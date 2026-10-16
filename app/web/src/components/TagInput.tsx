import { useMemo, useRef, useState } from 'react';

/** Chip-style tag editor that suggests tags already used elsewhere (most used first). */
export function TagInput({ value, onChange, known, placeholder = 'Add a tag…' }: {
  value: string[];
  onChange: (tags: string[]) => void;
  known: string[];
  placeholder?: string;
}) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [moved, setMoved] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const suggestions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of known) counts.set(t, (counts.get(t) || 0) + 1);
    const have = new Set(value.map((t) => t.toLowerCase()));
    const q = text.trim().toLowerCase();
    return [...counts.entries()]
      .filter(([t]) => !have.has(t.toLowerCase()) && (!q || t.toLowerCase().includes(q)))
      .sort((a, b) => Number(b[0].toLowerCase().startsWith(q)) - Number(a[0].toLowerCase().startsWith(q)) || b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 8)
      .map(([t]) => t);
  }, [known, value, text]);

  const add = (raw: string) => {
    const tag = raw.trim().replace(/,$/, '').trim();
    if (tag && !value.some((t) => t.toLowerCase() === tag.toLowerCase())) onChange([...value, tag]);
    setText(''); setActive(0); setMoved(false);
  };

  return (
    <div className="tag-input" onClick={() => input.current?.focus()}>
      {value.map((t) => (
        <span key={t} className="chip">{t}<button type="button" className="chip-x" onClick={() => onChange(value.filter((x) => x !== t))}>×</button></span>
      ))}
      <div className="tag-input-field">
        <input
          ref={input}
          value={text}
          placeholder={value.length ? '' : placeholder}
          onChange={(e) => { const v = e.target.value; if (v.endsWith(',')) add(v); else { setText(v); setOpen(true); setActive(0); setMoved(false); } }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => { if (text.trim()) add(text); setOpen(false); }, 120)}
          onKeyDown={(e) => {
            const pick = open && suggestions[active];
            if (e.key === 'Tab' && pick) { e.preventDefault(); add(pick); }
            else if (e.key === 'Enter') {
              e.preventDefault();
              if (pick && (moved || !text.trim())) add(pick);
              else if (text.trim()) add(text);
            } else if (e.key === 'ArrowDown') { e.preventDefault(); setMoved(true); setActive((a) => Math.min(a + 1, suggestions.length - 1)); setOpen(true); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setMoved(true); setActive((a) => Math.max(a - 1, 0)); }
            else if (e.key === 'Backspace' && !text && value.length) onChange(value.slice(0, -1));
            else if (e.key === 'Escape') setOpen(false);
          }}
        />
        {open && suggestions.length > 0 && (
          <div className="tag-suggest">
            {suggestions.map((s, i) => (
              <button type="button" key={s} className={i === active ? 'active' : ''} onMouseDown={(e) => { e.preventDefault(); add(s); }}>{s}</button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
