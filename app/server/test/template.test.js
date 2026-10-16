import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { renderTemplate, tidy } from '../template.js';
import { buildMessages } from '../context.js';

const prompts = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'prompts', 'system.json'), 'utf8'));
const r = (src, vars = {}, fns = {}) => tidy(renderTemplate(src, { vars, fns }));

test('if / elseif / else / comments', () => {
  const src = '{! note !}\n{#if a is "x"}\n  A\n{#elseif a is "y"}\n  B\n{#else}\n  C\n{#endif}';
  assert.equal(r(src, { a: 'x' }), 'A');
  assert.equal(r(src, { a: 'Y' }), 'B');
  assert.equal(r(src, { a: 'z' }), 'C');
});

test('in, not, concatenation, function-valued paths', () => {
  assert.equal(r('{#if "b" in list}yes{#endif}', { list: ['a', 'b'] }), 'yes');
  assert.equal(r('{#if not empty}none{#endif}', { empty: '' }), 'none');
  assert.equal(r('{ifs(name, " from " + name)}', {}, { ifs: (c, a) => (c ? a : '') }), '');
  const pov = { character: (s) => (s ? s.who : 'Mara') };
  assert.equal(r('{pov.character} / {pov.character(prev)}', { pov, prev: { who: 'Tobin' } }), 'Mara / Tobin');
});

const novel = {
  id: 't', title: 'T', language: 'US English', tense: 'past tense', pov: { type: 'first person', character: 'Mara' },
  codex: [{ id: 'm', type: 'character', name: 'Mara', aliases: ['Mar'], description: 'Keeper of the lighthouse.' }],
  acts: [{ id: 'a', title: '', chapters: [{ id: 'c', title: '', scenes: [
    { id: 's', title: '', summary: '', blocks: [{ id: 'b', type: 'text', text: 'One two three. Mara walked to the door. Four five six.' }] }] }] }],
};
const prompt = (name) => prompts.find((p) => p.name === name);

test('expand: multi-choice instructions, length target, codex, surrounding text', () => {
  const text = novel.acts[0].chapters[0].scenes[0].blocks[0].text;
  const start = text.indexOf('Mara'), end = text.indexOf('door.') + 5;
  const { messages } = buildMessages({ novel, settings: {}, prompts, prompt: prompt('Expand'),
    inputs: { Instructions: ['Add: Feelings', 'Keep it eerie'], Length: 'Double' },
    task: { kind: 'replace', sceneId: 's', blockId: 'b', start, end } });
  const [sys, user] = messages;
  assert.match(sys.content, /Go in depth about their feelings\./);
  assert.match(sys.content, /Keep it eerie/);
  assert.doesNotMatch(sys.content, /Add: Feelings/);
  assert.match(sys.content, /Your current word target is 10 words/);
  assert.match(user.content, /<character name="Mara" aliases="Mar">Keeper of the lighthouse\.<\/character>/);
  assert.match(user.content, /<pointOfView type="first person" character="Mara"\/>/);
  assert.match(user.content, /<textBefore>\nOne two three\.\n<\/textBefore>/);
  assert.match(user.content, /<text words="5">\nMara walked to the door\.\n<\/text>/);
});

test('shorten: elseif branch', () => {
  const { messages } = buildMessages({ novel, settings: {}, prompts, prompt: prompt('Shorten'), inputs: { Length: 'Quarter' },
    task: { kind: 'replace', sceneId: 's', blockId: 'b', start: 0, end: 52 } });
  assert.match(messages[0].content, /Quarter the length of the given prose\. Your current word target is 3 words/);
});

test('additional context uses local() and skips codex already included', () => {
  const { messages } = buildMessages({ novel, settings: {}, prompts, prompt: prompt('General Chat'),
    context: [{ type: 'text', text: '<note>Storm season.</note>' }],
    task: { kind: 'chat', history: [], message: 'What does Mara fear?' } });
  assert.match(messages[0].content, /<additionalContext>\n<note>Storm season\.<\/note>\n<\/additionalContext>/);
  assert.match(messages[0].content, /<codex>\n<character name="Mara"/);
  assert.equal(messages.at(-1).content, 'What does Mara fear?');
});

test('chat edit mode hands over target scenes with beat headings and refs', async () => {
  const { editingInstructions } = await import('../context.js');
  const n = structuredClone(novel);
  n.acts[0].chapters[0].scenes[0].blocks.unshift({ id: 'bt', type: 'beat', text: 'Mara reaches the door' });
  const text = editingInstructions(n, { type: 'chapter', id: 'c' });
  assert.match(text, /<scene ref="1\.1" title="Chapter 1 - Scene 1">\n### Beat: Mara reaches the door\n\nOne two three\./);
  assert.match(text, /<revision scene="REF">/);
  assert.equal(editingInstructions(n, null), '');
  assert.equal(editingInstructions(n, { type: 'scene', id: 'missing' }), '');
});

test('rewrite under a story beat sends the beat; POV rule follows the novel setting', async () => {
  const { povInstruction } = await import('../context.js');
  const n = structuredClone(novel);
  n.acts[0].chapters[0].scenes[0].blocks = [
    { id: 'bt', type: 'beat', text: 'Mara hides the letter from Tobin' },
    { id: 'b', type: 'text', text: 'She folded it twice and slid it under the floorboard.' },
  ];
  const { messages } = buildMessages({ novel: n, settings: {}, prompts, prompt: prompt('Expand'), inputs: {},
    task: { kind: 'replace', sceneId: 's', blockId: 'b', start: 0, end: 20 } });
  assert.match(messages[1].content, /<storyBeat>\nThe text being rewritten belongs to this story beat; keep it consistent with it:\nMara hides the letter from Tobin\n<\/storyBeat>/);
  assert.match(povInstruction(n, 's'), /first person \("I"\), narrated by Mara\. .*never switch to third person.*past tense/);
  n.acts[0].chapters[0].scenes[0].pov = { type: 'third person objective', character: '' };
  assert.match(povInstruction(n, 's'), /third person objective/);
  assert.equal(povInstruction({ ...n, povReminder: false }, 's'), '');
});
