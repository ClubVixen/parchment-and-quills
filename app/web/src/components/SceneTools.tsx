import { useEffect, useRef, useState } from 'react';
import { useApp } from '../App';
import { useWorkspace } from '../views/Workspace';
import type { Novel, Scene } from '../types';
import { blankScene, mentions, sceneText } from '../util';
import { POV_STYLES, povStyle } from '../pov';
import { defaultInputs, GenerateDialog, Reasoning, useGeneration, type DialogResult } from './Generate';

function locate(n: Novel, sceneId: string) {
  for (const act of n.acts) for (const ch of act.chapters) {
    const i = ch.scenes.findIndex((s) => s.id === sceneId);
    if (i >= 0) return { act, ch, i };
  }
  return null;
}

export function useSceneOps() {
  const { update } = useWorkspace();
  const edit = (sceneId: string, fn: (s: Scene) => void) => update((n) => { const l = locate(n, sceneId); if (l) fn(l.ch.scenes[l.i]); });
  return {
    edit,
    move: (sceneId: string, dir: -1 | 1) => update((n) => {
      const l = locate(n, sceneId);
      if (!l) return;
      const j = l.i + dir;
      if (j >= 0 && j < l.ch.scenes.length) { const [s] = l.ch.scenes.splice(l.i, 1); l.ch.scenes.splice(j, 0, s); return; }
      // Move across chapter boundaries.
      const chapters = n.acts.flatMap((a) => a.chapters);
      const ci = chapters.indexOf(l.ch) + dir;
      if (ci < 0 || ci >= chapters.length) return;
      const [s] = l.ch.scenes.splice(l.i, 1);
      if (dir < 0) chapters[ci].scenes.push(s); else chapters[ci].scenes.unshift(s);
    }),
    remove: (sceneId: string) => update((n) => { const l = locate(n, sceneId); if (l) l.ch.scenes.splice(l.i, 1); }),
    insertAfter: (sceneId: string) => update((n) => { const l = locate(n, sceneId); if (l) l.ch.scenes.splice(l.i + 1, 0, blankScene()); }),
  };
}

