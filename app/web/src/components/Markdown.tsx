import { Fragment, type ReactNode } from 'react';

/** Minimal, safe Markdown renderer for chat replies: headings, lists, quotes, code, bold/italic/inline code. */
export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r/g, '').split('\n');
  const out: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (line.startsWith('```')) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) body.push(lines[i++]);
      i++;
      out.push(<pre key={out.length} className="md-code">{body.join('\n')}</pre>);
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)/);
    if (h) { const Tag = (`h${Math.min(h[1].length + 2, 6)}`) as 'h3'; out.push(<Tag key={out.length}>{inline(h[2])}</Tag>); i++; continue; }
    if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]/.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) {
        let item = lines[i].replace(/^\s*([-*+]|\d+[.)])\s+/, '');
        i++;
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) item += ' ' + lines[i++].trim();
        items.push(item);
      }
      const List = ordered ? 'ol' : 'ul';
      out.push(<List key={out.length}>{items.map((it, k) => <li key={k}>{inline(it)}</li>)}</List>);
      continue;
    }
    if (line.startsWith('>')) {
      const q: string[] = [];
      while (i < lines.length && lines[i].startsWith('>')) q.push(lines[i++].replace(/^>\s?/, ''));
      out.push(<blockquote key={out.length}>{inline(q.join(' '))}</blockquote>);
      continue;
    }
    if (/^(-{3,}|\*{3,})$/.test(line.trim())) { out.push(<hr key={out.length} />); i++; continue; }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|>|\s*([-*+]|\d+[.)])\s+)/.test(lines[i])) para.push(lines[i++]);
    out.push(<p key={out.length}>{para.map((p, k) => <Fragment key={k}>{k > 0 && <br />}{inline(p)}</Fragment>)}</p>);
  }
  return <div className="md">{out}</div>;
}

function inline(s: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|__[^_]+__|\*[^*\s][^*]*\*|_[^_\s][^_]*_|`[^`]+`)/g;
  let last = 0;
  for (const m of s.matchAll(re)) {
    if (m.index! > last) parts.push(s.slice(last, m.index));
    const t = m[0];
    if (t.startsWith('**') || t.startsWith('__')) parts.push(<strong key={parts.length}>{t.slice(2, -2)}</strong>);
    else if (t.startsWith('`')) parts.push(<code key={parts.length}>{t.slice(1, -1)}</code>);
    else parts.push(<em key={parts.length}>{t.slice(1, -1)}</em>);
    last = m.index! + t.length;
  }
  if (last < s.length) parts.push(s.slice(last));
  return parts;
}
