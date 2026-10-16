import { useEffect, useState } from 'react';
import { api } from '../api';
import { TopNav, useApp } from '../App';
import type { Settings, TtsSettings as Tts } from '../types';

export function SettingsPage() {
  const { settings, setSettings } = useApp();
  const [s, setS] = useState<Settings | null>(settings);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [models, setModels] = useState<{ id: string; maxLen: number | null }[]>([]);
  const [saved, setSaved] = useState(false);
  useEffect(() => { if (settings && !s) setS(settings); }, [settings, s]);
  if (!s) return <div className="page loading">Loading…</div>;

  const set = (patch: Partial<Settings>) => { setS({ ...s, ...patch }); setSaved(false); };
  const save = async () => { const next = await api.saveSettings(s); setSettings(next); setSaved(true); return next; };
  const test = async () => {
    setStatus(null);
    try {
      await save();
      const m = await api.models();
      setModels(m);
      setStatus({ ok: true, text: `Connected. ${m.length} model(s): ${m.map((x) => `${x.id}${x.maxLen ? ` (${x.maxLen.toLocaleString()} ctx)` : ''}`).join(', ')}` });
    } catch (e) { setStatus({ ok: false, text: (e as Error).message }); }
  };

  return (
    <div className="page">
      <TopNav active="settings" />
      <main className="page-body">
        <h1 className="page-title">AI Connection</h1>
        <p className="page-sub">An OpenAI-compatible server (vLLM, LM Studio, Ollama, …). Requests go from this app's backend, so browser CORS rules don't apply.</p>
        <div className="card form narrow">
          <label>Base URL<input className="input" value={s.baseUrl} onChange={(e) => set({ baseUrl: e.target.value })} placeholder="http://192.168.0.48:8000/v1" /></label>
          <label>API key<input className="input" type="password" value={s.apiKey} onChange={(e) => set({ apiKey: e.target.value })} /></label>
          <label>Default model
            <div className="row">
              <input className="input grow" value={s.model} onChange={(e) => set({ model: e.target.value })} list="model-list" />
              <datalist id="model-list">{models.map((m) => <option key={m.id} value={m.id} />)}</datalist>
              <button className="btn" onClick={test}>Test connection</button>
            </div>
          </label>
          {status && <div className={status.ok ? 'notice' : 'alert'}>{status.text}</div>}
          <h3>Generation</h3>
          <p className="muted small">NovelCrafter sends no sampling settings, so the server defaults apply. Leave these empty to behave the same.</p>
          <div className="row">
            <label className="grow">Temperature<input className="input" type="number" step="0.05" min="0" max="2" value={s.temperature ?? ''} onChange={(e) => set({ temperature: e.target.value === '' ? null : Number(e.target.value) })} /></label>
            <label className="grow">Max tokens<input className="input" type="number" min="1" value={s.maxTokens ?? ''} onChange={(e) => set({ maxTokens: e.target.value === '' ? null : Number(e.target.value) })} /></label>
          </div>
          <p className="muted small">GLM always reasons before answering; the reasoning is kept out of your text and shown in a collapsible “Reasoning” box. (Turning thinking off via <code>enable_thinking: false</code> was tested on this server: GLM-5.3 then writes its reasoning into the answer, so that option is not offered.)</p>
          <h3>Persona</h3>
          <label>Details about you, sent to the AI as {'{personas}'}<textarea className="input" rows={5} value={s.persona} onChange={(e) => set({ persona: e.target.value })} placeholder="e.g. I write dark fantasy for adults; I prefer British spelling…" /></label>
          <div className="row"><button className="btn primary" onClick={save}>Save</button>{saved && <span className="muted small">Saved.</span>}</div>
        </div>
        <TtsSettings s={s} set={set} save={save} />
      </main>
    </div>
  );
}

