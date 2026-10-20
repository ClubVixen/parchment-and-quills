// AI-proposed changes. Chat replies may contain edit tags; each one becomes a pending change the author accepts
// or rejects in the manuscript, the codex or the chat. Scene and chapter references are resolved to ids when the
// change is created, so they stay correct if the book is reorganised before the author gets to them.
import { flatScenes, serializeScene } from './context.js';

export const EDIT_TAGS = ['revision', 'newScene', 'newChapter', 'sceneSummary', 'codexEntry'];
const TAG_RE = new RegExp(`<(${EDIT_TAGS.join('|')})\\b([^>]*)>([\\s\\S]*?)<\\/\\1>`, 'g');
const unesc = (s) => s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const list = (s) => (s == null ? undefined : s.split(',').map((x) => x.trim()).filter(Boolean));
const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const CODEX_TYPES = ['character', 'location', 'object', 'lore', 'subplot', 'other'];

/** Every complete edit tag in a reply, in order: { tag, attrs, body }. */
export function parseEdits(content) {
  const out = [];
  for (const m of content.matchAll(TAG_RE)) {
    const attrs = {};
    for (const a of m[2].matchAll(/([A-Za-z]+)\s*=\s*"([^"]*)"/g)) attrs[a[1]] = unesc(a[2]);
    out.push({ tag: m[1], attrs, body: m[3].replace(/^\s*\n/, '').replace(/\s+$/, '') });
  }
  return out;
}

/** Turn a reply's edit tags into change records. Edits that point nowhere or change nothing are dropped. */
export function changesFromReply(novel, content, { threadId, messageId, newId }) {
  const flat = flatScenes(novel);
  const chapters = novel.acts.flatMap((a) => a.chapters);
  const byRef = (ref) => flat.find((f) => `${f.chapterNo}.${f.sceneNo}` === String(ref || '').trim());
  const chapterByNo = (no) => chapters[Number(no) - 1];
  const entryByName = (name) => {
    const k = norm(name).toLowerCase();
    return k ? novel.codex.find((e) => e.name.trim().toLowerCase() === k || (e.aliases || []).some((a) => a.trim().toLowerCase() === k)) : undefined;
  };
  const out = [];
  parseEdits(content).forEach(({ tag, attrs, body }, index) => {
    const base = { id: newId(), threadId, messageId, index, kind: tag, status: 'pending', createdAt: new Date().toISOString() };
    if (tag === 'revision') {
      const f = byRef(attrs.scene);
      if (!f || norm(serializeScene(f.scene)) === norm(body)) return;
      out.push({ ...base, sceneId: f.scene.id, base: serializeScene(f.scene), text: body });
    } else if (tag === 'newScene') {
      const after = byRef(attrs.after);
      const chapter = chapterByNo(attrs.chapter) || after?.chapter;
      if (!chapter || !body.trim()) return;
      out.push({ ...base, chapterId: chapter.id, afterSceneId: after?.chapter === chapter ? after.scene.id : null, title: attrs.title || '', summary: attrs.summary || '', text: body });
    } else if (tag === 'newChapter') {
      if (!body.trim() && !attrs.summary) return;
      out.push({ ...base, afterChapterId: chapterByNo(attrs.after)?.id || null, title: attrs.title || '', summary: attrs.summary || '', text: body });
    } else if (tag === 'sceneSummary') {
      const f = byRef(attrs.scene);
      if (!f || norm(f.scene.summary) === norm(body)) return;
      out.push({ ...base, sceneId: f.scene.id, base: f.scene.summary || '', text: body.trim() });
    } else if (tag === 'codexEntry') {
      const entry = entryByName(attrs.name);
      const type = CODEX_TYPES.includes((attrs.type || '').toLowerCase()) ? attrs.type.toLowerCase() : undefined;
      const codex = {
        name: (attrs.newName || attrs.name || '').trim(), type, aliases: list(attrs.aliases), tags: list(attrs.tags),
        mode: attrs.mode === 'append' ? 'append' : 'replace', description: body.trim(),
      };
      if (!codex.name) return;
      if (entry) {
        const before = { name: entry.name, type: entry.type, aliases: entry.aliases || [], tags: entry.tags || [], description: entry.description || '' };
        const after = {
          name: codex.name, type: type || entry.type, aliases: codex.aliases ?? before.aliases, tags: codex.tags ?? before.tags,
          description: !codex.description ? before.description : codex.mode === 'append' ? `${before.description.trim()}\n\n${codex.description}`.trim() : codex.description,
        };
        if (JSON.stringify(before) === JSON.stringify(after)) return;
        out.push({ ...base, entryId: entry.id, base: before, codex: after });
      } else {
        out.push({ ...base, entryId: null, base: null, codex: { name: codex.name, type: type || 'other', aliases: codex.aliases || [], tags: codex.tags || [], description: codex.description } });
      }
    }
  });
  return out;
}
