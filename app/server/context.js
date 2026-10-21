// Builds the template environment for a task and renders a prompt into chat messages.
// Output formats (codex XML, storySoFar, scene wrappers, POV tag) match captured NovelCrafter requests.
import { renderTemplate, tidy } from './template.js';
import { codexXml, createFunctions, esc, lastWords, mentionedIds, OutlineItem, sceneText } from './functions.js';
import { effectiveInputs, findComponent } from './inputs.js';

export { codexXml, mentionedIds, sceneText };
const words = (text) => (text || '').split(/\s+/).filter(Boolean);

// ---------- manuscript helpers ----------

/** Scenes in reading order with their act/chapter/scene numbers. */
export function flatScenes(novel) {
  const out = [];
  novel.acts.forEach((act, ai) => act.chapters.forEach((ch, ci) => ch.scenes.forEach((sc, si) => {
    out.push({ scene: sc, act, chapter: ch, actNo: ai + 1, chapterNo: chapterNumber(novel, act, ci), sceneNo: si + 1 });
  })));
  return out;
}
function chapterNumber(novel, act, ci) {
  let n = 0;
  for (const a of novel.acts) { if (a === act) return n + ci + 1; n += a.chapters.length; }
  return ci + 1;
}

function sceneXml(info) {
  const title = `Chapter ${info.chapterNo} - ${info.scene.title || `Scene ${info.sceneNo}`}`;
  return `<scene title="${esc(title)}" number="${info.sceneNo}">${sceneText(info.scene)}</scene>`;
}

/** <storySoFar> outline of all scenes before `sceneId` (all scenes when null), using summaries. */
export function storySoFar(novel, sceneId) {
  const flat = flatScenes(novel);
  const stop = sceneId ? flat.findIndex((f) => f.scene.id === sceneId) : flat.length;
  return String(new OutlineItem(flat.slice(0, stop < 0 ? flat.length : stop)));
}

// ---------- codex ----------

/** Entries relevant for `text`: always-included + mentioned + explicit ids, then one level of nested mentions. */
export function relevantCodex(novel, text, extraIds = []) {
  const ids = new Set([...novel.codex.filter((e) => e.alwaysInclude).map((e) => e.id), ...mentionedIds(novel.codex, text), ...extraIds]);
  const nested = novel.codex.filter((e) => ids.has(e.id)).map((e) => e.description).join('\n');
  for (const id of mentionedIds(novel.codex, nested)) ids.add(id);
  return novel.codex.filter((e) => ids.has(e.id) && e.includeInAI !== false);
}

// ---------- additional context ----------

/** Turn the context picker's selections into XML strings (+ codex ids, which go to the codex block). */
export function resolveContext(novel, items = []) {
  const xml = [], codexIds = [];
  const flat = flatScenes(novel);
  for (const item of items) {
    if (item.type === 'codex') codexIds.push(item.id);
    else if (item.type === 'outline') { const s = storySoFar(novel, null); if (s) xml.push(s.replace('storySoFar>', 'novelOutline>').replace('</storySoFar>', '</novelOutline>')); }
    else if (item.type === 'manuscript') xml.push(`<manuscript>\n${flat.map(sceneXml).join('\n')}\n</manuscript>`);
    else if (item.type === 'scene') { const f = flat.find((x) => x.scene.id === item.id); if (f) xml.push(sceneXml(f)); }
    else if (item.type === 'sceneSummary') { const f = flat.find((x) => x.scene.id === item.id); if (f?.scene.summary) xml.push(`<sceneSummary title="${esc(`Chapter ${f.chapterNo} - ${f.scene.title || `Scene ${f.sceneNo}`}`)}">${f.scene.summary}</sceneSummary>`); }
    else if (item.type === 'chapter') {
      const fs = flat.filter((x) => x.chapter.id === item.id);
      if (fs.length) xml.push(`<chapter number="${fs[0].chapterNo}"${fs[0].chapter.title ? ` title="${esc(fs[0].chapter.title)}"` : ''}>\n${fs.map(sceneXml).join('\n')}\n</chapter>`);
    } else if (item.type === 'act') {
      const fs = flat.filter((x) => x.act.id === item.id);
      if (fs.length) xml.push(`<act number="${fs[0].actNo}"${fs[0].act.title ? ` title="${esc(fs[0].act.title)}"` : ''}>\n${fs.map(sceneXml).join('\n')}\n</act>`);
    } else if (item.type === 'text' && item.text?.trim()) xml.push(item.text.trim());
  }
  return { xml, codexIds };
}

// ---------- point of view reminder ----------

