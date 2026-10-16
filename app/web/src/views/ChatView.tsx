import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { Avatar, useApp } from '../App';
import { useWorkspace } from './Workspace';
import type { ChatMessage, EditTarget, Thread } from '../types';
import { InputsForm, ModelSelect, PromptPreview, Reasoning, useGeneration, defaultInputs } from '../components/Generate';
import { AssistantContent } from '../components/Revisions';
import { chapterNumber, flatScenes, sceneLabel } from '../util';
import { AutoTextarea } from '../components/AutoTextarea';

export function ChatView() {
  const { threads, activeThreadId, openThread, novel, reloadThreads } = useWorkspace();
  const thread = threads.find((t) => t.id === activeThreadId) || null;

  if (!thread) {
    return (
      <div className="chat-empty">
        <h2>Workshop chat</h2>
        <p className="muted">Talk through story beats, characters and structure with your local AI. Codex entries you mention are included automatically.</p>
        <button className="btn primary" onClick={async () => { const t = await api.newThread(novel.id); await reloadThreads(); openThread(t.id); }}>+ New thread</button>
        <div className="thread-grid">
          {threads.slice(0, 12).map((t) => (
            <div key={t.id} className="list-item card" onClick={() => openThread(t.id)}>
              <div className="clamp2">{t.title || <i className="muted">(Empty thread)</i>}</div>
              <div className="muted tiny">{t.messages.length} messages · {new Date(t.updatedAt).toLocaleString()}</div>
            </div>
          ))}
        </div>
      </div>
    );
  }
  return <ThreadView key={thread.id} thread={thread} />;
}

function ThreadView({ thread }: { thread: Thread }) {
  const { novel, reloadThreads, saveNow, openThread } = useWorkspace();
  const { prompts } = useApp();
  const chatPrompts = prompts.filter((p) => p.kind === 'chat');
  const [local, setLocal] = useState<Thread>(thread);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [model, setModel] = useState('');
  const [showInputs, setShowInputs] = useState(false);
  const [preview, setPreview] = useState<{ messages: { role: 'system' | 'user' | 'assistant'; content: string }[]; codex: string[] } | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const gen = useGeneration();
  const bottom = useRef<HTMLDivElement>(null);
  const patchTimer = useRef<number | undefined>(undefined);
  const prompt = prompts.find((p) => p.id === local.promptId) || chatPrompts[0];

  useEffect(() => { setLocal(thread); }, [thread]);
  useEffect(() => { bottom.current?.scrollIntoView({ block: 'end' }); }, [local.messages.length, gen.content, pending]);

  const patch = (p: Partial<Thread>) => {
    setLocal((t) => ({ ...t, ...p }));
    window.clearTimeout(patchTimer.current);
    patchTimer.current = window.setTimeout(() => { api.updateThread(novel.id, thread.id, p).then(() => reloadThreads()); }, 400);
  };

  const missing = prompt?.inputs.filter((i) => i.required && i.type !== 'context' && !String(local.inputs[i.name] || '').trim()) || [];
  const request = (task: { message?: string; retry?: boolean }) => ({
    novelId: novel.id, promptId: prompt.id, model: model || undefined, inputs: local.inputs, context: local.context, target: local.target || null,
    task: { kind: 'chat' as const, threadId: thread.id, ...task },
  });

  const send = async (retry = false) => {
    const message = draft.trim();
    if (!retry && !message) return;
    if (missing.length) { setShowInputs(true); return; }
    await saveNow();
    if (!retry) { setPending(message); setDraft(''); }
    await gen.run(request(retry ? { retry: true } : { message }));
    const fresh = await reloadThreads();
    const t = fresh.find((x) => x.id === thread.id);
    if (t) setLocal(t);
    setPending(null);
    gen.reset();
  };

  const showPreview = async () => {
    setPreviewOpen(true); setPreview(null);
    await saveNow();
    setPreview(await api.preview(request({ message: draft.trim() || '(your next message)' })));
  };

  const lastAssistant = [...local.messages].reverse().find((m) => m.role === 'assistant');
  const visible = gen.busy && local.messages.at(-1)?.role === 'assistant' && !pending ? local.messages.slice(0, -1) : local.messages;
  // The server saves the user message as soon as generation starts; a thread reload may already include it.
  const pendingShown = pending !== null && !(visible.at(-1)?.role === 'user' && visible.at(-1)?.content === pending);

  return (
    <div className="chat">
      <div className="chat-head">
        <input className="input bare chat-title" placeholder="Name your thread…" value={local.title} onChange={(e) => patch({ title: e.target.value })} />
        <select className="input inline" value={prompt?.id} onChange={(e) => patch({ promptId: e.target.value, inputs: defaultInputs(prompts.find((p) => p.id === e.target.value)) })}>
          {chatPrompts.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <TargetPicker value={local.target || null} onChange={(t) => patch({ target: t })} />
        <button className={`btn small ${showInputs ? 'on' : ''}`} onClick={() => setShowInputs(!showInputs)}>Inputs & context{local.context.length ? ` (${local.context.length})` : ''}</button>
        <button className="btn small" onClick={showPreview}>Preview prompt</button>
        <button className="btn small" onClick={() => patch({ pinned: !local.pinned })}>{local.pinned ? 'Unpin' : 'Pin'}</button>
        <button className="btn small ghost danger" onClick={async () => { if (!confirm('Delete this thread?')) return; await api.deleteThread(novel.id, thread.id); await reloadThreads(); openThread(''); }}>Delete</button>
      </div>
      {showInputs && prompt && (
        <div className="chat-inputs">
          <InputsForm prompt={prompt} inputs={local.inputs} setInputs={(i) => patch({ inputs: i })} context={local.context} setContext={(c) => patch({ context: c })} />
        </div>
      )}
      <div className="chat-log">
        {!visible.length && !pending && (
          <div className="empty">
            Start by typing a message below. Any codex entries you mention will be included in the context.
            <br /><br />To have the AI change your story, pick a chapter or scene under <b>Working on</b>, then ask for example “tighten the dialogue in this scene” or “rewrite it from Tobin's point of view”. You'll get the new text with the changes marked, and can commit it to the manuscript.
          </div>
        )}
        {visible.map((m) => (
          <MessageView key={m.id} m={m} onDelete={async () => { const t = await api.deleteMessage(novel.id, thread.id, m.id); setLocal(t); reloadThreads(); }}
            onRetry={m.id === lastAssistant?.id && !gen.busy ? () => send(true) : undefined} />
        ))}
        {pendingShown && <div className="msg user"><div className="msg-row"><div className="bubble">{pending}</div><Avatar size={28} /></div></div>}
        {gen.busy || gen.error ? (
          <div className="msg assistant">
            <div className="bubble">
              {gen.meta && <div className="muted tiny">Codex: {gen.meta.codex.length ? gen.meta.codex.join(', ') : 'none'} · ~{gen.meta.promptTokensApprox.toLocaleString()} prompt tokens</div>}
              <Reasoning text={gen.reasoning} busy={gen.busy && !gen.content} />
              {gen.content ? <AssistantContent content={gen.content} streaming /> : gen.busy && <span className="muted">…</span>}
              {gen.error && <div className="alert">{gen.error}</div>}
            </div>
          </div>
        ) : null}
        <div ref={bottom} />
      </div>
      <div className="composer">
        <AutoTextarea className="input composer-input" placeholder="Ask any question… (Ctrl+Enter to send)" value={draft} onChange={setDraft}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); } }} />
        <div className="composer-bar">
          <span className="muted small">{prompt?.name}</span>
          <ModelSelect value={model} onChange={setModel} />
          {missing.length > 0 && <span className="muted small">Needs: {missing.map((m) => m.name).join(', ')}</span>}
          <div className="grow" />
          {gen.busy ? <button className="btn" onClick={gen.stop}>■ Stop</button> : <button className="btn primary" disabled={!draft.trim()} onClick={() => send()}>Send</button>}
        </div>
      </div>
      {previewOpen && (
        <div className="modal-backdrop" onClick={() => setPreviewOpen(false)}>
          <div className="modal wide" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head"><h2>Prompt preview</h2><button className="btn ghost" onClick={() => setPreviewOpen(false)}>× Close</button></div>
            <div className="modal-body"><PromptPreview preview={preview} error="" /></div>
          </div>
        </div>
      )}
    </div>
  );
}

