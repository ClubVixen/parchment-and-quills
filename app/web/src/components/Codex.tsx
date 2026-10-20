import { useMemo, useState } from 'react';
import { useWorkspace } from '../views/Workspace';
import { CODEX_TYPES, type CodexEntry, type CodexType } from '../types';
import { entryRegex, flatScenes, mentionCount, newId, sceneLabel, sceneText } from '../util';
import { TagInput } from './TagInput';
import { ChangeCard } from './Changes';

const TYPE_LABEL: Record<CodexType, string> = { character: 'Characters', location: 'Locations', object: 'Objects', lore: 'Lore', subplot: 'Subplots', other: 'Other' };
const TYPE_ICON: Record<CodexType, string> = { character: '👤', location: '📍', object: '🗝', lore: '📜', subplot: '🧵', other: '◆' };

export function CodexPanel() {
  const { novel, update, openCodex, changes } = useWorkspace();
  const [q, setQ] = useState('');
  const aiPending = changes.filter((c) => c.status === 'pending' && c.kind === 'codexEntry');
  const proposedNew = aiPending.filter((c) => !c.entryId);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const match = (e: CodexEntry) => !q || [e.name, ...e.aliases, ...e.tags, e.description].join(' ').toLowerCase().includes(q.toLowerCase());

  const add = (type: CodexType = 'character') => {
    const id = newId();
    update((n) => { n.codex.push({ id, type, name: '', aliases: [], tags: [], description: '', includeInAI: true }); });
    openCodex(id);
  };

  return (
    <div className="sidebar-body">
      <div className="sidebar-tools">
        <input className="input search" placeholder="Search all entries…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn small" onClick={() => add()}>+ New Entry</button>
      </div>
      <div className="list">
        {!!proposedNew.length && (
          <div className="group">
            <div className="group-head"><span>✦ Proposed by the AI</span><span className="muted tiny">{proposedNew.length} new</span></div>
            <div className="codex-proposals">{proposedNew.map((c) => <ChangeCard key={c.id} change={c} open={false} inBook />)}</div>
          </div>
        )}
        {!novel.codex.length && (
          <div className="empty small">
            <b>Your codex is empty.</b>
            <p>The Codex stores your characters, places and lore. Entries mentioned in a beat or chat are sent to the AI automatically.</p>
          </div>
        )}
        {CODEX_TYPES.map((type) => {
          const entries = novel.codex.filter((e) => e.type === type && match(e));
          if (!entries.length) return null;
          return (
            <div key={type} className="group">
              <div className="group-head" onClick={() => setCollapsed((c) => ({ ...c, [type]: !c[type] }))}>
                <span>{TYPE_LABEL[type]}</span>
                <span className="muted tiny">{entries.length} entries <button className="icon-btn tiny" title={`New ${type}`} onClick={(ev) => { ev.stopPropagation(); add(type); }}>+</button> {collapsed[type] ? '▸' : '▾'}</span>
              </div>
              {!collapsed[type] && entries.map((e) => (
                <div key={e.id} className="codex-item" onClick={() => openCodex(e.id)}>
                  <div className="avatar">{TYPE_ICON[e.type]}</div>
                  <div className="codex-item-body">
                    <div className="codex-name">{e.name || <i className="muted">Unnamed</i>} {e.alwaysInclude && <span className="chip tiny" title="Always sent to the AI">always</span>}{aiPending.some((c) => c.entryId === e.id) && <span className="chip tiny ai-chip" title="The AI proposed a change to this entry; open it to review">✦ AI edit</span>}</div>
                    {!!e.tags.length && <div className="chips">{e.tags.map((t) => <span key={t} className="chip">{t}</span>)}</div>}
                    <div className="muted small clamp2">{e.description}</div>
                  </div>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const splitList = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);

export function CodexEditor({ id, onClose }: { id: string; onClose: () => void }) {
  const { novel, update, focusScene, changes } = useWorkspace();
  const entry = novel.codex.find((e) => e.id === id);
  const proposals = changes.filter((c) => c.status === 'pending' && c.kind === 'codexEntry' && c.entryId === id);
  const [tab, setTab] = useState<'details' | 'research' | 'mentions'>('details');
  const [aliasText, setAliasText] = useState(entry?.aliases.join(', ') || '');
  const count = useMemo(() => (entry ? mentionCount(entry, novel) : 0), [entry, novel]);
  if (!entry) return null;

  const set = (fn: (e: CodexEntry) => void) => update((n) => { const e = n.codex.find((x) => x.id === id); if (e) fn(e); });

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="codex-head">
            <select className="input inline" value={entry.type} onChange={(e) => set((x) => { x.type = e.target.value as CodexType; })}>
              {CODEX_TYPES.map((t) => <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</option>)}
            </select>
            <input className="input title-input" placeholder="Name" autoFocus={!entry.name} value={entry.name} onChange={(e) => set((x) => { x.name = e.target.value; })} />
            <span className="muted small">{count} mentions</span>
          </div>
          <button className="btn ghost" onClick={onClose}>× Close</button>
        </div>
        <div className="tabs">
          <button className={tab === 'details' ? 'tab active' : 'tab'} onClick={() => setTab('details')}>Details</button>
          <button className={tab === 'research' ? 'tab active' : 'tab'} onClick={() => setTab('research')}>Notes</button>
          <button className={tab === 'mentions' ? 'tab active' : 'tab'} onClick={() => setTab('mentions')}>Mentions</button>
        </div>
        <div className="modal-body form">
          {proposals.map((c) => <ChangeCard key={c.id} change={c} inBook />)}
          {tab === 'details' && (
            <>
              <label>Aliases / Nicknames <span className="muted small">(comma separated; all names are detected in your prose and chats)</span>
                <input className="input" value={aliasText} onChange={(e) => { setAliasText(e.target.value); set((x) => { x.aliases = splitList(e.target.value); }); }} />
              </label>
              <div className="field">
                <div className="field-head"><b>Tags</b> <span className="muted small">(type to pick from tags you've used; Enter or comma adds)</span></div>
                <TagInput value={entry.tags} known={novel.codex.filter((e) => e.id !== id).flatMap((e) => e.tags)} onChange={(tags) => set((x) => { x.tags = tags; })} />
              </div>
              <label>Description <span className="muted small">(this is what the AI sees)</span>
                <textarea className="input" rows={14} value={entry.description} onChange={(e) => set((x) => { x.description = e.target.value; })} />
              </label>
              <div className="row">
                <label className="check"><input type="checkbox" checked={!!entry.alwaysInclude} onChange={(e) => set((x) => { x.alwaysInclude = e.target.checked; })} /> Always include in AI context</label>
                <label className="check"><input type="checkbox" checked={entry.includeInAI !== false} onChange={(e) => set((x) => { x.includeInAI = e.target.checked; })} /> Include when mentioned</label>
              </div>
            </>
          )}
          {tab === 'research' && (
            <label>Private notes <span className="muted small">(never sent to the AI)</span>
              <textarea className="input" rows={18} value={entry.research || ''} onChange={(e) => set((x) => { x.research = e.target.value; })} />
            </label>
          )}
          {tab === 'mentions' && <Mentions entry={entry} onOpen={(sid) => { onClose(); focusScene(sid); }} />}
        </div>
        <div className="modal-foot">
          <button className="btn danger ghost" onClick={() => {
            if (!confirm(`Delete codex entry "${entry.name || 'Unnamed'}"? (A copy stays in History.)`)) return;
            update((n) => { n.codex = n.codex.filter((x) => x.id !== id); n.acts.forEach((a) => a.chapters.forEach((c) => c.scenes.forEach((s) => { s.codexIds = s.codexIds.filter((cid) => cid !== id); }))); });
            onClose();
          }}>Delete entry</button>
        </div>
      </div>
    </div>
  );
}

function Mentions({ entry, onOpen }: { entry: CodexEntry; onOpen: (sceneId: string) => void }) {
  const { novel } = useWorkspace();
  const re = entryRegex(entry, 'giu');
  const hits = flatScenes(novel).map((r) => {
    const text = sceneText(r.scene);
    const all = re ? [...text.matchAll(re)] : [];
    const first = all[0];
    const snippet = first ? `…${text.slice(Math.max(0, (first.index ?? 0) - 60), (first.index ?? 0) + 80)}…` : '';
    return { r, n: all.length, snippet, inSummary: !!(re && r.scene.summary.match(re)) };
  }).filter((h) => h.n || h.inSummary);
  if (!hits.length) return <div className="empty small">Not mentioned in any scene yet.</div>;
  return (
    <div className="list">
      {hits.map((h) => (
        <div key={h.r.scene.id} className="list-item" onClick={() => onOpen(h.r.scene.id)}>
          <div><b>{sceneLabel(h.r)}</b> <span className="muted small">{h.n} in text{h.inSummary ? ' · in summary' : ''}</span></div>
          {h.snippet && <div className="muted small">{h.snippet}</div>}
        </div>
      ))}
    </div>
  );
}
