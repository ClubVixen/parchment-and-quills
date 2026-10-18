import { useState } from 'react';
import { api } from '../api';
import { navigate, TopNav, useApp } from '../App';
import type { Prompt, PromptMessage } from '../types';
import { newId } from '../util';
import { AutoTextarea } from '../components/AutoTextarea';
import { CodeEditor, FunctionReference } from '../components/CodeEditor';

const KINDS: { kind: Prompt['kind']; label: string }[] = [
  { kind: 'beat', label: 'Scene Beat Completions' },
  { kind: 'summary', label: 'Scene Summarizations' },
  { kind: 'beatsFromText', label: 'Beats from Text' },
  { kind: 'replace', label: 'Text Replacements' },
  { kind: 'chat', label: 'Workshop Chats' },
  { kind: 'component', label: 'Prompt Components' },
];
const ROLE_LABEL = { system: 'System Message', user: 'User', assistant: 'AI' };

export function PromptsPage({ selected }: { selected?: string }) {
  const { prompts, reloadPrompts } = useApp();
  const [q, setQ] = useState('');
  const [err, setErr] = useState('');
  const current = prompts.find((p) => p.id === selected);
  const custom = prompts.filter((p) => !p.system);

  const saveCustom = async (list: Prompt[]) => {
    try { await api.saveCustomPrompts(list); await reloadPrompts(); setErr(''); } catch (e) { setErr((e as Error).message); }
  };
  const clone = async (p: Prompt) => {
    const copy: Prompt = { ...structuredClone(p), id: `custom-${newId()}`, system: false, name: p.kind === 'component' ? p.name : `${p.name} (copy)` };
    await saveCustom([...custom, copy]);
    navigate(`/prompts/${copy.id}`);
  };

  return (
    <div className="page">
      <TopNav active="prompts" />
      <main className="page-body wide">
        <h1 className="page-title">Prompt Collection</h1>
        <p className="page-sub">These are NovelCrafter's prompts, captured word for word. Clone one to make your own version. A custom component with the same name replaces the system one everywhere.</p>
        {err && <div className="alert">{err}</div>}
        <div className="prompts">
          <div className="prompt-list">
            <input className="input search" placeholder="Search library…" value={q} onChange={(e) => setQ(e.target.value)} />
            {KINDS.map(({ kind, label }) => {
              const items = prompts.filter((p) => p.kind === kind && p.name.toLowerCase().includes(q.toLowerCase()));
              if (!items.length) return null;
              return (
                <div key={kind} className="group">
                  <div className="group-head"><span>{label}</span><span className="muted tiny">{items.length}</span></div>
                  {items.map((p) => (
                    <div key={p.id} className={`list-item row ${p.id === selected ? 'selected' : ''}`} onClick={() => navigate(`/prompts/${p.id}`)}>
                      <span className="grow">{p.name}</span><span className={`chip tiny ${p.system ? '' : 'linked'}`}>{p.system ? 'System' : 'Custom'}</span>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
          <div className="prompt-detail">
            {!current && <div className="empty">Select a prompt to see its instructions.</div>}
            {current && <PromptEditor key={current.id} prompt={current} onClone={() => clone(current)} onSave={(p) => saveCustom(custom.map((c) => (c.id === p.id ? p : c)))}
              onDelete={async () => { if (confirm(`Delete "${current.name}"?`)) { await saveCustom(custom.filter((c) => c.id !== current.id)); navigate('/prompts'); } }} />}
          </div>
        </div>
      </main>
    </div>
  );
}

function PromptEditor({ prompt, onClone, onSave, onDelete }: { prompt: Prompt; onClone: () => void; onSave: (p: Prompt) => void; onDelete: () => void }) {
  const [p, setP] = useState(prompt);
  const [inputsJson, setInputsJson] = useState(JSON.stringify(prompt.inputs, null, 2));
  const [jsonErr, setJsonErr] = useState('');
  const ro = prompt.system;
  const dirty = JSON.stringify(p) !== JSON.stringify(prompt);
  const setMsg = (i: number, m: Partial<PromptMessage>) => setP({ ...p, messages: p.messages.map((x, j) => (j === i ? { ...x, ...m } : x)) });

  return (
    <div className="form">
      {ro ? (
        <div className="notice row"><span className="grow"><b>This is a system prompt.</b> To edit it, create a personal copy.</span><button className="btn small primary" onClick={onClone}>⧉ Clone</button></div>
      ) : (
        <div className="row">
          <input className="input grow" value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} />
          <select className="input inline" value={p.kind} onChange={(e) => setP({ ...p, kind: e.target.value as Prompt['kind'] })}>
            {KINDS.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
          </select>
          <button className="btn small primary" disabled={!dirty || !!jsonErr} onClick={() => onSave(p)}>Save</button>
          <button className="btn small ghost danger" onClick={onDelete}>Delete</button>
        </div>
      )}
      {ro && <h2>{p.name}</h2>}
      <details className="template-help">
        <summary className="muted small">Template syntax and function reference</summary>
        <p className="muted small">
          Insert values with <code>{'{novel.title}'}</code> or <code>{'{input("Words")}'}</code>, call functions like <code>{'{lastWords(scene.fullText(scene.previous), 650)}'}</code>,
          reuse components with <code>{'{include("Novelcrafter/Codex")}'}</code>, branch with <code>{'{#if …}{#elseif …}{#else}{#endif}'}</code> (operators <code>is</code>, <code>is not</code>, <code>in</code>, <code>not</code>, <code>+</code>) and comment with <code>{'{! … !}'}</code>.
          An included component also brings its inputs (e.g. Instructions, Additional Context).
        </p>
        <FunctionReference />
      </details>
      {p.messages.map((m, i) => (
        <div key={i} className="prompt-msg">
          <div className="row">
            {ro || p.kind === 'component' ? <b>{p.kind === 'component' ? 'Component text' : ROLE_LABEL[m.role]}</b> : (
              <select className="input inline" value={m.role} onChange={(e) => setMsg(i, { role: e.target.value as PromptMessage['role'] })}>
                <option value="system">System Message</option><option value="user">User</option><option value="assistant">AI</option>
              </select>
            )}
            <div className="grow" />
            <button className="btn ghost tiny" onClick={() => navigator.clipboard.writeText(m.content)}>Copy</button>
            {!ro && p.kind !== 'component' && <button className="btn ghost tiny" onClick={() => setP({ ...p, messages: p.messages.filter((_, j) => j !== i) })}>Remove</button>}
          </div>
          <CodeEditor readOnly={ro} value={m.content} onChange={(v) => setMsg(i, { content: v })} />
        </div>
      ))}
      <InputsTable prompt={prompt} />
      {p.kind === 'component' && !!prompt.inputs.length && <p className="muted small">Prompts that include this component also show these inputs.</p>}
      {!ro && p.kind !== 'component' && <button className="btn small" onClick={() => setP({ ...p, messages: [...p.messages, { role: 'user', content: '' }] })}>+ Add message</button>}
      {!ro && (
        <details>
          <summary><b>Edit inputs</b> <span className="muted small">(JSON)</span></summary>
          <AutoTextarea className="input code" value={inputsJson} onChange={(v) => {
            setInputsJson(v);
            try { setP({ ...p, inputs: JSON.parse(v) }); setJsonErr(''); } catch (e) { setJsonErr((e as Error).message); }
          }} />
          {jsonErr && <div className="alert small">{jsonErr}</div>}
          <p className="muted tiny">
            Each input: {'{ "name", "description", "types": ["text", "dropdown", "scene", "context", "checkbox"], "mode": "single" | "multiple", "options": [...], "default", "required", "placeholder", "hideInput" }'}.
            Options named "Group: Label" are grouped in the dropdown.
          </p>
        </details>
      )}
    </div>
  );
}

const TYPE_LABEL: Record<string, string> = { text: 'your own text', dropdown: 'a choice', scene: 'a scene', context: 'picked context', checkbox: 'yes/no' };

/** Read-only overview of what the prompt asks for, including inputs inherited from included components. */
function InputsTable({ prompt }: { prompt: Prompt }) {
  const all = prompt.allInputs || prompt.inputs;
  if (!all.length) return null;
  const own = new Set(prompt.inputs.map((i) => i.name));
  return (
    <div className="inputs-table">
      <b>Inputs</b> <span className="muted small">(what the Tweak dialog and chat ask for)</span>
      <table>
        <thead><tr><th>Input</th><th>Answer with</th><th>Options</th><th>Default</th></tr></thead>
        <tbody>
          {all.map((i) => (
            <tr key={i.name}>
              <td>
                <b>{i.displayName || i.name}</b>{i.required && <span className="chip tiny">Required</span>}{i.hideInput && <span className="chip tiny">More options</span>}
                {!own.has(i.name) && <div className="muted tiny">from an included component</div>}
                <div className="muted small">{i.description}</div>
              </td>
              <td className="small">{i.types.map((t) => TYPE_LABEL[t] || t).join(' or ')}{i.mode === 'multiple' ? ' (several)' : ''}</td>
              <td className="small">{i.options?.length ? i.options.join(', ') : '—'}</td>
              <td className="small">{Array.isArray(i.default) ? i.default.join(', ') : i.default || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
