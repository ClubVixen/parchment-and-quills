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
  assert.equal(r('{ifs(name, " from " + name)}', { name: '' }, { ifs: (c, a) => (c ? a : '') }), '');
  // Like NovelCrafter, a name that is neither a function nor a variable is an error, not silently empty.
  assert.throws(() => r('{nosuchthing}'), /Unknown function or variable: nosuchthing/);
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
  // Without a target the AI still gets the edit tags and the story map, but no scene text to rewrite.
  const bare = editingInstructions(n, null);
  assert.match(bare, /<newChapter after=/);
  assert.match(bare, /<storyMap>\n  <chapter number="1">\n    <scene ref="1\.1" title="Scene 1" words="\d+"\/>/);
  assert.doesNotMatch(bare, /<manuscriptForEditing>\n/);
  assert.doesNotMatch(editingInstructions(n, { type: 'scene', id: 'missing' }), /<manuscriptForEditing>\n/);
  assert.match(editingInstructions(n, { type: 'novel', id: '' }), /<manuscriptForEditing>\n<scene ref="1\.1"/);
  // Entries already shown in full are not listed again.
  assert.match(bare, /Other codex entries[\s\S]*- Mara \(character; aliases: Mar\)/);
  assert.doesNotMatch(editingInstructions(n, null, ['Mara']), /- Mara \(/);
});

