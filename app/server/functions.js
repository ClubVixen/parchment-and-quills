// NovelCrafter's template function library, mapped onto this app's data. Names, sections and behaviour follow
// NovelCrafter's registry (build f0d346): every {name} or {name(args)} in a prompt is one of these.
// Values are strings, numbers, booleans, arrays (lists) or the item classes below, which render themselves.
import { toStr, truthy } from './template.js';
import { inputValue } from './inputs.js';

export const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const words = (text) => (text || '').split(/\s+/).filter(Boolean);
const stripXml = (s) => toStr(s).replace(/<[^>]+>/g, '');
export const lastWords = (text, n) => words(stripXml(text)).slice(-n).join(' ');
export const firstWords = (text, n) => words(stripXml(text)).slice(0, n).join(' ');
const indent = (s, pad) => s.split('\n').map((l) => (l ? pad + l : l)).join('\n');
const flatList = (args) => args.flat(Infinity).filter((x) => x != null && x !== '' && x !== false);
const lower = (s) => toStr(s).trim().toLowerCase();

// ---------- manuscript items ----------

export const sceneText = (scene) => scene.blocks.filter((b) => b.type === 'text').map((b) => b.text.trim()).filter(Boolean).join('\n\n');
const sceneTitle = (info) => info.scene.title || `Scene ${info.sceneNo}`;
const fullTitle = (info) => `Chapter ${info.chapterNo} - ${sceneTitle(info)}`;

export class SceneItem {
  constructor(info, mode = 'content') { this.info = info; this.mode = mode; }
  get kind() { return 'scene'; }
  body() { return this.mode === 'summary' ? (this.info.scene.summary || '').trim() : sceneText(this.info.scene); }
  toString() { return `<scene title="${esc(fullTitle(this.info))}" number="${this.info.sceneNo}">${this.body()}</scene>`; }
  truthy() { return true; }
}

class GroupItem {
  constructor(kind, infos, mode, attrs) { this.kind = kind; this.infos = infos; this.mode = mode; this.attrs = attrs; }
  scenes() { return this.infos.filter((f) => f.scene.includeInAI !== false && (this.mode !== 'summary' || f.scene.summary?.trim())).map((f) => new SceneItem(f, this.mode)); }
  toString() {
    const attrs = Object.entries(this.attrs).filter(([, v]) => v !== '' && v != null).map(([k, v]) => ` ${k}="${esc(v)}"`).join('');
    return `<${this.kind}${attrs}>\n${this.scenes().map(String).join('\n')}\n</${this.kind}>`;
  }
  truthy() { return this.infos.length > 0; }
}

/** Acts → chapters → scenes, as NovelCrafter's <storySoFar> outline (summaries) or with the full text. */
export class OutlineItem {
  constructor(infos, mode = 'summary', tag = 'storySoFar') { this.infos = infos.filter((f) => f.scene.includeInAI !== false); this.mode = mode; this.tag = tag; }
  get kind() { return 'outline'; }
  scenes() { return this.infos.map((f) => new SceneItem(f, this.mode)); }
  toString() {
    if (!this.infos.length) return '';
    const lines = [`<${this.tag}>`];
    let act = null, chapter = null;
    for (const f of this.infos) {
      if (f.chapter !== chapter && chapter) lines.push('    </chapter>');
      if (f.act !== act) {
        if (act) lines.push('  </act>');
        lines.push(`  <act number="${f.actNo}"${f.act.title ? ` title="${esc(f.act.title)}"` : ''}>`);
        act = f.act;
      }
      if (f.chapter !== chapter) {
        lines.push(`    <chapter number="${f.chapterNo}"${f.chapter.title ? ` title="${esc(f.chapter.title)}"` : ''}>`);
        chapter = f.chapter;
      }
      const attrs = `title="${esc(sceneTitle(f))}" number="${f.sceneNo}"`;
      const body = this.mode === 'summary' ? f.scene.summary?.trim() : sceneText(f.scene);
      lines.push(body ? `      <scene ${attrs}>${body}</scene>` : `      <scene ${attrs}/>`);
    }
    lines.push('    </chapter>', '  </act>', `</${this.tag}>`);
    return lines.join('\n');
  }
  truthy() { return this.infos.length > 0; }
}

export class CodexItem {
  constructor(entry) { this.entry = entry; }
  get kind() { return 'codex'; }
  toString() { return codexXml([this.entry]); }
  truthy() { return true; }
}

export function codexXml(entries) {
  return entries.map((e) => {
    const tag = (e.type || 'other').toLowerCase().replace(/[^a-z]/g, '') || 'other';
    const aliases = (e.aliases || []).filter(Boolean);
    const attrs = `name="${esc(e.name)}"${aliases.length ? ` aliases="${esc(aliases.join(', '))}"` : ''}`;
    const body = (e.description || '').trim();
    return body.includes('\n') ? `<${tag} ${attrs}>\n${indent(body, '  ')}\n</${tag}>` : `<${tag} ${attrs}>${body}</${tag}>`;
  }).join('\n');
}

export class PovItem {
  constructor(pov) { this.type = pov.type || 'third person'; this.character = pov.character || ''; }
  get kind() { return 'pov'; }
  toString() { return `<pointOfView type="${esc(this.type)}"${this.character ? ` character="${esc(this.character)}"` : ''}/>`; }
  truthy() { return !!this.type; }
}

// ---------- codex matching ----------

