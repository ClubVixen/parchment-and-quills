# Parchment & Quills

A local writing app in the style of NovelCrafter that talks to your own OpenAI-compatible AI server
(currently vLLM serving GLM-5.3-Flash at `http://192.168.0.48:8000/v1`).

## Start

Double-click **`Start Parchment and Quills.cmd`** (one folder up). It installs/builds on first run,
starts the server and opens http://127.0.0.1:8787.

Or from a terminal in this folder:

```
npm install
npm run build
npm start
```

Development (two terminals): `npm run dev:server` and `npm run dev:web` (UI on http://localhost:5173).

## What's in it

| Area | Features |
|---|---|
| Library | Novels, create, delete (moved to `data/trash`) |
| Plan | Acts → chapters → scene cards, summaries, AI "Summarize scene", codex chips, POV per scene, include/exclude from AI |
| Write | Manuscript editor. Highlight text to **Expand / Rephrase / Shorten** with an optional guide ("more tension…") or on auto, or to **assign it to a beat** (snaps to whole paragraphs). Beat sections get a coloured edge and a numbered tag |
| Read | FimFiction-style reading view (Open Sans, double spacing by default). **Aa Format**: font, size, line spacing, spaced/indented paragraphs, alignment, page width, light/sepia/dark, beat labels. **🔊 Listen** reads the chapter aloud |
| Codex | Characters, locations, objects, lore, subplots; aliases, tags (autocomplete from tags you've used), notes, "always include", mention list. Entries named in a beat or chat are sent automatically |
| Chat | Threads, General Chat / Scene Beats from Summary / Developmental Editor, inputs + context picker (outline, manuscript, chapters, scenes, codex, notes), streaming, reasoning shown separately, retry |
| Chat edits | Pick a chapter or scene under **Working on**; ask for changes and the AI returns full revised scenes as cards with a word diff. **Commit to scene** saves a history version first, then replaces the text; **Read chapter** opens it in Read mode. Replies with beat lists get **Add these beats to a scene…** |
| Beats | Each scene's beats (short summaries) live in the side panel: click one to jump to its text and highlight it, Edit, reorder, delete, or **✦ Write with AI** (adds text at the end of that beat's section) |
| Covers | Add your own cover image to any book (library card or ⚙ Novel settings); cropped to 2:3 |
| Read aloud | Chatterbox (local), ElevenLabs or any OpenAI-style speech server (AI Connection → Voice). Narrator voice plus one voice per character (**Voices…**, auto-match by name). Dialogue speakers are guessed from names/"said" and back-and-forth; fix them in **Speakers…** or let the AI label them. Clips are cached in `data/audio-cache` |
| Profile | Username and profile picture (header, sidebar, chat), used as author for new novels |
| History | Autosave versions every 10 minutes, labelled versions, word-level diff per scene, restore one scene or the whole novel (a safety version is saved first) |
| Prompts | NovelCrafter's 15 system prompts, captured word for word; clone and edit your own. A custom component with the same name overrides the system one |

## How prompts are built

`server/template.js` is a port of NovelCrafter's template language (`{#if}`, `{include()}`, `{input()}`, …).
`server/context.js` fills it with the same data formats NovelCrafter uses (codex XML, `<storySoFar>`,
`<pointOfView/>`). `server/test/parity.test.js` checks the output against requests captured from
NovelCrafter itself (`../capture/*.json`). Run `npm test`.

Requests send only `model`, `stream` and `messages`, like NovelCrafter. Temperature / max tokens can be set
in **AI Connection** if you want them.

## Importing from NovelCrafter

1. In NovelCrafter open the novel, click **Export** (sidebar footer). Set **Novel File Format: Markdown (.md)**,
   turn on **Export Summaries**, **Export Prose**, **Include full Codex** and **Include all Chats**, click **Export**.
   You get `<date> <novel> - full.zip`.
2. With the app running (`npm start`):

```
node tools/import-novelcrafter.mjs "path\to\export - full.zip"
```

This creates a new novel with acts → chapters → scenes (titles, summaries, prose), the codex (type, aliases, tags,
description, "always include" / "no auto include") and the chat threads, then saves the history version
"Imported from NovelCrafter". Add `--dry-run` to only print counts, `--replace <novelId>` to re-import into an
existing novel (a "Before NovelCrafter re-import" version is saved first), `--help` for all options.

What the Markdown export does not contain: scene ↔ codex links (the chips on Plan cards), POV, labels,
snippets, codex images/relations. Scene links can be supplied with `--links links.json`
(`[{ "chapter": "<chapter title>", "scene": 1, "codex": ["Evelynn"] }]`, or `"chapterNo": 3` for untitled chapters); see
`../imports/2026-10-15/scene-links.json` for the one used for *Daughter Of The Sun*. A scene without a `---`
separator is read as summary only (use `--no-summaries` for exports made without summaries). Empty chat threads are
skipped. Chapters NovelCrafter shows unnumbered (e.g. "G01 - …") get regular numbers here.

## Data

Everything lives in `../data` (override with `NC_DATA_DIR`):

```
data/settings.json            connection + persona
data/prompts.json             your custom prompts
data/novels/<id>/novel.json   manuscript + codex
data/novels/<id>/chats.json   chat threads
data/novels/<id>/history/     versions
```

Plain JSON, so it's easy to back up or put in git. Port/host: `NC_PORT` (8787), `NC_HOST` (127.0.0.1;
set `0.0.0.0` to use it from other machines on your network).
