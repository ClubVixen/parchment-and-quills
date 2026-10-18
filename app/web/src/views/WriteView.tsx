import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../App';
import { useWorkspace } from './Workspace';
import type { Beat, Prompt, Scene, TextBlock } from '../types';
import { beatColor, blankScene, chapterNumber, flatScenes, mentions, mergeBlocks, newId, sceneWords, textBlocks } from '../util';
import { AutoTextarea } from '../components/AutoTextarea';
import { SceneCodexChips, SceneMenu, useSceneOps, useSummarizer } from '../components/SceneTools';
import { BeatsFromTextDialog } from '../components/BeatsFromText';
import { ContextPicker, defaultInputs, GenerateDialog, ModelSelect, promptInputs, Reasoning, useGeneration, type DialogResult, type Inputs } from '../components/Generate';

type Caret = { blockId: string; pos: number } | null;

export function WriteView() {
  const { novel, focusedSceneId } = useWorkspace();
  const [chapterFilter, setChapterFilter] = useState('');
  const [beatsFor, setBeatsFor] = useState<string | null>(null);
  const chapters = novel.acts.flatMap((a, ai) => a.chapters.map((c) => ({ c, ai })));

  useEffect(() => {
    if (focusedSceneId) document.getElementById(`scene-${focusedSceneId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [focusedSceneId]);

  return (
    <div className="write">
      <div className="write-tools">
        <select className="input inline" value={chapterFilter} onChange={(e) => setChapterFilter(e.target.value)}>
          <option value="">Everything – full manuscript</option>
          {chapters.map(({ c }) => <option key={c.id} value={c.id}>Chapter {chapterNumber(novel, c.id)}{c.title ? `: ${c.title}` : ''}</option>)}
        </select>
        <button className="btn small" onClick={() => setBeatsFor(chapterFilter || chapters[0]?.c.id || '')} title="Let the AI read existing chapters and add their beats">∿ Beats from text…</button>
        <span className="muted small">Tip: highlight a passage to rewrite it or assign it to a beat.</span>
      </div>
      {beatsFor !== null && <BeatsFromTextDialog chapterId={beatsFor} onClose={() => setBeatsFor(null)} />}
      <div className="manuscript">
        {novel.acts.map((act, ai) => {
          const visible = act.chapters.filter((c) => !chapterFilter || c.id === chapterFilter);
          if (!visible.length) return null;
          return (
            <div key={act.id}>
              <div className="ms-act">Act {ai + 1}{act.title ? `: ${act.title}` : ''}</div>
              {visible.map((ch) => (
                <div key={ch.id} className="ms-chapter">
                  <div className="ms-chapter-head">
                    <h1 className="ms-chapter-title">{ch.title || `Chapter ${chapterNumber(novel, ch.id)}`}</h1>
                    <button className="btn ghost small" onClick={() => setBeatsFor(ch.id)} title="Let the AI read this chapter and add its beats">∿ Beats from text</button>
                  </div>
                  {ch.scenes.map((s, si) => (
                    <div key={s.id}>
                      {si > 0 && <div className="scene-divider">⟡</div>}
                      <SceneEditor scene={s} number={si + 1} chapterNo={chapterNumber(novel, ch.id)} />
                    </div>
                  ))}
                  <ChapterAddScene chapterId={ch.id} />
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ChapterAddScene({ chapterId }: { chapterId: string }) {
  const { update } = useWorkspace();
  return <button className="btn ghost small" onClick={() => update((n) => { n.acts.flatMap((a) => a.chapters).find((c) => c.id === chapterId)?.scenes.push(blankScene()); })}>+ New scene</button>;
}

// ---------- beat operations ----------

/** Expand a selection to whole paragraphs, so a beat always owns complete paragraphs. */
function snapToParagraphs(text: string, start: number, end: number) {
  let e = end;
  while (e > start && /\s/.test(text[e - 1])) e--;
  const s = text.lastIndexOf('\n', start - 1) + 1;
  const next = text.indexOf('\n', e);
  return { start: s, end: next < 0 ? text.length : next };
}

function useBeatOps(sceneId: string) {
  const ops = useSceneOps();
  const editScene = (fn: (s: Scene) => void) => ops.edit(sceneId, (s) => { s.beats ||= []; fn(s); mergeBlocks(s); });
  return {
    /** Give the paragraphs touched by [start, end) of a block to a beat (or to no beat when beatId is undefined). */
    assign(blockId: string, start: number, end: number, beatId: string | undefined) {
      editScene((s) => {
        const i = s.blocks.findIndex((b) => b.id === blockId);
        const blk = s.blocks[i] as TextBlock;
        if (!blk) return;
        const r = snapToParagraphs(blk.text, start, end);
        const piece = (text: string, id: string | undefined): TextBlock => ({ id: newId(), type: 'text', text, beatId: id });
        const parts = [
          piece(blk.text.slice(0, r.start).replace(/\s+$/, ''), blk.beatId),
          piece(blk.text.slice(r.start, r.end).trim(), beatId),
          piece(blk.text.slice(r.end).replace(/^\s+/, ''), blk.beatId),
        ].filter((p, k) => k === 1 || p.text);
        s.blocks.splice(i, 1, ...parts);
      });
    },
    addBeat(text: string): string {
      const id = newId();
      editScene((s) => { s.beats!.push({ id, text, words: '400' }); });
      return id;
    },
    setBeat(beatId: string, fn: (b: Beat) => void) {
      ops.edit(sceneId, (s) => { const b = s.beats?.find((x) => x.id === beatId); if (b) fn(b); });
    },
    removeBeat(beatId: string) {
      editScene((s) => {
        s.beats = s.beats!.filter((b) => b.id !== beatId);
        for (const b of textBlocks(s)) if (b.beatId === beatId) delete b.beatId;
      });
    },
    moveBeat(beatId: string, dir: -1 | 1) {
      ops.edit(sceneId, (s) => {
        const i = s.beats!.findIndex((b) => b.id === beatId), j = i + dir;
        if (i < 0 || j < 0 || j >= s.beats!.length) return;
        [s.beats![i], s.beats![j]] = [s.beats![j], s.beats![i]];
      });
    },
    /** Add AI text at the end of a beat's section (or as a new section at the end of the scene). */
    appendToBeat(beatId: string, text: string) {
      editScene((s) => {
        const last = s.blocks.map((b) => (b as TextBlock).beatId).lastIndexOf(beatId);
        if (last >= 0) { const b = s.blocks[last] as TextBlock; b.text = b.text.trim() ? `${b.text.trim()}\n\n${text}` : text; }
        else {
          const tail = s.blocks.at(-1) as TextBlock | undefined;
          if (tail && !tail.text.trim()) s.blocks.pop();
          s.blocks.push({ id: newId(), type: 'text', text, beatId });
        }
      });
    },
  };
}

// ---------- scene ----------

function SceneEditor({ scene, number, chapterNo }: { scene: Scene; number: number; chapterNo: number }) {
  const ops = useSceneOps();
  const beatOps = useBeatOps(scene.id);
  const { trigger, ui } = useSummarizer(scene);
  const caret = useRef<Caret>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [openBeat, setOpenBeat] = useState<{ id: string; mode: 'edit' | 'ai' } | null>(null);
  const beats = scene.beats || [];
  const blocks = textBlocks(scene);

  const jump = (beatId: string) => {
    const first = blocks.find((b) => b.beatId === beatId);
    if (!first) return false;
    document.getElementById(`blk-${first.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setFlash(beatId);
    window.setTimeout(() => setFlash((f) => (f === beatId ? null : f)), 2600);
    return true;
  };

  return (
    <div id={`scene-${scene.id}`} className={`ms-scene ${scene.includeInAI === false ? 'excluded' : ''}`}>
      <div className="ms-scene-gutter">
        <div className="muted tiny">CHAPTER {chapterNo} · SCENE {number} – {sceneWords(scene).toLocaleString()} words</div>
        <input className="input bare small" placeholder="Scene title" value={scene.title} onChange={(e) => ops.edit(scene.id, (s) => { s.title = e.target.value; })} />
        <ClampedSummary scene={scene} />
        {ui}
        <BeatPanel scene={scene} open={openBeat} setOpen={setOpenBeat} onJump={jump}
          onAdd={(text, mode) => { const id = beatOps.addBeat(text); setOpenBeat({ id, mode }); }} />
        <SceneCodexChips scene={scene} />
        <div className="row wrap">
          <SceneMenu scene={scene} onSummarize={trigger} />
        </div>
      </div>
      <div className="ms-scene-body">
        {blocks.map((b, i) => {
          const sectionStart = !!b.beatId && blocks[i - 1]?.beatId !== b.beatId;
          const beatNo = beats.findIndex((x) => x.id === b.beatId) + 1;
          return (
            <TextBlockEditor key={b.id} scene={scene} block={b} caret={caret}
              color={beatColor(scene, b.beatId)} flashing={!!b.beatId && flash === b.beatId}
              tag={sectionStart && beatNo ? { no: beatNo, text: beats[beatNo - 1].text } : null}
              onTag={() => { if (b.beatId) { setOpenBeat({ id: b.beatId, mode: 'edit' }); jump(b.beatId); } }}
              onNewBeat={(id) => setOpenBeat({ id, mode: 'edit' })} />
          );
        })}
      </div>
    </div>
  );
}

// ---------- prose blocks: selection rewrite + beat assignment ----------

const AUTO_GUIDE: Record<string, string> = {
  Rephrase: 'Rephrase it so it reads smoothly and naturally, keeping the meaning, tone and voice.',
};

/**
 * Prompt inputs for a quick rewrite: the optional guide text goes into the prompt's Instructions input, and any
 * other required choice without a default (e.g. Shorten's Length) takes its first option.
 */
function guidedInputs(p: Prompt, guide: string): Inputs {
  const inputs = defaultInputs(p);
  const defs = promptInputs(p);
  const instr = defs.find((i) => i.name === 'Instructions');
  if (instr) {
    const g = guide.trim() || (instr.required ? AUTO_GUIDE[p.name] || 'Improve the passage while keeping its meaning and voice.' : '');
    if (g) inputs.Instructions = instr.mode === 'multiple' ? [g] : g;
  }
  for (const d of defs) if (d.required && d !== instr && !inputs[d.name] && d.options?.length) inputs[d.name] = d.options[0];
  return inputs;
}

function TextBlockEditor({ scene, block, caret, color, flashing, tag, onTag, onNewBeat }: {
  scene: Scene; block: TextBlock; caret: React.MutableRefObject<Caret>; color: string; flashing: boolean;
  tag: { no: number; text: string } | null; onTag: () => void; onNewBeat: (id: string) => void;
}) {
  const ops = useSceneOps();
  const beatOps = useBeatOps(scene.id);
  const { novel, saveNow } = useWorkspace();
  const { prompts } = useApp();
  const ta = useRef<HTMLTextAreaElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const [sel, setSel] = useState<{ start: number; end: number } | null>(null);
  const [guide, setGuide] = useState('');
  const [job, setJob] = useState<{ start: number; end: number; original: string; result?: DialogResult } | null>(null);
  const [dialog, setDialog] = useState<{ promptId: string } | null>(null);
  const gen = useGeneration();
  const replacePrompts = prompts.filter((p) => p.kind === 'replace');
  const beats = scene.beats || [];

  const track = () => {
    const el = ta.current;
    if (!el) return;
    caret.current = { blockId: block.id, pos: el.selectionStart };
    setSel(el.selectionEnd > el.selectionStart ? { start: el.selectionStart, end: el.selectionEnd } : null);
  };
  // Keep the selection while the user types a guide or picks a beat in the toolbar.
  const blurLater = () => setTimeout(() => {
    const active = document.activeElement;
    if (!bar.current?.contains(active) && active !== ta.current) setSel(null);
  }, 150);

  const reqFor = (r: DialogResult, range: { start: number; end: number }) => ({
    novelId: novel.id, promptId: r.promptId, inputs: r.inputs, model: r.model || undefined, context: r.context,
    task: { kind: 'replace' as const, sceneId: scene.id, blockId: block.id, start: range.start, end: range.end },
  });

  const run = async (r: DialogResult, range = sel || job) => {
    if (!range) return;
    setDialog(null);
    setJob({ start: range.start, end: range.end, original: block.text.slice(range.start, range.end), result: r });
    await saveNow();
    await gen.run(reqFor(r, range));
  };

  const quick = (p: Prompt) => run({ promptId: p.id, inputs: guidedInputs(p, guide), model: '', context: [] });

  const apply = () => {
    if (!job) return;
    // Keep the whitespace that surrounded the selection so words don't run together.
    const lead = job.original.match(/^\s*/)![0], trail = job.original.match(/\s*$/)![0];
    const text = lead + gen.content.trim() + trail;
    ops.edit(scene.id, (s) => {
      const b = s.blocks.find((x) => x.id === block.id) as TextBlock | undefined;
      if (!b) return;
      // Use the stored range if the text there is unchanged, otherwise find the original passage.
      if (b.text.slice(job.start, job.end) === job.original) b.text = b.text.slice(0, job.start) + text + b.text.slice(job.end);
      else if (b.text.includes(job.original)) b.text = b.text.replace(job.original, text);
    });
    setJob(null); gen.reset(); setGuide('');
  };

  const assign = (value: string) => {
    if (!sel) return;
    if (value === 'new') {
      const first = block.text.slice(sel.start, sel.end).trim().split(/(?<=[.!?])\s/)[0].slice(0, 140);
      const id = beatOps.addBeat(first);
      beatOps.assign(block.id, sel.start, sel.end, id);
      onNewBeat(id);
    } else beatOps.assign(block.id, sel.start, sel.end, value === 'none' ? undefined : value);
    setSel(null);
  };

  return (
    <div id={`blk-${block.id}`} className={`text-block ${block.beatId ? 'in-beat' : ''} ${flashing ? 'flash-section' : ''}`}
      style={{ ['--beat' as string]: color }}>
      {tag && <button className="beat-tag" title={`Beat ${tag.no}: ${tag.text}`} onClick={onTag}>{tag.no}</button>}
      {sel && !job && (
        <div className="sel-toolbar" ref={bar}>
          <input className="guide-input" placeholder="Guide it (optional) – e.g. more tension, add her fear…" value={guide}
            onChange={(e) => setGuide(e.target.value)} onBlur={blurLater} />
          {replacePrompts.map((p) => <button key={p.id} className="btn tiny" onMouseDown={(e) => e.preventDefault()} onClick={() => quick(p)} title={guide.trim() ? `${p.name}, guided` : `${p.name} (auto)`}>{p.name}</button>)}
          <button className="btn tiny ghost" onMouseDown={(e) => e.preventDefault()} onClick={() => setDialog({ promptId: replacePrompts[0]?.id })}>Tweak…</button>
          <select className="beat-assign" value="" onChange={(e) => assign(e.target.value)} onBlur={blurLater} title="Ascribe the highlighted paragraphs to a beat">
            <option value="">∿ Beat…</option>
            {beats.map((b, i) => <option key={b.id} value={b.id}>{i + 1}. {b.text.slice(0, 60) || '(untitled)'}</option>)}
            <option value="new">＋ New beat from selection</option>
            {block.beatId && <option value="none">Remove from beat</option>}
          </select>
          <span className="muted tiny">{block.text.slice(sel.start, sel.end).split(/\s+/).filter(Boolean).length} words</span>
        </div>
      )}
      <AutoTextarea
        ref={ta}
        className="prose"
        placeholder={block.beatId ? 'Write this beat…' : 'Start writing…'}
        value={block.text}
        onChange={(v) => { ops.edit(scene.id, (s) => { const b = s.blocks.find((x) => x.id === block.id); if (b) b.text = v; }); track(); }}
        onSelect={track}
        onKeyUp={track}
        onClick={track}
        onBlur={() => { if (ta.current) caret.current = { blockId: block.id, pos: ta.current.selectionStart }; blurLater(); }}
      />
      {dialog && sel && (
        <GenerateDialog kind="replace" title="Rewrite selection" initial={{ promptId: dialog.promptId, inputs: guidedInputs(prompts.find((p) => p.id === dialog.promptId)!, guide) }}
          buildRequest={(r) => reqFor(r, sel)} onGenerate={(r) => run(r, sel)} onClose={() => setDialog(null)} />
      )}
      {job && (
        <div className="gen-result docked">
          <div className="muted tiny">Original: “{job.original.length > 160 ? job.original.slice(0, 160) + '…' : job.original}”{guide.trim() ? ` · guided: “${guide.trim()}”` : ' · auto'}</div>
          <Reasoning text={gen.reasoning} busy={gen.busy && !gen.content} />
          {gen.error && <div className="alert">{gen.error}</div>}
          <div className="gen-text prose-preview">{gen.content || (gen.busy ? <span className="muted">Writing…</span> : null)}</div>
          <div className="gen-actions">
            {gen.busy ? <button className="btn small" onClick={gen.stop}>Stop</button> : (
              <>
                <button className="btn small primary" disabled={!gen.content} onClick={apply}>✓ Replace</button>
                <button className="btn small" onClick={() => job.result && run(job.result, job)}>↻ Retry</button>
                <button className="btn small ghost" onClick={() => { setJob(null); gen.reset(); }}>✕ Discard</button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- side panel: summary + beats ----------

function ClampedSummary({ scene }: { scene: Scene }) {
  const ops = useSceneOps();
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const long = scene.summary.length > 180 || scene.summary.split('\n').length > 3;
  return (
    <div className="gutter-section">
      <AutoTextarea className={`input bare summary small ${long && !open && !focused ? 'clamped' : ''}`} placeholder="Add summary…" value={scene.summary}
        onChange={(v) => ops.edit(scene.id, (s) => { s.summary = v; })} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} />
      {long && !focused && <button className="link-btn" onClick={() => setOpen(!open)}>{open ? 'Show less ▴' : 'Show more ▾'}</button>}
    </div>
  );
}

function BeatPanel({ scene, open, setOpen, onJump, onAdd }: {
  scene: Scene;
  open: { id: string; mode: 'edit' | 'ai' } | null;
  setOpen: (o: { id: string; mode: 'edit' | 'ai' } | null) => void;
  onJump: (beatId: string) => boolean;
  onAdd: (text: string, mode: 'edit' | 'ai') => void;
}) {
  const [all, setAll] = useState(false);
  const beats = scene.beats || [];
  const blocks = textBlocks(scene);
  return (
    <div className="gutter-section beat-shortcuts">
      <div className="gutter-head">
        <span>Beats{beats.length ? ` · ${beats.length}` : ''}</span>
        <div className="grow" />
        {beats.length > 0 && <button className="link-btn" onClick={() => setAll(!all)}>{all ? 'Shrink ▴' : 'Expand all ▾'}</button>}
        <button className="link-btn" onClick={() => onAdd('', 'edit')}>+ Beat</button>
      </div>
      {!beats.length && <div className="muted tiny">No beats yet. Highlight text and choose “∿ Beat…”, add one here, or add beats from a chat reply.</div>}
      <ol>
        {beats.map((b, i) => {
          const isOpen = open?.id === b.id;
          const hasText = blocks.some((x) => x.beatId === b.id);
          return (
            <li key={b.id} className={`beat-item ${isOpen ? 'open' : ''}`}>
              <div className="beat-row" onClick={() => { if (!onJump(b.id)) setOpen({ id: b.id, mode: 'edit' }); }} title={hasText ? 'Jump to this beat in the text' : 'No text assigned yet'}>
                <span className="beat-dot" style={{ background: beatColor(scene, b.id) }}>{i + 1}</span>
                <span className={all || isOpen ? 'beat-summary' : 'beat-summary clamp2'}>{b.text.trim() || <i className="muted">(no summary yet)</i>}</span>
              </div>
              <div className="beat-actions">
                {!hasText && <span className="muted tiny">no text yet</span>}
                <button className="link-btn" onClick={() => setOpen(isOpen && open?.mode === 'edit' ? null : { id: b.id, mode: 'edit' })}>Edit</button>
                <button className="link-btn" onClick={() => setOpen(isOpen && open?.mode === 'ai' ? null : { id: b.id, mode: 'ai' })}>✦ Write with AI</button>
              </div>
              {isOpen && open!.mode === 'edit' && <BeatEdit scene={scene} beat={b} index={i} onClose={() => setOpen(null)} />}
              {isOpen && open!.mode === 'ai' && <BeatAI scene={scene} beat={b} onDone={() => { setOpen(null); onJump(b.id); }} />}
            </li>
          );
        })}
      </ol>
      <button className="link-btn" onClick={() => onAdd('Continue the story.', 'ai')}>✦ Continue the story with a new beat</button>
    </div>
  );
}

function BeatEdit({ scene, beat, index, onClose }: { scene: Scene; beat: Beat; index: number; onClose: () => void }) {
  const beatOps = useBeatOps(scene.id);
  return (
    <div className="beat-edit">
      <AutoTextarea className="input small" autoFocus placeholder="What happens in this beat (its summary)…" value={beat.text} onChange={(v) => beatOps.setBeat(beat.id, (b) => { b.text = v; })} />
      <div className="row wrap">
        <button className="btn tiny" disabled={index === 0} onClick={() => beatOps.moveBeat(beat.id, -1)}>↑</button>
        <button className="btn tiny" disabled={index === (scene.beats?.length || 0) - 1} onClick={() => beatOps.moveBeat(beat.id, 1)}>↓</button>
        <button className="btn tiny ghost danger" onClick={() => { if (confirm('Delete this beat? Its text stays in the scene, just no longer assigned.')) { beatOps.removeBeat(beat.id); onClose(); } }}>Delete beat</button>
        <div className="grow" />
        <button className="btn tiny" onClick={onClose}>Done</button>
      </div>
    </div>
  );
}

function BeatAI({ scene, beat, onDone }: { scene: Scene; beat: Beat; onDone: () => void }) {
  const beatOps = useBeatOps(scene.id);
  const { novel, saveNow } = useWorkspace();
  const { prompts } = useApp();
  const gen = useGeneration();
  const [dialog, setDialog] = useState(false);
  const [model, setModel] = useState('');
  const last = useRef<DialogResult | null>(null);
  const beatPrompts = prompts.filter((p) => p.kind === 'beat');
  const promptId = beat.promptId && beatPrompts.some((p) => p.id === beat.promptId) ? beat.promptId : beatPrompts[0]?.id;

  const warnings = useMemo(() => {
    const w: string[] = [];
    const flat = flatScenes(novel);
    const idx = flat.findIndex((f) => f.scene.id === scene.id);
    const missing = flat.slice(0, idx).filter((f) => f.scene.includeInAI !== false && !f.scene.summary.trim());
    if (missing.length) w.push(`${missing.length} earlier scene(s) have no summary, so the AI won't know what happened there.`);
    if (beat.text.trim() && novel.codex.length && !mentions(novel.codex, beat.text).length) w.push('The beat mentions no codex entries; use names so the AI gets their details.');
    return w;
  }, [novel, scene.id, beat.text]);

  const req = (r: DialogResult) => ({
    novelId: novel.id, promptId: r.promptId, inputs: r.inputs, model: r.model || undefined, context: r.context,
    task: { kind: 'beat' as const, sceneId: scene.id, beatId: beat.id },
  });
  const run = async (r: DialogResult) => {
    last.current = r;
    setDialog(false);
    await saveNow();
    await gen.run(req(r));
  };
  const quickRun = () => {
    const p = prompts.find((x) => x.id === promptId);
    run({ promptId: promptId!, inputs: { ...defaultInputs(p), Words: beat.words || '400' }, model, context: beat.context || [] });
  };

  return (
    <div className="beat-ai">
      <AutoTextarea className="input small" placeholder="What should happen in this beat…" value={beat.text} onChange={(v) => beatOps.setBeat(beat.id, (b) => { b.text = v; })} />
      <div className="beat-tools">
        {['200', '400', '600'].map((w) => <button key={w} className={(beat.words || '400') === w ? 'chip toggle on' : 'chip toggle'} onClick={() => beatOps.setBeat(beat.id, (b) => { b.words = w; })}>{w}</button>)}
        <input className="input inline tiny words-input" placeholder="words" value={['200', '400', '600'].includes(beat.words || '400') ? '' : beat.words} onChange={(e) => beatOps.setBeat(beat.id, (b) => { b.words = e.target.value.replace(/\D/g, '') || '400'; })} />
      </div>
      <ContextPicker value={beat.context || []} onChange={(c) => beatOps.setBeat(beat.id, (b) => { b.context = c; })} />
      {!!warnings.length && <ul className="warnings">{warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
      <div className="beat-run">
        <select className="input inline tiny" value={promptId} onChange={(e) => beatOps.setBeat(beat.id, (b) => { b.promptId = e.target.value; })}>
          {beatPrompts.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <ModelSelect value={model} onChange={setModel} />
      </div>
      <div className="beat-run">
        <button className="btn primary small" disabled={gen.busy || !beat.text.trim()} onClick={quickRun}>▶ Generate</button>
        <button className="btn small" onClick={() => setDialog(true)}>Tweak…</button>
      </div>
      {dialog && (
        <GenerateDialog kind="beat" initial={{ promptId, inputs: { ...defaultInputs(prompts.find((p) => p.id === promptId)), Words: beat.words || '400' }, model, context: beat.context || [] }}
          buildRequest={req} onGenerate={run} onClose={() => setDialog(false)} />
      )}
      {(gen.busy || gen.content || gen.error) && (
        <div className="gen-result">
          {gen.meta && <div className="muted tiny">Codex: {gen.meta.codex.length ? gen.meta.codex.join(', ') : 'none'}</div>}
          <Reasoning text={gen.reasoning} busy={gen.busy && !gen.content} />
          {gen.error && <div className="alert">{gen.error}</div>}
          <div className="gen-text prose-preview small-prose">{gen.content || (gen.busy ? <span className="muted">Writing…</span> : null)}</div>
          <div className="gen-actions">
            {gen.busy ? <button className="btn small" onClick={gen.stop}>■ Stop</button> : (
              <>
                <button className="btn small primary" disabled={!gen.content} onClick={() => { beatOps.appendToBeat(beat.id, gen.content.trim()); gen.reset(); onDone(); }}>✓ Add to beat</button>
                <button className="btn small" onClick={() => (last.current ? run(last.current) : quickRun())}>↻</button>
                <button className="btn small ghost" onClick={() => gen.reset()}>✕</button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