function MessageView({ m, onDelete, onRetry }: { m: ChatMessage; onDelete: () => void; onRetry?: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className={`msg ${m.role}`}>
      {m.role === 'assistant' ? (
        <div className="bubble">
          <Reasoning text={m.reasoning || ''} />
          <AssistantContent content={m.content} />
        </div>
      ) : (
        <div className="msg-row"><div className="bubble pre-wrap">{m.content}</div><Avatar size={28} /></div>
      )}
      <div className="msg-actions">
        {onRetry && <button className="btn ghost tiny" onClick={onRetry}>↻ Retry</button>}
        <button className="btn ghost tiny" onClick={() => { navigator.clipboard.writeText(m.content); setCopied(true); setTimeout(() => setCopied(false), 1200); }}>{copied ? 'Copied' : 'Copy'}</button>
        <button className="btn ghost tiny" onClick={onDelete}>Delete</button>
        <span className="muted tiny">{m.content.split(/\s+/).filter(Boolean).length} words{m.model ? ` · ${m.model}` : ''}</span>
      </div>
    </div>
  );
}

function TargetPicker({ value, onChange }: { value: EditTarget; onChange: (t: EditTarget) => void }) {
  const { novel } = useWorkspace();
  const scenes = flatScenes(novel);
  const chapters = novel.acts.flatMap((a) => a.chapters);
  const v = value ? `${value.type}:${value.id}` : '';
  return (
    <label className="target-picker" title="Give the AI this text and let it propose revisions you can commit">
      <span className="muted small">Working on</span>
      <select className="input inline" value={v} onChange={(e) => {
        const [type, id] = e.target.value.split(':');
        onChange(e.target.value ? { type: type as 'scene' | 'chapter', id } : null);
      }}>
        <option value="">Nothing (just talk)</option>
        <optgroup label="Chapters">
          {chapters.map((c) => <option key={c.id} value={`chapter:${c.id}`}>Chapter {chapterNumber(novel, c.id)}{c.title ? `: ${c.title}` : ''}</option>)}
        </optgroup>
        <optgroup label="Scenes">
          {scenes.map((r) => <option key={r.scene.id} value={`scene:${r.scene.id}`}>{sceneLabel(r)}</option>)}
        </optgroup>
      </select>
    </label>
  );
}
