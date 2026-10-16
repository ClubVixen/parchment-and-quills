// Text-to-speech providers: Chatterbox (travisvn/chatterbox-tts-api), ElevenLabs, or any OpenAI-style /audio/speech.
// Every generated clip is cached on disk by provider + voice + settings + text.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR } from './store.js';

const CACHE = path.join(DATA_DIR, 'audio-cache');
const base = (tts) => tts.baseUrl.replace(/\/+$/, '');
const OPENAI_VOICES = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer'];

/** fetch that turns "fetch failed" into a message naming the server. */
async function call(url, init, what) {
  try { return await fetch(url, init); }
  catch (e) { throw new Error(`Can't reach the ${what} at ${new URL(url).origin} (${e.cause?.code || e.message}). Is it running?`); }
}

async function failText(res) {
  const t = await res.text().catch(() => '');
  return `HTTP ${res.status}${t ? `: ${t.slice(0, 300)}` : ''}`;
}

export async function listVoices(tts) {
  if (tts.provider === 'elevenlabs') {
    const res = await call('https://api.elevenlabs.io/v1/voices', { headers: { 'xi-api-key': tts.apiKey }, signal: AbortSignal.timeout(10000) }, 'ElevenLabs API');
    if (!res.ok) throw new Error(`ElevenLabs voices: ${await failText(res)}`);
    return (await res.json()).voices.map((v) => ({ id: v.voice_id, name: v.name }));
  }
  if (tts.provider === 'openai') return OPENAI_VOICES.map((v) => ({ id: v, name: v }));
  const res = await call(`${base(tts)}/voices`, { signal: AbortSignal.timeout(8000) }, 'voice server');
  if (!res.ok) throw new Error(`Chatterbox voices: ${await failText(res)}`);
  const json = await res.json();
  return (json.voices || []).map((v) => {
    const name = typeof v === 'string' ? v : v.name || v.voice_name || v.id;
    return { id: name, name };
  }).filter((v) => v.id);
}

/** Synthesize one piece of text. Returns { file, type } of a cached audio file. */
export async function synthesize(tts, voice, text) {
  const v = voice || tts.defaultVoice || '';
  const params = tts.provider === 'chatterbox' ? [tts.exaggeration, tts.cfgWeight, tts.temperature] : [tts.model];
  const key = crypto.createHash('sha1').update(JSON.stringify([tts.provider, base(tts), v, params, text])).digest('hex');
  fs.mkdirSync(CACHE, { recursive: true });
  for (const ext of ['wav', 'mp3']) {
    const f = path.join(CACHE, `${key}.${ext}`);
    if (fs.existsSync(f)) return { file: f, type: ext === 'wav' ? 'audio/wav' : 'audio/mpeg' };
  }

  let res, ext;
  if (tts.provider === 'elevenlabs') {
    if (!v) throw new Error('Choose an ElevenLabs voice first.');
    res = await call(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(v)}?output_format=mp3_44100_128`, {
      method: 'POST', headers: { 'xi-api-key': tts.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, model_id: tts.model || 'eleven_multilingual_v2' }),
    }, 'ElevenLabs API');
    ext = 'mp3';
  } else if (tts.provider === 'openai') {
    res = await call(`${base(tts)}/audio/speech`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(tts.apiKey ? { Authorization: `Bearer ${tts.apiKey}` } : {}) },
      body: JSON.stringify({ model: tts.model || 'tts-1', input: text, voice: v || 'alloy', response_format: 'mp3' }),
    }, 'speech server');
    ext = 'mp3';
  } else {
    const body = { input: text.slice(0, 3000), ...(v ? { voice: v } : {}) };
    if (tts.exaggeration != null && tts.exaggeration !== '') body.exaggeration = Number(tts.exaggeration);
    if (tts.cfgWeight != null && tts.cfgWeight !== '') body.cfg_weight = Number(tts.cfgWeight);
    if (tts.temperature != null && tts.temperature !== '') body.temperature = Number(tts.temperature);
    res = await call(`${base(tts)}/audio/speech`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, 'Chatterbox voice server');
    ext = 'wav';
  }
  if (!res.ok) throw new Error(`Speech failed: ${await failText(res)}`);
  const file = path.join(CACHE, `${key}.${ext}`);
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  return { file, type: ext === 'wav' ? 'audio/wav' : 'audio/mpeg' };
}
