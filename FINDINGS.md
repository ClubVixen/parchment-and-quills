# NovelCrafter → local app: findings (2026-10-15)

## AI server (192.168.0.48:8000)
- Stock vLLM (`0.1.dev20051+g487ecf187`), OpenAI-compatible, key `novelcrafter-local`.
- Models: `GLM-5.3-Flash` (alias of `zai-org/GLM-5.3-Flash`), max context 393,216 tokens.
- Streaming responses carry a separate `delta.reasoning` field before `delta.content`.
  Our app must show/hide reasoning separately and only insert `content` into prose.
- Also exposes `/v1/messages` (Anthropic-style), `/v1/responses`, `/tokenize` (useful for context budgeting),
  `/v1/chat/completions/render` (renders the chat template; useful for debugging).
- There's no API for reading back past prompts. `/metrics` only has counts
  (3 requests, 1,499 prompt tokens total as of the check).
- No SSH access from this PC (no key installed on that box).

## Prompts
All 15 system prompts/components captured verbatim → `prompts/novelcrafter-prompts.md`.
They use NovelCrafter's template language:
- `{var}` / `{fn(args)}` interpolation: `novel.title`, `novel.tense`, `novel.language`, `pov`, `pov.type`,
  `pov.character`, `message`, `textBefore`, `storySoFar`, `codex.context`, `personas`, `series.title`,
  `scene.fullText`, `scene.previous`, `date.today`, `isStartOfText`, `hasTextBefore/After`
- Functions: `input("Name")`, `include("Component")`, `wordsBefore(n)`, `wordsAfter(n)`, `lastWords(text,n)`,
  `wordCount`, `multiply`, `divide`, `round`, `either`, `ifs`, `and`, `without`, `any`, `asXml`,
  `removeWhitespace`, `content`, `local(name[, value])`
- Blocks: `{#if …}` `{#elseif …}` `{#else}` `{#endif}`; operators `is`, `in`
- Comments: `{! … !}` (stripped)
- Messages have roles System / User / AI; the AI role is used to pre-fill prior prose so the model imitates your style.

## Live captures (2026-10-15) - `capture/*.json`
Captured on the AI box with a temporary passive sniffer container (`tools/sniff_requests.py`) sharing the
vLLM container's network namespace; removed afterwards. vLLM itself runs in Docker container `vllm-glm53-cmp`
(started by `/mnt/mishka-storage/AI_models/glm53-vllm.sh`), CORS allowed origin `https://app.novelcrafter.com`.
SSH: `ssh ai-box` (user `mishka`, key `~/.ssh/mishka_ms7c34_ed25519`); `mishka` is in the `docker` group.

| File | Feature | Params sent |
|---|---|---|
| `chat_general_with_history.json` | Workshop chat (General Chat), 2nd turn | `model`, `stream: true` |
| `scene_beat_general_purpose.json` | Scene beat, 200 words | `model`, `stream: true` |
| `scene_summary_default.json` | Summarize scene, 80 words | `model`, `stream: false` |
| `scene_beat_retry.json` | Retry of the beat: byte-identical request | |

**No temperature / max_tokens / top_p are sent**, so vLLM's generation defaults apply. `model` is whatever was
picked: chat used `zai-org/GLM-5.3-Flash`, beat/summary used `GLM-5.3-Flash` (both served).
Requests go browser → `http://192.168.0.48:8000/v1/chat/completions` directly.

How prompts are rendered:
- Templates render to plain `{role, content}` messages; `{! !}` comments and empty includes leave blank lines.
- **Chat**: one system message (template + codex + instructions), then the raw thread as alternating
  user/assistant messages, ending with the new user message.
- **Codex block**: only entries *mentioned* (name or alias) in the thread / beat, plus entries mentioned inside those
  entries' text. Format, one element per entry, tag = entry type:
  `<character name="Evelynn" aliases="Eve">description…</character>`, also `<location …>`, `<lore …>`
  (aliases attribute omitted when none). Description is plain text with paragraphs.
- **Scene beat**: system = writer rules; user = personas/codex/story-so-far; assistant = text before the beat
  (`textBefore`); user = `Write N words…<instructions>{pov}

{beat text}</instructions>`.
  POV default renders `<pointOfView type="third person"/>`.
- **storySoFar** format: `<storySoFar><act number="1"><chapter number="1"><scene title="Scene 1" number="1"/>…`
  (scene element is self-closing when it has no summary; with a summary the summary text is expected inside
  the element. Not captured yet, inferred).
- **Summary**: `<scene>` wraps `<scene title="Chapter 1 - Scene 1" number="1">full text</scene>`.
- `novel.language` renders as "General English", `novel.tense` as "past tense".

UI notes seen during capture: beat box offers 200/400/600 words, `+ Context`, and warnings
("No Point of View set", "Previous scenes are missing summaries", "beat mentions no Codex entries");
generated prose shows Apply / Retry / Discard / Section + "N words, model". Scene Actions menu: Set custom POV,
Add Subtitle, Include in AI Context toggle, Summarize Scene, Detect Characters, Chat with Scene, Versions/History,
Copy Text, Export Scene. Modes: Plan / Write / Chat / Review / Settings.
The writing/summary model collections default to cloud models (GPT-4o, Gemini…), all unavailable, so GLM must be
picked through "Use another model…". Our app should default to the local model.

Fallback tool kept: `tools/capture_proxy.py` (pass-through logging proxy, if the browser can be pointed at it).

## Layout / features observed
- **Library**: Novels / Series / Prompts top nav; novel grid with cover, search/sort/group.
- **Novel workspace** (`/novels/<id>/storyboard`):
  - Left sidebar tabs: **Codex** | **Snippets** | **Chats**; footer: Help, Prompts, Export.
  - Main: mode switch **Plan** (also Write/Chat), view **Grid**, scene filter, View options.
  - Plan grid: Acts (collapsible, word counts) → Chapters (cards side by side) → Scenes
    (summary text with codex mentions underlined, tag chips for linked codex entries, `+ Codex`, `Label`).
  - "New Act", "Create from Outline", "Import", "Actions".
- **Codex**: groups Characters (12), Locations (6), Lore (12), Subplots (6). Entry = type, name, tags, aliases,
  description (rich text), image; tabs Details / Research / Relations / Mentions / Tracking; mention sparkline.
  Names and aliases are auto-detected in prose and linked.
- **Chats**: threads (pinned/unpinned), each message has Copy / Snippet / Extract and a word count.
- **Prompts library**: categories Model Collections, Default Prompts, Scene Beat Completions, Scene Summarizations,
  Text Replacements, Workshop Chats, Prompt Components; each prompt has General (presets, models, type),
  Instructions (messages), Advanced (inputs, included components, live preview).

## Side effects in your NovelCrafter account
- *Daughter Of The Sun*: new chat thread "Prompt capture test: in one sentence, how does Evelynn relate to The School?"
  (2 questions + answers). Manuscript and codex untouched.
- New scratch novel **"Capture Test - delete me"** (2 scenes, a generated scene-1 summary, an unapplied beat).
  Delete it from the library when convenient.
