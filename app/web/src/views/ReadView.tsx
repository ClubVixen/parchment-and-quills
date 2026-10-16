import { useCallback, useEffect, useRef, useState } from 'react';
import { useWorkspace } from './Workspace';
import { beatColor, chapterNumber, chapterWords, paragraphs, textBlocks } from '../util';
import { AudioPlayer } from '../components/Audio';

export const READ_FONTS = [
  { name: 'Open Sans', css: "'Open Sans', sans-serif" },
  { name: 'Source Serif 4', css: "'Source Serif 4', Georgia, serif" },
  { name: 'Lora', css: "'Lora', Georgia, serif" },
  { name: 'Merriweather', css: "'Merriweather', Georgia, serif" },
  { name: 'Literata', css: "'Literata', Georgia, serif" },
  { name: 'Georgia', css: 'Georgia, serif' },
  { name: 'Atkinson Hyperlegible', css: "'Atkinson Hyperlegible', sans-serif" },
  { name: 'Inter', css: 'Inter, sans-serif' },
  { name: 'Courier Prime', css: "'Courier Prime', 'Courier New', monospace" },
];

const SPACING = { single: { label: 'Single', lh: 1.4 }, onehalf: { label: '1.5', lh: 1.6 }, double: { label: 'Double', lh: 1.8 }, airy: { label: 'Extra', lh: 2.1 } };
const WIDTHS = { narrow: { label: 'Narrow', px: 640 }, medium: { label: 'Medium', px: 830 }, wide: { label: 'Wide', px: 1040 }, full: { label: 'Full', px: 0 } };
const THEMES = { light: 'Light', sepia: 'Sepia', dark: 'Dark' };

type Fmt = {
  font: string; size: number; spacing: keyof typeof SPACING; paragraphs: 'spaced' | 'indented';
  align: 'justify' | 'left'; width: keyof typeof WIDTHS; theme: keyof typeof THEMES; beats: boolean;
};
// FimFiction's default look: Open Sans 16px, 1.8 line height, blank line between paragraphs, justified, ~830px.
const DEFAULT_FMT: Fmt = { font: 'Open Sans', size: 16, spacing: 'double', paragraphs: 'spaced', align: 'justify', width: 'medium', theme: 'light', beats: false };

function loadFmt(): Fmt {
  try { return { ...DEFAULT_FMT, ...JSON.parse(localStorage.getItem('pq.read.fmt') || '{}') }; } catch { return DEFAULT_FMT; }
}

