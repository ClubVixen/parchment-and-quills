// Read-aloud scripts: a chapter split into narration and dialogue segments, each with a speaker.
// Paragraphs are numbered exactly like Read mode shows them, so the player can highlight the right one.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR } from './store.js';
import { normalizeScene } from './context.js';
import { streamChat } from './ai.js';

const MAX_SEGMENT = 500; // characters; shorter clips start playing sooner

export const paragraphsOf = (text) => text.split(/\n{2,}|\n/).map((p) => p.trim()).filter(Boolean);

export function chapterParagraphs(novel, chapterId) {
  const ch = novel.acts.flatMap((a) => a.chapters).find((c) => c.id === chapterId);
  if (!ch) throw Object.assign(new Error('Chapter not found'), { status: 404 });
  const out = [];
  for (const sc of ch.scenes) {
    const s = normalizeScene(structuredClone(sc));
    for (const b of s.blocks) out.push(...paragraphsOf(b.text));
  }
  return out;
}

// ---------- speakers ----------

/** Names a character may be referred to by: full name, aliases, parts like "Margaret (Peggy)" and first names. */
function characterNames(codex) {
  const out = [];
  for (const e of codex.filter((x) => x.type === 'character')) {
    const names = new Set();
    for (const raw of [e.name, ...(e.aliases || [])]) {
      for (const part of raw.split(/[()—–,/]| - /).map((p) => p.trim()).filter(Boolean)) {
        names.add(part);
        const first = part.split(/\s+/)[0];
        if (first.length >= 3) names.add(first);
      }
    }
    out.push({ id: e.id, names: [...names].filter((n) => n.length >= 2) });
  }
  return out;
}

const SPEECH = 'said|says|asked|asks|replied|replies|whispered|shouted|yelled|muttered|murmured|called|cried|snapped|added|answered|began|continued|quipped|growled|hissed|laughed|sighed|stammered|stuttered|groaned|mumbled|exclaimed|demanded|insisted|offered|admitted|breathed|half shouted|interrupted|retorted|teased|urged|warned|pleaded|chuckled|snorted|scoffed|barked|grumbled|repeated|told';
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Split a paragraph into narration and quoted speech. An unclosed opening quote runs to the end of the paragraph. */
function splitQuotes(p) {
  const parts = [];
  const re = /“[^”]*(”|$)|"[^"]*("|$)/g;
  let last = 0;
  for (const m of p.matchAll(re)) {
    if (m.index > last) parts.push({ quote: false, text: p.slice(last, m.index) });
    parts.push({ quote: true, text: m[0] });
    last = m.index + m[0].length;
  }
  if (last < p.length) parts.push({ quote: false, text: p.slice(last) });
  return parts.filter((x) => x.text.trim());
}

function guessSpeaker(narration, chars, povId, firstPerson) {
  if (!narration.trim()) return null;
  // "Mara said" / "said Mara" / "Mara asked" — a name next to a speech verb wins.
  for (const c of chars) for (const n of c.names) {
    const name = esc(n);
    if (new RegExp(`\\b${name}\\b[^.!?“"]{0,25}\\b(${SPEECH})\\b|\\b(${SPEECH})\\b[^.!?“"]{0,12}\\b${name}\\b`, 'i').test(narration)) return c.id;
  }
  if (firstPerson && povId && new RegExp(`\\bI\\b[^.!?“"]{0,25}\\b(${SPEECH})\\b|\\b(${SPEECH})\\b\\s+I\\b`).test(narration)) return povId;
  // Otherwise the first character named in the narration of this paragraph.
  let best = null, pos = Infinity;
  for (const c of chars) for (const n of c.names) {
    const m = narration.match(new RegExp(`\\b${esc(n)}\\b`));
    if (m && m.index < pos) { pos = m.index; best = c.id; }
  }
  if (best) return best;
  if (firstPerson && povId && /^\s*I\b/.test(narration)) return povId;
  return null;
}

