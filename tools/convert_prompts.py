"""Convert prompts/novelcrafter-prompts.md into app/server/prompts/system.json."""
import json, re, sys
src, dst = sys.argv[1], sys.argv[2]
md = open(src, encoding='utf-8').read()

INPUTS = {
  'General Purpose': [
    {'name': 'Words', 'type': 'number', 'required': True, 'options': ['200', '400', '600'], 'default': '400', 'description': 'How many words should the AI write?'},
    {'name': 'Instructions', 'type': 'text', 'description': 'Any (optional) additional instructions and roles for the AI'},
    {'name': 'Additional Context', 'type': 'context', 'description': 'Any additional information to provide to the AI'}],
  'Default': [
    {'name': 'Words', 'type': 'number', 'required': True, 'options': ['80', '120', '300'], 'default': '80', 'description': 'How long should the summary be?'},
    {'name': 'Instructions', 'type': 'text', 'description': 'Any (optional) additional instructions and roles for the AI'}],
  'Expand': [
    {'name': 'Instructions', 'type': 'multi', 'options': ['Add: Sensory details', 'Add: Feelings', 'Add: Introspection'], 'description': 'How should the text be expanded?'},
    {'name': 'Length', 'type': 'choice', 'options': ['Double', 'Triple'], 'description': 'How long should the expanded text be?'},
    {'name': 'Additional Context', 'type': 'context', 'description': 'Any additional information to provide to the AI'}],
  'Rephrase': [
    {'name': 'Instructions', 'type': 'text', 'required': True, 'options': ['Make it more vivid', 'Simplify the language', 'Fix grammar and flow'], 'description': 'How should the text be rephrased?'},
    {'name': 'Additional Context', 'type': 'context', 'description': 'Any additional information to provide to the AI'}],
  'Shorten': [
    {'name': 'Length', 'type': 'choice', 'required': True, 'options': ['Half', 'Quarter', 'Single paragraph'], 'default': 'Half', 'description': 'How long should the shortened text be?'},
    {'name': 'Instructions', 'type': 'text', 'description': 'Any (optional) additional instructions and roles for the AI'}],
  'General Chat': [
    {'name': 'Instructions', 'type': 'text', 'description': 'Any (optional) additional instructions and roles for the AI'},
    {'name': 'Additional Context', 'type': 'context', 'description': 'Any additional information to provide to the AI'}],
  'Scene Beats from Summary': [
    {'name': 'Scene', 'type': 'scene', 'required': True, 'description': 'The scene summary to develop beats for'},
    {'name': 'Amount', 'type': 'number', 'required': True, 'options': ['6', '8', '12'], 'default': '8', 'description': 'How many beats should be generated?'},
    {'name': 'Instructions', 'type': 'text', 'description': 'Any (optional) additional instructions and roles for the AI'},
    {'name': 'Additional Context', 'type': 'context', 'description': 'Any additional information to provide to the AI'}],
  'Developmental Editor': [
    {'name': 'Genre', 'key': 'role', 'type': 'text', 'required': True, 'options': ['Fantasy', 'Romance', 'Science Fiction', 'Thriller', 'Literary'], 'description': 'This will determine the genre that your AI assistant specialises in.'},
    {'name': 'Feedback', 'type': 'choice', 'options': ['Pacing', 'Dialogue', 'Characterization', 'Structural', 'Developmental'], 'description': 'What kind of feedback do you want from the AI?'},
    {'name': 'Instructions', 'type': 'text', 'description': 'Any (optional) additional instructions and roles for the AI'},
    {'name': 'Additional Context', 'type': 'context', 'description': 'Any additional information to provide to the AI'}],
}
KIND = {'Scene Beat Completions': 'beat', 'Scene Summarizations': 'summary', 'Text Replacements': 'replace', 'Workshop Chats': 'chat'}
ROLE = {'system': 'system', 'user': 'user', 'assistant': 'assistant'}

def blocks(section):
    """Yield (role, text) for each '### role' + ~~~ fenced block in a section."""
    for m in re.finditer(r'^### (\w+)\n(?:~~~\n(.*?)\n~~~|\((identical to Expand.s user message)\))', section, re.S | re.M):
        yield m.group(1), m.group(2), bool(m.group(3))

prompts, expand_user = [], None
for m in re.finditer(r'^## (.+?) / (.+?)\n(.*?)(?=^## |^# |\Z)', md, re.S | re.M):
    cat, name, body = m.group(1).strip(), m.group(2).strip(), m.group(3)
    msgs = []
    for role, text, same in blocks(body):
        if same:
            text = expand_user
        msgs.append({'role': ROLE[role], 'content': text})
        if name == 'Expand' and role == 'user':
            expand_user = text
    pid = 'sys-' + re.sub(r'[^a-z0-9]+', '-', (KIND[cat] + ' ' + name).lower()).strip('-')
    prompts.append({'id': pid, 'name': name, 'kind': KIND[cat], 'system': True, 'messages': msgs, 'inputs': INPUTS[name]})

comp = md[md.index('# Prompt Components'):]
for m in re.finditer(r'^## (Novelcrafter/\S+)\n~~~\n(.*?)\n~~~', comp, re.S | re.M):
    prompts.append({'id': 'sys-comp-' + m.group(1).split('/', 1)[1].lower().replace('/', '-'), 'name': m.group(1),
                    'kind': 'component', 'system': True, 'messages': [{'role': 'system', 'content': m.group(2)}], 'inputs': []})

json.dump(prompts, open(dst, 'w', encoding='utf-8'), indent=2, ensure_ascii=False)
print(len(prompts), 'prompts:', ', '.join(f"{p['kind']}:{p['name']}({len(p['messages'])})" for p in prompts))
