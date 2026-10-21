// Find a quoted passage in prose even when quotes, dashes or spacing differ (the AI often writes ' for ’, -- for —,
// or joins lines). Shared logic with web/src/locate.ts: keep the two in step.

const FOLD = { '‘': "'", '’': "'", '‚': "'", '′': "'", '“': '"', '”': '"', '„': '"', '″': '"', '–': '-', '—': '-', '…': '...', ' ': ' ' };

/** Folded copy of `s` plus, for every folded character, the index in `s` it came from. */
function fold(s) {
  let out = '';
  const map = [];
  let space = false;
  for (let i = 0; i < s.length; i++) {
    let c = FOLD[s[i]] ?? s[i];
    if (/\s/.test(c)) {
      if (space) continue;
      space = true;
      c = ' ';
    } else space = false;
    if (c === '-' && out.endsWith('-')) continue; // "--" and "—" both mean a dash
    for (const ch of c) { out += ch; map.push(i); }
  }
  map.push(s.length);
  return { text: out, map };
}

/** [start, end) of `needle` in `hay`: exact match first, then a quote/dash/space-insensitive one. */
export function locate(hay, needle) {
  const n = needle.trim();
  if (!n) return null;
  const at = hay.indexOf(n);
  if (at >= 0) return [at, at + n.length];
  const h = fold(hay), f = fold(n).text.trim();
  const i = h.text.indexOf(f);
  if (i < 0) return null;
  return [h.map[i], h.map[i + f.length - 1] + 1];
}

/** Start and end of the paragraph around [start, end) (paragraphs are separated by blank lines). */
export function paragraphRange(text, start, end) {
  const before = text.lastIndexOf('\n\n', start);
  const after = text.indexOf('\n\n', end);
  return [before < 0 ? 0 : before + 2, after < 0 ? text.length : after];
}
