import type { Beat, BeatBlock, Chapter, CodexEntry, Novel, Scene, TextBlock } from './types';

export const newId = () => {
  const a = new Uint8Array(9);
  crypto.getRandomValues(a);
  return btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

export const wordCount = (text: string) => (text.match(/[\p{L}\p{N}'’-]+/gu) || []).length;
export const sceneText = (s: Scene) => s.blocks.filter((b) => b.type === 'text').map((b) => b.text.trim()).filter(Boolean).join('\n\n');
export const sceneWords = (s: Scene) => s.blocks.reduce((n, b) => n + (b.type === 'text' ? wordCount(b.text) : 0), 0);
export const chapterWords = (c: Chapter) => c.scenes.reduce((n, s) => n + sceneWords(s), 0);
export const novelWords = (n: Novel) => n.acts.reduce((t, a) => t + a.chapters.reduce((u, c) => u + chapterWords(c), 0), 0);

export const blankScene = (): Scene => ({ id: newId(), title: '', summary: '', includeInAI: true, pov: null, labels: [], codexIds: [], blocks: [{ id: newId(), type: 'text', text: '' }], beats: [] });
export const blankChapter = (): Chapter => ({ id: newId(), title: '', scenes: [blankScene()] });

export type SceneRef = { scene: Scene; chapter: Chapter; actIndex: number; chapterNo: number; sceneNo: number };

export function flatScenes(n: Novel): SceneRef[] {
  const out: SceneRef[] = [];
  let chNo = 0;
  n.acts.forEach((act, actIndex) => act.chapters.forEach((chapter) => {
    chNo++;
    chapter.scenes.forEach((scene, i) => out.push({ scene, chapter, actIndex, chapterNo: chNo, sceneNo: i + 1 }));
  }));
  return out;
}

export function chapterNumber(n: Novel, chapterId: string) {
  let no = 0;
  for (const a of n.acts) for (const c of a.chapters) { no++; if (c.id === chapterId) return no; }
  return 0;
}

export function findScene(n: Novel, id: string): Scene | undefined {
  for (const a of n.acts) for (const c of a.chapters) for (const s of c.scenes) if (s.id === id) return s;
}

export const sceneLabel = (r: SceneRef) => `Chapter ${r.chapterNo} – ${r.scene.title || `Scene ${r.sceneNo}`}`;

// ---------- codex mentions ----------

const reCache = new Map<string, RegExp | null>();
export function entryRegex(e: CodexEntry, flags = 'iu'): RegExp | null {
  const names = [e.name, ...(e.aliases || [])].map((s) => s.trim()).filter((s) => s.length > 1);
  const key = names.join('|') + flags;
  if (!reCache.has(key)) {
    const alt = names.sort((a, b) => b.length - a.length).map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    reCache.set(key, alt ? new RegExp(`(?<![\\p{L}\\p{N}])(?:${alt})(?![\\p{L}\\p{N}])`, flags) : null);
  }
  return reCache.get(key) ?? null;
}

export const mentions = (codex: CodexEntry[], text: string) => (text ? codex.filter((e) => entryRegex(e)?.test(text)) : []);

export function mentionCount(e: CodexEntry, n: Novel) {
  const re = entryRegex(e, 'giu');
  if (!re) return 0;
  let count = 0;
  for (const r of flatScenes(n)) count += (sceneText(r.scene).match(re) || []).length;
  return count;
}

// ---------- beats: sections of text ----------

/** Text blocks of a scene (after normalizeScene there are no legacy beat blocks). */
export const textBlocks = (s: Scene) => s.blocks.filter((b): b is TextBlock => b.type === 'text');

/**
 * Bring a scene to the current shape: beats live in `scene.beats`, prose blocks point to them with `beatId`.
 * Old scenes had beat *headings* inside `blocks`; the text after each heading becomes that beat's section.
 * Returns true when anything changed.
 */
export function normalizeScene(s: Scene): boolean {
  let changed = false;
  if (!s.beats) { s.beats = []; changed = true; }
  if (s.blocks.some((b) => b.type === 'beat')) {
    const out: TextBlock[] = [];
    let current: string | undefined;
    for (const b of s.blocks) {
      if (b.type === 'beat') {
        const { type: _t, collapsed: _c, ...beat } = b as BeatBlock;
        s.beats.push(beat);
        current = beat.id;
      } else out.push({ ...b, beatId: b.beatId ?? current });
    }
    s.blocks = out;
    changed = true;
  }
  if (mergeBlocks(s)) changed = true;
  return changed;
}

export function normalizeNovel(n: Novel) {
  let changed = false;
  for (const a of n.acts) for (const c of a.chapters) for (const sc of c.scenes) if (normalizeScene(sc)) changed = true;
  return changed;
}

/** Join neighbouring prose blocks that belong to the same beat (or both to none); drop empty extras. */
export function mergeBlocks(s: Scene): boolean {
  const before = s.blocks.length;
  const out: TextBlock[] = [];
  for (const b of textBlocks(s)) {
    const prev = out.at(-1);
    if (prev && (prev.beatId || '') === (b.beatId || '')) {
      prev.text = [prev.text.replace(/\s+$/, ''), b.text.replace(/^\s+/, '')].filter(Boolean).join('\n\n');
    } else if (!b.text.trim() && out.length && b !== textBlocks(s).at(-1)) {
      continue; // an empty block between sections adds nothing
    } else out.push(b);
  }
  if (!out.length) out.push({ id: newId(), type: 'text', text: '' });
  s.blocks = out;
  return out.length !== before;
}

/** The prose that belongs to a beat. */
export const sectionText = (s: Scene, beatId: string) => textBlocks(s).filter((b) => b.beatId === beatId).map((b) => b.text.trim()).filter(Boolean).join('\n\n');

/** Paragraphs of a text, as Read mode and read-aloud both see them. */
export const paragraphs = (text: string) => text.split(/\n{2,}|\n/).map((p) => p.trim()).filter(Boolean);

export const BEAT_COLORS = ['#7c6fd6', '#d08a3c', '#3e9a8c', '#c25e8a', '#5b8bd0', '#8aa13d', '#b5654a', '#6d6d9e'];
export const beatColor = (s: Scene, beatId?: string) => {
  const i = (s.beats || []).findIndex((b) => b.id === beatId);
  return i < 0 ? 'transparent' : BEAT_COLORS[i % BEAT_COLORS.length];
};

// ---------- scene text <-> blocks (chat edit mode) ----------

export const BEAT_PREFIX = '### Beat:';
export const NO_BEAT = '### No beat';

/** Scene as plain text for the AI: a "### Beat: …" line starts each beat's section, "### No beat" ends one. */
export function serializeScene(s: Scene) {
  const out: string[] = [];
  let current = '';
  const beats = s.beats || [];
  for (const b of textBlocks(s)) {
    const id = b.beatId || '';
    if (id !== current) {
      const beat = beats.find((x) => x.id === id);
      out.push(beat ? `${BEAT_PREFIX} ${beat.text.trim()}` : NO_BEAT);
      current = id;
    }
    if (b.text.trim()) out.push(b.text.trim());
  }
  // Beats with no text yet are listed at the end so they survive a revision.
  for (const beat of beats) if (!textBlocks(s).some((b) => b.beatId === beat.id)) out.push(`${BEAT_PREFIX} ${beat.text.trim()}`);
  return out.join('\n\n');
}

/** Parse revised scene text back into blocks + beats. Beats whose text is unchanged keep their id and settings. */
export function parseSceneText(text: string, previousBeats: Beat[] = []): { blocks: TextBlock[]; beats: Beat[] } {
  const beats: Beat[] = [...previousBeats];
  const blocks: TextBlock[] = [];
  let prose: string[] = [];
  let current: string | undefined;
  const flush = () => { const t = prose.join('\n').trim(); if (t) blocks.push({ id: newId(), type: 'text', text: t, beatId: current }); prose = []; };
  for (const line of text.replace(/\r/g, '').split('\n')) {
    if (/^\s*#{1,6}\s*No beat\s*$/i.test(line)) { flush(); current = undefined; continue; }
    const m = line.match(/^\s*#{1,6}\s*Beat\s*:\s*(.*)$/i);
    if (!m) { prose.push(line); continue; }
    flush();
    const beatText = m[1].trim();
    let beat = beats.find((b) => b.text.trim().toLowerCase() === beatText.toLowerCase());
    if (!beat) { beat = { id: newId(), text: beatText, words: '400' }; beats.push(beat); }
    current = beat.id;
  }
  flush();
  const scene = { blocks, beats } as unknown as Scene;
  mergeBlocks(scene);
  return { blocks: scene.blocks as TextBlock[], beats };
}

export type ReplyPart = { kind: 'text'; text: string } | { kind: 'revision'; ref: string; text: string; complete: boolean };

/** Split an AI reply into prose and <revision scene="REF"> blocks (the last one may still be streaming). */
export function parseReply(content: string): ReplyPart[] {
  const parts: ReplyPart[] = [];
  const re = /<revision\s+scene="([^"]+)"\s*>([\s\S]*?)(<\/revision>|$)/g;
  let last = 0;
  for (const m of content.matchAll(re)) {
    if (m.index! > last) parts.push({ kind: 'text', text: content.slice(last, m.index) });
    parts.push({ kind: 'revision', ref: m[1].trim(), text: m[2].trim(), complete: m[3] === '</revision>' });
    last = m.index! + m[0].length;
  }
  if (last < content.length) parts.push({ kind: 'text', text: content.slice(last) });
  return parts.filter((p) => p.kind === 'revision' || p.text.trim());
}

const plain = (s: string) => s.replace(/\*\*|__|\*|_|`/g, '').trim();

/**
 * Story beats in a reply: a numbered list ("1. Alex enters…"), or "Beat 1: Title" headings,
 * in which case the title is joined with the first sentence of the paragraph under it.
 */
export function numberedItems(text: string) {
  const list = [...text.matchAll(/^\s*\d+[.)]\s+(.+)$/gm)].map((m) => plain(m[1])).filter(Boolean);
  if (list.length >= 2) return list;
  const lines = text.replace(/\r/g, '').split('\n');
  const beats: string[] = [];
  lines.forEach((line, i) => {
    const m = plain(line.replace(/^#+\s*/, '')).match(/^Beat\s+\d+\s*[:.–—-]\s*(.+)$/i);
    if (!m) return;
    const title = m[1].replace(/^["“]|["”]$/g, '').trim();
    const para = lines.slice(i + 1).find((l) => l.trim());
    const first = para && !/^\s*(#|Beat\s+\d)/i.test(plain(para)) ? plain(para).match(/^.*?[.!?](?=\s|$)/)?.[0] : '';
    beats.push(first ? `${title}: ${first}` : title);
  });
  return beats.length >= 2 ? beats : list;
}

export const sceneRef = (r: SceneRef) => `${r.chapterNo}.${r.sceneNo}`;

// ---------- misc ----------

export function timeAgo(iso: string) {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`;
  return new Date(iso).toLocaleDateString();
}

export const fmtDate = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export function moveItem<T>(list: T[], from: number, to: number) {
  if (to < 0 || to >= list.length) return;
  const [x] = list.splice(from, 1);
  list.splice(to, 0, x);
}


export const LANGUAGES = ['General English', 'US English', 'UK English', 'Australian English', 'Canadian English', 'French', 'German', 'Spanish'];
