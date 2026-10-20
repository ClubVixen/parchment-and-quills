import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { Avatar, navigate, useApp, type Mode } from '../App';
import type { Change, Novel, Thread } from '../types';
import { applyChange, changeLabel, isStale } from '../changes';
import { ChangesDrawer } from '../components/Changes';
import { LANGUAGES, normalizeNovel, novelWords } from '../util';
import { POV_STYLES, povStyle } from '../pov';
import { CoverButtons, CoverImage } from '../components/Cover';
import { CodexPanel, CodexEditor } from '../components/Codex';
import { HistoryPanel } from '../components/History';
import { PlanView } from './PlanView';
import { WriteView } from './WriteView';
import { ChatView } from './ChatView';
import { ReadView } from './ReadView';

type SaveState = 'saved' | 'unsaved' | 'saving' | 'error';

type WorkspaceState = {
  novel: Novel;
  update: (fn: (n: Novel) => void) => void;
  saveNow: () => Promise<void>;
  replaceNovel: (n: Novel) => void;
  openCodex: (id: string | null) => void;
  threads: Thread[];
  reloadThreads: () => Promise<Thread[]>;
  focusScene: (sceneId: string) => void;
  focusedSceneId: string | null;
  openThread: (threadId: string) => void;
  activeThreadId: string | null;
  readChapter: (chapterId: string | null) => void;
  readChapterId: string | null;
  /** AI-proposed changes from chats (all statuses). */
  changes: Change[];
  reloadChanges: () => Promise<Change[]>;
  /** Accept (apply, after saving a history version) or reject changes. */
  decideChanges: (list: Change[], status: 'accepted' | 'rejected') => Promise<void>;
  openChanges: () => void;
};
const Ctx = createContext<WorkspaceState>(null!);
export const useWorkspace = () => useContext(Ctx);

