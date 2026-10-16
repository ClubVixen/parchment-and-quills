// Port of NovelCrafter's prompt template language.
//   {! comment !}            stripped
//   {expr}                   interpolation
//   {#if expr} {#elseif expr} {#else} {#endif}
// Expressions: paths (novel.title), calls (fn(a, b)), "strings", numbers, `a + b`, `a is b`, `a is not b`,
// `a in b`, `not a`, parentheses. A path that resolves to a function is called with no arguments unless
// it is followed by an argument list, so `pov.character` and `pov.character(scene.previous)` both work.

const CONTROL = /^#(if|elseif|else|endif)\b\s*([\s\S]*)$/;

/** Split a template into text / comment / tag tokens. Tags may span lines and contain quoted braces. */
function tokenize(src) {
  const tokens = [];
  let i = 0;
  let text = '';
  const flush = () => { if (text) tokens.push({ t: 'text', v: text }); text = ''; };
  while (i < src.length) {
    const c = src[i];
    if (c === '{' && src[i + 1] === '!') {
      const end = src.indexOf('!}', i + 2);
      flush();
      tokens.push({ t: 'comment' });
      i = end < 0 ? src.length : end + 2;
      continue;
    }
    if (c === '{') {
      let depth = 0, j = i + 1, quote = null;
      for (; j < src.length; j++) {
        const d = src[j];
        if (quote) { if (d === '\\') j++; else if (d === quote) quote = null; continue; }
        if (d === '"' || d === "'") quote = d;
        else if (d === '(' || d === '{') depth++;
        else if (d === ')') depth--;
        else if (d === '}') { if (depth <= 0) break; depth--; }
      }
      if (j >= src.length) { text += c; i++; continue; }
      flush();
      const body = src.slice(i + 1, j).trim();
      const m = body.match(CONTROL);
      tokens.push(m ? { t: 'ctl', kind: m[1], expr: m[2].trim() } : { t: 'expr', expr: body });
      i = j + 1;
      continue;
    }
    text += c;
    i++;
  }
  flush();
  return stripStandaloneLines(tokens);
}

/** A control tag or comment alone on its line removes that whole line (indent + newline). */
function stripStandaloneLines(tokens) {
  for (let k = 0; k < tokens.length; k++) {
    const tok = tokens[k];
    if (tok.t !== 'ctl' && tok.t !== 'comment') continue;
    const prev = tokens[k - 1], next = tokens[k + 1];
    const prevOk = !prev || (prev.t === 'text' && /(^|\n)[ \t]*$/.test(prev.v)) || prev.t === 'ctl' || prev.t === 'comment';
    const nextOk = !next || (next.t === 'text' && /^[ \t]*(\r?\n|$)/.test(next.v));
    if (!prevOk || !nextOk) continue;
    if (prev && prev.t === 'text') prev.v = prev.v.replace(/[ \t]*$/, '');
    if (next && next.t === 'text') next.v = next.v.replace(/^[ \t]*\r?\n/, '');
  }
  return tokens;
}

function parseBlocks(tokens) {
  let pos = 0;
  function parseUntil(stops) {
    const nodes = [];
    while (pos < tokens.length) {
      const tok = tokens[pos];
      if (tok.t === 'ctl' && stops.includes(tok.kind)) return nodes;
      pos++;
      if (tok.t === 'text') nodes.push(tok);
      else if (tok.t === 'expr') nodes.push({ t: 'expr', ast: parseExpr(tok.expr) });
      else if (tok.t === 'ctl' && tok.kind === 'if') {
        const branches = [{ cond: parseExpr(tok.expr), body: parseUntil(['elseif', 'else', 'endif']) }];
        let elseBody = null;
        while (pos < tokens.length) {
          const t2 = tokens[pos++];
          if (t2.kind === 'elseif') branches.push({ cond: parseExpr(t2.expr), body: parseUntil(['elseif', 'else', 'endif']) });
          else if (t2.kind === 'else') elseBody = parseUntil(['endif']);
          else break; // endif
        }
        nodes.push({ t: 'if', branches, elseBody });
      }
    }
    return nodes;
  }
  return parseUntil([]);
}

// ---------- expressions ----------

function lexExpr(s) {
  const out = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '"' || c === "'") {
      let j = i + 1, v = '';
      while (j < s.length && s[j] !== c) { if (s[j] === '\\') j++; v += s[j]; j++; }
      out.push({ k: 'str', v }); i = j + 1; continue;
    }
    if (/[0-9]/.test(c)) { const m = s.slice(i).match(/^[0-9]+(\.[0-9]+)?/); out.push({ k: 'num', v: Number(m[0]) }); i += m[0].length; continue; }
    if (/[A-Za-z_]/.test(c)) { const m = s.slice(i).match(/^[A-Za-z_][A-Za-z0-9_]*/); out.push({ k: 'id', v: m[0] }); i += m[0].length; continue; }
    if ('(),.+'.includes(c)) { out.push({ k: c }); i++; continue; }
    throw new Error(`Unexpected "${c}" in expression: ${s}`);
  }
  return out;
}

