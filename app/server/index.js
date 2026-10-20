// Parchment & Quills server (NovelCrafter-style): REST API + AI generation (SSE) + static UI.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import * as store from './store.js';
import { buildMessages, editingInstructions, povInstruction } from './context.js';
import { listModels, streamChat } from './ai.js';
import { listVoices, synthesize } from './tts.js';
import { aiSpeakers, getScript, saveScript } from './audio.js';
import { effectiveInputs, normalizeInput } from './inputs.js';
import { functionDocs } from './functions.js';
import { changesFromReply } from './changes.js';

const PORT = Number(process.env.NC_PORT || 8787);
const HOST = process.env.NC_HOST || '127.0.0.1';
const WEB_DIST = path.join(import.meta.dirname, '..', 'web', 'dist');
const SYSTEM_PROMPTS = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'prompts', 'system.json'), 'utf8'));

const rawPrompts = () => [...SYSTEM_PROMPTS, ...store.getCustomPrompts().map((p) => ({ ...p, system: false }))];
/** Every prompt with its inputs in the current shape, plus the inputs it inherits from included components. */
const allPrompts = () => {
  const list = rawPrompts().map((p) => ({ ...p, inputs: (p.inputs || []).map(normalizeInput) }));
  return list.map((p) => ({ ...p, allInputs: effectiveInputs(p, list) }));
};
function findPrompt(id) {
  const p = allPrompts().find((x) => x.id === id);
  if (!p) throw Object.assign(new Error(`Unknown prompt ${id}`), { status: 400 });
  return p;
}

// ---------- tiny router ----------