const POV_RULES = {
  'first person': (c) => `first person ("I"), narrated by ${c || 'the protagonist'}. Write every passage of prose in first person from ${c || 'the narrator'}'s perspective; never switch to third person ("he"/"she" for the narrator)`,
  'first person peripheral': (c) => `first person ("I"), narrated by ${c || 'a witness character'} who observes the main characters rather than being the protagonist. Keep the narrator's "I" voice and limit inner thoughts to the narrator's own`,
  'first person multiple': (c) => `first person ("I") with alternating narrators; ${c ? `this part is narrated by ${c}` : 'each scene has its own narrator'}. Keep the "I" voice of the current narrator and do not switch to third person`,
  'second person': (c) => `second person ("you")${c ? `, addressing ${c}` : ''}. Keep the "you" narration and do not switch to "I" or "he/she"`,
  'third person': (c) => `third person ("he"/"she"/"they")${c ? `, following ${c}` : ''}. Do not switch to first person`,
  'third person limited': (c) => `close third person limited, staying inside ${c || 'the viewpoint character'}'s head: only what they perceive, know and think. Use "he"/"she"/"they", never first person`,
  'third person multiple': (c) => `third person limited with rotating viewpoint characters; ${c ? `this part follows ${c}` : 'each scene follows one viewpoint character'}. Stay in that one character's head per scene and never switch to first person`,
  'third person omniscient': () => 'third person omniscient: a narrator who can know and reveal any character\'s thoughts and comment on events. Use "he"/"she"/"they", not first person',
  'third person objective': () => 'third person objective: describe only what can be seen and heard, like a camera, without stating any character\'s inner thoughts. Use "he"/"she"/"they", not first person',
};

/** A plain-language POV rule added to writing/chat requests unless the novel turns it off. */
export function povInstruction(novel, sceneId) {
  if (novel.povReminder === false) return '';
  const info = sceneId ? flatScenes(novel).find((f) => f.scene.id === sceneId) : null;
  const pov = povFor(novel, info?.scene);
  const rule = (POV_RULES[pov.type] || POV_RULES['third person'])(pov.character);
  return `Point of view: this novel is written in ${rule}. Tense: ${novel.tense || 'past tense'}. Follow both in any prose you write, unless the author explicitly asks for something else.`;
}

// ---------- chat edit mode ----------

export const BEAT_PREFIX = '### Beat:';

/** Scene as editable text: "### Beat: …" starts each beat's section, "### No beat" starts unassigned text. */
export function serializeScene(scene) {
  const s = normalizeScene(structuredClone(scene));
  const out = [];
  let current = '';
  for (const b of s.blocks) {
    const id = b.beatId || '';
    if (id !== current) {
      const beat = s.beats.find((x) => x.id === id);
      out.push(beat ? `${BEAT_PREFIX} ${beat.text.trim()}` : '### No beat');
      current = id;
    }
    if (b.text.trim()) out.push(b.text.trim());
  }
  // Beats with no text yet are listed at the end so they survive a revision.
  for (const beat of s.beats) if (!s.blocks.some((b) => b.beatId === beat.id)) out.push(`${BEAT_PREFIX} ${beat.text.trim()}`);
  return out.join('\n\n');
}

/**
 * Current scene shape: a `beats` list plus prose blocks that point to a beat with `beatId`. Older scenes kept
 * beat headings inside `blocks`; the text after each heading becomes that beat's section. Mutates the scene.
 */
export function normalizeScene(scene) {
  scene.beats ||= [];
  if (scene.blocks.some((b) => b.type === 'beat')) {
    const out = [];
    let current;
    for (const b of scene.blocks) {
      if (b.type === 'beat') {
        const { type: _type, collapsed: _collapsed, ...beat } = b;
        scene.beats.push(beat);
        current = beat.id;
      } else out.push({ ...b, beatId: b.beatId ?? current });
    }
    scene.blocks = out;
  }
  return scene;
}

/**
 * Extra system text for chats: the edit tags the AI may use (scene rewrites, new scenes and chapters, summaries,
 * codex entries), a map of the book with scene refs, the codex entries not already shown in full, and the text of
 * the part the author picked under "Working on" (a scene, a chapter or the whole novel).
 */
