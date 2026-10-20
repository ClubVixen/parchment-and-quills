import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useWorkspace } from '../views/Workspace';
import type { HistoryEntry, Novel } from '../types';
import { flatScenes, fmtDate, sceneLabel, sceneText, type SceneRef } from '../util';

type Change = { id: string; label: string; kind: 'changed' | 'added' | 'removed'; old: string; cur: string; oldSummary: string; curSummary: string };

function compare(old: Novel, cur: Novel): Change[] {
  const o = new Map(flatScenes(old).map((r) => [r.scene.id, r]));
  const c = new Map(flatScenes(cur).map((r) => [r.scene.id, r]));
  const out: Change[] = [];
  const row = (id: string, kind: Change['kind'], a?: SceneRef, b?: SceneRef): Change => ({
    id, kind, label: sceneLabel((b || a)!), old: a ? sceneText(a.scene) : '', cur: b ? sceneText(b.scene) : '',
    oldSummary: a?.scene.summary || '', curSummary: b?.scene.summary || '',
  });
  for (const [id, a] of o) {
    const b = c.get(id);
    if (!b) out.push(row(id, 'removed', a));
    else if (sceneText(a.scene) !== sceneText(b.scene) || a.scene.summary !== b.scene.summary) out.push(row(id, 'changed', a, b));
  }
  for (const [id, b] of c) if (!o.has(id)) out.push(row(id, 'added', undefined, b));
  return out;
}

/** Word-level diff (LCS). Falls back to plain old/new for very long texts. */
export function diffWords(a: string, b: string) {
  const x = a.split(/(\s+)/), y = b.split(/(\s+)/);
  if (x.length * y.length > 4_000_000) return null;
  const dp = Array.from({ length: x.length + 1 }, () => new Uint32Array(y.length + 1));
  for (let i = x.length - 1; i >= 0; i--) for (let j = y.length - 1; j >= 0; j--)
    dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: { t: 'same' | 'del' | 'add'; s: string }[] = [];
  let i = 0, j = 0;
  const push = (t: 'same' | 'del' | 'add', s: string) => { const l = out.at(-1); if (l?.t === t) l.s += s; else out.push({ t, s }); };
  while (i < x.length && j < y.length) {
    if (x[i] === y[j]) { push('same', x[i]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) push('del', x[i++]);
    else push('add', y[j++]);
  }
  while (i < x.length) push('del', x[i++]);
  while (j < y.length) push('add', y[j++]);
  return out;
}

export function Diff({ a, b }: { a: string; b: string }) {
  const d = useMemo(() => diffWords(a, b), [a, b]);
  if (!d) return <div className="row"><pre className="grow">{a}</pre><pre className="grow">{b}</pre></div>;
  return <div className="diff">{d.map((p, i) => <span key={i} className={p.t}>{p.s}</span>)}</div>;
}

export function HistoryPanel({ onClose }: { onClose: () => void }) {
  const { novel, saveNow, replaceNovel } = useWorkspace();
  const [list, setList] = useState<HistoryEntry[] | null>(null);
  const [sel, setSel] = useState<HistoryEntry | null>(null);
  const [version, setVersion] = useState<Novel | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [label, setLabel] = useState('');

  const load = () => api.history(novel.id).then(setList);
  useEffect(() => { saveNow().then(load); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setVersion(null); setOpen(null); if (sel) api.version(novel.id, sel.file).then((v) => setVersion(v.novel)); }, [sel, novel.id]);

  const changes = useMemo(() => (version ? compare(version, novel) : []), [version, novel]);
  const codexDelta = version ? { before: version.codex.length, now: novel.codex.length, edited: version.codex.filter((e) => { const n = novel.codex.find((x) => x.id === e.id); return n && JSON.stringify(n) !== JSON.stringify(e); }).length } : null;

  const restore = async (sceneId?: string) => {
    if (!sel) return;
    if (!confirm(sceneId ? 'Restore this scene from the selected version? The current state is saved to History first.' : 'Restore the whole novel to this version? The current state is saved to History first.')) return;
    await saveNow();
    replaceNovel(await api.restore(novel.id, sel.file, sceneId));
    load();
  };

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><h2>Book history</h2><button className="btn ghost" onClick={onClose}>× Close</button></div>
        <div className="history">
          <div className="history-list">
            <div className="row">
              <input className="input" placeholder="Label (e.g. Before act 2 rewrite)" value={label} onChange={(e) => setLabel(e.target.value)} />
              <button className="btn small primary" onClick={async () => { await saveNow(); await api.snapshot(novel.id, label || 'Manual save'); setLabel(''); load(); }}>Save version</button>
            </div>
            <p className="muted tiny">Versions are saved automatically every 10 minutes while you work, and before every restore.</p>
            {list?.map((h) => (
              <div key={h.file} className={`list-item ${sel?.file === h.file ? 'selected' : ''}`} onClick={() => setSel(h)}>
                <div><b>{h.label || 'Autosave'}</b></div>
                <div className="muted tiny">{fmtDate(h.savedAt)} · {h.words.toLocaleString()} words</div>
              </div>
            ))}
          </div>
          <div className="history-detail">
            {!sel && <div className="empty">Select a version to compare it with the current text.</div>}
            {sel && !version && <div className="muted">Loading…</div>}
            {sel && version && (
              <>
                <div className="row">
                  <div className="grow">
                    <b>{sel.label || 'Autosave'}</b> <span className="muted small">{fmtDate(sel.savedAt)}</span>
                    <div className="muted small">{changes.length} scene{changes.length === 1 ? '' : 's'} differ · codex {codexDelta!.before} → {codexDelta!.now} entries{codexDelta!.edited ? `, ${codexDelta!.edited} edited` : ''}</div>
                  </div>
                  <button className="btn small" onClick={async () => { const l = prompt('Label for this version', sel.label); if (l != null) { await api.labelVersion(novel.id, sel.file, l); load(); } }}>Rename</button>
                  <button className="btn small primary" onClick={() => restore()}>Restore whole novel</button>
                </div>
                {!changes.length && <div className="empty small">The manuscript is identical to this version.</div>}
                {changes.map((c) => (
                  <div key={c.id} className="change">
                    <div className="change-head" onClick={() => setOpen(open === c.id ? null : c.id)}>
                      <span className={`chip ${c.kind}`}>{c.kind}</span> <b>{c.label}</b>
                      <span className="muted tiny">{c.old.split(/\s+/).filter(Boolean).length} → {c.cur.split(/\s+/).filter(Boolean).length} words</span>
                      <div className="grow" />
                      {c.kind !== 'added' && <button className="btn tiny" onClick={(e) => { e.stopPropagation(); restore(c.id); }}>Restore scene</button>}
                    </div>
                    {open === c.id && (
                      <div className="change-body">
                        {c.oldSummary !== c.curSummary && <><div className="muted tiny">Summary</div><Diff a={c.oldSummary} b={c.curSummary} /></>}
                        <div className="muted tiny">Text <span className="del">removed since then</span> / <span className="add">added since then</span></div>
                        <Diff a={c.old} b={c.cur} />
                      </div>
                    )}
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
