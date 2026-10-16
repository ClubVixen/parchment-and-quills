import { useState } from 'react';
import { useWorkspace } from './Workspace';
import type { Act, Chapter, Scene } from '../types';
import { blankChapter, blankScene, chapterNumber, chapterWords, moveItem, newId, sceneWords } from '../util';
import { SceneCodexChips, SceneMenu, useSummarizer } from '../components/SceneTools';
import { AutoTextarea } from '../components/AutoTextarea';

export function PlanView() {
  const { novel, update } = useWorkspace();
  const [filter, setFilter] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  return (
    <div className="plan">
      <div className="plan-tools">
        <input className="input search" placeholder="Filter scenes…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>
      {novel.acts.map((act, ai) => (
        <section key={act.id} className="act">
          <div className="act-head">
            <button className="icon-btn" onClick={() => setCollapsed((c) => ({ ...c, [act.id]: !c[act.id] }))}>{collapsed[act.id] ? '▸' : '▾'}</button>
            <h2>Act {ai + 1}:</h2>
            <input className="input bare act-title" placeholder="Untitled act" value={act.title} onChange={(e) => update((n) => { n.acts[ai].title = e.target.value; })} />
            <span className="muted small">{act.chapters.length} chapter{act.chapters.length === 1 ? '' : 's'} – {act.chapters.reduce((t, c) => t + chapterWords(c), 0).toLocaleString()} words</span>
            <button className="btn small" onClick={() => update((n) => { n.acts[ai].chapters.push(blankChapter()); })}>+ New Chapter</button>
            <ActMenu act={act} index={ai} />
          </div>
          {!collapsed[act.id] && (
            <div className="chapter-row">
              {act.chapters.map((ch, ci) => <ChapterCard key={ch.id} chapter={ch} actIndex={ai} index={ci} filter={filter} />)}
            </div>
          )}
        </section>
      ))}
      <div className="plan-foot">
        <button className="btn" onClick={() => update((n) => { n.acts.push({ id: newId(), title: '', chapters: [blankChapter()] }); })}>+ New Act</button>
      </div>
    </div>
  );
}

function ActMenu({ act, index }: { act: Act; index: number }) {
  const { update, novel } = useWorkspace();
  return (
    <span className="act-actions">
      <button className="icon-btn" title="Move act up" disabled={index === 0} onClick={() => update((n) => moveItem(n.acts, index, index - 1))}>↑</button>
      <button className="icon-btn" title="Move act down" disabled={index === novel.acts.length - 1} onClick={() => update((n) => moveItem(n.acts, index, index + 1))}>↓</button>
      <button className="icon-btn" title="Delete act" onClick={() => {
        if (novel.acts.length === 1) return alert('A novel needs at least one act.');
        if (confirm(`Delete Act ${index + 1}${act.title ? ` "${act.title}"` : ''} and all its chapters? (Recoverable from History.)`)) update((n) => { n.acts.splice(index, 1); });
      }}>🗑</button>
    </span>
  );
}

function ChapterCard({ chapter, actIndex, index, filter }: { chapter: Chapter; actIndex: number; index: number; filter: string }) {
  const { update, novel } = useWorkspace();
  const no = chapterNumber(novel, chapter.id);
  const edit = (fn: (c: Chapter) => void) => update((n) => fn(n.acts[actIndex].chapters[index]));
  const scenes = chapter.scenes.filter((s) => !filter || `${s.title} ${s.summary}`.toLowerCase().includes(filter.toLowerCase()));
  return (
    <div className="chapter-card">
      <div className="chapter-head">
        <div className="grow">
          <div className="muted small">Chapter {no} – {chapterWords(chapter).toLocaleString()} words</div>
          <input className="input bare chapter-title" placeholder="Untitled chapter" value={chapter.title} onChange={(e) => edit((c) => { c.title = e.target.value; })} />
        </div>
        <button className="icon-btn" title="Move left" onClick={() => update((n) => moveItem(n.acts[actIndex].chapters, index, index - 1))}>←</button>
        <button className="icon-btn" title="Move right" onClick={() => update((n) => moveItem(n.acts[actIndex].chapters, index, index + 1))}>→</button>
        <button className="icon-btn" title="Delete chapter" onClick={() => { if (confirm(`Delete Chapter ${no} and its scenes? (Recoverable from History.)`)) update((n) => { n.acts[actIndex].chapters.splice(index, 1); }); }}>🗑</button>
      </div>
      {scenes.map((s) => <SceneCard key={s.id} scene={s} number={chapter.scenes.indexOf(s) + 1} />)}
      <button className="btn ghost small full" onClick={() => edit((c) => { c.scenes.push(blankScene()); })}>+ New scene</button>
    </div>
  );
}

function SceneCard({ scene, number }: { scene: Scene; number: number }) {
  const { update, focusScene } = useWorkspace();
  const { trigger, ui } = useSummarizer(scene);
  const set = (fn: (s: Scene) => void) => update((n) => { for (const a of n.acts) for (const c of a.chapters) for (const s of c.scenes) if (s.id === scene.id) fn(s); });
  return (
    <div className={`scene-card ${scene.includeInAI === false ? 'excluded' : ''}`}>
      <div className="scene-head">
        <span className="muted small">Scene {number} – {sceneWords(scene).toLocaleString()} words</span>
        <input className="input bare scene-title" placeholder="" value={scene.title} onChange={(e) => set((s) => { s.title = e.target.value; })} />
        <button className="icon-btn" title="Open in Write mode" onClick={() => focusScene(scene.id)}>✎</button>
        <SceneMenu scene={scene} onSummarize={trigger} />
      </div>
      <AutoTextarea className="input bare summary" placeholder="Add summary…" value={scene.summary} onChange={(v) => set((s) => { s.summary = v; })} />
      {ui}
      {(scene.beats || []).some((b) => b.text.trim()) && (
        <ol className="card-beats" title="Story beats in this scene">
          {(scene.beats || []).filter((b) => b.text.trim()).map((b) => <li key={b.id}>{b.text}</li>)}
        </ol>
      )}
      <SceneCodexChips scene={scene} />
      {scene.pov && <div className="muted tiny">POV: {scene.pov.type}{scene.pov.character ? ` – ${scene.pov.character}` : ''}</div>}
    </div>
  );
}