function chunk(text) {
  if (text.length <= MAX_SEGMENT) return [text];
  const out = [];
  let cur = '';
  for (const s of text.match(/[^.!?…]+[.!?…]+["”’)]*\s*|[^.!?…]+$/g) || [text]) {
    if ((cur + s).length > MAX_SEGMENT && cur) { out.push(cur.trim()); cur = ''; }
    cur += s;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Heuristic script: narration -> 'narrator', each quote -> a codex character id or 'unknown'. */
export function simpleScript(novel, chapterId) {
  const paras = chapterParagraphs(novel, chapterId);
  const chars = characterNames(novel.codex || []);
  const firstPerson = /^first person/.test(novel.pov?.type || '');
  const pov = (novel.pov?.character || '').trim().toLowerCase();
  const povId = pov ? chars.find((c) => c.names.some((n) => n.toLowerCase() === pov))?.id : null;

  const segments = [];
  let convo = []; // speakers of the current run of dialogue paragraphs, for back-and-forth exchanges
  let lastQuotePara = -10;
  paras.forEach((p, para) => {
    const parts = splitQuotes(p);
    const narration = parts.filter((x) => !x.quote).map((x) => x.text).join(' ');
    let speaker = guessSpeaker(narration, chars, povId, firstPerson);
    const hasQuote = parts.some((x) => x.quote);
    if (hasQuote) {
      if (para - lastQuotePara > 2) convo = []; // a long stretch of narration ends the conversation
      if (!speaker) {
        // Alternating conversation (A, B, A, B…): an unlabelled line belongs to whoever did not speak last.
        const known = convo.filter((s) => s !== 'unknown');
        const prev = known.at(-1);
        const other = [...known].reverse().find((s) => s !== prev);
        if (prev && other) speaker = other;
      }
      convo.push(speaker || 'unknown');
      lastQuotePara = para;
    }
    for (const part of parts) {
      for (const text of chunk(part.text.trim())) {
        segments.push({ para, quote: part.quote, speaker: part.quote ? speaker || 'unknown' : 'narrator', text });
      }
    }
  });
  return { segments, hash: hashParas(paras) };
}

const hashParas = (paras) => crypto.createHash('sha1').update(paras.join('\n')).digest('hex');

// ---------- AI speaker detection ----------

/** Ask the chat model who speaks each quote. Updates segments in place; returns how many were labelled. */
export async function aiSpeakers(novel, settings, script) {
  const paras = chapterParagraphs(novel, script.chapterId);
  const chars = (novel.codex || []).filter((e) => e.type === 'character');
  const quotes = script.segments.map((s, i) => ({ ...s, i })).filter((s) => s.quote);
  const firstPerson = /^first person/.test(novel.pov?.type || '');
  let labelled = 0;
  for (let k = 0; k < quotes.length; k += 40) {
    const batch = quotes.slice(k, k + 40);
    const from = Math.max(0, batch[0].para - 2), to = Math.min(paras.length, batch.at(-1).para + 1);
    const context = paras.slice(from, to).map((p, j) => `[P${from + j}] ${p}`).join('\n');
    const list = batch.map((q) => `Q${q.i} (in P${q.para}): ${q.text.slice(0, 160)}`).join('\n');
    const messages = [
      { role: 'system', content: 'You label who speaks each line of dialogue in a novel. Reply with JSON only.' },
      { role: 'user', content: `Characters: ${chars.map((c) => [c.name, ...(c.aliases || [])].join(' / ')).join('; ')}.
${firstPerson && novel.pov?.character ? `The narrator ("I") is ${novel.pov.character}.\n` : ''}
Story text:
${context}

For each quote below, give the speaker's name exactly as in the character list, or "unknown" if it cannot be told.
${list}

Answer as a JSON object mapping quote ids to names, e.g. {"Q12": "Mara", "Q13": "unknown"}.` },
    ];
    const res = await streamChat(settings, { messages }, () => {});
    const json = res.content.match(/\{[\s\S]*\}/);
    if (!json) continue;
    let map;
    try { map = JSON.parse(json[0]); } catch { continue; }
    for (const q of batch) {
      const name = String(map[`Q${q.i}`] || '').trim().toLowerCase();
      if (!name || name === 'unknown') continue;
      const c = chars.find((x) => [x.name, ...(x.aliases || [])].some((n) => n.toLowerCase() === name || n.toLowerCase().split(/[\s(]/)[0] === name.split(/\s/)[0]));
      if (c) { script.segments[q.i].speaker = c.id; labelled++; }
    }
  }
  script.mode = 'ai';
  return labelled;
}

// ---------- storage ----------

const scriptFile = (novelId, chapterId) => {
  if (!/^[\w-]+$/.test(novelId) || !/^[\w-]+$/.test(chapterId)) throw Object.assign(new Error('bad id'), { status: 400 });
  return path.join(DATA_DIR, 'novels', novelId, 'audio', `${chapterId}.json`);
};

/** The saved script if the chapter text is unchanged, otherwise a fresh heuristic one. */
export function getScript(novel, chapterId) {
  const fresh = simpleScript(novel, chapterId);
  const file = scriptFile(novel.id, chapterId);
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (saved.hash === fresh.hash) return saved;
  } catch { /* none saved yet */ }
  return { chapterId, mode: 'simple', overrides: {}, ...fresh };
}

export function saveScript(novelId, script) {
  const file = scriptFile(novelId, script.chapterId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(script, null, 2));
  return script;
}
