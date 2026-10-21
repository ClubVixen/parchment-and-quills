import { useMemo, useState } from 'react';
import { useWorkspace } from '../views/Workspace';
import type { Change, CodexFields, Scene } from '../types';
import { changeLabel, changeScene, passageContext } from '../changes';
import { findScene, serializeScene } from '../util';
import { diffWords } from './History';

// Review UI for changes the AI proposed in chats: a highlighted preview (green = added, red = removed) with
// Accept / Reject, shown in the chat, in the chapter itself (Write and Read), in the codex and in the drawer.

type Piece = { t: 'same' | 'del' | 'add'; s: string };
type Para = { kind: 'same' | 'del' | 'add' | 'mixed'; pieces: Piece[]; text: string };

const splitParas = (s: string) => s.replace(/\r/g, '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);

/** Paragraph-level LCS, then a word diff inside paragraphs that were edited (works for whole chapters). */
export function diffParagraphs(a: string, b: string): Para[] {
  const x = splitParas(a), y = splitParas(b);
  const dp = Array.from({ length: x.length + 1 }, () => new Uint16Array(y.length + 1));
  for (let i = x.length - 1; i >= 0; i--) for (let j = y.length - 1; j >= 0; j--)
    dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: Para[] = [];
  let dels: string[] = [], adds: string[] = [];
  const flush = () => {
    // Pair removed and added paragraphs that sit in the same spot: show them as one edited paragraph.
    const n = Math.min(dels.length, adds.length);
    for (let k = 0; k < n; k++) {
      const d = diffWords(dels[k], adds[k]);
      const same = d ? d.filter((p) => p.t === 'same').reduce((s, p) => s + p.s.length, 0) : 0;
      if (d && same > Math.min(dels[k].length, adds[k].length) * 0.3) out.push({ kind: 'mixed', pieces: d, text: adds[k] });
      else out.push({ kind: 'del', pieces: [{ t: 'del', s: dels[k] }], text: dels[k] }, { kind: 'add', pieces: [{ t: 'add', s: adds[k] }], text: adds[k] });
    }
    for (const d of dels.slice(n)) out.push({ kind: 'del', pieces: [{ t: 'del', s: d }], text: d });
    for (const p of adds.slice(n)) out.push({ kind: 'add', pieces: [{ t: 'add', s: p }], text: p });
    dels = []; adds = [];
  };
  let i = 0, j = 0;
  while (i < x.length || j < y.length) {
    if (i < x.length && j < y.length && x[i] === y[j]) { flush(); out.push({ kind: 'same', pieces: [{ t: 'same', s: x[i] }], text: x[i] }); i++; j++; }
    else if (j >= y.length || (i < x.length && dp[i + 1][j] >= dp[i][j + 1])) dels.push(x[i++]);
    else adds.push(y[j++]);
  }
  flush();
  return out;
}

const BEAT_LINE = /^#{1,6}\s*Beat\s*:\s*/i;
const NO_BEAT_LINE = /^#{1,6}\s*No beat\s*$/i;

/** Prose with changes highlighted; "### Beat:" lines show as beat headings. */
export function ProseDiff({ before, after, className = 'prose-diff' }: { before: string; after: string; className?: string }) {
  const paras = useMemo(() => diffParagraphs(before, after), [before, after]);
  return (
    <div className={className}>
      {paras.map((p, k) => {
        if (NO_BEAT_LINE.test(p.text)) return null;
        if (BEAT_LINE.test(p.text)) {
          return <h4 key={k} className={`diff-beat ${p.kind}`}>∿ {p.pieces.map((x, i) => <span key={i} className={x.t}>{x.s.replace(BEAT_LINE, '')}</span>)}</h4>;
        }
        return <p key={k} className={`diff-para ${p.kind}`}>{p.pieces.map((x, i) => <span key={i} className={x.t}>{x.s}</span>)}</p>;
      })}
    </div>
  );
}

function CodexDiff({ before, after }: { before: CodexFields | null; after: CodexFields }) {
  const row = (label: string, a: string, b: string) => (a === b ? null : (
    <div className="codex-diff-row"><span className="muted small">{label}</span> {a && <span className="del">{a}</span>} <span className="add">{b || '(none)'}</span></div>
  ));
  return (
    <div className="codex-diff">
      {before ? (
        <>
          {row('Name', before.name, after.name)}
          {row('Type', before.type, after.type)}
          {row('Aliases', before.aliases.join(', '), after.aliases.join(', '))}
          {row('Tags', before.tags.join(', '), after.tags.join(', '))}
          {before.description !== after.description && <ProseDiff before={before.description} after={after.description} className="prose-diff small" />}
        </>
      ) : (
        <>
          <div className="codex-diff-row"><b>{after.name}</b> <span className="chip tiny">{after.type}</span>{after.aliases.length > 0 && <span className="muted small"> aliases: {after.aliases.join(', ')}</span>}{after.tags.length > 0 && <span className="muted small"> · tags: {after.tags.join(', ')}</span>}</div>
          <ProseDiff before="" after={after.description} className="prose-diff small" />
        </>
      )}
    </div>
  );
}

/** What accepting the change would do, highlighted against the book as it is now. */
export function ChangePreview({ change }: { change: Change }) {
  const { novel } = useWorkspace();
  const scene = change.sceneId ? findScene(novel, change.sceneId) : undefined;
  switch (change.kind) {
    case 'revision': return <ProseDiff before={scene ? serializeScene(scene) : String(change.base || '')} after={change.text || ''} />;
    case 'passage': {
      const ctx = scene && passageContext(scene, change);
      if (!ctx) return <div className="alert small">The text this edit changes is no longer in the scene (it was edited since), so it can't be applied. Reject it, or ask the AI again.</div>;
      return <>{change.note && <p className="muted small">{change.note}</p>}<ProseDiff before={ctx.before} after={ctx.after} /></>;
    }
    case 'sceneSummary': return <ProseDiff before={scene?.summary || ''} after={change.text || ''} className="prose-diff small" />;
    case 'codexEntry': {
      const e = change.entryId ? novel.codex.find((x) => x.id === change.entryId) : undefined;
      const now = e ? { name: e.name, type: e.type, aliases: e.aliases || [], tags: e.tags || [], description: e.description || '' } : (change.base as CodexFields | null);
      return <CodexDiff before={now} after={change.codex!} />;
    }
    default: return (
      <>
        {change.summary && <p className="muted small"><b>Summary:</b> {change.summary}</p>}
        <ProseDiff before="" after={change.text || ''} />
      </>
    );
  }
}

export function ChangeButtons({ list, small = true }: { list: Change[]; small?: boolean }) {
  const { decideChanges } = useWorkspace();
  const [busy, setBusy] = useState(false);
  const pending = list.filter((c) => c.status === 'pending');
  if (!pending.length) {
    const s = list[0]?.status;
    return <span className={`change-status ${s}`}>{s === 'accepted' ? '✓ Accepted' : s === 'rejected' ? '✕ Rejected' : ''}</span>;
  }
  const go = async (status: 'accepted' | 'rejected') => { setBusy(true); try { await decideChanges(pending, status); } finally { setBusy(false); } };
  return (
    <span className="change-buttons">
      <button className={`btn ${small ? 'small' : ''} primary`} disabled={busy} onClick={() => go('accepted')}>✓ Accept{pending.length > 1 ? ` all ${pending.length}` : ''}</button>
      <button className={`btn ${small ? 'small' : ''}`} disabled={busy} onClick={() => go('rejected')}>✕ Reject{pending.length > 1 ? ' all' : ''}</button>
    </span>
  );
}

/** A proposed change as a card: label, highlighted preview, Accept / Reject and links to where it applies. */
export function ChangeCard({ change, open: startOpen = true, inBook = false }: { change: Change; open?: boolean; inBook?: boolean }) {
  const { novel, focusScene, openThread, threads } = useWorkspace();
  const [open, setOpen] = useState(startOpen);
  const where = changeScene(novel, change);
  const thread = threads.find((t) => t.id === change.threadId);
  return (
    <div className={`change-card ${change.kind} ${change.status}`}>
      <div className="change-head">
        <span className="chip tiny ai-chip">✦ AI</span>
        <b className="grow">{changeLabel(novel, change)}</b>
        <button className="btn ghost tiny" onClick={() => setOpen(!open)}>{open ? 'Hide' : 'Show'} changes</button>
      </div>
      {open && <div className="change-body"><ChangePreview change={change} /></div>}
      <div className="change-foot">
        <ChangeButtons list={[change]} />
        <div className="grow" />
        {!inBook && where && change.status === 'pending' && <button className="btn ghost tiny" onClick={() => focusScene(where)}>Show in chapter</button>}
        {inBook && thread && <button className="btn ghost tiny" onClick={() => openThread(thread.id)}>From chat “{thread.title || 'Untitled'}”</button>}
      </div>
    </div>
  );
}

/** Pending changes that rewrite this scene or its summary. */
export const sceneChanges = (changes: Change[], sceneId: string) =>
  changes.filter((c) => c.status === 'pending' && c.sceneId === sceneId && (c.kind === 'revision' || c.kind === 'sceneSummary' || c.kind === 'passage'));
/** Pending new scenes that go right after this scene (or at the end of the chapter when `sceneId` is its last). */
export function newScenesAfter(changes: Change[], chapter: { id: string; scenes: Scene[] }, sceneId: string) {
  const last = chapter.scenes.at(-1)?.id === sceneId;
  return changes.filter((c) => c.status === 'pending' && c.kind === 'newScene' && c.chapterId === chapter.id
    && (c.afterSceneId === sceneId || (last && (!c.afterSceneId || !chapter.scenes.some((s) => s.id === c.afterSceneId)))));
}
/** Pending new chapters after this chapter (`null` = at the end of the book). */
export const newChaptersAfter = (changes: Change[], chapterId: string | null, allChapterIds: string[]) =>
  changes.filter((c) => c.status === 'pending' && c.kind === 'newChapter'
    && (c.afterChapterId === chapterId || (chapterId === allChapterIds.at(-1) && (!c.afterChapterId || !allChapterIds.includes(c.afterChapterId)))));

/** A proposed new scene or chapter, shown in place in the manuscript. */
export function PendingInsert({ change }: { change: Change }) {
  return (
    <div className={`pending-insert ${change.kind}`}>
      {change.kind === 'newChapter' && <h1 className="ms-chapter-title pending-title">{change.title || 'New chapter'}</h1>}
      <ChangeCard change={change} inBook />
    </div>
  );
}

/** Every pending change, grouped, with Accept all / Reject all. */
export function ChangesDrawer({ onClose }: { onClose: () => void }) {
  const { changes } = useWorkspace();
  const pending = changes.filter((c) => c.status === 'pending');
  const book = pending.filter((c) => c.kind !== 'codexEntry');
  const codex = pending.filter((c) => c.kind === 'codexEntry');
  const decided = changes.filter((c) => c.status !== 'pending').slice(-12).reverse();
  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><h2>AI changes</h2><button className="btn ghost" onClick={onClose}>× Close</button></div>
        <div className="modal-body changes-drawer">
          <p className="muted small">Changes the AI proposed in your chats. Nothing changes in the book until you accept; a history version is saved before each accept.</p>
          {!pending.length && <div className="empty">Nothing waiting. Ask for changes in a chat and they show up here, in the chapter and in the codex.</div>}
          {pending.length > 1 && <div className="row"><b className="grow">{pending.length} waiting</b><ChangeButtons list={pending} /></div>}
          {!!book.length && <h3>Manuscript</h3>}
          {book.map((c) => <ChangeCard key={c.id} change={c} open={false} />)}
          {!!codex.length && <h3>Codex</h3>}
          {codex.map((c) => <ChangeCard key={c.id} change={c} open={false} />)}
          {!!decided.length && (
            <details>
              <summary className="muted small">Recently decided ({decided.length})</summary>
              {decided.map((c) => <ChangeCard key={c.id} change={c} open={false} />)}
            </details>
          )}
        </div>
      </div>
    </div>
  );
}
