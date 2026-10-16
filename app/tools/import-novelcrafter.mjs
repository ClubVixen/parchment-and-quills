#!/usr/bin/env node
// Import a NovelCrafter project export into NovelCrafter Local.
//
// In NovelCrafter: Export -> Novel File Format "Markdown (.md)", turn on Export Summaries, Export Prose,
// Include full Codex, Include all Chats -> Export. You get "<date> <slug> - full.zip".
//
//   node tools/import-novelcrafter.mjs <export.zip | unzipped folder> [options]
//
// Options:
//   --server URL       app server (default http://127.0.0.1:8787)
//   --data-dir DIR     data folder, for chats.json (default: NC_DATA_DIR or ../data next to the app)
//   --links FILE       JSON with scene -> codex links (the Markdown export does not contain them):
//                      [{ "chapter": "<chapter title>", "scene": 1, "codex": ["Evelynn", "The School"] }]
//   --replace ID       overwrite the manuscript/codex/chats of an existing local novel instead of creating one
//                      (its history is kept; a safety version is saved first)
//   --no-summaries     the export was made without "Export Summaries" (all scene text is prose)
//   --label TEXT       label of the history version taken after import (default "Imported from NovelCrafter")
//   --dry-run          parse and print what would be imported, change nothing
//
// The server must be running (npm start). Chats are written to <data-dir>/novels/<id>/chats.json directly,
// because the API only creates empty threads.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const newId = () => crypto.randomBytes(9).toString('base64url');

// ---------- args ----------

function parseArgs(argv) {
  const o = { server: 'http://127.0.0.1:8787', dataDir: process.env.NC_DATA_DIR || path.join(APP_DIR, '..', 'data'), label: 'Imported from NovelCrafter', summaries: true };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--server') o.server = argv[++i];
    else if (a === '--data-dir') o.dataDir = argv[++i];
    else if (a === '--links') o.links = argv[++i];
    else if (a === '--replace') o.replace = argv[++i];
    else if (a === '--label') o.label = argv[++i];
    else if (a === '--no-summaries') o.summaries = false;
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '-h' || a === '--help') o.help = true;
    else rest.push(a);
  }
  o.input = rest[0];
  return o;
}

// ---------- reading the export ----------

function openExport(input) {
  const stat = fs.statSync(input);
  if (stat.isDirectory()) return { dir: input, cleanup() {} };
  // Windows 10+ and macOS/Linux ship bsdtar, which reads .zip.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nc-import-'));
  // On Windows use the system bsdtar explicitly: Git Bash's GNU tar may come first on PATH and reads "D:" as a host.
  const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
  execFileSync(tar, ['-xf', path.resolve(input), '-C', dir]);
  return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

const read = (f) => fs.readFileSync(f, 'utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n');

/** Split "---\nyaml\n---\nbody". Only the flat keys we need are parsed. */
function frontMatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: text };
  const meta = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (kv) meta[kv[1]] = kv[2].replace(/^"(.*)"$/, '$1');
  }
  return { meta, body: m[2] };
}

