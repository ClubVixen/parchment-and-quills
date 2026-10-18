import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import type { FunctionDoc } from '../types';
import { AutoTextarea } from './AutoTextarea';

// Prompt template highlighting, in the spirit of NovelCrafter's prompt editor: comments, control tags,
// function calls, strings and the XML tags the prompts use are each coloured.

const KEYWORDS = new Set(['is', 'in', 'not', 'and', 'or', 'true', 'false']);

function highlightExpr(src: string, key: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(#(?:if|elseif|else|endif))|([A-Za-z_][\w.]*)(\s*\()?|(\d+(?:\.\d+)?)/g;
  let last = 0, m: RegExpExecArray | null, n = 0;
  while ((m = re.exec(src))) {
    if (m.index > last) out.push(src.slice(last, m.index));
    const k = `${key}-${n++}`;
    if (m[1]) out.push(<span key={k} className="hl-str">{m[1]}</span>);
    else if (m[2]) out.push(<span key={k} className="hl-ctl">{m[2]}</span>);
    else if (m[3]) {
      const cls = m[4] ? 'hl-fn' : KEYWORDS.has(m[3]) ? 'hl-kw' : 'hl-var';
      out.push(<span key={k} className={cls}>{m[3]}</span>);
      if (m[4]) out.push(m[4]);
    } else if (m[5]) out.push(<span key={k} className="hl-num">{m[5]}</span>);
    last = re.lastIndex;
  }
  if (last < src.length) out.push(src.slice(last));
  return out;
}

/** Split template text into highlighted spans. */
export function highlight(src: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let i = 0, text = '', n = 0;
  const flushText = () => {
    if (!text) return;
    // XML-ish tags in plain text (<codex>, </instructions>, <text words="…">).
    const parts = text.split(/(<\/?[A-Za-z][\w-]*(?:\s[^<>]*)?\/?>)/);
    parts.forEach((p, j) => out.push(j % 2 ? <span key={`t${n}-${j}`} className="hl-tag">{p}</span> : p));
    n++;
    text = '';
  };
  while (i < src.length) {
    if (src.startsWith('{!', i)) {
      const end = src.indexOf('!}', i + 2);
      const stop = end < 0 ? src.length : end + 2;
      flushText();
      out.push(<span key={`c${n++}`} className="hl-comment">{src.slice(i, stop)}</span>);
      i = stop;
      continue;
    }
    if (src[i] === '{') {
      let depth = 0, j = i + 1, quote: string | null = null;
      for (; j < src.length; j++) {
        const d = src[j];
        if (quote) { if (d === '\\') j++; else if (d === quote) quote = null; continue; }
        if (d === '"' || d === "'") quote = d;
        else if (d === '(' || d === '{') depth++;
        else if (d === ')') depth--;
        else if (d === '}') { if (depth <= 0) break; depth--; }
      }
      if (j < src.length) {
        flushText();
        const body = src.slice(i + 1, j);
        const ctl = /^\s*#/.test(body);
        out.push(<span key={`e${n++}`} className={ctl ? 'hl-block hl-block-ctl' : 'hl-block'}>{'{'}{highlightExpr(body, `x${n}`)}{'}'}</span>);
        i = j + 1;
        continue;
      }
    }
    text += src[i++];
  }
  flushText();
  return out;
}

/** Template editor: a transparent textarea over a highlighted copy of the same text. */
export function CodeEditor({ value, onChange, readOnly }: { value: string; onChange?: (v: string) => void; readOnly?: boolean }) {
  const shown = useMemo(() => highlight(value), [value]);
  if (readOnly) return <pre className="code code-view">{shown}{'\n'}</pre>;
  return (
    <div className="code-editor">
      <pre className="code code-view" aria-hidden>{shown}{'\n'}</pre>
      <AutoTextarea className="code code-input" spellCheck={false} value={value} onChange={(v) => onChange?.(v)} />
    </div>
  );
}

const SECTION_LABEL: Record<string, string> = {
  composition: 'Composition', logic: 'Logic', lists: 'Lists', math: 'Math', text: 'Text', other: 'Other', context: 'Context',
  prompts: 'Prompts', series: 'Series', novels: 'Novel', acts: 'Acts', chapters: 'Chapters', scenes: 'Scenes',
  snippets: 'Snippets', codex: 'Codex', pov: 'Point of view',
};

let docsCache: Promise<FunctionDoc[]> | null = null;

/** Searchable list of every template function; click one to copy it. */
export function FunctionReference() {
  const [docs, setDocs] = useState<FunctionDoc[]>([]);
  const [q, setQ] = useState('');
  const [copied, setCopied] = useState('');
  useEffect(() => { (docsCache ??= api.templateFunctions().catch(() => [])).then(setDocs); }, []);
  const hits = docs.filter((d) => !q || `${d.name} ${d.description}`.toLowerCase().includes(q.toLowerCase()));
  const sections = [...new Set(hits.map((d) => d.section))];
  const copy = (name: string) => { navigator.clipboard.writeText(`{${name}}`); setCopied(name); setTimeout(() => setCopied(''), 1200); };
  return (
    <div className="fn-ref">
      <input className="input" placeholder={`Search ${docs.length} functions…`} value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="fn-list">
        {sections.map((s) => (
          <div key={s}>
            <div className="fn-section">{SECTION_LABEL[s] || s}</div>
            {hits.filter((d) => d.section === s).map((d) => (
              <button key={d.name} className="fn-item" onClick={() => copy(d.name)} title="Copy">
                <code className="hl-fn">{d.name}</code>{copied === d.name && <span className="muted tiny"> copied</span>}
                <span className="muted small">{d.description}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
