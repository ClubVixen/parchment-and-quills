import { useRef, useState } from 'react';
import { api, generate } from '../api';
import { useApp } from '../App';
import { useWorkspace } from '../views/Workspace';
import { applyBeats, parseBeatsReply, sceneParagraphs, type ProposedBeat } from '../beatsFromText';
import { BEAT_COLORS, chapterNumber, findScene, flatScenes, sceneLabel, type SceneRef } from '../util';
import { AutoTextarea } from './AutoTextarea';
import { defaultInputs, InputsForm, ModelSelect, type Inputs } from './Generate';

type Row = {
  ref: SceneRef;
  status: 'waiting' | 'running' | 'done' | 'error' | 'skipped' | 'empty';
  paragraphs: string[];
  beats?: ProposedBeat[];
  error?: string;
  thinking?: number;
  apply?: boolean;
};

const firstWords = (s: string, n = 14) => { const w = s.split(/\s+/); return w.slice(0, n).join(' ') + (w.length > n ? '…' : ''); };

/**
 * Review existing chapters with the AI: it reads each scene, proposes the beats it was written from and which
 * paragraphs belong to each, and on Apply the scenes get those beats with their prose split into beat sections.
 */
export function BeatsFromTextDialog({ chapterId, onClose }: { chapterId: string; onClose: () => void }) {
  const { prompts } = useApp();
  const { novel, update, saveNow, focusScene } = useWorkspace();
  const options = prompts.filter((p) => p.kind === 'beatsFromText');
  const [promptId, setPromptId] = useState(options[0]?.id || '');
  const prompt = prompts.find((p) => p.id === promptId);
  const [inputs, setInputs] = useState<Inputs>(defaultInputs(prompt));
  const [model, setModel] = useState('');
  const [scope, setScope] = useState(chapterId);
  const [existing, setExisting] = useState<'skip' | 'replace'>('skip');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const abort = useRef<AbortController | null>(null);

  const chapters = novel.acts.flatMap((a) => a.chapters);
  const inScope = flatScenes(novel).filter((r) => !scope || r.chapter.id === scope);
  const withBeats = inScope.filter((r) => (r.scene.beats || []).length).length;
  const scopeLabel = scope ? `Chapter ${chapterNumber(novel, scope)}` : 'the whole novel';

  const patchRow = (i: number, p: Partial<Row>) => setRows((rs) => rs && rs.map((r, j) => (j === i ? { ...r, ...p } : r)));

  const start = async () => {
    setError('');
    await saveNow();
    const list: Row[] = inScope.map((ref) => {
      const paragraphs = sceneParagraphs(ref.scene);
      const status = !paragraphs.length ? 'empty' : existing === 'skip' && (ref.scene.beats || []).length ? 'skipped' : 'waiting';
      return { ref, paragraphs, status };
    });
    setRows(list);
    setRunning(true);
    const ac = new AbortController();
    abort.current = ac;
    for (let i = 0; i < list.length; i++) {
      if (ac.signal.aborted) break;
      if (list[i].status !== 'waiting') continue;
      await analyse(i, list[i], ac.signal);
    }
    setRunning(false);
  };

  const analyse = async (i: number, row: Row, signal: AbortSignal) => {
    patchRow(i, { status: 'running', thinking: 0, error: undefined });
    let thinking = 0;
    try {
      const res = await generate({
        novelId: novel.id, promptId, inputs, model: model || undefined, context: [],
        task: { kind: 'beatsFromText', sceneId: row.ref.scene.id },
      }, { onDelta: (d) => { if (d.reasoning) { thinking += d.reasoning.length; patchRow(i, { thinking }); } } }, signal);
      const beats = parseBeatsReply(res.content, row.paragraphs.length);
      patchRow(i, { status: 'done', beats, apply: true });
    } catch (e) {
      if (!signal.aborted) patchRow(i, { status: 'error', error: (e as Error).message });
      else patchRow(i, { status: 'waiting' });
    }
  };

  const retry = async (i: number) => {
    if (!rows) return;
    const ac = new AbortController();
    abort.current = ac;
    setRunning(true);
    await analyse(i, rows[i], ac.signal);
    setRunning(false);
  };

  const stop = () => { abort.current?.abort(); setRunning(false); };

  const ready = (rows || []).filter((r) => r.status === 'done' && r.apply && r.beats?.length);
  const apply = async () => {
    // The text may have changed while the AI was reading; only apply where the paragraphs still line up.
    const stale = ready.filter((r) => {
      const s = findScene(novel, r.ref.scene.id);
      return !s || sceneParagraphs(s).join('\n\n') !== r.paragraphs.join('\n\n');
    });
    if (stale.length) { setError(`The text of ${stale.map((r) => sceneLabel(r.ref)).join(', ')} changed while it was being read. Run those again.`); return; }
    await saveNow();
    await api.snapshot(novel.id, `Before beats from text (${scopeLabel})`);
    update((n) => {
      for (const r of ready) {
        const s = findScene(n, r.ref.scene.id);
        if (s) applyBeats(s, r.beats!.filter((b) => b.text.trim()));
      }
    });
    await saveNow();
    focusScene(ready[0].ref.scene.id);
    onClose();
  };

  const editBeat = (i: number, k: number, text: string) => patchRow(i, { beats: rows![i].beats!.map((b, j) => (j === k ? { ...b, text } : b)) });

  return (
    <div className="modal-backdrop" onClick={running ? undefined : onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><h2>Beats from text</h2><button className="btn ghost" onClick={() => { stop(); onClose(); }}>× Close</button></div>
        <div className="modal-body">
          {!rows ? (
            <div className="form">
              <p className="muted small">
                The AI reads each scene, works out the beats it was written from and which paragraphs belong to each beat.
                You can check and edit them before anything changes. Applying adds the beats to the scene and marks each beat's
                paragraphs as its section; a history version is saved first.
              </p>
              <label>Chapters
                <select className="input" value={scope} onChange={(e) => setScope(e.target.value)}>
                  {chapters.map((c) => <option key={c.id} value={c.id}>Chapter {chapterNumber(novel, c.id)}{c.title ? `: ${c.title}` : ''}</option>)}
                  <option value="">Whole novel ({chapters.length} chapters)</option>
                </select>
              </label>
              <div className="muted small">{inScope.length} scene{inScope.length === 1 ? '' : 's'}, {inScope.reduce((n, r) => n + sceneParagraphs(r.scene).length, 0)} paragraphs.</div>
              {!!withBeats && (
                <label>{withBeats} scene{withBeats === 1 ? ' already has' : 's already have'} beats
                  <select className="input" value={existing} onChange={(e) => setExisting(e.target.value as 'skip' | 'replace')}>
                    <option value="skip">Leave those scenes as they are</option>
                    <option value="replace">Replace their beats too</option>
                  </select>
                </label>
              )}
              {options.length > 1 && (
                <label>Prompt
                  <select className="input" value={promptId} onChange={(e) => { setPromptId(e.target.value); setInputs(defaultInputs(prompts.find((p) => p.id === e.target.value))); }}>
                    {options.map((p) => <option key={p.id} value={p.id}>{p.name}{p.system ? '' : ' (custom)'}</option>)}
                  </select>
                </label>
              )}
              {prompt && <InputsForm prompt={prompt} inputs={inputs} setInputs={setInputs} context={[]} setContext={() => {}} />}
            </div>
          ) : (
            <div className="bft-rows">
              {rows.map((r, i) => (
                <div key={r.ref.scene.id} className={`bft-row ${r.status}`}>
                  <div className="row">
                    {r.status === 'done' && <input type="checkbox" checked={!!r.apply} onChange={(e) => patchRow(i, { apply: e.target.checked })} title="Apply this scene" />}
                    <b className="grow">{sceneLabel(r.ref)}</b>
                    <span className="muted small">
                      {r.status === 'waiting' && 'Waiting'}
                      {r.status === 'running' && (r.thinking ? `Reading… (${r.thinking.toLocaleString()} chars of reasoning)` : 'Reading…')}
                      {r.status === 'done' && `${r.beats!.length} beats · ${r.paragraphs.length} paragraphs`}
                      {r.status === 'skipped' && 'Skipped: already has beats'}
                      {r.status === 'empty' && 'Skipped: no text'}
                      {r.status === 'error' && 'Failed'}
                    </span>
                    {(r.status === 'done' || r.status === 'error') && !running && <button className="btn ghost tiny" onClick={() => retry(i)}>↻ Again</button>}
                  </div>
                  {r.error && <div className="alert small">{r.error}</div>}
                  {r.status === 'done' && r.apply && (
                    <ol className="bft-beats">
                      {r.beats!.map((b, k) => (
                        <li key={k} style={{ borderLeftColor: BEAT_COLORS[k % BEAT_COLORS.length] }}>
                          <AutoTextarea className="input small" value={b.text} onChange={(v) => editBeat(i, k, v)} />
                          <div className="muted tiny">¶ {b.from}{b.to > b.from ? `–${b.to}` : ''}: “{firstWords(r.paragraphs[b.from - 1])}”</div>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              ))}
            </div>
          )}
          {error && <div className="alert">{error}</div>}
        </div>
        <div className="modal-foot">
          {!rows ? (
            <>
              <ModelSelect value={model} onChange={setModel} />
              <div className="grow" />
              <button className="btn primary" disabled={!prompt || !inScope.length} onClick={start}>Read {scopeLabel}</button>
            </>
          ) : (
            <>
              {running ? <button className="btn" onClick={stop}>Stop</button> : <button className="btn ghost" onClick={() => setRows(null)}>← Settings</button>}
              <div className="grow" />
              <span className="muted small">{ready.length} scene{ready.length === 1 ? '' : 's'} ready</span>
              <button className="btn primary" disabled={running || !ready.length} onClick={apply}>Apply beats</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
