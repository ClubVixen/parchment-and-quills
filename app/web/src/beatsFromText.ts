// "Beats from Text": the AI reads a finished scene as numbered paragraphs and answers with beats and the
// paragraph range each one covers. These helpers read that answer and rebuild the scene into beat sections.
import type { Beat, Scene, TextBlock } from './types';
import { newId, textBlocks } from './util';

/** A scene's paragraphs, numbered from 1 in the prompt. Blank lines separate paragraphs (same rule as the server). */
export const sceneParagraphs = (s: Scene) => textBlocks(s).flatMap((b) => b.text.split(/\n\s*\n/)).map((p) => p.trim()).filter(Boolean);

export type ProposedBeat = { text: string; from: number; to: number };

/**
 * Read the AI's JSON answer. Only each beat's start paragraph is trusted: beats are sorted by it and each one runs
 * up to the next, so the result always covers paragraphs 1..count in order with no gaps or overlaps.
 */
export function parseBeatsReply(content: string, count: number): ProposedBeat[] {
  const start = content.indexOf('[');
  const end = content.lastIndexOf(']');
  if (start < 0 || end <= start) throw new Error('The AI did not answer with a list of beats.');
  let raw: unknown;
  try { raw = JSON.parse(content.slice(start, end + 1)); } catch { throw new Error('The AI answer was not valid JSON.'); }
  if (!Array.isArray(raw)) throw new Error('The AI did not answer with a list of beats.');
  const items = raw
    .map((x) => {
      const o = (x || {}) as Record<string, unknown>;
      const text = String(o.beat ?? o.text ?? o.summary ?? '').trim();
      const from = Math.round(Number(o.from ?? o.start ?? o.first));
      return { text, from };
    })
    .filter((b) => b.text && Number.isFinite(b.from))
    .map((b) => ({ ...b, from: Math.min(Math.max(b.from, 1), count) }))
    .sort((a, b) => a.from - b.from);
  const out: ProposedBeat[] = [];
  for (const b of items) {
    if (out.length && out.at(-1)!.from === b.from) continue; // two beats starting on the same paragraph: keep the first
    out.push({ text: b.text, from: out.length ? b.from : 1, to: count });
  }
  for (let i = 0; i < out.length - 1; i++) out[i].to = out[i + 1].from - 1;
  if (!out.length) throw new Error('The AI answer had no usable beats.');
  return out;
}

/** Replace the scene's beats with `beats` and split its prose into one section per beat. */
export function applyBeats(scene: Scene, beats: ProposedBeat[]) {
  const paras = sceneParagraphs(scene);
  const newBeats: Beat[] = beats.map((b) => ({ id: newId(), text: b.text.trim() }));
  const blocks: TextBlock[] = beats.map((b, i) => ({
    id: newId(), type: 'text', beatId: newBeats[i].id, text: paras.slice(b.from - 1, b.to).join('\n\n'),
  }));
  scene.beats = newBeats;
  scene.blocks = blocks.length ? blocks : [{ id: newId(), type: 'text', text: '' }];
}
