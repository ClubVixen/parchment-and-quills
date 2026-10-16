import { useState } from 'react';
import { api } from '../api';
import { useWorkspace } from '../views/Workspace';
import { Diff } from './History';
import { Markdown } from './Markdown';
import { blankScene, chapterNumber, flatScenes, newId, numberedItems, parseReply, parseSceneText, sceneLabel, sceneRef, serializeScene, wordCount, type SceneRef } from '../util';

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Renders an AI reply: Markdown text plus a card for every <revision> block. */
export function AssistantContent({ content, streaming = false }: { content: string; streaming?: boolean }) {
  const { novel } = useWorkspace();
  const parts = parseReply(content);
  const revisions = parts.filter((p) => p.kind === 'revision' && p.complete) as { ref: string; text: string }[];
  const flat = flatScenes(novel);
  const pending = revisions.filter((r) => { const f = flat.find((x) => sceneRef(x) === r.ref); return f && norm(serializeScene(f.scene)) !== norm(r.text); });
  return (
    <>
      {parts.map((p, i) => p.kind === 'text'
        ? <Markdown key={i} text={p.text} />
        : <RevisionCard key={i} refId={p.ref} text={p.text} complete={p.complete} />)}
      {!streaming && pending.length > 1 && <CommitAll revisions={pending} />}
      {!streaming && !revisions.length && <AddBeats content={content} />}
    </>
  );
}

function useCommit() {
  const { novel, update, saveNow } = useWorkspace();
  return async (items: { scene: SceneRef; text: string }[], label: string) => {
    await saveNow();
    await api.snapshot(novel.id, label);
    update((n) => {
      for (const { scene, text } of items) {
        for (const a of n.acts) for (const c of a.chapters) for (const s of c.scenes) if (s.id === scene.scene.id) { const parsed = parseSceneText(text, s.beats || []); s.blocks = parsed.blocks; s.beats = parsed.beats; }
      }
    });
    await saveNow();
  };
}

function RevisionCard({ refId, text, complete }: { refId: string; text: string; complete: boolean }) {
  const { novel, readChapter } = useWorkspace();
  const commit = useCommit();
  const [view, setView] = useState<'changes' | 'text'>('changes');
  const [busy, setBusy] = useState(false);
  const f = flatScenes(novel).find((x) => sceneRef(x) === refId);
  if (!f) return <div className="revision missing">Revision for unknown scene “{refId}” (it may have been moved or deleted).</div>;
  const current = serializeScene(f.scene);
  const committed = norm(current) === norm(text);

  return (
    <div className={`revision ${committed ? 'committed' : ''}`}>
      <div className="revision-head">
        <span className="chip tiny">{complete ? 'Revision' : 'Writing revision…'}</span>
        <b>{sceneLabel(f)}</b>
        <span className="muted tiny">{wordCount(current)} → {wordCount(text)} words</span>
        <div className="grow" />
        <div className="segmented small">
          <button className={view === 'changes' ? 'active' : ''} onClick={() => setView('changes')}>Changes</button>
          <button className={view === 'text' ? 'active' : ''} onClick={() => setView('text')}>New text</button>
        </div>
      </div>
      <div className="revision-body">
        {view === 'changes' ? <Diff a={current} b={text} /> : <div className="read-text">{text.split(/\n{2,}/).filter((p) => !/^#{1,6}\s*No beat\s*$/i.test(p.trim())).map((p, i) => /^#{1,6}\s*Beat\s*:/i.test(p) ? <h4 key={i} className="read-beat">{p.replace(/^#{1,6}\s*Beat\s*:\s*/i, '')}</h4> : <p key={i}>{p}</p>)}</div>}
      </div>
      {complete && (
        <div className="revision-actions">
          {committed
            ? <span className="committed-mark">✓ In the manuscript</span>
            : <button className="btn small primary" disabled={busy} onClick={async () => { setBusy(true); await commit([{ scene: f, text }], `Before AI revision – ${sceneLabel(f)}`); setBusy(false); }}>✓ Commit to scene</button>}
          <button className="btn small" onClick={() => readChapter(f.chapter.id)}>📖 Read chapter</button>
          <span className="muted tiny">A history version is saved before every commit, so you can always go back.</span>
        </div>
      )}
    </div>
  );
}

function CommitAll({ revisions }: { revisions: { ref: string; text: string }[] }) {
  const { novel } = useWorkspace();
  const commit = useCommit();
  const [busy, setBusy] = useState(false);
  const flat = flatScenes(novel);
  const items = revisions.map((r) => ({ scene: flat.find((x) => sceneRef(x) === r.ref)!, text: r.text })).filter((x) => x.scene);
  return (
    <div className="row">
      <button className="btn small primary" disabled={busy} onClick={async () => { setBusy(true); await commit(items, `Before AI revision – ${items.length} scenes`); setBusy(false); }}>
        ✓ Commit all {items.length} revisions
      </button>
    </div>
  );
}

/** "Add these beats to a scene" for replies that contain a numbered list. */
function AddBeats({ content }: { content: string }) {
  const { novel, update, focusScene } = useWorkspace();
  const items = numberedItems(content);
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<{ sceneId: string; text: string } | null>(null);
  if (items.length < 2) return null;
  const scenes = flatScenes(novel);
  const add = (choice: string) => {
    let sceneId = choice;
    if (choice.startsWith('new:')) {
      // A fresh scene at the end of the chosen chapter, holding just the beats.
      const scene = blankScene();
      sceneId = scene.id;
      update((n) => { n.acts.flatMap((a) => a.chapters).find((c) => c.id === choice.slice(4))?.scenes.push(scene); });
    }
    update((n) => {
      for (const a of n.acts) for (const c of a.chapters) for (const s of c.scenes) if (s.id === sceneId) {
        // Beats are summaries; assign text to them later by highlighting it in Write mode.
        s.beats ||= [];
        for (const t of items) s.beats.push({ id: newId(), text: t, words: '400' });
      }
    });
    const f = scenes.find((x) => x.scene.id === sceneId);
    setDone({ sceneId, text: `Added ${items.length} beats to ${f ? sceneLabel(f) : 'a new scene'}.` });
    setOpen(false);
  };
  return (
    <div className="add-beats">
      {done ? (
        <span className="muted small">{done.text} <button className="btn ghost tiny" onClick={() => focusScene(done.sceneId)}>Open in Write</button></span>
      ) : open ? (
        <select className="input inline" autoFocus value="" onChange={(e) => e.target.value && add(e.target.value)} onBlur={() => setOpen(false)}>
          <option value="">Add {items.length} beats to which scene?</option>
          <optgroup label="New scene at the end of…">
            {novel.acts.flatMap((a) => a.chapters).map((c) => <option key={c.id} value={`new:${c.id}`}>Chapter {chapterNumber(novel, c.id)}{c.title ? `: ${c.title}` : ''}</option>)}
          </optgroup>
          <optgroup label="Existing scene (beats go after its text)">
            {scenes.map((r) => <option key={r.scene.id} value={r.scene.id}>{sceneLabel(r)}{r.scene.summary ? ` – ${r.scene.summary.slice(0, 40)}…` : ''}</option>)}
          </optgroup>
        </select>
      ) : (
        <button className="btn ghost tiny" onClick={() => setOpen(true)}>∿ Add these {items.length} beats to a scene…</button>
      )}
    </div>
  );
}