// Markdown backslash escapes NovelCrafter adds (\[ \* \_ ...). Prose/summaries are stored as plain text here.
const unescapeMd = (s) => s.replace(/\\([\\`*_{}\[\]()#+\-.!>~|])/g, '$1');
const tidy = (s) => unescapeMd(s.replace(/\n{3,}/g, '\n\n').trim());

const CODEX_TYPES = new Set(['character', 'location', 'object', 'lore', 'subplot', 'other']);
const CODEX_ALIASES = { item: 'object', objects: 'object', characters: 'character', locations: 'location', subplots: 'subplot' };

function readCodex(dir) {
  const entries = [];
  for (const group of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!group.isDirectory()) continue;
    for (const e of fs.readdirSync(path.join(dir, group.name), { withFileTypes: true })) {
      const base = path.join(dir, group.name, e.name);
      if (!e.isDirectory() || !fs.existsSync(path.join(base, 'metadata.json'))) continue;
      const meta = JSON.parse(read(path.join(base, 'metadata.json')));
      const a = meta.attributes || {};
      const entryFile = path.join(base, 'entry.md');
      const body = fs.existsSync(entryFile) ? frontMatter(read(entryFile)).body : '';
      const ncType = String(a.type || group.name).toLowerCase();
      const type = CODEX_ALIASES[ncType] || ncType;
      entries.push({
        id: meta.id || newId(),
        type: CODEX_TYPES.has(type) ? type : 'other',
        name: a.name || e.name,
        aliases: a.aliases || [],
        tags: a.tags || [],
        description: tidy(body),
        alwaysInclude: !!a.alwaysIncludeInContext,
        includeInAI: !a.noAutoInclude,
        // keep custom NovelCrafter types visible, since they all become "other" here
        ...(CODEX_TYPES.has(type) ? {} : { research: `NovelCrafter type: ${a.type}` }),
      });
    }
  }
  const order = ['character', 'location', 'object', 'lore', 'subplot', 'other'];
  return entries.sort((x, y) => order.indexOf(x.type) - order.indexOf(y.type) || x.name.localeCompare(y.name));
}

/**
 * novel.md layout (Markdown export):
 *   # Title / by Author
 *   ## Act heading ("Act N" when the act has no title)
 *   ### Chapter heading ("Chapter N: Title", "Chapter N", or just the title for unnumbered chapters)
 *   #### Scene subtitle (optional)      scenes are separated by "* * *" (or the chosen divider)
 *   summary paragraphs, "---", prose  (no "---": only one of them; long text = prose)
 */
const looksLikeProse = (text) => text.split(/\s+/).filter(Boolean).length > 400;

function readManuscript(file, { summaries }) {
  const lines = read(file).split('\n');
  const novel = { title: '', author: '', acts: [] };
  let act = null, chapter = null, buf = [], sceneTitle = '';

  const flushScene = (force = false) => {
    const text = buf.join('\n');
    buf = [];
    if (!chapter || (!text.trim() && !sceneTitle && !force)) { sceneTitle = ''; return; }
    const parts = text.split(/^---[ \t]*$/m);
    let summary = '', prose = '';
    if (parts.length > 1) { summary = parts[0]; prose = parts.slice(1).join('\n---\n'); }
    // No "---": the scene has only a summary or only prose. Summaries are short, so long text is prose.
    else if (summaries && !looksLikeProse(text)) summary = text;
    else prose = text;
    chapter.scenes.push({
      id: newId(), title: unescapeMd(sceneTitle), summary: tidy(summary), includeInAI: true, pov: null, labels: [], codexIds: [],
      blocks: [{ id: newId(), type: 'text', text: tidy(prose) }],
    });
    sceneTitle = '';
  };
  const flushChapter = () => { flushScene(); if (chapter && !chapter.scenes.length) flushScene(true); chapter = null; };

  for (const line of lines) {
    let m;
    if ((m = line.match(/^# (.*)$/)) && !act) { novel.title = m[1].trim(); continue; }
    if (!act && !novel.author && (m = line.match(/^by (.*)$/))) { novel.author = m[1].trim(); continue; }
    if ((m = line.match(/^## (.*)$/))) {
      flushChapter();
      const t = m[1].trim();
      act = { id: newId(), title: /^Act \d+$/.test(t) ? '' : unescapeMd(t.replace(/^Act \d+:\s*/, '')), chapters: [] };
      novel.acts.push(act);
      continue;
    }
    if ((m = line.match(/^### (.*)$/))) {
      flushChapter();
      if (!act) { act = { id: newId(), title: '', chapters: [] }; novel.acts.push(act); }
      const t = m[1].trim();
      chapter = { id: newId(), title: /^Chapter \d+$/.test(t) ? '' : unescapeMd(t.replace(/^Chapter \d+:\s*/, '')), scenes: [] };
      act.chapters.push(chapter);
      continue;
    }
    if (chapter && (m = line.match(/^#### (.*)$/))) { flushScene(); sceneTitle = m[1].trim(); continue; }
    if (chapter && /^\s*(\* \* \*|\*\*\*|#)\s*$/.test(line)) { flushScene(true); continue; }
    if (chapter) buf.push(line);
  }
  flushChapter();
  return novel;
}

function readChats(dir) {
  if (!fs.existsSync(dir)) return { threads: [], skipped: 0 };
  const threads = [];
  let skipped = 0;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.md')).sort()) {
    const { meta, body } = frontMatter(read(path.join(dir, f)));
    const date = (f.match(/^(\d{4}-\d{2}-\d{2})/) || [])[1];
    const ts = date ? new Date(`${date}T12:00:00Z`).toISOString() : new Date().toISOString();
    const messages = [];
    let cur = null;
    for (const line of body.split('\n')) {
      const role = line === '## User' ? 'user' : line === '## AI' ? 'assistant' : null;
      if (role) { cur = { id: newId(), role, content: '', createdAt: ts }; messages.push(cur); }
      else if (cur) cur.content += line + '\n';
    }
    for (const m of messages) m.content = m.content.trim();
    if (!messages.length) { skipped++; continue; }
    const first = messages.find((m) => m.role === 'user')?.content || '';
    const title = meta.title || (first.length > 60 ? first.slice(0, 57).trimEnd() + '…' : first);
    threads.push({ id: newId(), title, promptId: 'sys-chat-general-chat', inputs: {}, context: [], pinned: meta.favourite === 'true', createdAt: ts, updatedAt: ts, messages });
  }
  threads.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { threads, skipped };
}

function applyLinks(novel, links) {
  const byName = new Map();
  for (const e of novel.codex) for (const n of [e.name, ...e.aliases]) byName.set(n.toLowerCase(), e.id);
  const problems = [];
  const chapters = novel.acts.flatMap((a) => a.chapters);
  for (const l of links) {
    // Untitled chapters ("Chapter 3") are matched by number: { "chapterNo": 3, ... }.
    const ch = l.chapterNo ? chapters[l.chapterNo - 1] : chapters.find((c) => c.title === l.chapter);
    const sc = ch?.scenes[(l.scene || 1) - 1];
    if (!sc) { problems.push(`no scene ${l.scene || 1} in chapter "${l.chapter}"`); continue; }
    for (const name of l.codex || []) {
      const id = byName.get(name.toLowerCase());
      if (!id) problems.push(`unknown codex entry "${name}" (chapter "${l.chapter}")`);
      else if (!sc.codexIds.includes(id)) sc.codexIds.push(id);
    }
  }
  return problems;
}

// ---------- API ----------

async function api(server, method, url, body) {
  const res = await fetch(server + url, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${url}: ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

// ---------- main ----------

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.help || !o.input) {
    console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 22).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
    process.exit(o.help ? 0 : 1);
  }
  const exp = openExport(o.input);
  try {
    const manuscript = path.join(exp.dir, 'novel.md');
    if (!fs.existsSync(manuscript)) throw new Error(`novel.md not found in ${o.input}. Is this a NovelCrafter Markdown project export?`);
    const parsed = readManuscript(manuscript, o);
    const codex = readCodex(exp.dir);
    const { threads, skipped } = readChats(path.join(exp.dir, 'chats'));
    const imported = { ...parsed, codex };
    const problems = o.links ? applyLinks(imported, JSON.parse(read(o.links))) : [];

    const counts = {};
    for (const e of codex) counts[e.type] = (counts[e.type] || 0) + 1;
    const chapters = parsed.acts.flatMap((a) => a.chapters);
    const scenes = chapters.flatMap((c) => c.scenes);
    console.log(`"${parsed.title}" by ${parsed.author || '?'}: ${parsed.acts.length} acts, ${chapters.length} chapters, ${scenes.length} scenes`
      + ` (${scenes.filter((s) => s.summary).length} with summary, ${scenes.filter((s) => s.blocks[0].text).length} with prose, ${scenes.filter((s) => s.codexIds.length).length} with codex links)`);
    console.log(`Codex: ${codex.length} entries ${JSON.stringify(counts)}`);
    console.log(`Chats: ${threads.length} threads, ${threads.reduce((n, t) => n + t.messages.length, 0)} messages${skipped ? ` (${skipped} empty thread(s) skipped)` : ''}`);
    for (const p of problems) console.warn('warning: ' + p);
    if (o.dryRun) { console.log('Dry run, nothing written.'); return; }

    let novel;
    if (o.replace) {
      novel = await api(o.server, 'GET', `/api/novels/${o.replace}`);
      await api(o.server, 'POST', `/api/novels/${novel.id}/history`, { label: 'Before NovelCrafter re-import' });
    } else {
      novel = await api(o.server, 'POST', '/api/novels', { title: parsed.title, author: parsed.author });
    }
    novel = { ...novel, title: parsed.title || novel.title, author: parsed.author || novel.author, acts: parsed.acts, codex };
    await api(o.server, 'PUT', `/api/novels/${novel.id}`, novel);

    const chatsFile = path.join(o.dataDir, 'novels', novel.id, 'chats.json');
    if (!fs.existsSync(path.dirname(chatsFile))) throw new Error(`Data folder for the novel not found: ${path.dirname(chatsFile)} (use --data-dir)`);
    fs.writeFileSync(chatsFile, JSON.stringify(threads, null, 2));

    await api(o.server, 'POST', `/api/novels/${novel.id}/history`, { label: o.label });
    console.log(`Imported into novel ${novel.id}: ${o.server}/#/novel/${novel.id}`);
  } finally {
    exp.cleanup();
  }
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