export function Workspace({ novelId, mode }: { novelId: string; mode: Mode }) {
  const [novel, setNovel] = useState<Novel | null>(null);
  const [error, setError] = useState('');
  const [save, setSave] = useState<SaveState>('saved');
  const [sidebarTab, setSidebarTab] = useState<'codex' | 'chats'>('codex');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [codexId, setCodexId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [focusedSceneId, setFocusedSceneId] = useState<string | null>(null);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [readChapterId, setReadChapterId] = useState<string | null>(null);
  const [changes, setChanges] = useState<Change[]>([]);
  const [changesOpen, setChangesOpen] = useState(false);

  const ref = useRef<Novel | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const inflight = useRef<Promise<void> | null>(null);

  useEffect(() => {
    api.novel(novelId).then((n) => {
      // Older novels kept beats as headings inside the text; convert and save them in the current shape.
      const converted = normalizeNovel(n);
      ref.current = n;
      setNovel(n);
      if (converted) api.saveNovel(n).catch((e) => setError(`Save failed: ${e.message}`));
    }).catch((e) => setError(e.message));
  }, [novelId]);

  const reloadThreads = useCallback(async () => {
    const t = await api.chats(novelId);
    setThreads(t);
    return t;
  }, [novelId]);
  useEffect(() => { reloadThreads(); }, [reloadThreads]);

  const reloadChanges = useCallback(async () => {
    const c = await api.changes(novelId);
    setChanges(c);
    return c;
  }, [novelId]);
  useEffect(() => { reloadChanges(); }, [reloadChanges]);

  const doSave = useCallback(async () => {
    window.clearTimeout(timer.current);
    if (!ref.current) return;
    if (inflight.current) await inflight.current;
    setSave('saving');
    const p = api.saveNovel(ref.current).then(() => setSave('saved')).catch((e) => { setSave('error'); setError(`Save failed: ${e.message}`); });
    inflight.current = p;
    await p;
    inflight.current = null;
  }, []);

  const update = useCallback((fn: (n: Novel) => void) => {
    if (!ref.current) return;
    const next = structuredClone(ref.current);
    fn(next);
    ref.current = next;
    setNovel(next);
    setSave('unsaved');
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(doSave, 800);
  }, [doSave]);

  const replaceNovel = useCallback((n: Novel) => { ref.current = n; setNovel(n); setSave('saved'); }, []);

  // Flush pending edits when leaving the page.
  useEffect(() => {
    const flush = () => {
      if (save !== 'saved' && ref.current) {
        fetch(`/api/novels/${ref.current.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ref.current), keepalive: true });
      }
    };
    window.addEventListener('beforeunload', flush);
    return () => { window.removeEventListener('beforeunload', flush); };
  }, [save]);
  useEffect(() => () => { if (ref.current) void doSave(); }, [doSave]);

  const decideChanges = async (list: Change[], status: 'accepted' | 'rejected') => {
    if (!list.length || !ref.current) return;
    let decided = list;
    if (status === 'accepted') {
      const stale = list.filter((c) => isStale(ref.current!, c));
      if (stale.length && !confirm(`${stale.map((c) => changeLabel(ref.current!, c)).join(', ')}: you edited this after the AI suggested the change. Accepting replaces your newer edits (a history version is saved first). Accept anyway?`)) return;
      await doSave();
      await api.snapshot(novelId, `Before AI change – ${list.length > 1 ? `${list.length} changes` : changeLabel(ref.current, list[0])}`);
      const failed = new Set<string>();
      const messages: string[] = [];
      update((n) => { for (const c of list) { try { applyChange(n, c); } catch (e) { failed.add(c.id); messages.push((e as Error).message); } } });
      await doSave();
      if (failed.size) setError(`Could not apply ${failed.size} change${failed.size === 1 ? '' : 's'}: ${messages.join('; ')}`);
      decided = list.filter((c) => !failed.has(c.id));
    }
    for (const c of decided) await api.setChangeStatus(novelId, c.id, status);
    await reloadChanges();
  };

  if (error && !novel) return <div className="page"><div className="alert">{error} <a href="#/">Back to library</a></div></div>;
  if (!novel) return <div className="page loading">Loading…</div>;

  const state: WorkspaceState = {
    novel, update, saveNow: doSave, replaceNovel, openCodex: setCodexId, threads, reloadThreads,
    focusScene: (id) => { setFocusedSceneId(id); navigate(`/novel/${novelId}/write`); },
    focusedSceneId,
    openThread: (id) => { setActiveThreadId(id); navigate(`/novel/${novelId}/chat`); },
    activeThreadId,
    readChapter: (id) => { setReadChapterId(id); void doSave(); navigate(`/novel/${novelId}/read`); },
    readChapterId,
    changes, reloadChanges, decideChanges, openChanges: () => setChangesOpen(true),
  };
  const pendingCount = changes.filter((c) => c.status === 'pending').length;

  return (
    <Ctx.Provider value={state}>
      <div className={`workspace ${sidebarOpen ? '' : 'sidebar-closed'}`}>
        <aside className="sidebar">
          <div className="sidebar-head">
            <button className="icon-btn" title="Back to library" onClick={() => { void doSave(); navigate('/'); }}>←</button>
            <div className="sidebar-title">
              <div className="novel-title" title={novel.title}>{novel.title}</div>
              <div className="muted small">{novel.author}</div>
            </div>
            <button className="icon-btn" title="Novel settings" onClick={() => setSettingsOpen(true)}>⚙</button>
            <button className="icon-btn" title="Collapse sidebar" onClick={() => setSidebarOpen(false)}>⇤</button>
          </div>
          <div className="tabs">
            <button className={sidebarTab === 'codex' ? 'tab active' : 'tab'} onClick={() => setSidebarTab('codex')}>Codex</button>
            <button className={sidebarTab === 'chats' ? 'tab active' : 'tab'} onClick={() => setSidebarTab('chats')}>Chats</button>
          </div>
          {sidebarTab === 'codex' ? <CodexPanel /> : <ThreadList />}
          <div className="sidebar-foot">
            <a href="#/profile" className="sidebar-profile" title="Your profile"><Avatar size={26} /></a>
            <a href="#/prompts" className="btn ghost small">✦ Prompts</a>
            <a href="#/settings" className="btn ghost small">AI Connection</a>
          </div>
        </aside>
        <section className="main">
          <div className="main-bar">
            {!sidebarOpen && <button className="icon-btn" title="Show sidebar" onClick={() => setSidebarOpen(true)}>⇥</button>}
            <div className="segmented">
              {(['plan', 'write', 'read', 'chat'] as Mode[]).map((m) => (
                <button key={m} className={mode === m ? 'active' : ''} onClick={() => navigate(`/novel/${novelId}/${m}`)}>
                  {m === 'plan' ? '▦ Plan' : m === 'write' ? '✎ Write' : m === 'read' ? '📖 Read' : '💬 Chat'}
                </button>
              ))}
            </div>
            <div className="main-bar-info muted small">{novelWords(novel).toLocaleString()} words</div>
            <div className={`save-state ${save}`}>{save === 'saved' ? 'Saved' : save === 'saving' ? 'Saving…' : save === 'unsaved' ? 'Unsaved' : 'Save failed'}</div>
            {pendingCount > 0 && <button className="btn small ai-changes" onClick={() => setChangesOpen(true)} title="Changes the AI proposed in chats, waiting for you">✦ {pendingCount} AI change{pendingCount === 1 ? '' : 's'}</button>}
            <button className="btn small" onClick={() => setHistoryOpen(true)}>⟲ History</button>
          </div>
          {error && <div className="alert" onClick={() => setError('')}>{error}</div>}
          <div className="main-content">
            {mode === 'plan' && <PlanView />}
            {mode === 'write' && <WriteView />}
            {mode === 'read' && <ReadView />}
            {mode === 'chat' && <ChatView />}
          </div>
        </section>
        {codexId && <CodexEditor key={`${codexId}:${changes.filter((c) => c.status === 'accepted').length}`} id={codexId} onClose={() => setCodexId(null)} />}
        {historyOpen && <HistoryPanel onClose={() => setHistoryOpen(false)} />}
        {changesOpen && <ChangesDrawer onClose={() => setChangesOpen(false)} />}
        {settingsOpen && <NovelSettings onClose={() => setSettingsOpen(false)} />}
      </div>
    </Ctx.Provider>
  );
}

function ThreadList() {
  const { threads, novel, reloadThreads, openThread, activeThreadId } = useWorkspace();
  const { prompts } = useApp();
  const [q, setQ] = useState('');
  const shown = threads.filter((t) => (t.title || '').toLowerCase().includes(q.toLowerCase()));
  const sorted = [...shown.filter((t) => t.pinned), ...shown.filter((t) => !t.pinned)];
  return (
    <div className="sidebar-body">
      <div className="sidebar-tools">
        <input className="input search" placeholder="Search threads…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn small" onClick={async () => { const t = await api.newThread(novel.id); await reloadThreads(); openThread(t.id); }}>+ New thread</button>
      </div>
      <div className="list">
        {sorted.map((t) => (
          <div key={t.id} className={`list-item ${t.id === activeThreadId ? 'selected' : ''}`} onClick={() => openThread(t.id)}>
            <div className="clamp2">{t.pinned ? '📌 ' : ''}{t.title || <i className="muted">(Empty thread)</i>}</div>
            <div className="muted tiny">{new Date(t.updatedAt).toLocaleString()} · {t.messages.length} msgs · {prompts.find((p) => p.id === t.promptId)?.name || 'Chat'}</div>
          </div>
        ))}
        {!sorted.length && <div className="empty small">No threads yet.</div>}
      </div>
    </div>
  );
}

function NovelSettings({ onClose }: { onClose: () => void }) {
  const { novel, update } = useWorkspace();
  const [cover, setCover] = useState<number | null>(null);
  useEffect(() => { api.novels().then((l) => setCover(l.find((x) => x.id === novel.id)?.cover ?? null)); }, [novel.id]);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><h2>Novel settings</h2><button className="btn ghost" onClick={onClose}>× Close</button></div>
        <div className="modal-body form">
          <div className="row settings-cover">
            <CoverImage novelId={novel.id} title={novel.title} cover={cover} className="small-cover" />
            <div className="form grow">
              <label>Title<input className="input" value={novel.title} onChange={(e) => update((n) => { n.title = e.target.value; })} /></label>
              <div><CoverButtons novelId={novel.id} cover={cover} onChange={setCover} /></div>
              <p className="muted tiny">Any image works; it's cropped to a 2:3 book cover.</p>
            </div>
          </div>
          <label>Author<input className="input" value={novel.author} onChange={(e) => update((n) => { n.author = e.target.value; })} /></label>
          <label>Language (used in prompts as {'{novel.language}'})
            <select className="input" value={novel.language} onChange={(e) => update((n) => { n.language = e.target.value; })}>{LANGUAGES.map((l) => <option key={l}>{l}</option>)}</select>
          </label>
          <label>Tense
            <select className="input" value={novel.tense} onChange={(e) => update((n) => { n.tense = e.target.value; })}><option>past tense</option><option>present tense</option></select>
          </label>
          <div className="field">
            <div className="field-head"><b>Point of view</b> <span className="muted small">How the book is narrated. Scenes can override it from their ⋮ menu.</span></div>
            <div className="pov-list">
              {POV_STYLES.map((p) => (
                <label key={p.value} className={`pov-option ${novel.pov.type === p.value ? 'on' : ''}`}>
                  <input type="radio" name="pov" checked={novel.pov.type === p.value} onChange={() => update((n) => { n.pov.type = p.value; })} />
                  <div>
                    <div><b>{p.label}</b> <span className="muted small">{p.pronoun}</span></div>
                    <div className="small">{p.description}</div>
                    {!!p.examples.length && <div className="muted tiny">e.g. {p.examples.join(' · ')}</div>}
                  </div>
                </label>
              ))}
            </div>
          </div>
          {povStyle(novel.pov.type).needsCharacter && (
            <label>{povStyle(novel.pov.type).needsCharacter}
              <input className="input" placeholder="Name (optional, but helps the AI)" value={novel.pov.character} onChange={(e) => update((n) => { n.pov.character = e.target.value; })} />
            </label>
          )}
          <label className="check">
            <input type="checkbox" checked={novel.povReminder !== false} onChange={(e) => update((n) => { n.povReminder = e.target.checked; })} />
            Remind the AI of this point of view in every request (so a first-person book never comes back in third person unless you ask)
          </label>
        </div>
      </div>
    </div>
  );
}
