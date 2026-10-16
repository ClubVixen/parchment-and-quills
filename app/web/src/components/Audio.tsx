import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { useApp } from '../App';
import { useWorkspace } from '../views/Workspace';
import type { AudioScript, AudioSegment, CodexEntry, Novel } from '../types';

type Voice = { id: string; name: string };

let voiceCache: Promise<Voice[]> | null = null;
export function useVoices() {
  const [voices, setVoices] = useState<Voice[]>([]);
  const [error, setError] = useState('');
  const load = useCallback((force = false) => {
    if (force || !voiceCache) voiceCache = api.voices();
    voiceCache.then((v) => { setVoices(v); setError(''); }).catch((e) => { voiceCache = null; setError(e.message); });
  }, []);
  useEffect(() => { load(); }, [load]);
  return { voices, error, reload: () => load(true) };
}

const characters = (n: Novel) => n.codex.filter((e) => e.type === 'character');

/** The POV character's codex entry (first-person books are narrated in their voice by default). */
function povEntry(n: Novel): CodexEntry | undefined {
  const name = n.pov?.character?.trim().toLowerCase();
  if (!name) return undefined;
  return characters(n).find((e) => [e.name, ...e.aliases].some((x) => x.toLowerCase() === name || x.toLowerCase().split(/[\s(]/)[0] === name));
}

export function narratorVoice(n: Novel, fallback: string) {
  const pov = /^first person/.test(n.pov?.type || '') ? povEntry(n) : undefined;
  return n.voices?.narrator || (pov && n.voices?.characters?.[pov.id]) || fallback;
}

function voiceFor(n: Novel, speaker: string, fallback: string) {
  if (speaker !== 'narrator' && speaker !== 'unknown') {
    const v = n.voices?.characters?.[speaker];
    if (v) return v;
  }
  return narratorVoice(n, fallback);
}

export const speakerName = (n: Novel, id: string) => (id === 'narrator' ? 'Narrator' : id === 'unknown' ? 'Unknown speaker' : n.codex.find((e) => e.id === id)?.name || 'Unknown speaker');

// ---------- player ----------

export function AudioPlayer({ chapterId, seek, onPara, onClose }: {
  chapterId: string;
  seek: { para: number; n: number } | null;
  onPara: (para: number | null) => void;
  onClose: () => void;
}) {
  const { novel, saveNow } = useWorkspace();
  const { settings } = useApp();
  const fallback = settings?.tts?.defaultVoice || '';
  const [script, setScript] = useState<AudioScript | null>(null);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [rate, setRate] = useState(() => Number(localStorage.getItem('pq.audio.rate')) || 1);
  const [dialog, setDialog] = useState<'voices' | 'speakers' | null>(null);
  const audio = useRef<HTMLAudioElement>(new Audio());
  const playingRef = useRef(false);

  // Clips are generated one at a time (the voice server works on one line at a time anyway), always starting
  // with the line needed next, and kept up to LOOKAHEAD lines ahead of playback.
  type Job = { i: number; voice: string; text: string; promise: Promise<string>; resolve: (u: string) => void; reject: (e: unknown) => void; started: boolean; done: boolean };
  const jobs = useRef(new Map<string, Job>());
  const busy = useRef(false);
  const wantIdx = useRef(0);
  const [, setTick] = useState(0);
  const [preparing, setPreparing] = useState(false);

  const loadScript = useCallback(async () => {
    setError('');
    try { await saveNow(); setScript(await api.audioScript(novel.id, chapterId)); } catch (e) { setError((e as Error).message); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [novel.id, chapterId]);
  useEffect(() => { loadScript(); setIdx(0); }, [loadScript]);

  const segs = script?.segments || [];
  const speakerOf = (i: number) => script?.overrides?.[i] || segs[i]?.speaker || 'narrator';
  const keyOf = (i: number) => {
    const voice = voiceFor(novel, speakerOf(i), fallback);
    return { key: `${voice}|${segs[i].text}`, voice };
  };

  const kick = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      for (;;) {
        const waiting = [...jobs.current.values()].filter((j) => !j.started);
        if (!waiting.length) break;
        const rank = (j: Job) => (j.i < wantIdx.current ? 1e9 : 0) + j.i; // next lines first, earlier ones last
        const job = waiting.sort((a, b) => rank(a) - rank(b))[0];
        job.started = true;
        try { job.resolve(await api.speak(job.text, job.voice)); }
        catch (e) { job.reject(e); jobs.current.forEach((v, k) => { if (v === job) jobs.current.delete(k); }); }
        job.done = true;
        setTick((t) => t + 1);
      }
    } finally { busy.current = false; }
  }, []);

  const request = useCallback((i: number) => {
    const { key, voice } = keyOf(i);
    let job = jobs.current.get(key);
    if (!job) {
      let resolve!: (u: string) => void, reject!: (e: unknown) => void;
      const promise = new Promise<string>((a, b) => { resolve = a; reject = b; });
      promise.catch(() => {});
      job = { i, voice, text: segs[i].text, promise, resolve, reject, started: false, done: false };
      jobs.current.set(key, job);
    }
    kick();
    return job.promise;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segs, script, novel, fallback, kick]);

  const LOOKAHEAD = 6;
  const playAt = useCallback(async (i: number) => {
    if (!segs[i]) { setPlaying(false); playingRef.current = false; onPara(null); setStatus('Finished the chapter.'); return; }
    setIdx(i);
    onPara(segs[i].para);
    wantIdx.current = i;
    for (let k = 1; k <= LOOKAHEAD; k++) if (segs[i + k]) request(i + k); // queue the next lines behind this one
    setStatus('Generating voice…');
    try {
      const url = await request(i);
      if (!playingRef.current) return;
      const a = audio.current;
      a.src = url;
      a.playbackRate = rate;
      a.onended = () => { if (playingRef.current) playAt(i + 1); };
      await a.play();
      setStatus('');
    } catch (e) {
      setError((e as Error).message);
      setPlaying(false); playingRef.current = false;
    }
  }, [segs, request, onPara, rate]);

  const prepareAll = async () => {
    setPreparing(true);
    await Promise.allSettled(segs.map((_, i) => request(i)));
    setPreparing(false);
  };
  const ready = segs.filter((_, i) => jobs.current.get(keyOf(i).key)?.done).length;

  const start = (i = idx) => { setError(''); playingRef.current = true; setPlaying(true); playAt(i); };
  const pause = () => { playingRef.current = false; setPlaying(false); audio.current.pause(); setStatus('Paused'); };
  const jumpPara = (dir: -1 | 1) => {
    const cur = segs[idx]?.para ?? 0;
    const target = dir > 0 ? segs.findIndex((s) => s.para > cur) : segs.findIndex((s) => s.para === Math.max(0, cur - 1));
    if (target < 0) return;
    audio.current.pause();
    if (playingRef.current) playAt(target); else { setIdx(target); onPara(segs[target].para); }
  };

  // Clicking a paragraph in Read mode starts reading there.
  useEffect(() => {
    if (!seek || !segs.length) return;
    const i = segs.findIndex((s) => s.para >= seek.para);
    if (i >= 0) { audio.current.pause(); start(i); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seek]);

  useEffect(() => { audio.current.playbackRate = rate; try { localStorage.setItem('pq.audio.rate', String(rate)); } catch { /* ignore */ } }, [rate]);
  useEffect(() => { const a = audio.current; return () => { a.pause(); playingRef.current = false; onPara(null); }; }, [onPara]);

  const current = segs[idx];
  return (
    <div className="audio-bar">
      <button className="btn small primary" disabled={!segs.length} onClick={() => (playing ? pause() : start())}>{playing ? '⏸ Pause' : '▶ Listen'}</button>
      <button className="icon-btn" title="Previous paragraph" onClick={() => jumpPara(-1)}>⏮</button>
      <button className="icon-btn" title="Next paragraph" onClick={() => jumpPara(1)}>⏭</button>
      <select className="input inline tiny" value={rate} onChange={(e) => setRate(Number(e.target.value))} title="Speed">
        {[0.75, 0.9, 1, 1.1, 1.25, 1.5].map((r) => <option key={r} value={r}>{r}×</option>)}
      </select>
      <div className="audio-status">
        {error ? <span className="danger small">{error}</span> : current
          ? <span className="small"><b>{speakerName(novel, speakerOf(idx))}</b>{current.quote ? '' : ''} <span className="muted">· line {idx + 1} of {segs.length}{status ? ` · ${status}` : ''}</span></span>
          : <span className="muted small">{script ? 'Nothing to read in this chapter.' : 'Preparing…'}</span>}
      </div>
      <button className="btn small" disabled={!segs.length || preparing || ready === segs.length} onClick={prepareAll}
        title="Generate the whole chapter in the background so playback never waits (clips are kept for next time)">
        {ready === segs.length && segs.length ? '✓ Chapter ready' : preparing ? `Preparing ${ready}/${segs.length}…` : '⬇ Prepare chapter'}
      </button>
      <button className="btn small" onClick={() => setDialog('voices')}>Voices…</button>
      <button className="btn small" onClick={() => setDialog('speakers')} disabled={!script}>Speakers…</button>
      <button className="icon-btn" title="Close player" onClick={() => { pause(); onClose(); }}>✕</button>
      {dialog === 'voices' && <VoicesDialog onClose={() => { setDialog(null); jobs.current.clear(); }} />}
      {dialog === 'speakers' && script && (
        <SpeakersDialog script={script} chapterId={chapterId} onClose={() => setDialog(null)}
          onChange={(s) => { setScript(s); jobs.current.clear(); }} />
      )}
    </div>
  );
}

// ---------- voice assignment ----------

export function VoicesDialog({ onClose }: { onClose: () => void }) {
  const { novel, update } = useWorkspace();
  const { settings } = useApp();
  const { voices, error, reload } = useVoices();
  const [testing, setTesting] = useState('');
  const chars = characters(novel);
  const pov = povEntry(novel);
  const firstPerson = /^first person/.test(novel.pov?.type || '');

  const set = (key: 'narrator' | string, voice: string) => update((n) => {
    n.voices ||= {};
    n.voices.characters ||= {};
    if (key === 'narrator') n.voices.narrator = voice || undefined;
    else if (voice) n.voices.characters[key] = voice; else delete n.voices.characters[key];
  });
  const autoMatch = () => update((n) => {
    n.voices ||= {};
    n.voices.characters ||= {};
    for (const c of characters(n)) {
      if (n.voices.characters[c.id]) continue;
      const names = [c.name, ...c.aliases].flatMap((x) => [x.toLowerCase(), x.toLowerCase().split(/[\s(]/)[0]]);
      const v = voices.find((vv) => names.includes(vv.name.toLowerCase().replace(/\.(wav|mp3)$/, '')));
      if (v) n.voices.characters[c.id] = v.id;
    }
  });
  const test = async (voice: string, name: string) => {
    setTesting(name);
    try { const url = await api.speak(`Hello, I'm ${name}. This is how I sound.`, voice); const a = new Audio(url); a.onended = () => setTesting(''); await a.play(); }
    catch (e) { alert((e as Error).message); setTesting(''); }
  };
  const select = (value: string, onChange: (v: string) => void, placeholder: string) => (
    <select className="input inline" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {voices.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
    </select>
  );

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><h2>Voices for “{novel.title}”</h2><button className="btn ghost" onClick={onClose}>× Close</button></div>
        <div className="modal-body form">
          {error && <div className="alert">Can't list voices: {error}. Check AI Connection → Voice, and that the voice server is running.</div>}
          <p className="muted small">Narration is read by the narrator voice; dialogue is read in the voice of the character speaking (lines with an unknown speaker use the narrator). Provider: <b>{settings?.tts?.provider}</b> · {voices.length} voices. <button className="link-btn" onClick={reload}>Refresh</button></p>
          <div className="voice-row">
            <div className="grow"><b>Narrator</b><div className="muted tiny">{firstPerson && pov ? `First-person book: if empty, ${pov.name}'s voice is used.` : 'Also used for lines whose speaker is unknown.'}</div></div>
            {select(novel.voices?.narrator || '', (v) => set('narrator', v), firstPerson && pov ? `${pov.name}'s voice` : `Default (${settings?.tts?.defaultVoice || 'server default'})`)}
            <button className="btn small" disabled={!!testing} onClick={() => test(narratorVoice(novel, settings?.tts?.defaultVoice || ''), 'the narrator')}>▶</button>
          </div>
          <div className="row"><b className="grow">Characters</b><button className="btn small" onClick={autoMatch} disabled={!voices.length}>Auto-match by name</button></div>
          {!chars.length && <div className="muted small">Add characters to the codex to give them voices.</div>}
          {chars.map((c) => (
            <div key={c.id} className="voice-row">
              <div className="grow">{c.name}{pov?.id === c.id && <span className="chip tiny">POV</span>}</div>
              {select(novel.voices?.characters?.[c.id] || '', (v) => set(c.id, v), 'Narrator voice')}
              <button className="btn small" disabled={!!testing || !novel.voices?.characters?.[c.id]} onClick={() => test(novel.voices!.characters![c.id], c.name.split(/[\s(]/)[0])}>{testing === c.name.split(/[\s(]/)[0] ? '…' : '▶'}</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------- speaker corrections ----------

function SpeakersDialog({ script, chapterId, onClose, onChange }: { script: AudioScript; chapterId: string; onClose: () => void; onChange: (s: AudioScript) => void }) {
  const { novel, saveNow } = useWorkspace();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [filter, setFilter] = useState<'all' | 'unknown'>('all');
  const lines = useMemo(() => script.segments.map((s, i) => ({ s, i })).filter(({ s }) => s.quote), [script]);
  const who = (i: number, s: AudioSegment) => script.overrides?.[i] || s.speaker;
  const shown = filter === 'unknown' ? lines.filter(({ s, i }) => who(i, s) === 'unknown') : lines;

  const change = async (i: number, speaker: string) => {
    const overrides = { ...(script.overrides || {}), [i]: speaker };
    onChange(await api.saveOverrides(novel.id, chapterId, overrides));
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><h2>Who says what</h2><button className="btn ghost" onClick={onClose}>× Close</button></div>
        <div className="tabs">
          <button className={filter === 'all' ? 'tab active' : 'tab'} onClick={() => setFilter('all')}>All lines ({lines.length})</button>
          <button className={filter === 'unknown' ? 'tab active' : 'tab'} onClick={() => setFilter('unknown')}>Unknown ({lines.filter(({ s, i }) => who(i, s) === 'unknown').length})</button>
          <div className="grow" />
          <button className="btn small" disabled={busy} onClick={async () => {
            setBusy(true); setMsg('Asking the AI to label every line… this takes a few minutes for a long chapter.');
            try { await saveNow(); const r = await api.aiSpeakers(novel.id, chapterId); onChange(r); setMsg(`The AI labelled ${r.labelled} lines. Your own corrections are kept.`); }
            catch (e) { setMsg((e as Error).message); }
            setBusy(false);
          }}>{busy ? 'Detecting…' : '✦ Detect speakers with AI'}</button>
        </div>
        <div className="modal-body">
          <p className="muted small">Speakers were guessed from names and words like “said” near each line{script.mode === 'ai' ? ', then checked by the AI' : ''}. Fix any line here; it is remembered until the chapter text changes.</p>
          {msg && <div className="notice small">{msg}</div>}
          <div className="speaker-list">
            {shown.map(({ s, i }) => (
              <div key={i} className="speaker-row">
                <select className="input inline tiny" value={who(i, s)} onChange={(e) => change(i, e.target.value)}>
                  <option value="unknown">Unknown (narrator voice)</option>
                  <option value="narrator">Narrator</option>
                  {characters(novel).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <span className="small">{s.text.length > 160 ? `${s.text.slice(0, 160)}…` : s.text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