function parseExpr(src) {
  const toks = lexExpr(src);
  let p = 0;
  const peek = () => toks[p];
  const isId = (v) => peek() && peek().k === 'id' && peek().v === v;
  const expect = (k) => { if (!peek() || peek().k !== k) throw new Error(`Expected "${k}" in: ${src}`); return toks[p++]; };

  function compare() {
    let left = concat();
    if (isId('is')) {
      p++;
      let neg = false;
      if (isId('not')) { p++; neg = true; }
      left = { op: neg ? 'isnot' : 'is', a: left, b: concat() };
    } else if (isId('in')) {
      p++;
      left = { op: 'in', a: left, b: concat() };
    }
    return left;
  }
  function concat() {
    let left = unary();
    while (peek() && peek().k === '+') { p++; left = { op: '+', a: left, b: unary() }; }
    return left;
  }
  function unary() {
    if (isId('not') && toks[p + 1] && toks[p + 1].k !== '(') { p++; return { op: 'not', a: unary() }; }
    return primary();
  }
  function primary() {
    const t = toks[p++];
    if (!t) throw new Error(`Unexpected end of expression: ${src}`);
    if (t.k === 'str' || t.k === 'num') return { lit: t.v };
    if (t.k === '(') { const e = compare(); expect(')'); return e; }
    if (t.k === 'id') {
      if (t.v === 'true' || t.v === 'false') return { lit: t.v === 'true' };
      const path = [t.v];
      while (peek() && peek().k === '.') { p++; path.push(expect('id').v); }
      let node = { path };
      if (peek() && peek().k === '(') {
        p++;
        const args = [];
        while (peek() && peek().k !== ')') { args.push(compare()); if (peek() && peek().k === ',') p++; }
        expect(')');
        node = { call: path, args };
      }
      return node;
    }
    throw new Error(`Unexpected token in: ${src}`);
  }
  const ast = compare();
  if (p < toks.length) throw new Error(`Trailing tokens in expression: ${src}`);
  return ast;
}

// ---------- evaluation ----------

export function toStr(v) {
  if (v == null || v === false) return '';
  if (Array.isArray(v)) return v.map(toStr).filter(Boolean).join('\n');
  if (typeof v === 'function') return toStr(v());
  return String(v);
}

export function truthy(v) {
  if (typeof v === 'function') return truthy(v());
  if (Array.isArray(v)) return v.length > 0;
  if (v && typeof v === 'object') return typeof v.truthy === 'function' ? v.truthy() : toStr(v).trim() !== '';
  if (typeof v === 'string') return v.trim() !== '';
  return !!v;
}

function lookup(ctx, path) {
  let v = ctx.vars;
  let parent;
  for (const key of path) {
    if (v == null) return undefined;
    if (typeof v === 'function' && parent !== undefined) v = v();
    parent = v;
    v = v[key];
  }
  return typeof v === 'function' ? v.bind(parent) : v;
}

function evaluate(ast, ctx) {
  if ('lit' in ast) return ast.lit;
  if (ast.path) {
    const v = ast.path.length === 1 && ast.path[0] in ctx.fns && !(ast.path[0] in ctx.vars)
      ? ctx.fns[ast.path[0]] : lookup(ctx, ast.path);
    return typeof v === 'function' ? v() : v;
  }
  if (ast.call) {
    const fn = ast.call.length === 1 && ast.call[0] in ctx.fns ? ctx.fns[ast.call[0]] : lookup(ctx, ast.call);
    if (typeof fn !== 'function') throw new Error(`Not a function: ${ast.call.join('.')}`);
    return fn(...ast.args.map((a) => evaluate(a, ctx)));
  }
  const a = evaluate(ast.a, ctx);
  switch (ast.op) {
    case 'not': return !truthy(a);
    case '+': return toStr(a) + toStr(evaluate(ast.b, ctx));
    case 'is': return eq(a, evaluate(ast.b, ctx));
    case 'isnot': return !eq(a, evaluate(ast.b, ctx));
    case 'in': {
      const b = evaluate(ast.b, ctx);
      if (Array.isArray(b)) return b.some((x) => eq(x, a));
      return toStr(b).toLowerCase().includes(toStr(a).toLowerCase());
    }
  }
  throw new Error('Bad expression');
}

function eq(a, b) {
  if (Array.isArray(a)) return a.length === 1 && eq(a[0], b);
  return toStr(a).trim().toLowerCase() === toStr(b).trim().toLowerCase();
}

// Template text inside {#if} blocks is dedented by 2 spaces per level (interpolated values are left alone).
function dedent(text, depth, atLineStart) {
  if (!depth) return text;
  const re = new RegExp(`\\n {1,${2 * depth}}`, 'g');
  let s = text.replace(re, '\n');
  if (atLineStart) s = s.replace(new RegExp(`^ {1,${2 * depth}}`), '');
  return s;
}

function renderNodes(nodes, ctx, depth, prefix = '') {
  let out = '';
  for (const n of nodes) {
    const atLineStart = (prefix + out) === '' || (prefix + out).endsWith('\n');
    if (n.t === 'text') out += dedent(n.v, depth, atLineStart);
    else if (n.t === 'expr') out += toStr(evaluate(n.ast, ctx));
    else if (n.t === 'if') {
      const hit = n.branches.find((b) => truthy(evaluate(b.cond, ctx)));
      const body = hit ? hit.body : n.elseBody;
      if (body) out += renderNodes(body, ctx, depth + 1, (prefix + out).slice(-1));
    }
  }
  return out;
}

const cache = new Map();
function compile(src) {
  if (!cache.has(src)) cache.set(src, parseBlocks(tokenize(src)));
  return cache.get(src);
}

/** Render one template string. `ctx` = { vars, fns }. */
export function renderTemplate(src, ctx) {
  return renderNodes(compile(src), ctx, 0);
}

/** Tidy a rendered message the way NovelCrafter does: no runs of blank lines, trimmed. */
export function tidy(text) {
  return text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
