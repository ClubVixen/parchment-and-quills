// File-based storage. Each novel lives in data/novels/<id>/:
//   novel.json      manuscript + codex (the thing history snapshots cover)
//   chats.json      chat threads
//   history/*.json  snapshots { savedAt, label, auto, words, novel }
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const DATA_DIR = path.resolve(process.env.NC_DATA_DIR || path.join(import.meta.dirname, '..', '..', 'data'));
const NOVELS = path.join(DATA_DIR, 'novels');
const TRASH = path.join(DATA_DIR, 'trash');
const AUTO_SNAPSHOT_MS = 10 * 60 * 1000;
const MAX_AUTO_SNAPSHOTS = 300;

fs.mkdirSync(NOVELS, { recursive: true });

export const newId = () => crypto.randomBytes(9).toString('base64url');
const now = () => new Date().toISOString();

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}
const novelDir = (id) => {
  if (!/^[\w-]+$/.test(id)) throw Object.assign(new Error('bad id'), { status: 400 });
  return path.join(NOVELS, id);
};

// ---------- settings ----------

const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const DEFAULT_SETTINGS = {
  baseUrl: 'http://192.168.0.48:8000/v1',
  apiKey: 'novelcrafter-local',
  model: 'GLM-5.3-Flash',
  temperature: null,
  maxTokens: null,
  disableThinking: false,
  persona: '',
  userName: '',
  avatar: '', // data URL (resized in the browser to 256px)
  tts: {
    provider: 'chatterbox', // 'chatterbox' | 'elevenlabs' | 'openai'
    baseUrl: 'http://192.168.0.48:4123',
    apiKey: '',
    model: 'eleven_multilingual_v2',
    defaultVoice: '',
    exaggeration: null,
    cfgWeight: null,
    temperature: null,
  },
};
export const getSettings = () => {
  const saved = readJson(SETTINGS_FILE, {});
  return { ...DEFAULT_SETTINGS, ...saved, tts: { ...DEFAULT_SETTINGS.tts, ...(saved.tts || {}) } };
};
export function saveSettings(patch) {
  const cur = getSettings();
  const next = { ...cur, ...patch, tts: { ...cur.tts, ...(patch.tts || {}) } };
  writeJson(SETTINGS_FILE, next);
  return next;
}

// ---------- custom prompts ----------

const PROMPTS_FILE = path.join(DATA_DIR, 'prompts.json');
export const getCustomPrompts = () => readJson(PROMPTS_FILE, []);
export const saveCustomPrompts = (list) => writeJson(PROMPTS_FILE, list);

// ---------- novels ----------

