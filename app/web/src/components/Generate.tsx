import { useCallback, useEffect, useRef, useState } from 'react';
import { api, generate, type StreamResult } from '../api';
import { useApp } from '../App';
import { useWorkspace } from '../views/Workspace';
import type { ContextItem, GenerateRequest, Prompt, PromptInput, PromptMessage } from '../types';
import { chapterNumber, flatScenes, sceneLabel } from '../util';

export type Inputs = Record<string, string | string[]>;

export function defaultInputs(p: Prompt | undefined): Inputs {
  const out: Inputs = {};
  for (const i of p?.inputs || []) if (i.default) out[i.name] = i.default;
  return out;
}

// ---------- streaming hook ----------

export function useGeneration() {
  const [busy, setBusy] = useState(false);
  const [content, setContent] = useState('');
  const [reasoning, setReasoning] = useState('');
  const [error, setError] = useState('');
  const [meta, setMeta] = useState<{ codex: string[]; promptTokensApprox: number } | null>(null);
  const abort = useRef<AbortController | null>(null);

  const run = useCallback(async (req: GenerateRequest): Promise<StreamResult | null> => {
    abort.current?.abort();
    const ac = new AbortController();
    abort.current = ac;
    setBusy(true); setContent(''); setReasoning(''); setError(''); setMeta(null);
    try {
      return await generate(req, {
        onMeta: setMeta,
        onDelta: (d) => {
          if (d.reasoning) setReasoning((r) => r + d.reasoning);
          if (d.content) setContent((c) => c + d.content);
        },
      }, ac.signal);
    } catch (e) {
      if (!ac.signal.aborted) setError((e as Error).message);
      return null;
    } finally {
      if (abort.current === ac) setBusy(false);
    }
  }, []);

  const stop = useCallback(() => { abort.current?.abort(); setBusy(false); }, []);
  const reset = useCallback(() => { setContent(''); setReasoning(''); setError(''); setMeta(null); }, []);
  useEffect(() => () => abort.current?.abort(), []);
  return { busy, content, reasoning, error, meta, run, stop, reset, setContent };
}

// ---------- model picker ----------

let modelCache: Promise<{ id: string }[]> | null = null;
export function ModelSelect({ value, onChange }: { value: string; onChange: (m: string) => void }) {
  const { settings } = useApp();
  const [models, setModels] = useState<{ id: string }[]>([]);
  useEffect(() => {
    modelCache ??= api.models().catch(() => []);
    modelCache.then(setModels);
  }, []);
  return (
    <select className="input inline" value={value} onChange={(e) => onChange(e.target.value)} title="Model">
      <option value="">{settings?.model || 'Default model'} (default)</option>
      {models.filter((m) => m.id !== settings?.model).map((m) => <option key={m.id} value={m.id}>{m.id}</option>)}
    </select>
  );
}

// ---------- reasoning disclosure ----------

export function Reasoning({ text, busy }: { text: string; busy?: boolean }) {
  if (!text) return null;
  return (
    <details className="reasoning">
      <summary>{busy ? 'Thinking…' : 'Reasoning'} <span className="muted tiny">({text.length.toLocaleString()} chars)</span></summary>
      <pre>{text}</pre>
    </details>
  );
}

// ---------- inputs form ----------

export function InputsForm({ prompt, inputs, setInputs, context, setContext }: {
  prompt: Prompt; inputs: Inputs; setInputs: (i: Inputs) => void; context: ContextItem[]; setContext: (c: ContextItem[]) => void;
}) {
  const set = (name: string, v: string | string[]) => setInputs({ ...inputs, [name]: v });
  return (
    <div className="form">
      {prompt.inputs.map((inp) => (
        <div key={inp.name} className="field">
          <div className="field-head"><b>{inp.name}</b> {inp.required && <span className="chip tiny">Required</span>} <span className="muted small">{inp.description}</span></div>
          <InputField inp={inp} value={inputs[inp.name]} onChange={(v) => set(inp.name, v)} context={context} setContext={setContext} />
        </div>
      ))}
      {!prompt.inputs.length && <div className="muted small">This prompt has no inputs.</div>}
    </div>
  );
}