const routes = [];
const route = (method, pattern, handler) => {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, handler });
};

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
function send(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

// ---------- settings / models / prompts ----------

route('GET', '/api/settings', () => store.getSettings());
route('PUT', '/api/settings', ({ body }) => store.saveSettings(body));
route('GET', '/api/models', async () => listModels(store.getSettings()));
route('GET', '/api/prompts', () => allPrompts());
route('GET', '/api/template-functions', () => functionDocs());
route('PUT', '/api/prompts/custom', ({ body }) => {
  if (!Array.isArray(body)) throw Object.assign(new Error('Expected a list'), { status: 400 });
  store.saveCustomPrompts(body.map(({ system, allInputs, ...p }) => p));
  return allPrompts();
});

// ---------- novels ----------

route('GET', '/api/novels', () => store.listNovels());
route('POST', '/api/novels', ({ body }) => store.createNovel(body));
route('GET', '/api/novels/:id', ({ id }) => store.getNovel(id));
route('PUT', '/api/novels/:id', ({ id, body }) => ({ updatedAt: store.saveNovel(id, body).updatedAt }));
route('DELETE', '/api/novels/:id', ({ id }) => { store.deleteNovel(id); return { ok: true }; });

// ---------- history ----------

route('GET', '/api/novels/:id/history', ({ id }) => store.listHistory(id));
route('POST', '/api/novels/:id/history', ({ id, body }) => store.snapshot(store.getNovel(id), { label: body.label || 'Manual save', auto: false }));
route('GET', '/api/novels/:id/history/:file', ({ id, file }) => store.getSnapshot(id, file));
route('PATCH', '/api/novels/:id/history/:file', ({ id, file, body }) => { store.updateSnapshotLabel(id, file, body.label || ''); return { ok: true }; });
route('POST', '/api/novels/:id/history/:file/restore', ({ id, file, body }) => {
  const snap = store.getSnapshot(id, file);
  const current = store.getNovel(id);
  const when = new Date(snap.savedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
  const what = body.sceneId ? 'a scene from ' : '';
  store.snapshot(current, { label: `Before restoring ${what}"${snap.label || 'Autosave'}" (${when})`, auto: false });
  let next;
  if (body.sceneId) {
    const old = findScene(snap.novel, body.sceneId);
    if (!old) throw Object.assign(new Error('Scene not in that version'), { status: 404 });
    next = current;
    const where = findScene(next, body.sceneId);
    if (where) where.chapter.scenes[where.index] = old.scene;
    else (findChapter(next, old.chapter.id) || next.acts.at(-1).chapters.at(-1)).scenes.push(old.scene);
  } else {
    next = { ...snap.novel, id };
  }
  store.saveNovel(id, next);
  return next;
});

function findScene(novel, sceneId) {
  for (const act of novel.acts) for (const chapter of act.chapters) {
    const index = chapter.scenes.findIndex((s) => s.id === sceneId);
    if (index >= 0) return { scene: chapter.scenes[index], chapter, index };
  }
  return null;
}
const findChapter = (novel, chId) => novel.acts.flatMap((a) => a.chapters).find((c) => c.id === chId);

// ---------- chats ----------

route('GET', '/api/novels/:id/chats', ({ id }) => store.getChats(id));
route('GET', '/api/novels/:id/changes', ({ id }) => store.getChanges(id));
route('PATCH', '/api/novels/:id/changes/:cid', ({ id, cid, body }) => {
  const list = store.getChanges(id);
  const c = list.find((x) => x.id === cid);
  if (!c) throw Object.assign(new Error('Change not found'), { status: 404 });
  if (['pending', 'accepted', 'rejected'].includes(body.status)) { c.status = body.status; c.decidedAt = new Date().toISOString(); }
  store.saveChanges(id, list);
  return c;
});
route('POST', '/api/novels/:id/chats', ({ id, body }) => {
  const chats = store.getChats(id);
  const ts = new Date().toISOString();
  const thread = { id: store.newId(), title: body.title || '', promptId: body.promptId || 'sys-chat-general-chat', inputs: {}, context: [], pinned: false, createdAt: ts, updatedAt: ts, messages: [] };
  chats.unshift(thread);
  store.saveChats(id, chats);
  return thread;
});
route('PATCH', '/api/novels/:id/chats/:tid', ({ id, tid, body }) =>
  store.updateThread(id, tid, (t) => { for (const k of ['title', 'promptId', 'inputs', 'context', 'pinned', 'target']) if (k in body) t[k] = body[k]; }));
route('DELETE', '/api/novels/:id/chats/:tid', ({ id, tid }) => { store.saveChats(id, store.getChats(id).filter((t) => t.id !== tid)); return { ok: true }; });
/** Pending (undecided) changes proposed in these messages go away with them; decided ones stay as a record. */
const dropPending = (novelId, messageIds) => {
  const all = store.getChanges(novelId);
  const keep = all.filter((c) => !(c.status === 'pending' && messageIds.includes(c.messageId)));
  if (keep.length !== all.length) store.saveChanges(novelId, keep);
};
route('DELETE', '/api/novels/:id/chats/:tid/messages/:mid', ({ id, tid, mid }) => {
  dropPending(id, [mid]);
  return store.updateThread(id, tid, (t) => { t.messages = t.messages.filter((m) => m.id !== mid); });
});

// ---------- covers ----------

route('GET', '/api/novels/:id/cover', ({ id }) => {
  const c = store.coverInfo(id);
  if (!c) throw Object.assign(new Error('No cover'), { status: 404 });
  return { sendFile: c.file, type: c.type, cache: 'max-age=31536000' }; // URLs carry ?v=<mtime>
});
route('PUT', '/api/novels/:id/cover', ({ id, body }) => ({ cover: store.saveCover(id, body.dataUrl).mtime }));
route('DELETE', '/api/novels/:id/cover', ({ id }) => { store.removeCover(id); return { cover: null }; });

// ---------- read aloud ----------

route('GET', '/api/tts/voices', async () => listVoices(store.getSettings().tts));
route('POST', '/api/tts', async ({ body }) => {
  if (!String(body.text || '').trim()) throw Object.assign(new Error('No text'), { status: 400 });
  const clip = await synthesize(store.getSettings().tts, body.voice, String(body.text));
  return { sendFile: clip.file, type: clip.type, cache: 'max-age=86400' };
});
route('GET', '/api/novels/:id/audio/:chapterId', ({ id, chapterId }) => getScript(store.getNovel(id), chapterId));
route('PUT', '/api/novels/:id/audio/:chapterId', ({ id, chapterId, body }) => {
  const script = getScript(store.getNovel(id), chapterId);
  script.overrides = body.overrides || {};
  return saveScript(id, script);
});
route('POST', '/api/novels/:id/audio/:chapterId/ai', async ({ id, chapterId }) => {
  const novel = store.getNovel(id);
  const script = getScript(novel, chapterId);
  const labelled = await aiSpeakers(novel, store.getSettings(), script);
  saveScript(id, script);
  return { ...script, labelled };
});

// ---------- generation ----------

function prepare(body) {
  const novel = store.getNovel(body.novelId);
  const settings = store.getSettings();
  const prompt = findPrompt(body.promptId);
  let task = body.task;
  let thread = null;
  if (task.kind === 'chat') {
    thread = store.getChats(body.novelId).find((t) => t.id === task.threadId);
    if (!thread) throw Object.assign(new Error('Thread not found'), { status: 404 });
    let msgs = thread.messages;
    let message = task.message;
    if (task.retry) {
      // Regenerate the answer to the last user message.
      while (msgs.length && msgs.at(-1).role === 'assistant') msgs = msgs.slice(0, -1);
      message = msgs.at(-1)?.content || '';
      msgs = msgs.slice(0, -1);
    }
    task = { ...task, message, history: msgs.map((m) => ({ role: m.role, content: m.content })) };
  }
  const built = buildMessages({ novel, settings, prompt, prompts: allPrompts(), task, inputs: body.inputs || {}, context: body.context || [], model: body.model || settings.model });
  // Chat edit mode: give the AI the current text of the target scenes and the <revision> format.
  const editing = task.kind === 'chat' ? editingInstructions(novel, body.target, built.codex) : '';
  // Summaries are always third person by design; everything else gets the book's POV spelled out.
  const pov = task.kind === 'summary' || task.kind === 'beatsFromText' ? '' : povInstruction(novel, task.sceneId || (body.target?.type === 'scene' ? body.target.id : null));
  const extraSystem = [pov, editing].filter(Boolean).join('\n\n');
  if (extraSystem) {
    const sys = built.messages.find((m) => m.role === 'system');
    if (sys) sys.content += `\n\n${extraSystem}`;
    else built.messages.unshift({ role: 'system', content: extraSystem });
  }
  return { settings, task, thread, ...built };
}

route('POST', '/api/preview', ({ body }) => {
  const { messages, codex } = prepare(body);
  return { messages, codex };
});

async function generate(req, res, body) {
  const { settings, task, thread, messages, codex } = prepare(body);
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  const emit = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const abort = new AbortController();
  res.on('close', () => { if (!res.writableEnded) abort.abort(); });

  const ts = () => new Date().toISOString();
  if (thread && !task.retry) {
    store.updateThread(body.novelId, thread.id, (t) => {
      t.messages.push({ id: store.newId(), role: 'user', content: task.message, createdAt: ts() });
      if (!t.title) t.title = task.message.slice(0, 80);
    });
  }
  if (thread && task.retry) {
    const dropped = [];
    store.updateThread(body.novelId, thread.id, (t) => { while (t.messages.length && t.messages.at(-1).role === 'assistant') dropped.push(t.messages.pop().id); });
    dropPending(body.novelId, dropped);
  }
  emit('meta', { codex, messageCount: messages.length, promptTokensApprox: Math.round(messages.reduce((n, m) => n + m.content.length, 0) / 4) });
  try {
    const result = await streamChat(settings, { model: body.model, messages }, (d) => emit('delta', d), abort.signal);
    if (thread) {
      store.updateThread(body.novelId, thread.id, (t) => {
        t.messages.push({ id: store.newId(), role: 'assistant', content: result.content, reasoning: result.reasoning, model: result.model, createdAt: ts() });
      });
      // Edit tags in the reply become pending changes for the author to accept or reject.
      const saved = store.getChats(body.novelId).find((t) => t.id === thread.id)?.messages.at(-1);
      const changes = changesFromReply(store.getNovel(body.novelId), result.content, { threadId: thread.id, messageId: saved.id, newId: store.newId });
      if (changes.length) store.saveChanges(body.novelId, [...store.getChanges(body.novelId), ...changes]);
      result.changes = changes.length;
    }
    emit('done', result);
  } catch (err) {
    if (!abort.signal.aborted) emit('error', { message: err.message });
  }
  res.end();
}

// ---------- static UI ----------

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.json': 'application/json' };
function serveStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = path.join(WEB_DIST, path.normalize(urlPath).replace(/^([/\\])+/, ''));
  if (!file.startsWith(WEB_DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(WEB_DIST, 'index.html');
  if (!fs.existsSync(file)) { res.writeHead(404); res.end('UI not built. Run: npm run build'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}

// ---------- server ----------

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (!url.pathname.startsWith('/api/')) return serveStatic(req, res);
    if (req.method === 'POST' && url.pathname === '/api/generate') return await generate(req, res, await readBody(req));
    for (const r of routes) {
      const m = r.method === req.method && url.pathname.match(r.re);
      if (!m) continue;
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req) : {};
      const result = await r.handler({ ...params, body, query: url.searchParams });
      if (result && result.sendFile) {
        res.writeHead(200, { 'Content-Type': result.type, 'Cache-Control': result.cache || 'no-cache' });
        return fs.createReadStream(result.sendFile).pipe(res);
      }
      return send(res, 200, result);
    }
    send(res, 404, { error: 'Not found' });
  } catch (err) {
    if (res.headersSent) { res.end(); return; }
    send(res, err.status || 500, { error: err.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Parchment & Quills running at http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log(`Data: ${store.DATA_DIR}`);
});