export function wordCount(text) {
  const m = (text || '').match(/[\p{L}\p{N}'’-]+/gu);
  return m ? m.length : 0;
}

export function novelWords(novel) {
  let n = 0;
  for (const act of novel.acts || []) for (const ch of act.chapters) for (const sc of ch.scenes)
    for (const b of sc.blocks) if (b.type === 'text') n += wordCount(b.text);
  return n;
}

export function blankNovel({ title = 'New Novel', author = '', language = 'General English' } = {}) {
  const ts = now();
  return {
    id: newId(), title, author, language, tense: 'past tense',
    pov: { type: 'third person', character: '' },
    createdAt: ts, updatedAt: ts,
    acts: [{ id: newId(), title: '', chapters: [{ id: newId(), title: '', scenes: [blankScene()] }] }],
    codex: [],
  };
}
export const blankScene = () => ({ id: newId(), title: '', summary: '', includeInAI: true, pov: null, labels: [], codexIds: [], blocks: [{ id: newId(), type: 'text', text: '' }] });

export function listNovels() {
  return fs.readdirSync(NOVELS, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => readJson(path.join(NOVELS, d.name, 'novel.json'), null))
    .filter(Boolean)
    .map((n) => ({ id: n.id, title: n.title, author: n.author, updatedAt: n.updatedAt, createdAt: n.createdAt, words: novelWords(n), codex: n.codex.length, cover: coverInfo(n.id)?.mtime ?? null }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getNovel(id) {
  const n = readJson(path.join(novelDir(id), 'novel.json'), null);
  if (!n) throw Object.assign(new Error('Novel not found'), { status: 404 });
  return n;
}

export function createNovel(opts) {
  const n = blankNovel(opts);
  writeJson(path.join(novelDir(n.id), 'novel.json'), n);
  snapshot(n, { label: 'Created', auto: false });
  return n;
}

const hashOf = (novel) => crypto.createHash('sha1').update(JSON.stringify({ ...novel, updatedAt: null })).digest('hex');

/** Save the whole novel. Takes an automatic history snapshot at most every 10 minutes when content changed. */
export function saveNovel(id, novel) {
  if (novel.id !== id) throw Object.assign(new Error('id mismatch'), { status: 400 });
  novel.updatedAt = now();
  writeJson(path.join(novelDir(id), 'novel.json'), novel);
  const last = listHistory(id)[0];
  if (!last || (Date.now() - Date.parse(last.savedAt) > AUTO_SNAPSHOT_MS && last.hash !== hashOf(novel))) {
    snapshot(novel, { label: '', auto: true });
  }
  return novel;
}

export function deleteNovel(id) {
  fs.mkdirSync(TRASH, { recursive: true });
  fs.renameSync(novelDir(id), path.join(TRASH, `${id}-${Date.now()}`));
}

// ---------- covers (kept as files so they don't bloat novel.json and its history) ----------

const COVER_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

export function coverInfo(id) {
  for (const [type, ext] of Object.entries(COVER_TYPES)) {
    const file = path.join(novelDir(id), `cover.${ext}`);
    if (fs.existsSync(file)) return { file, type, mtime: Math.round(fs.statSync(file).mtimeMs) };
  }
  return null;
}

export function saveCover(id, dataUrl) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(dataUrl || '');
  if (!m) throw Object.assign(new Error('Expected a JPEG, PNG or WebP data URL'), { status: 400 });
  removeCover(id);
  const file = path.join(novelDir(id), `cover.${COVER_TYPES[m[1]]}`);
  fs.writeFileSync(file, Buffer.from(m[2], 'base64'));
  return coverInfo(id);
}

export function removeCover(id) {
  for (const ext of Object.values(COVER_TYPES)) fs.rmSync(path.join(novelDir(id), `cover.${ext}`), { force: true });
}

// ---------- history ----------

const histDir = (id) => path.join(novelDir(id), 'history');

export function snapshot(novel, { label = '', auto = false } = {}) {
  const savedAt = now();
  const file = path.join(histDir(novel.id), `${savedAt.replace(/[:.]/g, '-')}${auto ? '' : '-m'}.json`);
  writeJson(file, { savedAt, label, auto, words: novelWords(novel), hash: hashOf(novel), novel });
  if (auto) pruneHistory(novel.id);
  return { file: path.basename(file), savedAt, label, auto };
}

export function listHistory(id) {
  const dir = histDir(id);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort().reverse().map((f) => {
    const s = readJson(path.join(dir, f), null);
    return s && { file: f, savedAt: s.savedAt, label: s.label, auto: s.auto, words: s.words, hash: s.hash };
  }).filter(Boolean);
}

export function getSnapshot(id, file) {
  if (!/^[\w.-]+\.json$/.test(file)) throw Object.assign(new Error('bad file'), { status: 400 });
  const s = readJson(path.join(histDir(id), file), null);
  if (!s) throw Object.assign(new Error('Snapshot not found'), { status: 404 });
  return s;
}

export function updateSnapshotLabel(id, file, label) {
  const s = getSnapshot(id, file);
  s.label = label;
  s.auto = false; // labelled snapshots are kept
  writeJson(path.join(histDir(id), file), s);
}

function pruneHistory(id) {
  const autos = listHistory(id).filter((h) => h.auto && !h.label);
  for (const h of autos.slice(MAX_AUTO_SNAPSHOTS)) fs.rmSync(path.join(histDir(id), h.file));
}

// ---------- chats ----------

const chatsFile = (id) => path.join(novelDir(id), 'chats.json');
export const getChats = (id) => readJson(chatsFile(id), []);
export const saveChats = (id, chats) => writeJson(chatsFile(id), chats);

export function updateThread(id, threadId, fn) {
  const chats = getChats(id);
  const t = chats.find((c) => c.id === threadId);
  if (!t) throw Object.assign(new Error('Thread not found'), { status: 404 });
  fn(t);
  t.updatedAt = now();
  saveChats(id, chats);
  return t;
}

// ---------- AI-proposed changes (changes.json) ----------

const changesFile = (id) => path.join(novelDir(id), 'changes.json');
export const getChanges = (id) => readJson(changesFile(id), []);
export const saveChanges = (id, list) => writeJson(changesFile(id), list);