const PROVIDERS: Record<Tts['provider'], { label: string; hint: string }> = {
  chatterbox: { label: 'Chatterbox (local)', hint: 'Your Chatterbox TTS API, e.g. http://192.168.0.48:4123 on the Linux machine. Start it with the “Start Chatterbox” launcher there.' },
  elevenlabs: { label: 'ElevenLabs', hint: 'Cloud voices from elevenlabs.io. Text you listen to is sent to ElevenLabs.' },
  openai: { label: 'OpenAI-compatible', hint: 'Any server with POST /audio/speech (OpenAI, Kokoro, etc.).' },
};

function TtsSettings({ s, set, save }: { s: Settings; set: (p: Partial<Settings>) => void; save: () => Promise<Settings> }) {
  const tts = s.tts;
  const [voices, setVoices] = useState<{ id: string; name: string }[]>([]);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const t = (patch: Partial<Tts>) => set({ tts: { ...tts, ...patch } });
  const num = (v: string) => (v === '' ? null : Number(v));

  const test = async () => {
    setStatus({ ok: true, text: 'Connecting…' });
    try {
      await save();
      const v = await api.voices();
      setVoices(v);
      setStatus({ ok: true, text: `Connected. ${v.length} voice(s): ${v.map((x) => x.name).slice(0, 12).join(', ')}${v.length > 12 ? '…' : ''}. Playing a sample…` });
      const url = await api.speak('Hello! This is how your stories will sound.', tts.defaultVoice || v[0]?.id || '');
      await new Audio(url).play();
    } catch (e) { setStatus({ ok: false, text: (e as Error).message }); }
  };

  return (
    <div className="card form narrow" style={{ marginTop: 24 }}>
      <h3>Voice (read aloud)</h3>
      <p className="muted small">Used by 📖 Read → 🔊 Listen. Each character can get their own voice from the Voices… button in the player.</p>
      <label>Provider
        <select className="input" value={tts.provider} onChange={(e) => t({ provider: e.target.value as Tts['provider'] })}>
          {Object.entries(PROVIDERS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
      </label>
      <p className="muted small">{PROVIDERS[tts.provider].hint}</p>
      {tts.provider !== 'elevenlabs' && <label>Server URL<input className="input" value={tts.baseUrl} onChange={(e) => t({ baseUrl: e.target.value })} placeholder="http://192.168.0.48:4123" /></label>}
      {tts.provider !== 'chatterbox' && <label>API key<input className="input" type="password" value={tts.apiKey} onChange={(e) => t({ apiKey: e.target.value })} /></label>}
      {tts.provider !== 'chatterbox' && <label>Model<input className="input" value={tts.model} onChange={(e) => t({ model: e.target.value })} placeholder={tts.provider === 'elevenlabs' ? 'eleven_multilingual_v2' : 'tts-1'} /></label>}
      <label>Default voice
        <div className="row">
          <input className="input grow" list="tts-voices" value={tts.defaultVoice} onChange={(e) => t({ defaultVoice: e.target.value })} placeholder="(server default)" />
          <datalist id="tts-voices">{voices.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</datalist>
          <button className="btn" onClick={test}>Test voice</button>
        </div>
      </label>
      {status && <div className={status.ok ? 'notice' : 'alert'}>{status.text}</div>}
      {tts.provider === 'chatterbox' && (
        <div className="row">
          <label className="grow">Emotion (0.25–2)<input className="input" type="number" step="0.05" min="0.25" max="2" value={tts.exaggeration ?? ''} placeholder="0.5" onChange={(e) => t({ exaggeration: num(e.target.value) })} /></label>
          <label className="grow">Pace / CFG (0–1)<input className="input" type="number" step="0.05" min="0" max="1" value={tts.cfgWeight ?? ''} placeholder="0.5" onChange={(e) => t({ cfgWeight: num(e.target.value) })} /></label>
          <label className="grow">Temperature<input className="input" type="number" step="0.05" min="0.05" max="5" value={tts.temperature ?? ''} placeholder="0.8" onChange={(e) => t({ temperature: num(e.target.value) })} /></label>
        </div>
      )}
      <div className="row"><button className="btn primary" onClick={save}>Save voice settings</button></div>
    </div>
  );
}