export function editingInstructions(novel, target, shownCodex = []) {
  const flat = flatScenes(novel);
  const editable = !target ? [] : flat.filter((f) => target.type === 'novel' || (target.type === 'scene' ? f.scene.id === target.id : f.chapter.id === target.id));
  const ref = (f) => `${f.chapterNo}.${f.sceneNo}`;

  const map = [];
  let chapter = null;
  for (const f of flat) {
    if (f.chapter !== chapter) {
      if (chapter) map.push('  </chapter>');
      map.push(`  <chapter number="${f.chapterNo}"${f.chapter.title ? ` title="${esc(f.chapter.title)}"` : ''}>`);
      chapter = f.chapter;
    }
    const words = sceneText(f.scene).split(/\s+/).filter(Boolean).length;
    const summary = (f.scene.summary || '').trim().replace(/\s+/g, ' ');
    const short = summary.length > 160 ? `${summary.slice(0, 160)}…` : summary;
    map.push(`    <scene ref="${ref(f)}" title="${esc(f.scene.title || `Scene ${f.sceneNo}`)}" words="${words}"${short ? '' : '/'}>${short ? `${short}</scene>` : ''}`);
  }
  if (chapter) map.push('  </chapter>');

  const shown = new Set(shownCodex.map((n) => n.toLowerCase()));
  const others = novel.codex.filter((e) => !shown.has(e.name.toLowerCase()));
  const codexList = others.map((e) => `- ${e.name} (${e.type || 'other'}${e.aliases?.length ? `; aliases: ${e.aliases.join(', ')}` : ''})`).join('\n');

  const body = editable.map((f) => {
    const title = `Chapter ${f.chapterNo} - ${f.scene.title || `Scene ${f.sceneNo}`}`;
    return `<scene ref="${ref(f)}" title="${esc(title)}">\n${serializeScene(f.scene) || '(empty)'}\n</scene>`;
  }).join('\n');

  return `You can change the author's story and codex directly. The author reviews every change and accepts or rejects it before anything is applied, so when they ask for a change, make it with the tags below instead of only describing it. Each tag holds the COMPLETE new content:
- Change or add specific passages in an existing scene (preferred for targeted edits, one tag per edit, as many tags as needed):
  <passage scene="REF"><find>exact current text</find><replace>new text</replace></passage> replaces the found text.
  <passage scene="REF"><find>exact current text</find><insert>new paragraph(s)</insert></passage> adds new paragraphs right after the paragraph containing the found text (add position="before" to put them before it).
  The <find> text must be copied exactly from the manuscript as you have seen it (a sentence or two is enough, but it must be unique in the scene). Only use text you have actually seen in this conversation.
- Rewrite a whole scene: <revision scene="REF">full new text of the scene</revision>. Only for scenes whose current text is in <manuscriptForEditing>, and only when most of the scene changes; for a few sentences use <passage>.
- Add a scene to a chapter: <newScene chapter="CHAPTER NUMBER" after="REF" title="Scene title" summary="Short summary">full text of the scene</newScene>. "after" is optional; without it the scene goes at the end of the chapter.
- Add a chapter: <newChapter after="CHAPTER NUMBER" title="Chapter title" summary="Short summary">full text of its first scene</newChapter>. "after" is the number of the chapter it follows; without it the chapter goes at the end of the book.
- Change a scene's summary: <sceneSummary scene="REF">new summary</sceneSummary>
- Update or create a codex entry: <codexEntry name="Exact name" type="character|location|object|lore|subplot|other" aliases="comma, separated" tags="comma, separated">full description</codexEntry>. A name that matches an existing entry (or one of its aliases) updates it; any other name creates a new entry. Leave out attributes you don't want to change; add newName="..." to rename. If you have not seen an entry's full description, add mode="append" so your text is added to the end of it instead of replacing it.

Inside scene text:
- Keep story beats as their own lines starting with "${BEAT_PREFIX}" followed by the beat; the prose that belongs to that beat goes underneath. A line "### No beat" starts text that belongs to no beat. You may add, reword or remove beats when asked.
- Write only the manuscript text: no commentary, no Markdown formatting other than the beat lines. Separate paragraphs with a blank line.
Only include what you actually change. Outside the tags, briefly explain what you changed and why. If the author only asks for feedback, questions or ideas, answer normally without tags.

Scene refs are "chapter.scene" numbers. This is the book as it stands (scene summaries shortened):
<storyMap>
${map.join('\n')}
</storyMap>
${others.length ? `\nOther codex entries (their descriptions are not shown here):\n${codexList}\n` : ''}${body ? `
The author is working on this part of the manuscript with you. This is its current text:
<manuscriptForEditing>
${body}
</manuscriptForEditing>` : `
No scene text was shared for editing (the author can pick a scene, chapter or the whole novel under "Working on"). You can still edit passages you have seen in this conversation with <passage>, add scenes and chapters, change summaries and edit the codex. To rewrite text you have not seen, ask the author to pick it under "Working on".`}`;
}

// ---------- rendering ----------

/** A scene's paragraphs as "Beats from Text" numbers them (blank lines separate paragraphs). Same rule as the UI. */
export const sceneParagraphs = (scene) => scene.blocks.filter((b) => b.type === 'text')
  .flatMap((b) => b.text.split(/\n\s*\n/)).map((p) => p.trim()).filter(Boolean);

function povFor(novel, scene) {
  const p = scene?.pov?.type ? scene.pov : novel.pov || { type: 'third person' };
  return { type: p.type || 'third person', character: p.character || '' };
}