/** Codex chips for a scene: linked entries + entries mentioned in its summary or text. */
export function SceneCodexChips({ scene }: { scene: Scene }) {
  const { novel, openCodex } = useWorkspace();
  const ops = useSceneOps();
  const [adding, setAdding] = useState(false);
  const found = mentions(novel.codex, `${scene.summary}\n${sceneText(scene)}`);
  const linked = novel.codex.filter((e) => scene.codexIds.includes(e.id));
  const all = [...linked, ...found.filter((e) => !scene.codexIds.includes(e.id))];
  return (
    <div className="chips">
      {all.map((e) => (
        <span key={e.id} className={`chip ${scene.codexIds.includes(e.id) ? 'linked' : ''}`} onClick={() => openCodex(e.id)} title={scene.codexIds.includes(e.id) ? 'Linked: always sent with this scene' : 'Mentioned'}>
          {e.name}
          {scene.codexIds.includes(e.id) && <button className="chip-x" onClick={(ev) => { ev.stopPropagation(); ops.edit(scene.id, (s) => { s.codexIds = s.codexIds.filter((x) => x !== e.id); }); }}>×</button>}
        </span>
      ))}
      {adding ? (
        <select className="input inline tiny" autoFocus onBlur={() => setAdding(false)} value="" onChange={(e) => { const id = e.target.value; if (id) ops.edit(scene.id, (s) => { s.codexIds = [...s.codexIds, id]; }); setAdding(false); }}>
          <option value="">Link codex entry…</option>
          {novel.codex.filter((e) => !scene.codexIds.includes(e.id)).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
      ) : <button className="chip toggle" onClick={() => setAdding(true)}>+ Codex</button>}
    </div>
  );
}

export function SceneMenu({ scene, onSummarize }: { scene: Scene; onSummarize: (tweak: boolean) => void }) {
  const ops = useSceneOps();
  const { novel } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [povOpen, setPovOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) { setOpen(false); setPovOpen(false); } };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const pov = scene.pov || null;
  return (
    <div className="menu-wrap" ref={ref}>
      <button className="icon-btn" title="Scene actions" onClick={() => setOpen(!open)}>⋮</button>
      {open && (
        <div className="menu">
          <button onClick={() => setPovOpen(!povOpen)}>👁 {pov ? `POV: ${pov.type}${pov.character ? ` (${pov.character})` : ''}` : 'Set custom POV'}</button>
          {povOpen && (
            <div className="menu-form">
              <select className="input" value={pov?.type || ''} onChange={(e) => ops.edit(scene.id, (s) => { s.pov = e.target.value ? { type: e.target.value, character: s.pov?.character || '' } : null; })}>
                <option value="">Novel default ({povStyle(novel.pov.type).label})</option>
                {POV_STYLES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
              {pov && <input className="input" placeholder="POV character" value={pov.character} onChange={(e) => ops.edit(scene.id, (s) => { if (s.pov) s.pov.character = e.target.value; })} />}
            </div>
          )}
          <label className="menu-check"><input type="checkbox" checked={scene.includeInAI !== false} onChange={(e) => ops.edit(scene.id, (s) => { s.includeInAI = e.target.checked; })} /> Include in AI context</label>
          <hr />
          <button onClick={() => { setOpen(false); onSummarize(false); }}>≡ Summarize scene</button>
          <button onClick={() => { setOpen(false); onSummarize(true); }}>≡ Summarize… (tweak)</button>
          <button onClick={() => { navigator.clipboard.writeText(sceneText(scene)); setOpen(false); }}>⧉ Copy text</button>
          <hr />
          <button onClick={() => { ops.move(scene.id, -1); setOpen(false); }}>↑ Move up</button>
          <button onClick={() => { ops.move(scene.id, 1); setOpen(false); }}>↓ Move down</button>
          <button onClick={() => { ops.insertAfter(scene.id); setOpen(false); }}>＋ New scene after</button>
          <button className="danger" onClick={() => { if (confirm('Delete this scene? (Recoverable from History.)')) ops.remove(scene.id); setOpen(false); }}>🗑 Delete scene</button>
        </div>
      )}
    </div>
  );
}

/** Runs the summarization prompt for a scene and shows the result with Apply / Discard. */
export function useSummarizer(scene: Scene) {
  const { novel, saveNow } = useWorkspace();
  const { prompts } = useApp();
  const ops = useSceneOps();
  const gen = useGeneration();
  const [dialog, setDialog] = useState(false);
  const [show, setShow] = useState(false);
  const summaryPrompt = prompts.find((p) => p.kind === 'summary');

  const req = (r: DialogResult) => ({ novelId: novel.id, promptId: r.promptId, inputs: r.inputs, model: r.model || undefined, context: r.context, task: { kind: 'summary' as const, sceneId: scene.id } });
  const last = useRef<DialogResult | null>(null);
  const start = async (r: DialogResult) => {
    last.current = r;
    setDialog(false); setShow(true);
    await saveNow();
    await gen.run(req(r));
  };
  const trigger = (tweak: boolean) => {
    if (!sceneText(scene).trim()) { alert('This scene has no text to summarize yet.'); return; }
    if (tweak) setDialog(true);
    else if (summaryPrompt) start({ promptId: summaryPrompt.id, inputs: defaultInputs(summaryPrompt), model: '', context: [] });
  };

  const ui = (
    <>
      {dialog && <GenerateDialog kind="summary" title="Summarize Scene" initial={{}} buildRequest={req} onGenerate={start} onClose={() => setDialog(false)} />}
      {show && (
        <div className="gen-result">
          <Reasoning text={gen.reasoning} busy={gen.busy && !gen.content} />
          {gen.error && <div className="alert">{gen.error}</div>}
          <div className="gen-text">{gen.content || (gen.busy ? <span className="muted">Summarizing…</span> : null)}</div>
          <div className="gen-actions">
            {gen.busy ? <button className="btn small" onClick={gen.stop}>Stop</button> : (
              <>
                <button className="btn small primary" disabled={!gen.content} onClick={() => { const text = gen.content.trim(); ops.edit(scene.id, (s) => { s.summary = text; }); setShow(false); gen.reset(); }}>✓ Apply summary</button>
                <button className="btn small" onClick={() => (last.current ? start(last.current) : trigger(false))}>↻ Retry</button>
                <button className="btn small ghost" onClick={() => { setShow(false); gen.reset(); }}>✕ Discard</button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
  return { trigger, ui };
}
