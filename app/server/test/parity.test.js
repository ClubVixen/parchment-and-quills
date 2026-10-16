// Renders the captured scenarios and compares with what NovelCrafter actually sent (../../../capture/*.json).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildMessages } from '../context.js';

const root = path.join(import.meta.dirname, '..', '..', '..');
const prompts = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'prompts', 'system.json'), 'utf8'));
const captured = (f) => JSON.parse(fs.readFileSync(path.join(root, 'capture', f), 'utf8')).body.messages;
const byName = (name) => prompts.find((p) => p.name === name);
const norm = (s) => s.replace(/\s+/g, ' ').trim();
const settings = { persona: '' };

// Same content as the "Capture Test - delete me" novel at capture time.
const novel = {
  id: 't', title: 'Capture Test - delete me', language: 'General English', tense: 'past tense', pov: { type: 'third person', character: '' },
  codex: [],
  acts: [{ id: 'a1', title: '', chapters: [{ id: 'c1', title: '', scenes: [
    { id: 's1', title: '', summary: '', blocks: [{ id: 'b1', type: 'text', text: "The wind came off the sea in long, cold breaths. Mara knelt at the lighthouse door and found the letter wedged beneath it, its wax seal pressed with a gull. She heard Tobin's boots on the stairs above and shoved the envelope inside her coat." }] },
    { id: 's2', title: '', summary: '', blocks: [
      { id: 'b2', type: 'text', text: 'Back in the kitchen, Tobin was waiting with two mugs of tea.' },
      { id: 'beat', type: 'beat', text: 'Tobin asks about the letter; Mara lies and says it was nothing.' }] },
  ] }] }],
};

function compare(ours, theirs) {
  assert.equal(ours.length, theirs.length, `message count: ${ours.map((m) => m.role)} vs ${theirs.map((m) => m.role)}`);
  ours.forEach((m, i) => {
    assert.equal(m.role, theirs[i].role);
    assert.equal(norm(m.content), norm(theirs[i].content), `message ${i} (${m.role}) differs`);
  });
}

test('scene beat matches capture', () => {
  const { messages } = buildMessages({ novel, settings, prompts, prompt: byName('General Purpose'), inputs: { Words: '200' }, task: { kind: 'beat', sceneId: 's2', beatId: 'beat' } });
  compare(messages, captured('scene_beat_general_purpose.json'));
});

test('scene summary matches capture', () => {
  const { messages } = buildMessages({ novel, settings, prompts, prompt: byName('Default'), inputs: { Words: '80' }, task: { kind: 'summary', sceneId: 's1' } });
  compare(messages, captured('scene_summary_default.json'));
});

test('general chat matches capture (codex selection + history)', () => {
  const cap = captured('chat_general_with_history.json');
  // Rebuild the codex entries from the captured XML block.
  const codexBlock = cap[0].content.match(/<codex>\n([\s\S]*?)\n<\/codex>/)[1];
  const codex = [...codexBlock.matchAll(/<(\w+) name="([^"]+)"(?: aliases="([^"]+)")?>([\s\S]*?)<\/\1>/g)].map((m, i) => ({
    id: `e${i}`, type: m[1], name: m[2], aliases: m[3] ? m[3].split(', ') : [],
    description: m[4].startsWith('\n') ? m[4].trim().split('\n').map((l) => l.replace(/^ {2}/, '')).join('\n') : m[4],
  }));
  const chatNovel = { ...novel, title: 'Daughter Of The Sun', codex };
  const history = cap.slice(1, -1);
  const { messages } = buildMessages({ novel: chatNovel, settings, prompts, prompt: byName('General Chat'), task: { kind: 'chat', history, message: cap.at(-1).content } });
  // date.today differs from capture day; compare everything else.
  const strip = (s) => s.replace(/today is [^"]+ and/, 'today is X and');
  compare(messages.map((m) => ({ ...m, content: strip(m.content) })), cap.map((m) => ({ ...m, content: strip(m.content) })));
});