const reCache = new Map();
function entryRegex(entry) {
  const names = [entry.name, ...(entry.aliases || [])].map((s) => s.trim()).filter((s) => s.length > 1);
  const key = names.join('|');
  if (!reCache.has(key)) {
    const alt = names.sort((a, b) => b.length - a.length).map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    reCache.set(key, alt ? new RegExp(`(?<![\\p{L}\\p{N}])(?:${alt})(?![\\p{L}\\p{N}])`, 'iu') : null);
  }
  return reCache.get(key);
}
export const mentionedIds = (codex, text) => (text ? codex.filter((e) => entryRegex(e)?.test(text)).map((e) => e.id) : []);

// ---------- the library ----------

/**
 * env: { novel, flat, cur, task, contents: { message, textBefore?, textAfter? }, codexContext: entries, extra,
 *        inputDefs, inputs, settings, model, locals, include(name) }
 */
export function createFunctions(env) {
  const { novel, flat } = env;
  const visible = flat.filter((f) => f.scene.includeInAI !== false);
  const curIdx = env.cur ? flat.indexOf(env.cur) : -1;
  const lang = novel.language || 'General English';
  const povOf = (scene) => {
    const p = scene?.pov?.type ? scene.pov : novel.pov || { type: 'third person' };
    return new PovItem({ type: p.type || 'third person', character: p.character || '' });
  };

  // Pull typed items out of whatever the template passed in.
  const scenesFrom = (args, mode) => {
    if (!args.length) return env.cur ? [new SceneItem(env.cur, mode)] : [];
    const out = [];
    for (const a of flatList(args)) {
      if (a instanceof SceneItem) out.push(mode ? new SceneItem(a.info, mode) : a);
      else if (a instanceof OutlineItem || a instanceof GroupItem) out.push(...a.infos.map((f) => new SceneItem(f, mode || a.mode)));
      else if (typeof a === 'string') { const f = flat.find((x) => lower(x.scene.title) === lower(a)); if (f) out.push(new SceneItem(f, mode)); }
    }
    return out.filter((s) => s.info.scene.includeInAI !== false);
  };
  const chapterGroup = (chapter, mode) => {
    const infos = flat.filter((f) => f.chapter === chapter);
    return new GroupItem('chapter', infos, mode, { number: infos[0]?.chapterNo ?? '', title: chapter.title || '' });
  };
  const actGroup = (act, mode) => new GroupItem('act', flat.filter((f) => f.act === act), mode, { number: novel.acts.indexOf(act) + 1, title: act.title || '' });
  const chaptersFrom = (args) => {
    if (!args.length) return env.cur ? [env.cur.chapter] : [];
    const out = new Set();
    for (const a of flatList(args)) {
      if (a instanceof SceneItem) out.add(a.info.chapter);
      else if (a?.kind === 'chapter') a.infos[0] && out.add(a.infos[0].chapter);
      else if (a instanceof OutlineItem || a?.kind === 'act') a.infos.forEach((f) => out.add(f.chapter));
    }
    return [...out];
  };
  const actsFrom = (args) => {
    if (!args.length) return env.cur ? [env.cur.act] : [];
    const out = new Set();
    for (const a of flatList(args)) {
      if (a instanceof SceneItem) out.add(a.info.act);
      else if (a instanceof GroupItem || a instanceof OutlineItem) a.infos.forEach((f) => out.add(f.act));
    }
    return [...out];
  };
  const allChapters = novel.acts.flatMap((a) => a.chapters);
  const entriesFrom = (args) => {
    if (!args.length) return env.codexContext;
    const out = [];
    for (const a of flatList(args)) {
      if (a instanceof CodexItem) out.push(a.entry);
      else if (typeof a === 'string') {
        const e = novel.codex.find((x) => lower(x.name) === lower(a) || (x.aliases || []).some((al) => lower(al) === lower(a)));
        if (e) out.push(e);
      }
    }
    return [...new Set(out)];
  };
  const codexList = (entries) => entries.filter((e) => e.includeInAI !== false).map((e) => new CodexItem(e));
  const ofType = (type) => (...args) => codexList(entriesFrom(args).filter((e) => (e.type || 'other') === type));
  const relatedIds = (entry) => mentionedIds(novel.codex, `${entry.description || ''}\n${entry.research || ''}`).filter((id) => id !== entry.id);
  const titleOf = (x) => (x instanceof SceneItem ? sceneTitle(x.info) : x instanceof CodexItem ? x.entry.name : x?.attrs?.title ?? toStr(x));
  const plain = (x) => (x instanceof SceneItem ? x.body() : x instanceof CodexItem ? (x.entry.description || '') : stripXml(x));
  const num = (x) => Number(toStr(x).trim());
  const list = (args) => flatList(args);
  const outline = (stopAt, startAt, mode, tag) => {
    const from = startAt == null ? 0 : startAt;
    const to = stopAt == null ? flat.length : stopAt;
    return new OutlineItem(flat.slice(from, to), mode, tag);
  };
  const posIndex = (args) => {
    const s = scenesFrom(args)[0];
    if (args.length && s) return flat.indexOf(s.info);
    if (args.length) { const c = chaptersFrom(args)[0]; if (c) return flat.findIndex((f) => f.chapter === c); }
    return curIdx;
  };
  const neighbour = (from, step, same) => {
    if (!from) return null;
    let i = flat.indexOf(from.info);
    const pov = same && povOf(from.info.scene);
    for (i += step; i >= 0 && i < flat.length; i += step) {
      const f = flat[i];
      if (f.scene.includeInAI === false) continue;
      if (!same) return new SceneItem(f, from.mode);
      const p = povOf(f.scene);
      if (p.type === pov.type && p.character === pov.character) return new SceneItem(f, from.mode);
    }
    return null;
  };
  const beatList = env.cur?.scene.beats || [];
  const beatIdx = env.task?.kind === 'beat' ? beatList.findIndex((b) => b.id === env.task.beatId) : -1;
  const hasPosition = env.contents.textBefore !== undefined;
  const { message = '', textBefore = '', textAfter = '' } = env.contents;

  const F = {
    // composition
    input: ['composition', 'Returns the value for the custom input with the given name (case-insensitive).', (name) => {
      const key = lower(name);
      const def = env.inputDefs.find((d) => d.name.toLowerCase() === key || (d.key || '').toLowerCase() === key);
      if (!def) { const v = env.inputs[name]; return Array.isArray(v) ? v : v == null ? '' : String(v); }
      if (def.types.includes('context')) return env.extra.xml;
      const v = inputValue(def, env.inputs);
      if (def.types.includes('scene')) {
        const pick = (s) => { const m = /^scene:(.+)$/.exec(s); const f = m && flat.find((x) => x.scene.id === m[1]); return f ? new SceneItem(f, def.sceneMode || 'summary') : s; };
        return Array.isArray(v) ? v.map(pick) : pick(v);
      }
      return v;
    }],
    include: ['composition', 'Evaluates in the prompt component with the given name (case-insensitive).', (...names) => list(names).map((n) => env.include(toStr(n))).join('')],
    local: ['composition', 'Stores or retrieves a value in the local memory of the current prompt (case-sensitive). If a value is provided, it will be stored; if no value is provided, the stored value will be returned.', (name, ...rest) => {
      if (rest.length) { env.locals[toStr(name)] = rest[0]; return ''; }
      return env.locals[toStr(name)] ?? false;
    }],

    // logic
    ifs: ['logic', 'Returns the value for the first condition that is true, or the last value if none are true (e.g. "ifs(conditionA, valueA, conditionB, valueB, valueFallback)").', (...a) => {
      for (let i = 0; i + 1 < a.length; i += 2) if (truthy(a[i])) return a[i + 1];
      return a.length % 2 ? a[a.length - 1] : '';
    }],
    either: ['logic', 'Returns the first argument that matches to not being empty.', (...a) => a.find(truthy) ?? ''],
    and: ['logic', 'Filters the given arguments to all those that match to being true.', (...a) => a.every(truthy)],
    or: ['logic', 'Filters the given arguments to any those that match to being true.', (...a) => a.some(truthy)],
    not: ['logic', 'Returns true if any of the given arguments match to being false.', (...a) => !a.every(truthy)],
    isEmpty: ['logic', 'Returns true if all given arguments matches to being empty.', (...a) => a.every((x) => !truthy(x))],
    isEqual: ['logic', 'Returns true if all given arguments match to being equal to the first argument.', (first, ...rest) => rest.length > 0 && rest.every((x) => same(first, x))],
    isNotEqual: ['logic', 'Returns true if all given arguments match to not being equal to the first argument.', (first, ...rest) => rest.length > 0 && rest.every((x) => !same(first, x))],
    isGreaterThan: ['logic', 'Returns true if the first argument is greater than the second argument.', (a, b) => num(a) > num(b)],
    isLessThan: ['logic', 'Returns true if the first argument is less than the second argument.', (a, b) => num(a) < num(b)],
    isGreaterOrEqual: ['logic', 'Returns true if the first argument is greater than or equal to the second argument.', (a, b) => num(a) >= num(b)],
    isLessOrEqual: ['logic', 'Returns true if the first argument is less than or equal to the second argument.', (a, b) => num(a) <= num(b)],
    startsWith: ['logic', 'Returns true if the given haystack starts with the given needle (case-insensitive).', (hay, needle) => list([hay]).some((h) => list([needle]).some((n) => lower(plain(h)).startsWith(lower(n))))],
    endsWith: ['logic', 'Returns true if the given haystack ends with the given needle (case-insensitive).', (hay, needle) => list([hay]).some((h) => list([needle]).some((n) => lower(plain(h)).endsWith(lower(n))))],
    contains: ['logic', 'Returns true if the given haystack contains the given needle (case-insensitive).', (hay, needle) => list([hay]).some((h) => list([needle]).some((n) => lower(plain(h)).includes(lower(n))))],

    // lists
    any: ['lists', 'Creates a new list from the given arguments, whose matching mode is set to "any".', (...a) => list(a)],
    all: ['lists', 'Creates a new list from the given arguments, whose matching mode is set to "all".', (...a) => Object.assign(list(a), { matchAll: true })],
    join: ['lists', 'Joins all given arguments into a single text value.', (...a) => list(a).map(toStr).join('')],
    count: ['lists', 'Returns the total number of elements in the given arguments.', (a) => (a == null ? 0 : list([a]).length)],
    takeFirst: ['lists', 'Returns the first N elements from the given arguments.', (a, n) => list([a]).slice(0, Math.abs(num(n)))],
    takeLast: ['lists', 'Returns the last N elements from the given arguments.', (a, n) => list([a]).slice(-Math.abs(num(n)))],
    without: ['lists', 'Returns the haystack without the needle.', (hay, needle) => {
      const drop = list([needle]);
      return list([hay]).filter((x) => !drop.some((d) => same(x, d)));
    }],

    // math
    divide: ['math', 'Divides the first number by the second number.', (a, b) => (num(b) === 0 ? 0 : num(a) / num(b))],
    multiply: ['math', 'Multiplies all given numbers together.', (...a) => list(a).map(num).reduce((x, y) => x * y)],
    round: ['math', 'Rounds each given number to the nearest full number.', (a) => Math.round(num(a))],
    floor: ['math', 'Rounds each given number down to the nearest full number.', (a) => Math.floor(num(a))],
    ceil: ['math', 'Rounds each given number up to the nearest full number.', (a) => Math.ceil(num(a))],
    min: ['math', 'Returns the smallest number from the given arguments.', (...a) => Math.min(...list(a).map(num))],
    max: ['math', 'Returns the largest number from the given arguments.', (...a) => Math.max(...list(a).map(num))],
    isNumber: ['math', 'Checks if each given argument can be a number.', (a) => toStr(a).trim() !== '' && !Number.isNaN(num(a))],

    // text
    uppercase: ['text', 'Transforms a text into all capital letters.', (a) => toStr(a).toUpperCase()],
    lowercase: ['text', 'Transforms a text into all lowercase letters.', (a) => toStr(a).toLowerCase()],
    removeWhitespace: ['text', 'Removes all whitespace from a text.', (a) => toStr(a).replace(/\n{3,}/g, '\n\n').trim()],
    removePunctuation: ['text', 'Removes all punctuation from a text.', (a) => toStr(a).replace(/[\p{P}]/gu, '').replace(/\n{3,}/g, '\n\n').trim()],
    wordCount: ['text', 'Counts the number of total words in a given text.', (...a) => list(a).reduce((n, x) => n + words(plain(x)).length, 0)],
    pluralize: ['text', 'Returns a text with the count and the correct singular/plural form based on that count.', (n, one, many) => {
      const c = num(n);
      return Number.isNaN(c) ? `${toStr(n)} ${toStr(many)}` : `${c} ${c === 1 ? toStr(one) : toStr(many)}`;
    }],
    wordsBefore: ['text', 'Returns the last N words of the text before the current message, up to the nearest boundary.', (n) => (n == null ? textBefore : lastWords(textBefore, num(n) || 200))],
    wordsAfter: ['text', 'Returns the last N words of the text after the current message, up to the nearest boundary.', (n) => (n == null ? textAfter : firstWords(textAfter, num(n) || 200))],
    firstWords: ['text', 'Returns the first N number of words for the given text elements, excluding any titles or attributes.', (...a) => {
      const n = num(a.pop());
      return firstWords(list(a).map(plain).join('\n\n'), n || 200);
    }],
    lastWords: ['text', 'Returns the last N number of words for the given text elements, excluding any titles or attributes.', (...a) => {
      const n = num(a.pop());
      return lastWords(list(a).map(plain).join('\n\n'), n || 200);
    }],
    title: ['text', 'Extracts the title of the given arguments.', (...a) => list(a).map(titleOf)],
    content: ['text', 'Extracts the text content of the given arguments.', (...a) => list(a).map(plain).join('\n\n')],
    asXml: ['text', 'Renders each given argument as (nested) XML.', (...a) => list(a).map(toStr).join('\n')],
    asList: ['text', 'Converts each given argument to a text container and renders them as a bulleted list.', (...a) => list(a).map((x) => `- ${titleOrText(x)}`).join('\n')],
    asNumberedList: ['text', 'Converts each given argument to a text container and renders them as a numbered list.', (...a) => list(a).map((x, i) => `${i + 1}. ${titleOrText(x)}`).join('\n')],
    asMarkdown: ['text', 'Renders each given argument as Markdown (nested elements will use increasing heading levels).', (...a) => list(a).map(markdown).join('\n\n')],
    asPlainText: ['text', 'Renders each given argument as regular plain text.', (...a) => list(a).map(plain).join('\n')],

    // other
    'date.today': ['other', 'Retrieves the current date in a human-readable format (e.g., "Monday, January 1, 2023").', () => new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })],
    personas: ['other', 'Returns all available personas in the current context (based on the prompt type and the project(s) we\'re in).', () => (env.settings.persona?.trim() ? `<persona>${env.settings.persona.trim()}</persona>` : '')],

    // context
    textBefore: ['context', 'Retrieves the text content immediately preceding the current position in a document/scene.', () => textBefore],
    hasTextBefore: ['context', 'Checks if there is any text content immediately preceding the current position in a document/scene.', () => !!textBefore.trim()],
    isStartOfText: ['context', 'Checks if the current position is at the start of a document/scene (i.e., no text before).', () => hasPosition && !textBefore.trim()],
    textAfter: ['context', 'Retrieves the text content immediately following the current position in a document/scene.', () => textAfter],
    hasTextAfter: ['context', 'Checks if there is any text content immediately following the current position in a document/scene.', () => !!textAfter.trim()],
    isEndOfText: ['context', 'Checks if the current position is at the end of a document/scene (i.e., no text after).', () => env.contents.textAfter !== undefined && !textAfter.trim()],
    message: ['context', 'Retrieves the message content of the current scene beat/chat/text replacement selection.', () => message],
    hasMessage: ['context', 'Checks if there is any message content in the current scene beat/chat/text replacement selection.', () => !!message.trim()],
    storySoFar: ['context', 'Returns the outline of the current Novel up to the current position (or the position determined by the given arguments).', (...a) => {
      const i = posIndex(a);
      return i < 0 && !a.length && env.cur == null ? '' : outline(i < 0 ? 0 : i, 0, 'summary', 'storySoFar');
    }],
    storyToCome: ['context', 'Returns the outline of the current Novel from the current position (or the position determined by the given arguments) to the end.', (...a) => {
      const i = posIndex(a);
      return i < 0 ? '' : outline(null, i + 1, 'summary', 'storyToCome');
    }],
    textSoFar: ['context', 'Returns the text content of the current Novel up to the current position (or the position determined by the given arguments).', (...a) => {
      const i = posIndex(a);
      const before = outline(i < 0 ? flat.length : i, 0, 'content', 'storySoFar');
      return env.cur && !a.length && textBefore ? [before, `<scene title="${esc(fullTitle(env.cur))}" number="${env.cur.sceneNo}">${textBefore}</scene>`] : before;
    }],
    textToCome: ['context', 'Returns the text content of the current Novel from the current position (or the position determined by the given arguments) to the end.', (...a) => {
      const i = posIndex(a);
      const after = outline(null, i + 1, 'content', 'storyToCome');
      return env.cur && !a.length && textAfter ? [`<scene title="${esc(fullTitle(env.cur))}" number="${env.cur.sceneNo}">${textAfter}</scene>`, after] : after;
    }],

    // prompts
    'prompt.isNSFW': ['prompts', 'Checks if the current prompt is marked as NSFW (Not Safe For Work).', () => false],
    'prompt.model': ['prompts', 'Retrieves the full model name of the current prompt (as provided by your AI connection).', () => env.model || env.settings.model || ''],

    // series (this app has no series yet)
    series: ['series', 'Retrieves the Series object to which the current novel belongs, if any.', () => ''],
    'series.title': ['series', 'Extract the title of the Series to which the current novel belongs, if any.', () => ''],
    'series.description': ['series', 'Extract the description of the Series to which the current novel belongs, if any.', () => ''],

    // novels
    novel: ['novels', 'Returns the current Novel, if available.', () => novel.title],
    'novel.title': ['novels', 'Returns the title of the current Novel.', () => (novel.title || '').trim()],
    'novel.author': ['novels', 'Returns the author of the current Novel.', () => (novel.author || '').trim()],
    'novel.tense': ['novels', 'Returns the tense of the current Novel.', () => novel.tense || 'past tense'],
    'novel.language': ['novels', 'Returns the language of the current Novel.', () => lang],
    'novel.hasSeries': ['novels', 'Checks if the current Novel is part of a series.', () => false],
    'novel.outline': ['novels', 'Returns the full outline hierarchy of the current Novel, or the outline for the given arguments (e.g. Acts, POVs, ...).', (...a) => byArgs(a, 'summary')],
    'novel.fullText': ['novels', 'Returns the full text hierarchy of the current Novel, or the text for the given arguments (e.g. Acts, POVs, ...).', (...a) => byArgs(a, 'content')],

    // acts
    isAct: ['acts', "Filters the given collection of items to only those that are an actual 'Act'", (...a) => list(a).filter((x) => x?.kind === 'act')],
    act: ['acts', "Extracts all possible 'Acts' from the given arguments. Defaults to the current Act, if no arguments are given.", (...a) => actsFrom(a).map((x) => actGroup(x, 'content'))],
    'act.previous': ['acts', "Returns the immediately preceding 'Act' for each possible 'Act' in the given arguments (or the current Act if none are provided).", (...a) => actsFrom(a).map((x) => novel.acts[novel.acts.indexOf(x) - 1]).filter(Boolean).map((x) => actGroup(x, 'content'))],
    'act.next': ['acts', "Returns the immediately following 'Act' for each possible 'Act' in the given arguments (or the current Act if none are provided).", (...a) => actsFrom(a).map((x) => novel.acts[novel.acts.indexOf(x) + 1]).filter(Boolean).map((x) => actGroup(x, 'content'))],
    'act.title': ['acts', "Returns the title of each 'Act' in the given arguments (or the current Act if none are provided).", (...a) => actsFrom(a).map((x) => x.title || `Act ${novel.acts.indexOf(x) + 1}`)],
    'act.name': ['acts', "Returns the name of each 'Act' in the given arguments (or the current Act if none are provided).", (...a) => actsFrom(a).map((x) => x.title).filter(Boolean)],
    'act.summary': ['acts', "Returns a summary of each 'Act' in the given arguments (or the current Act if none are provided).", (...a) => actsFrom(a).map((x) => actGroup(x, 'summary'))],
    'act.fullText': ['acts', "Returns the full text of each 'Act' in the given arguments (or the current Act if none are provided).", (...a) => actsFrom(a).map((x) => actGroup(x, 'content'))],
    'act.number': ['acts', "Returns the number of each 'Act' in the given arguments (or the current Act if none are provided).", (...a) => actsFrom(a).map((x) => novel.acts.indexOf(x) + 1)],

    // chapters
    isChapter: ['chapters', "Filters the given collection of items to only those that are an actual 'Chapter'", (...a) => list(a).filter((x) => x?.kind === 'chapter')],
    chapter: ['chapters', "Extracts all possible 'Chapters' from the given arguments. Defaults to the current Chapter, if no arguments are given.", (...a) => chaptersFrom(a).map((c) => chapterGroup(c, 'content'))],
    'chapter.previous': ['chapters', "Returns the immediately preceding 'Chapter' for each possible 'Chapter' in the given arguments (or the current Chapter if none are provided).", (...a) => chaptersFrom(a).map((c) => allChapters[allChapters.indexOf(c) - 1]).filter(Boolean).map((c) => chapterGroup(c, 'content'))],
    'chapter.next': ['chapters', "Returns the immediately following 'Chapter' for each possible 'Chapter' in the given arguments (or the current Chapter if none are provided).", (...a) => chaptersFrom(a).map((c) => allChapters[allChapters.indexOf(c) + 1]).filter(Boolean).map((c) => chapterGroup(c, 'content'))],
    'chapter.title': ['chapters', "Returns the full title for each possible 'Chapter' in the given arguments (or the current Chapter if none are provided).", (...a) => chaptersFrom(a).map((c) => `Chapter ${allChapters.indexOf(c) + 1}${c.title ? `: ${c.title}` : ''}`)],
    'chapter.name': ['chapters', "Returns the custom name for each possible 'Chapter' in the given arguments (or the current Chapter if none are provided).", (...a) => chaptersFrom(a).map((c) => c.title).filter(Boolean)],
    'chapter.summary': ['chapters', "Returns the summary for each possible 'Chapter' in the given arguments (or the current Chapter if none are provided).", (...a) => chaptersFrom(a).map((c) => chapterGroup(c, 'summary'))],
    'chapter.fullText': ['chapters', "Returns the full text/prose for each possible 'Chapter' in the given arguments (or the current Chapter if none are provided).", (...a) => chaptersFrom(a).map((c) => chapterGroup(c, 'content'))],
    'chapter.number': ['chapters', "Returns the number for each possible 'Chapter' in the given arguments (or the current Chapter if none are provided).", (...a) => chaptersFrom(a).map((c) => allChapters.indexOf(c) + 1)],

    // scenes
    isScene: ['scenes', 'Filters a collection of items, returning only those that are actual Scene objects.', (...a) => list(a).filter((x) => x instanceof SceneItem)],
    scene: ['scenes', 'Retrieves a list of Scene objects by all given arguments.', (...a) => {
      const s = scenesFrom(a);
      return a.length ? s : s[0] || '';
    }],
    'scene.previous': ['scenes', 'Gets the Scene that comes directly before a given Scene or the current one.', (...a) => one(scenesFrom(a).map((s) => neighbour(s, -1, false)))],
    'scene.next': ['scenes', 'Gets the Scene that comes directly after a given Scene or the current one.', (...a) => one(scenesFrom(a).map((s) => neighbour(s, 1, false)))],
    'scene.previousSamePOV': ['scenes', 'Returns the most recent preceding Scene that shares the same Point of View as the current/specified Scene.', (...a) => one(scenesFrom(a).map((s) => neighbour(s, -1, true)))],
    'scene.nextSamePOV': ['scenes', 'Returns the next Scene that shares the same Point of View as the current/specified Scene.', (...a) => one(scenesFrom(a).map((s) => neighbour(s, 1, true)))],
    'scene.title': ['scenes', 'Extracts the title of a Scene for the given arguments.', (...a) => one(scenesFrom(a).map((s) => sceneTitle(s.info)))],
    'scene.fullTitle': ['scenes', 'Extracts the full title of a Scene with chapter information for the given arguments.', (...a) => one(scenesFrom(a).map((s) => fullTitle(s.info)))],
    'scene.subtitle': ['scenes', 'Extracts the subtitle of a Scene for the given arguments.', () => ''],
    'scene.hasSubtitle': ['scenes', 'Filters a collection of items, returning only those that have a subtitle.', () => false],
    'scene.summary': ['scenes', 'Extracts the summary of a Scene for the given arguments.', (...a) => one(scenesFrom(a, 'summary').filter((s) => s.body()))],
    'scene.hasSummary': ['scenes', 'Filters a collection of items, returning only those that have a summary.', (...a) => one(scenesFrom(a).filter((s) => s.info.scene.summary?.trim()))],
    'scene.fullText': ['scenes', 'Extracts the full text of a Scene for the given arguments.', (...a) => one(scenesFrom(a, 'content'))],
    'scene.hasText': ['scenes', 'Filters a collection of items, returning only those that have text content.', (...a) => one(scenesFrom(a).filter((s) => sceneText(s.info.scene)))],
    'scene.number': ['scenes', 'Extracts the number of a Scene for the given arguments.', (...a) => one(scenesFrom(a).map((s) => s.info.sceneNo))],
    'scene.references': ['scenes', 'Extracts the references of a Scene for the given arguments.', (...a) => codexList(novel.codex.filter((e) => scenesFrom(a).some((s) => s.info.scene.codexIds?.includes(e.id))))],
    'scene.hasReference': ['scenes', 'Filters a collection of items, returning only those that have a reference to a given Codex entry.', (...a) => {
      const needle = entriesFrom([a.pop()]).map((e) => e.id);
      return one(scenesFrom(a).filter((s) => s.info.scene.codexIds?.some((id) => needle.includes(id))));
    }],
    'scene.hasMention': ['scenes', 'Filters a collection of items, returning only those that have a mention to a given Codex entry.', (...a) => {
      const needle = entriesFrom([a.pop()]);
      return one(scenesFrom(a).filter((s) => needle.some((e) => entryRegex(e)?.test(sceneText(s.info.scene)))));
    }],
    'scene.labels': ['scenes', 'Extracts the labels of a Scene for the given arguments.', (...a) => scenesFrom(a).flatMap((s) => s.info.scene.labels || [])],
    'scene.hasLabel': ['scenes', 'Filters a collection of items, returning only those that have a label with a given name.', (...a) => {
      const needle = lower(a.pop());
      return one(scenesFrom(a).filter((s) => (s.info.scene.labels || []).some((l) => lower(l) === needle)));
    }],

    // snippets (not in this app yet)
    'snippets.has': ['snippets', 'Check if there are Snippets with all given arguments.', () => false],
    'snippets.get': ['snippets', 'Retrieves a list of Snippets by all given arguments.', () => []],

    // codex
    'codex.get': ['codex', 'Retrieves one or more Codex entries by their name or alias, or extracts them from the given arguments.', (...a) => codexList(entriesFrom(a))],
    'codex.has': ['codex', 'Checks if the given arguments contain any (valid) Codex entries.', (...a) => entriesFrom(a).length > 0],
    'codex.mentions': ['codex', 'Retrieves all Codex entries that are mentioned in the given text/arguments.', (...a) => {
      const ids = mentionedIds(novel.codex, list(a).map(plain).join('\n'));
      return codexList(novel.codex.filter((e) => ids.includes(e.id)));
    }],
    'codex.all': ['codex', 'Returns all Codex entries, or extracts them from the given arguments.', (...a) => codexList(a.length ? entriesFrom(a) : novel.codex)],
    'codex.global': ['codex', 'Returns/Extracts all Codex entries that are marked as global (always included).', (...a) => codexList((a.length ? entriesFrom(a) : novel.codex).filter((e) => e.alwaysInclude))],
    'codex.characters': ['codex', "Returns/Extracts all Codex entries that are of type 'Character'.", ofType('character')],
    'codex.locations': ['codex', "Returns/Extracts all Codex entries that are of type 'Location'.", ofType('location')],
    'codex.objects': ['codex', "Returns/Extracts all Codex entries that are of type 'Object'.", ofType('object')],
    'codex.lore': ['codex', "Returns/Extracts all Codex entries that are of type 'Lore'.", ofType('lore')],
    'codex.subplots': ['codex', "Returns/Extracts all Codex entries that are of type 'Subplot'.", ofType('subplot')],
    'codex.other': ['codex', "Returns/Extracts all Codex entries that are of type 'Other'.", ofType('other')],
    'codex.name': ['codex', "Returns the name for each possible 'Codex' entry in the given arguments (or the current Codex context if none are provided).", (...a) => entriesFrom(a).map((e) => `${e.name}${e.aliases?.length ? ` (${e.aliases.join(', ')})` : ''}`)],
    'codex.aliases': ['codex', "Returns the aliases for each possible 'Codex' entry in the given arguments (or the current Codex context if none are provided).", (...a) => entriesFrom(a).filter((e) => e.aliases?.length).map((e) => e.aliases.join(', '))],
    'codex.description': ['codex', "Returns the description for each possible 'Codex' entry in the given arguments (or the current Codex context if none are provided).", (...a) => codexList(entriesFrom(a).filter((e) => e.description?.trim()))],
    'codex.notes': ['codex', "Returns the notes for each possible 'Codex' entry in the given arguments (or the current Codex context if none are provided).", (...a) => codexXml(entriesFrom(a).filter((e) => e.research?.trim()).map((e) => ({ ...e, description: e.research })))],
    'codex.detail': ['codex', "Returns the given custom details for each possible 'Codex' entry in the given arguments (or the current Codex context if none are provided).", () => []],
    'codex.category': ['codex', "Returns the custom Codex category by name, or for each possible 'Codex' entry in the given arguments (or the current Codex context if none are provided).", () => []],
    'codex.relations': ['codex', "Returns all Codex entries that are related to the given arguments (or the current Codex context if none are provided).", (...a) => {
      const ids = new Set(entriesFrom(a).flatMap(relatedIds));
      return codexList(novel.codex.filter((e) => ids.has(e.id)));
    }],
    'codex.hasTag': ['codex', 'Filters all Codex entries in given arguments (or the current Codex context if none are provided) by whether they have the given tag(s).', (...a) => {
      const tags = list([a.pop()]).map(lower);
      return codexList(entriesFrom(a).filter((e) => (e.tags || []).some((t) => tags.includes(lower(t)))));
    }],
    'codex.hasDetail': ['codex', 'Filters all Codex entries in given arguments (or the current Codex context if none are provided) by whether they have the given detail(s).', () => []],
    'codex.inCategory': ['codex', 'Filters all Codex entries in given arguments (or the current Codex context if none are provided) by whether they are in the given custom category/categories.', () => []],
    'codex.isOfType': ['codex', 'Filters all Codex entries in given arguments (or the current Codex context if none are provided) by whether they are of the given type(s).', (...a) => {
      const types = list([a.pop()]).map(lower);
      return codexList(entriesFrom(a).filter((e) => types.includes(e.type || 'other')));
    }],
    'codex.isCharacter': ['codex', "Filters all Codex entries in given arguments (or the current Codex context if none are provided) by whether they are of type 'Character'.", ofType('character')],
    'codex.isLocation': ['codex', "Filters all Codex entries in given arguments (or the current Codex context if none are provided) by whether they are of type 'Location'.", ofType('location')],
    'codex.isObject': ['codex', "Filters all Codex entries in given arguments (or the current Codex context if none are provided) by whether they are of type 'Object'.", ofType('object')],
    'codex.isLore': ['codex', "Filters all Codex entries in given arguments (or the current Codex context if none are provided) by whether they are of type 'Lore'.", ofType('lore')],
    'codex.isSubplot': ['codex', "Filters all Codex entries in given arguments (or the current Codex context if none are provided) by whether they are of type 'Subplot'.", ofType('subplot')],
    'codex.isOther': ['codex', "Filters all Codex entries in given arguments (or the current Codex context if none are provided) by whether they are of type 'Other'.", ofType('other')],
    'codex.isRelatedTo': ['codex', 'Filters all Codex entries in given arguments (or the current Codex context if none are provided) by whether they are related to the given entry/entries (even across other Codex entries).', (...a) => {
      const targets = new Set(entriesFrom([a.pop()]).map((e) => e.id));
      return codexList(entriesFrom(a).filter((e) => relatedIds(e).some((id) => targets.has(id))));
    }],
    'codex.context': ['codex', 'Returns the current codex context, or filters the given arguments by whether they are in the current codex context.', (...a) => {
      const ctxIds = new Set(env.codexContext.map((e) => e.id));
      return a.length ? codexList(entriesFrom(a).filter((e) => ctxIds.has(e.id))) : codexXml(env.codexContext);
    }],
    withRelations: ['codex', 'Appends all Codex entries that are related to the given arguments (or the current Codex context if none are provided).', (...a) => {
      const base = entriesFrom(a);
      const ids = new Set([...base.map((e) => e.id), ...base.flatMap(relatedIds)]);
      return codexList(novel.codex.filter((e) => ids.has(e.id)));
    }],

    // beats
    previousBeat: ['scenes', 'Retrieves the scene beat immediately preceding the current one (within the current scene).', () => (beatIdx > 0 ? beatList[beatIdx - 1].text : false)],
    nextBeat: ['scenes', 'Retrieves the scene beat immediately following the current one (within the current scene).', () => (beatIdx >= 0 && beatIdx < beatList.length - 1 ? beatList[beatIdx + 1].text : false)],

    // point of view
    pov: ['pov', 'Extracts all available point of views from the given arguments (or the current scene if none are given).', (...a) => (a.length ? scenesFrom(a).map((s) => povOf(s.info.scene)) : povOf(env.cur?.scene))],
    'pov.character': ['pov', 'Extracts the character name from the given/current point of view(s).', (...a) => one(povs(a).map((p) => p.character).filter(Boolean))],
    'pov.type': ['pov', 'Extracts the type of point of view from the given/current point of view(s).', (...a) => one(povs(a).map((p) => p.type))],
    'pov.isFirstPerson': ['pov', 'Returns all given (or current) point of views that are first person.', (...a) => povs(a).some((p) => p.type.startsWith('first'))],
    'pov.isSecondPerson': ['pov', 'Returns all given (or current) point of views that are second person.', (...a) => povs(a).some((p) => p.type.startsWith('second'))],
    'pov.isThirdPerson': ['pov', 'Returns all given (or current) point of views that are third person.', (...a) => povs(a).some((p) => p.type.startsWith('third'))],
    'pov.isLimited': ['pov', "Returns all given (or current) point of views that are considered to be 'limited'.", (...a) => povs(a).some((p) => !/omniscient|objective/.test(p.type) && p.type !== 'third person')],
    'pov.isOmniscient': ['pov', "Returns all given (or current) point of views that are considered to be 'omniscient'.", (...a) => povs(a).some((p) => p.type.includes('omniscient'))],
    'pov.isOverwrite': ['pov', 'Returns all given (or current) point of views that are not the same as the Novel default point of view.', (...a) => {
      const base = povOf(null);
      return povs(a).some((p) => p.type !== base.type || p.character !== base.character);
    }],
  };

  function povs(a) {
    if (!a.length) return [povOf(env.cur?.scene)];
    return flatList(a).flatMap((x) => (x instanceof PovItem ? [x] : x instanceof SceneItem ? [povOf(x.info.scene)] : []));
  }
  function byArgs(a, mode) {
    if (!a.length) return new OutlineItem(visible, mode, mode === 'summary' ? 'novelOutline' : 'manuscript');
    const povArgs = flatList(a).filter((x) => x instanceof PovItem);
    if (povArgs.length) return new OutlineItem(visible.filter((f) => povArgs.some((p) => { const q = povOf(f.scene); return q.type === p.type && q.character === p.character; })), mode, 'novelOutline');
    return scenesFrom(a, mode);
  }
  function one(items) { return items.length === 1 ? items[0] : items.length ? items : ''; }
  function titleOrText(x) { return x instanceof SceneItem || x instanceof CodexItem || x instanceof GroupItem ? titleOf(x) : plain(x); }
  function markdown(x) {
    if (x instanceof SceneItem) return `## ${fullTitle(x.info)}\n\n${x.body()}`;
    if (x instanceof CodexItem) return `## ${x.entry.name}\n\n${x.entry.description || ''}`;
    if (x instanceof GroupItem) return `# ${titleOf(x) || x.kind}\n\n${x.scenes().map(markdown).join('\n\n').replace(/^## /gm, '### ')}`;
    if (x instanceof OutlineItem) return x.scenes().map(markdown).join('\n\n');
    return toStr(x);
  }
  function same(a, b) {
    if (Array.isArray(a)) return a.matchAll ? a.every((x) => same(x, b)) : a.some((x) => same(x, b));
    if (Array.isArray(b)) return b.some((x) => same(a, x));
    if (a instanceof SceneItem && b instanceof SceneItem) return a.info === b.info;
    if (a instanceof CodexItem && b instanceof CodexItem) return a.entry === b.entry;
    return lower(a) === lower(b);
  }

  const fns = {};
  const docs = [];
  for (const [name, [section, description, fn]] of Object.entries(F)) {
    fns[name] = fn;
    docs.push({ name, section, description });
  }
  Object.defineProperty(fns, 'docs', { value: docs });
  return fns;
}

/** Name, section and description of every function, for the prompt editor's reference panel. */
export function functionDocs() {
  const env = { novel: { title: '', acts: [], codex: [], pov: {} }, flat: [], cur: null, contents: {}, codexContext: [], extra: { xml: [] }, inputDefs: [], inputs: {}, settings: {}, locals: {}, include: () => '' };
  return createFunctions(env).docs;
}
