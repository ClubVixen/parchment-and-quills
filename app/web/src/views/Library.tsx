import { useEffect, useState } from 'react';
import { api } from '../api';
import { navigate, TopNav, useApp } from '../App';
import type { NovelSummary } from '../types';
import { LANGUAGES, timeAgo } from '../util';
import { CoverButtons, CoverImage } from '../components/Cover';


export function Library() {
  const [novels, setNovels] = useState<NovelSummary[] | null>(null);
  const [filter, setFilter] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  const load = () => api.novels().then(setNovels).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  const shown = (novels || []).filter((n) => `${n.title} ${n.author}`.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className="page">
      <TopNav active="novels" />
      <main className="page-body">
        <h1 className="page-title">Your Novels</h1>
        <p className="page-sub">Your personal library. Everything is stored on this computer and written with your local AI.</p>
        {error && <div className="alert">{error}</div>}
        <div className="toolbar">
          <button className="btn primary" onClick={() => setCreating(true)}>+ Create Novel</button>
          <input className="input search" placeholder="Search name…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
        {novels && !novels.length && <div className="empty">No novels yet. Create your first one.</div>}
        <div className="novel-grid">
          {shown.map((n) => (
            <div key={n.id} className="novel-card" onClick={() => navigate(`/novel/${n.id}/plan`)}>
              <div className="cover-wrap">
                <CoverImage novelId={n.id} title={n.title} cover={n.cover} />
                <div className="cover-actions"><CoverButtons compact novelId={n.id} cover={n.cover} onChange={() => load()} /></div>
              </div>
              <div className="novel-card-title">{n.title}</div>
              <div className="muted small">{n.author || 'Unknown author'} · {n.words.toLocaleString()} words · {timeAgo(n.updatedAt)}</div>
              <button
                className="btn ghost tiny card-delete"
                title="Move to trash"
                onClick={async (e) => {
                  e.stopPropagation();
                  if (!confirm(`Move "${n.title}" to the trash folder? (It can be recovered from data/trash.)`)) return;
                  await api.deleteNovel(n.id);
                  load();
                }}
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      </main>
      {creating && <CreateNovel onClose={() => setCreating(false)} />}
    </div>
  );
}

function CreateNovel({ onClose }: { onClose: () => void }) {
  const { settings } = useApp();
  const [title, setTitle] = useState('New Novel');
  const [author, setAuthor] = useState(settings?.userName || '');
  const [language, setLanguage] = useState('General English');
  const [busy, setBusy] = useState(false);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><h2>Create a new Novel</h2><button className="btn ghost" onClick={onClose}>× Close</button></div>
        <div className="modal-body form">
          <label>Title<input className="input" value={title} autoFocus onChange={(e) => setTitle(e.target.value)} /></label>
          <label>Author / Pen name<input className="input" value={author} onChange={(e) => setAuthor(e.target.value)} /></label>
          <label>Language<select className="input" value={language} onChange={(e) => setLanguage(e.target.value)}>{LANGUAGES.map((l) => <option key={l}>{l}</option>)}</select></label>
        </div>
        <div className="modal-foot">
          <button className="btn primary" disabled={busy || !title.trim()} onClick={async () => {
            setBusy(true);
            const n = await api.createNovel({ title: title.trim(), author, language });
            navigate(`/novel/${n.id}/plan`);
          }}>Create Novel</button>
        </div>
      </div>
    </div>
  );
}