/** Distraction-free reading of the manuscript, one chapter or the whole book, with read-aloud. */
export function ReadView() {
  const { novel, readChapterId, focusScene } = useWorkspace();
  const chapters = novel.acts.flatMap((a, ai) => a.chapters.map((c) => ({ c, ai })));
  const [chapterId, setChapterId] = useState<string>(readChapterId || chapters[0]?.c.id || '');
  const [fmt, setFmt] = useState<Fmt>(loadFmt);
  const [menu, setMenu] = useState(false);
  const [listening, setListening] = useState(false);
  const [reading, setReading] = useState<number | null>(null);
  const [seek, setSeek] = useState<{ para: number; n: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (readChapterId) setChapterId(readChapterId); }, [readChapterId]);
  useEffect(() => { try { localStorage.setItem('pq.read.fmt', JSON.stringify(fmt)); } catch { /* storage unavailable */ } }, [fmt]);
  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menu]);
  useEffect(() => {
    if (reading == null) return;
    document.querySelector(`[data-para="${reading}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [reading]);
  const onPara = useCallback((p: number | null) => setReading(p), []);

  const set = <K extends keyof Fmt>(k: K, v: Fmt[K]) => setFmt((f) => ({ ...f, [k]: v }));
  const idx = chapters.findIndex((x) => x.c.id === chapterId);
  const shown = chapterId === 'all' ? chapters : chapters.filter((x) => x.c.id === chapterId);
  const font = READ_FONTS.find((f) => f.name === fmt.font) || READ_FONTS[0];
  const width = WIDTHS[fmt.width].px;
  const go = (i: number) => { setChapterId(chapters[i].c.id); setListening(false); document.querySelector('.main-content')?.scrollTo(0, 0); };

  return (
    <div className={`read theme-${fmt.theme}`}>
      <div className="read-tools">
        <select className="input inline" value={chapterId} onChange={(e) => { setChapterId(e.target.value); setListening(false); }}>
          <option value="all">Whole book</option>
          {chapters.map(({ c }) => <option key={c.id} value={c.id}>Chapter {chapterNumber(novel, c.id)}{c.title ? `: ${c.title}` : ''}</option>)}
        </select>
        <div className="grow" />
        {chapterId !== 'all' && !listening && <button className="btn small" onClick={() => setListening(true)}>🔊 Listen</button>}
        <div className="menu-wrap" ref={menuRef}>
          <button className={`btn small ${menu ? 'on' : ''}`} onClick={() => setMenu(!menu)}>Aa Format</button>
          {menu && (
            <div className="menu format-menu">
              <div className="fmt-row"><span>Font</span>
                <select className="input inline" value={fmt.font} onChange={(e) => set('font', e.target.value)}>
                  {READ_FONTS.map((f) => <option key={f.name} value={f.name} style={{ fontFamily: f.css }}>{f.name}</option>)}
                </select>
              </div>
              <div className="fmt-row"><span>Size</span>
                <div className="segmented small">
                  <button onClick={() => set('size', Math.max(12, fmt.size - 1))}>A−</button>
                  <button className="active">{fmt.size}px</button>
                  <button onClick={() => set('size', Math.min(30, fmt.size + 1))}>A+</button>
                </div>
              </div>
              <Choice label="Line spacing" value={fmt.spacing} options={Object.fromEntries(Object.entries(SPACING).map(([k, v]) => [k, v.label]))} onChange={(v) => set('spacing', v as Fmt['spacing'])} />
              <Choice label="Paragraphs" value={fmt.paragraphs} options={{ spaced: 'Spaced', indented: 'Indented' }} onChange={(v) => set('paragraphs', v as Fmt['paragraphs'])} />
              <Choice label="Alignment" value={fmt.align} options={{ justify: 'Justified', left: 'Left' }} onChange={(v) => set('align', v as Fmt['align'])} />
              <Choice label="Page width" value={fmt.width} options={Object.fromEntries(Object.entries(WIDTHS).map(([k, v]) => [k, v.label]))} onChange={(v) => set('width', v as Fmt['width'])} />
              <Choice label="Theme" value={fmt.theme} options={THEMES} onChange={(v) => set('theme', v as Fmt['theme'])} />
              <label className="menu-check"><input type="checkbox" checked={fmt.beats} onChange={(e) => set('beats', e.target.checked)} /> Show beat labels</label>
              <button className="link-btn" onClick={() => setFmt(DEFAULT_FMT)}>Reset to default</button>
            </div>
          )}
        </div>
      </div>
      {listening && chapterId !== 'all' && (
        <AudioPlayer chapterId={chapterId} seek={seek} onPara={onPara} onClose={() => setListening(false)} />
      )}
      <article className={`read-page para-${fmt.paragraphs}`} style={{
        fontFamily: font.css, fontSize: fmt.size, lineHeight: SPACING[fmt.spacing].lh, textAlign: fmt.align,
        maxWidth: width ? width + 128 : undefined,
      }}>
        {shown.map(({ c, ai }) => {
          let para = 0; // paragraph numbers match the read-aloud script
          return (
            <section key={c.id} className="read-chapter">
              <div className="read-act">Act {ai + 1}{novel.acts[ai].title ? ` · ${novel.acts[ai].title}` : ''}</div>
              <h1>{c.title || `Chapter ${chapterNumber(novel, c.id)}`}</h1>
              <div className="muted small read-meta">Chapter {chapterNumber(novel, c.id)} · {chapterWords(c).toLocaleString()} words</div>
              {c.scenes.map((s, si) => {
                const blocks = textBlocks(s);
                const empty = !blocks.some((b) => b.text.trim());
                return (
                  <div key={s.id} className="read-scene">
                    {si > 0 && <div className="scene-divider">* * *</div>}
                    {empty && <p className="muted read-empty">{s.summary ? `(Not written yet. Summary: ${s.summary})` : '(Empty scene)'}</p>}
                    {blocks.map((b, bi) => {
                      const beat = (s.beats || []).find((x) => x.id === b.beatId);
                      const label = fmt.beats && beat && blocks[bi - 1]?.beatId !== b.beatId
                        ? <div className="read-beat" style={{ color: beatColor(s, b.beatId) }}>{beat.text}</div> : null;
                      return (
                        <div key={b.id}>
                          {label}
                          {paragraphs(b.text).map((p) => {
                            const n = para++;
                            return (
                              <p key={n} data-para={n} className={reading === n ? 'reading' : ''}
                                onClick={listening ? () => setSeek({ para: n, n: Date.now() }) : undefined}>{p}</p>
                            );
                          })}
                        </div>
                      );
                    })}
                    <button className="btn ghost tiny read-edit" onClick={() => focusScene(s.id)}>✎ Edit scene</button>
                  </div>
                );
              })}
            </section>
          );
        })}
        {chapterId !== 'all' && (
          <div className="read-nav">
            <button className="btn" disabled={idx <= 0} onClick={() => go(idx - 1)}>← Previous chapter</button>
            <button className="btn" disabled={idx < 0 || idx >= chapters.length - 1} onClick={() => go(idx + 1)}>Next chapter →</button>
          </div>
        )}
      </article>
    </div>
  );
}

function Choice({ label, value, options, onChange }: { label: string; value: string; options: Record<string, string>; onChange: (v: string) => void }) {
  return (
    <div className="fmt-row"><span>{label}</span>
      <div className="segmented small">
        {Object.entries(options).map(([k, v]) => <button key={k} className={value === k ? 'active' : ''} onClick={() => onChange(k)}>{v}</button>)}
      </div>
    </div>
  );
}