function InputField({ inp, value, onChange, context, setContext }: {
  inp: PromptInput; value: string | string[] | undefined; onChange: (v: string | string[]) => void; context: ContextItem[]; setContext: (c: ContextItem[]) => void;
}) {
  const { novel } = useWorkspace();
  const str = Array.isArray(value) ? '' : value || '';
  if (inp.type === 'context') return <ContextPicker value={context} onChange={setContext} />;
  if (inp.type === 'multi') {
    const arr = Array.isArray(value) ? value : value ? [value] : [];
    const chosen = arr.filter((x) => inp.options?.includes(x));
    const free = arr.filter((x) => !inp.options?.includes(x)).join('\n');
    return (
      <>
        <div className="chips">
          {inp.options?.map((o) => (
            <button key={o} className={chosen.includes(o) ? 'chip toggle on' : 'chip toggle'} onClick={() => onChange(chosen.includes(o) ? [...chosen.filter((x) => x !== o), ...(free ? [free] : [])] : [...chosen, o, ...(free ? [free] : [])])}>{o}</button>
          ))}
        </div>
        <textarea className="input" rows={2} placeholder="Additional instructions (optional)" value={free} onChange={(e) => onChange([...chosen, ...(e.target.value ? [e.target.value] : [])])} />
      </>
    );
  }
  if (inp.type === 'scene') {
    const scenes = flatScenes(novel);
    return (
      <>
        <select className="input" value="" onChange={(e) => { const r = scenes.find((s) => s.scene.id === e.target.value); if (r) onChange(r.scene.summary || ''); }}>
          <option value="">Fill from a scene summary…</option>
          {scenes.map((r) => <option key={r.scene.id} value={r.scene.id} disabled={!r.scene.summary}>{sceneLabel(r)}{r.scene.summary ? '' : ' (no summary)'}</option>)}
        </select>
        <textarea className="input" rows={4} value={str} onChange={(e) => onChange(e.target.value)} placeholder="Scene summary" />
      </>
    );
  }
  const options = inp.options || [];
  return (
    <div className="input-with-options">
      {!!options.length && (
        <div className="chips">
          {options.map((o) => <button key={o} className={str === o ? 'chip toggle on' : 'chip toggle'} onClick={() => onChange(str === o ? '' : o)}>{o}</button>)}
          {(inp.type === 'number' || inp.type === 'choice') && <span className="muted small">or</span>}
        </div>
      )}
      {inp.type === 'text'
        ? <textarea className="input" rows={3} value={str} onChange={(e) => onChange(e.target.value)} placeholder={inp.description} />
        : <input className="input" value={options.includes(str) ? '' : str} placeholder={inp.type === 'number' ? 'e.g. 300' : 'Custom…'} onChange={(e) => onChange(e.target.value)} />}
    </div>
  );
}

// ---------- context picker ----------

export function contextLabel(novel: ReturnType<typeof useWorkspace>['novel'], c: ContextItem) {
  const scenes = flatScenes(novel);
  switch (c.type) {
    case 'outline': return 'Novel outline (all summaries)';
    case 'manuscript': return 'Full manuscript';
    case 'codex': return `Codex: ${novel.codex.find((e) => e.id === c.id)?.name || '?'}`;
    case 'scene': { const r = scenes.find((s) => s.scene.id === c.id); return r ? `Scene text: ${sceneLabel(r)}` : 'Scene (deleted)'; }
    case 'sceneSummary': { const r = scenes.find((s) => s.scene.id === c.id); return r ? `Summary: ${sceneLabel(r)}` : 'Summary (deleted)'; }
    case 'chapter': { const ch = novel.acts.flatMap((a) => a.chapters).find((x) => x.id === c.id); return ch ? `Chapter ${chapterNumber(novel, ch.id)}${ch.title ? `: ${ch.title}` : ''}` : 'Chapter (deleted)'; }
    case 'text': return `Note: ${c.text.slice(0, 40)}`;
  }
}

export function ContextPicker({ value, onChange }: { value: ContextItem[]; onChange: (c: ContextItem[]) => void }) {
  const { novel } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<ContextItem['type']>('outline');
  const [pick, setPick] = useState('');
  const [text, setText] = useState('');
  const scenes = flatScenes(novel);
  const chapters = novel.acts.flatMap((a) => a.chapters);

  const add = () => {
    let item: ContextItem | null = null;
    if (kind === 'outline' || kind === 'manuscript') item = { type: kind };
    else if (kind === 'text') item = text.trim() ? { type: 'text', text } : null;
    else if (pick) item = { type: kind, id: pick } as ContextItem;
    if (item) onChange([...value, item]);
    setOpen(false); setPick(''); setText('');
  };

  return (
    <div className="context-picker">
      <div className="chips">
        {value.map((c, i) => (
          <span key={i} className="chip">{contextLabel(novel, c)} <button className="chip-x" onClick={() => onChange(value.filter((_, j) => j !== i))}>×</button></span>
        ))}
        <button className="chip toggle" onClick={() => setOpen(!open)}>+ Context</button>
      </div>
      {open && (
        <div className="context-add">
          <select className="input inline" value={kind} onChange={(e) => { setKind(e.target.value as ContextItem['type']); setPick(''); }}>
            <option value="outline">Novel outline (all summaries)</option>
            <option value="manuscript">Full manuscript</option>
            <option value="chapter">A chapter (full text)</option>
            <option value="scene">A scene (full text)</option>
            <option value="sceneSummary">A scene summary</option>
            <option value="codex">A codex entry</option>
            <option value="text">Custom note</option>
          </select>
          {(kind === 'scene' || kind === 'sceneSummary') && (
            <select className="input inline" value={pick} onChange={(e) => setPick(e.target.value)}>
              <option value="">Choose scene…</option>
              {scenes.map((r) => <option key={r.scene.id} value={r.scene.id}>{sceneLabel(r)}</option>)}
            </select>
          )}
          {kind === 'chapter' && (
            <select className="input inline" value={pick} onChange={(e) => setPick(e.target.value)}>
              <option value="">Choose chapter…</option>
              {chapters.map((c) => <option key={c.id} value={c.id}>Chapter {chapterNumber(novel, c.id)}{c.title ? `: ${c.title}` : ''}</option>)}
            </select>
          )}
          {kind === 'codex' && (
            <select className="input inline" value={pick} onChange={(e) => setPick(e.target.value)}>
              <option value="">Choose entry…</option>
              {novel.codex.map((e) => <option key={e.id} value={e.id}>{e.name || 'Unnamed'}</option>)}
            </select>
          )}
          {kind === 'text' && <textarea className="input" rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="Anything else the AI should know" />}
          <button className="btn small primary" onClick={add}>Add</button>
        </div>
      )}
    </div>
  );
}