test('edit tags in a reply become pending changes', async () => {
  const { changesFromReply } = await import('../changes.js');
  let k = 0;
  const reply = `Here you go.
<revision scene="1.1">
### Beat: Mara arrives
One two three. Mara ran to the door. Four five six.
</revision>
<sceneSummary scene="1.1">Mara runs to the door.</sceneSummary>
<newScene chapter="1" after="1.1" title="After">She opened it.</newScene>
<newChapter after="1" title="Two" summary="Mara leaves.">The road was long.</newChapter>
<codexEntry name="mar" aliases="Mar, Keeper" mode="append">She hates the cold.</codexEntry>
<codexEntry name="Tobin" type="Character">Old keeper.</codexEntry>
<revision scene="9.9">nowhere</revision>`;
  const list = changesFromReply(novel, reply, { threadId: 't', messageId: 'm', newId: () => `c${++k}` });
  assert.deepEqual(list.map((c) => c.kind), ['revision', 'sceneSummary', 'newScene', 'newChapter', 'codexEntry', 'codexEntry']);
  const [rev, sum, scene, chapter, upd, add] = list;
  assert.equal(rev.sceneId, 's');
  assert.match(rev.base, /One two three\. Mara walked/);
  assert.equal(sum.text, 'Mara runs to the door.');
  assert.deepEqual([scene.chapterId, scene.afterSceneId, scene.title], ['c', 's', 'After']);
  assert.deepEqual([chapter.afterChapterId, chapter.title, chapter.summary, chapter.text], ['c', 'Two', 'Mara leaves.', 'The road was long.']);
  assert.equal(upd.entryId, 'm');
  assert.deepEqual(upd.codex.aliases, ['Mar', 'Keeper']);
  assert.equal(upd.codex.description, 'Keeper of the lighthouse.\n\nShe hates the cold.');
  assert.deepEqual([add.entryId, add.codex.name, add.codex.type], [null, 'Tobin', 'character']);
  assert.ok(list.every((c) => c.status === 'pending' && c.messageId === 'm'));
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

// ---------- NovelCrafter function library ----------

const book = {
  id: 'b', title: 'Book', author: 'A. Writer', language: 'British English', tense: 'past tense', pov: { type: 'third person limited', character: 'Mara' },
  codex: [
    { id: 'm', type: 'character', name: 'Mara', aliases: [], tags: ['keeper'], description: 'Keeper. Friends with Tobin.', alwaysInclude: true },
    { id: 't', type: 'character', name: 'Tobin', aliases: [], tags: [], description: 'Old keeper.' },
    { id: 'l', type: 'location', name: 'Saltreach', aliases: [], tags: [], description: 'A lighthouse.' },
  ],
  acts: [{ id: 'a1', title: 'One', chapters: [
    { id: 'c1', title: 'Arrival', scenes: [
      { id: 's1', title: 'Dawn', summary: 'Mara finds a letter.', labels: ['mystery'], codexIds: ['l'], blocks: [{ id: 'x1', type: 'text', text: 'The wind came off the sea.' }] },
      { id: 's2', title: 'Tea', summary: 'Tobin asks about it.', pov: { type: 'first person', character: 'Tobin' }, blocks: [{ id: 'x2', type: 'text', text: 'I poured the tea.' }] },
    ] },
    { id: 'c2', title: 'Night', scenes: [
      { id: 's3', title: 'Lamp', summary: 'Mara reads the letter.', blocks: [{ id: 'x3', type: 'text', text: 'She climbed the stairs.' }] },
    ] },
  ] }],
};
const custom = (content, inputs = []) => ({ id: 'c', name: 'Custom', kind: 'chat', inputs, messages: [{ role: 'system', content }] });
const say = (content, { sceneId = 's2', inputs = {}, defs = [], kind = 'summary' } = {}) =>
  buildMessages({ novel: book, settings: { persona: '' }, prompts, prompt: custom(content, defs), inputs, task: { kind, sceneId, message: 'hi', history: [] } }).messages[0]?.content || '';

test('scene, chapter, act and story functions', () => {
  assert.equal(say('{scene.title} | {scene.fullTitle} | {scene.number}'), 'Tea | Chapter 1 - Tea | 2');
  assert.equal(say('{scene.title(scene.previous)} < {scene.title(scene.next)}'), 'Dawn < Lamp');
  assert.equal(say('{chapter.title} / {chapter.title(chapter.next)} / {act.title} / {chapter.number}'), 'Chapter 1: Arrival / Chapter 2: Night / One / 1');
  assert.match(say('{storyToCome}'), /<storyToCome>[\s\S]*Mara reads the letter\.[\s\S]*<\/storyToCome>/);
  assert.match(say('{storySoFar}'), /<storySoFar>[\s\S]*Mara finds a letter\.[\s\S]*<\/storySoFar>/);
  assert.equal(say('{asNumberedList(title(scene(novel.outline)))}'), '1. Dawn\n2. Tea\n3. Lamp');
  assert.equal(say('{scene.title(takeLast(scene(storySoFar), 1))}', { sceneId: 's3' }), 'Tea');
  assert.match(say('{chapter.summary}'), /<chapter number="1" title="Arrival">\n<scene title="Chapter 1 - Dawn" number="1">Mara finds a letter\.<\/scene>/);
  assert.equal(say('{#if scene.hasLabel(scene.previous, "Mystery")}labelled{#endif}'), 'labelled');
});

test('pov functions follow scene overrides', () => {
  assert.equal(say('{pov.type}/{pov.character}/{#if pov.isFirstPerson}1st{#endif}{#if pov.isOverwrite} override{#endif}'), 'first person/Tobin/1st override');
  assert.equal(say('{pov.character(scene.previousSamePOV)}'), '');
  assert.equal(say('{pov.type(scene.previous)}'), 'third person limited');
});

test('codex functions', () => {
  assert.equal(say('{asList(codex.name(codex.characters(codex.all)))}'), '- Mara\n- Tobin');
  assert.equal(say('{codex.name(codex.hasTag(codex.all, "Keeper"))}'), 'Mara');
  assert.equal(say('{codex.name(codex.relations("Mara"))}'), 'Tobin');
  assert.equal(say('{codex.name(scene.references(scene.previous))}'), 'Saltreach');
  assert.match(say('{codex.get("tobin")}'), /^<character name="Tobin">Old keeper\.<\/character>$/);
});

test('text, list, math and logic functions', () => {
  assert.equal(say('{uppercase("abc")} {lowercase("DEF")} {join("a", "b")} {count(any("x", "y", "z"))}'), 'ABC def ab 3');
  assert.equal(say('{pluralize(1, "beat", "beats")}, {pluralize(3, "beat", "beats")}'), '1 beat, 3 beats');
  assert.equal(say('{max(3, 9, 4)} {min(3, 9, 4)} {floor(2.7)} {ceil(2.1)}'), '9 3 2 3');
  assert.equal(say('{#if isGreaterThan(wordCount("one two three"), 2)}long{#endif}'), 'long');
  assert.equal(say('{#if contains("Romance: Billionaire", "romance")}yes{#endif}{#if startsWith("Cozy: Fantasy", "cozy")} cozy{#endif}'), 'yes cozy');
  assert.equal(say('{novel.title} by {novel.author}, {novel.language}'), 'Book by A. Writer, British English');
});

test('inputs: defaults, dropdown+text, scene picks and component inputs', () => {
  const defs = [
    { name: 'Words', types: ['dropdown', 'text'], options: ['200', '400'], default: '400' },
    { name: 'Scene', types: ['scene'], sceneMode: 'summary' },
  ];
  assert.equal(say('{input("Words")}', { defs }), '400');
  assert.equal(say('{input("words")}', { defs, inputs: { Words: '250' } }), '250');
  assert.equal(say('{input("Scene")}', { defs, inputs: { Scene: 'scene:s3' } }), '<scene title="Chapter 2 - Lamp" number="1">Mara reads the letter.</scene>');
  // Instructions come from the AdditionalInstructions component, like in NovelCrafter.
  assert.match(say('{include("Novelcrafter/AdditionalInstructions")}', { inputs: { Instructions: 'Be terse.' } }), /<instructions>\nBe terse\.\n<\/instructions>/);
  const beats = prompts.find((p) => p.name === 'Scene Beats from Summary');
  const r = buildMessages({ novel: book, settings: {}, prompts, prompt: beats, inputs: { Scene: 'scene:s1' }, task: { kind: 'chat', message: 'go', history: [] } });
  assert.match(r.messages[0].content, /develop a list of 12 highly detailed scene beats/);
  assert.match(r.messages[0].content, /Here is the scene that you need to develop the beats for:\n<scene title="Chapter 1 - Dawn" number="1">Mara finds a letter\.<\/scene>/);
});

test('developmental editor uses the picked genre and feedback', () => {
  const dev = prompts.find((p) => p.name === 'Developmental Editor');
  const run = (inputs) => buildMessages({ novel: book, settings: {}, prompts, prompt: dev, inputs, task: { kind: 'chat', message: 'Thoughts?', history: [] } }).messages[0].content;
  const bare = run({});
  assert.match(bare, /in the "novel" genre/);
  assert.match(bare, /<generalAdvice>\n<\/generalAdvice>/);
  const set = run({ Genre: 'Fantasy: Dark', Feedback: 'Dialogue' });
  assert.match(set, /in the "Fantasy: Dark" genre/);
  assert.match(set, /advice on: "Dialogue"/);
  assert.match(set, /Craft speech patterns/);
  assert.match(set, /<fantasy>[\s\S]*fantasy jargon[\s\S]*<\/fantasy>/);
});

test('passage edits find quoted text (even with straight vs curly quotes) and insert after a paragraph', async () => {
  const { changesFromReply } = await import('../changes.js');
  const n = structuredClone(novel);
  n.acts[0].chapters[0].scenes[0].blocks[0].text = 'First paragraph here.\n\nMara’s door creaked — open. She waited.\n\nLast one.';
  let k = 0;
  const reply = `<passage scene="1.1"><find>Mara's door creaked -- open.</find><replace>Mara's door groaned open.</replace></passage>
<passage scene="1.1"><find>First paragraph</find><insert>A new paragraph.</insert></passage>
<passage scene="1.1" position="before"><find>Last one.</find><insert>Second to last.</insert></passage>
<passage scene="1.1"><find>Not in the book</find><replace>x</replace></passage>`;
  const list = changesFromReply(n, reply, { threadId: 't', messageId: 'm', newId: () => `p${++k}` });
  assert.equal(list.length, 3);
  assert.deepEqual([list[0].find, list[0].replace, list[0].sceneId, list[0].blockId], ['Mara’s door creaked — open.', 'Mara’s door groaned open.', 's', 'b']);
  assert.deepEqual([list[1].find, list[1].replace], ['First paragraph here.', 'First paragraph here.\n\nA new paragraph.']);
  assert.deepEqual([list[2].find, list[2].replace], ['Last one.', 'Second to last.\n\nLast one.']);
});