/**
 * Render `prompt` for a task.
 * task: { kind:'beat', sceneId, beatId } | { kind:'summary', sceneId } | { kind:'replace', sceneId, blockId, start, end }
 *     | { kind:'chat', history:[{role,content}], message } | { kind:'beatsFromText', sceneId }
 */
export function buildMessages({ novel: original, settings, prompt, prompts, task, inputs = {}, context = [], model = '' }) {
  const novel = structuredClone(original);
  for (const a of novel.acts) for (const c of a.chapters) for (const sc of c.scenes) normalizeScene(sc);
  const flat = flatScenes(novel);
  const cur = flat.find((f) => f.scene.id === task.sceneId) || null;
  const scene = cur?.scene;
  const extra = resolveContext(novel, context);

  // NovelCrafter only knows "text before/after" when there is a position in a scene (beats and rewrites).
  const contents = { message: '' };
  let scanText = '';
  if (task.kind === 'beat' && scene) {
    const beat = scene.beats.find((b) => b.id === task.beatId);
    if (!beat) throw Object.assign(new Error('Beat not found'), { status: 400 });
    contents.message = beat.text || '';
    // New text continues from the end of the beat's section (or the end of the scene if it has none yet).
    const last = scene.blocks.map((b) => b.beatId).lastIndexOf(beat.id);
    const cut = last >= 0 ? last + 1 : scene.blocks.length;
    contents.textBefore = scene.blocks.slice(0, cut).map((b) => b.text.trim()).filter(Boolean).join('\n\n');
    contents.textAfter = scene.blocks.slice(cut).map((b) => b.text.trim()).filter(Boolean).join('\n\n');
    if (words(contents.textBefore).length > 3000) contents.textBefore = lastWords(contents.textBefore, 3000);
    scanText = contents.message;
  } else if (task.kind === 'replace' && scene) {
    const bi = scene.blocks.findIndex((b) => b.id === task.blockId);
    const blk = scene.blocks[bi];
    if (!blk) throw Object.assign(new Error('Text block not found'), { status: 400 });
    contents.message = blk.text.slice(task.start, task.end);
    const before = scene.blocks.slice(0, bi).filter((b) => b.type === 'text').map((b) => b.text);
    const after = scene.blocks.slice(bi + 1).filter((b) => b.type === 'text').map((b) => b.text);
    contents.textBefore = [...before, blk.text.slice(0, task.start)].join('\n\n').trim();
    contents.textAfter = [blk.text.slice(task.end), ...after].join('\n\n').trim();
    // Text written under a story beat is rewritten with that beat in mind.
    const beat = scene.beats.find((b) => b.id === blk.beatId && b.text.trim());
    if (beat) extra.xml.unshift(`<storyBeat>\nThe text being rewritten belongs to this story beat; keep it consistent with it:\n${beat.text.trim()}\n</storyBeat>`);
    scanText = [contents.message, beat?.text || ''].join('\n');
  } else if (task.kind === 'beatsFromText' && scene) {
    // The scene's paragraphs, numbered, so the AI can say which paragraphs each beat covers.
    contents.message = sceneParagraphs(scene).map((p, i) => `[${i + 1}] ${p}`).join('\n\n');
    scanText = contents.message;
  } else if (task.kind === 'chat') {
    contents.message = task.message || '';
    scanText = [...(task.history || []).map((m) => m.content), contents.message, ...extra.xml].join('\n');
  }

  const inputDefs = effectiveInputs(prompt, prompts);
  // A scene picked in an input (e.g. "Scene Beats from Summary") also counts for codex detection.
  for (const d of inputDefs.filter((x) => x.types.includes('scene'))) {
    const m = /^scene:(.+)$/.exec(String(inputs[d.name] || ''));
    const f = m && flat.find((x) => x.scene.id === m[1]);
    if (f) scanText += `\n${f.scene.summary || ''}`;
  }
  const codexEntries = task.kind === 'summary' ? [] : relevantCodex(novel, scanText, [...extra.codexIds, ...(scene?.codexIds || [])]);

  const ctx = { vars: {}, fns: null };
  ctx.fns = createFunctions({
    novel, flat, cur, task, contents, extra, inputDefs, inputs, settings, model, locals: {},
    codexContext: codexEntries,
    include: (name) => {
      const comp = findComponent(prompts, name);
      if (!comp) throw new Error(`Component with name "${name}" not found. Make sure the component exists in your prompt library.`);
      return renderTemplate(comp.messages[0].content, ctx);
    },
  });

  const messages = [];
  for (const m of prompt.messages) {
    const content = tidy(renderTemplate(m.content, ctx));
    if (content) messages.push({ role: m.role, content });
  }
  if (task.kind === 'chat') {
    for (const h of task.history || []) if (h.content?.trim()) messages.push({ role: h.role, content: h.content });
    messages.push({ role: 'user', content: contents.message });
  }
  return { messages, codex: codexEntries.map((e) => e.name) };
}