// ---------- tweak & generate dialog ----------

export type DialogResult = { promptId: string; inputs: Inputs; model: string; context: ContextItem[] };

export function GenerateDialog({ kind, initial, buildRequest, onGenerate, onClose, title = 'Generate Text' }: {
  kind: Prompt['kind'];
  initial: Partial<DialogResult>;
  buildRequest: (r: DialogResult) => GenerateRequest;
  onGenerate: (r: DialogResult) => void;
  onClose: () => void;
  title?: string;
}) {
  const { prompts } = useApp();
  const { saveNow } = useWorkspace();
  const options = prompts.filter((p) => p.kind === kind);
  const [promptId, setPromptId] = useState(initial.promptId || options[0]?.id || '');
  const prompt = prompts.find((p) => p.id === promptId);
  const [inputs, setInputs] = useState<Inputs>(initial.inputs || defaultInputs(prompt));
  const [context, setContext] = useState<ContextItem[]>(initial.context || []);
  const [model, setModel] = useState(initial.model || '');
  const [tab, setTab] = useState<'tweak' | 'preview'>('tweak');
  const [preview, setPreview] = useState<{ messages: PromptMessage[]; codex: string[] } | null>(null);
  const [previewErr, setPreviewErr] = useState('');

  const result: DialogResult = { promptId, inputs, model, context };
  const missing = prompt?.inputs.filter((i) => i.required && i.type !== 'context' && !(Array.isArray(inputs[i.name]) ? (inputs[i.name] as string[]).length : String(inputs[i.name] || '').trim())) || [];

  useEffect(() => {
    if (tab !== 'preview') return;
    setPreview(null); setPreviewErr('');
    saveNow().then(() => api.preview(buildRequest(result))).then(setPreview).catch((e) => setPreviewErr(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  if (!prompt) return null;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><h2>{title}</h2><button className="btn ghost" onClick={onClose}>× Close</button></div>
        <div className="tabs">
          <button className={tab === 'tweak' ? 'tab active' : 'tab'} onClick={() => setTab('tweak')}>Tweak</button>
          <button className={tab === 'preview' ? 'tab active' : 'tab'} onClick={() => setTab('preview')}>Preview</button>
          <div className="grow" />
          <select className="input inline" value={promptId} onChange={(e) => { setPromptId(e.target.value); setInputs(defaultInputs(prompts.find((p) => p.id === e.target.value))); }}>
            {options.map((p) => <option key={p.id} value={p.id}>{p.name}{p.system ? '' : ' (custom)'}</option>)}
          </select>
        </div>
        <div className="modal-body">
          {tab === 'tweak'
            ? <InputsForm prompt={prompt} inputs={inputs} setInputs={setInputs} context={context} setContext={setContext} />
            : <PromptPreview preview={preview} error={previewErr} />}
        </div>
        <div className="modal-foot">
          <ModelSelect value={model} onChange={setModel} />
          <div className="grow" />
          {!!missing.length && <span className="muted small">Required: {missing.map((m) => m.name).join(', ')}</span>}
          <button className="btn primary" disabled={!!missing.length} onClick={() => onGenerate(result)}>Generate</button>
        </div>
      </div>
    </div>
  );
}

export function PromptPreview({ preview, error }: { preview: { messages: PromptMessage[]; codex: string[] } | null; error: string }) {
  if (error) return <div className="alert">{error}</div>;
  if (!preview) return <div className="muted">Rendering…</div>;
  const total = preview.messages.reduce((n, m) => n + m.content.split(/\s+/).filter(Boolean).length, 0);
  return (
    <div className="preview">
      <div className="muted small">{total.toLocaleString()} words total · codex sent: {preview.codex.length ? preview.codex.join(', ') : 'none'}</div>
      {preview.messages.map((m, i) => (
        <div key={i} className="preview-msg">
          <div className="preview-role">{m.role === 'system' ? 'System Message' : m.role === 'assistant' ? 'AI' : 'User'} <button className="btn ghost tiny" onClick={() => navigator.clipboard.writeText(m.content)}>Copy</button></div>
          <pre>{m.content}</pre>
        </div>
      ))}
    </div>
  );
}
