// Applying AI-proposed changes (see server/changes.js) to the novel, and describing them for the UI.
import type { Change, CodexEntry, CodexFields, Novel, Scene } from './types';
import { blankScene, chapterNumber, findScene, flatScenes, newId, parseSceneText, sceneLabel, serializeScene } from './util';

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

/** A new scene built from AI text ("### Beat:" lines become beats). */
function sceneFromText(title: string, summary: string, text: string): Scene {
  const s = blankScene();
  const parsed = parseSceneText(text);
  s.title = title;
  s.summary = summary;
  s.blocks = parsed.blocks.length ? parsed.blocks : s.blocks;
  s.beats = parsed.beats;
  return s;
}

/** Apply one change to a (draft) novel. Returns the id of the scene to show afterwards, if any. */
export function applyChange(n: Novel, c: Change): string | undefined {
  if (c.kind === 'revision') {
    const s = findScene(n, c.sceneId!);
    if (!s) throw new Error('That scene no longer exists.');
    const parsed = parseSceneText(c.text!, s.beats || []);
    s.blocks = parsed.blocks;
    s.beats = parsed.beats;
    return s.id;
  }
  if (c.kind === 'sceneSummary') {
    const s = findScene(n, c.sceneId!);
    if (!s) throw new Error('That scene no longer exists.');
    s.summary = c.text!;
    return s.id;
  }
  if (c.kind === 'newScene') {
    const chapter = n.acts.flatMap((a) => a.chapters).find((x) => x.id === c.chapterId);
    if (!chapter) throw new Error('That chapter no longer exists.');
    const scene = sceneFromText(c.title || '', c.summary || '', c.text || '');
    const at = c.afterSceneId ? chapter.scenes.findIndex((s) => s.id === c.afterSceneId) : -1;
    chapter.scenes.splice(at >= 0 ? at + 1 : chapter.scenes.length, 0, scene);
    return scene.id;
  }
  if (c.kind === 'newChapter') {
    const scene = sceneFromText('', c.summary || '', c.text || '');
    const chapter = { id: newId(), title: c.title || '', scenes: [scene] };
    const act = n.acts.find((a) => a.chapters.some((x) => x.id === c.afterChapterId));
    if (act) act.chapters.splice(act.chapters.findIndex((x) => x.id === c.afterChapterId) + 1, 0, chapter);
    else (n.acts.at(-1) || (n.acts[0] = { id: newId(), title: '', chapters: [] })).chapters.push(chapter);
    return scene.id;
  }
  if (c.kind === 'codexEntry') {
    const f = c.codex!;
    const e = c.entryId ? n.codex.find((x) => x.id === c.entryId) : undefined;
    if (c.entryId && !e) throw new Error('That codex entry no longer exists.');
    if (e) Object.assign(e, { name: f.name, type: f.type as CodexEntry['type'], aliases: f.aliases, tags: f.tags, description: f.description });
    else n.codex.push({ id: newId(), type: f.type as CodexEntry['type'], name: f.name, aliases: f.aliases, tags: f.tags, description: f.description });
  }
  return undefined;
}

/** True when the thing a change replaces was edited after the AI saw it (accepting would overwrite those edits). */
export function isStale(n: Novel, c: Change): boolean {
  if (c.kind === 'revision') { const s = findScene(n, c.sceneId!); return !!s && norm(serializeScene(s)) !== norm(String(c.base || '')); }
  if (c.kind === 'sceneSummary') { const s = findScene(n, c.sceneId!); return !!s && norm(s.summary || '') !== norm(String(c.base || '')); }
  if (c.kind === 'codexEntry' && c.entryId && c.base) {
    const e = n.codex.find((x) => x.id === c.entryId);
    const b = c.base as CodexFields;
    return !!e && (e.name !== b.name || norm(e.description || '') !== norm(b.description));
  }
  return false;
}

/** Short human label: "Rewrite of Chapter 2 – Tea", "New chapter “Night”", "Codex: Mara (update)". */
export function changeLabel(n: Novel, c: Change): string {
  const ref = c.sceneId ? flatScenes(n).find((r) => r.scene.id === c.sceneId) : undefined;
  const chapterName = (id?: string | null) => { const ch = n.acts.flatMap((a) => a.chapters).find((x) => x.id === id); return ch ? `Chapter ${chapterNumber(n, ch.id)}${ch.title ? `: ${ch.title}` : ''}` : ''; };
  switch (c.kind) {
    case 'revision': return `Rewrite of ${ref ? sceneLabel(ref) : 'a deleted scene'}`;
    case 'sceneSummary': return `New summary for ${ref ? sceneLabel(ref) : 'a deleted scene'}`;
    case 'newScene': return `New scene${c.title ? ` “${c.title}”` : ''} in ${chapterName(c.chapterId) || 'a deleted chapter'}`;
    case 'newChapter': return `New chapter${c.title ? ` “${c.title}”` : ''}${c.afterChapterId ? ` after ${chapterName(c.afterChapterId)}` : ' at the end'}`;
    case 'codexEntry': return `Codex: ${c.codex?.name} (${c.entryId ? 'update' : 'new entry'})`;
  }
}

/** Where in the book a change shows up: the scene or chapter to open in Write/Read. */
export function changeScene(n: Novel, c: Change): string | undefined {
  if (c.sceneId) return c.sceneId;
  if (c.kind === 'newScene') return c.afterSceneId || n.acts.flatMap((a) => a.chapters).find((x) => x.id === c.chapterId)?.scenes.at(-1)?.id;
  if (c.kind === 'newChapter') return c.afterChapterId ? n.acts.flatMap((a) => a.chapters).find((x) => x.id === c.afterChapterId)?.scenes.at(-1)?.id : flatScenes(n).at(-1)?.scene.id;
  return undefined;
}
