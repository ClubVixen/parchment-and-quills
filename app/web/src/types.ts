export type Pov = { type: string; character: string };

/** A run of prose. `beatId` ties it to one of the scene's beats (its section). */
export type TextBlock = { id: string; type: 'text'; text: string; beatId?: string };
/** A story beat: a short summary of what happens; its text is the blocks that point to it. */
export type Beat = { id: string; text: string; words?: string; promptId?: string; context?: ContextItem[] };
/** Old format (beat headings inside the text); converted to Beat + beatId on load. */
export type BeatBlock = { id: string; type: 'beat'; text: string; words?: string; promptId?: string; collapsed?: boolean; context?: ContextItem[] };
export type Block = TextBlock | BeatBlock;

export type Scene = {
  id: string;
  title: string;
  summary: string;
  includeInAI: boolean;
  pov: Pov | null;
  labels: string[];
  codexIds: string[];
  blocks: Block[];
  beats?: Beat[];
};
export type Chapter = { id: string; title: string; scenes: Scene[] };
export type Act = { id: string; title: string; chapters: Chapter[] };

export const CODEX_TYPES = ['character', 'location', 'object', 'lore', 'subplot', 'other'] as const;
export type CodexType = (typeof CODEX_TYPES)[number];

export type CodexEntry = {
  id: string;
  type: CodexType;
  name: string;
  aliases: string[];
  tags: string[];
  description: string;
  research?: string;
  alwaysInclude?: boolean;
  includeInAI?: boolean;
};

export type Novel = {
  id: string;
  title: string;
  author: string;
  language: string;
  tense: string;
  pov: Pov;
  povReminder?: boolean;
  voices?: NovelVoices;
  createdAt: string;
  updatedAt: string;
  acts: Act[];
  codex: CodexEntry[];
};

export type NovelSummary = { id: string; title: string; author: string; updatedAt: string; createdAt: string; words: number; codex: number; cover: number | null };

export type PromptInput = {
  name: string;
  key?: string;
  type: 'text' | 'number' | 'choice' | 'multi' | 'context' | 'scene';
  required?: boolean;
  options?: string[];
  default?: string;
  description?: string;
};
export type PromptMessage = { role: 'system' | 'user' | 'assistant'; content: string };
export type Prompt = {
  id: string;
  name: string;
  kind: 'beat' | 'summary' | 'replace' | 'chat' | 'component';
  system: boolean;
  messages: PromptMessage[];
  inputs: PromptInput[];
};

export type ContextItem =
  | { type: 'codex'; id: string }
  | { type: 'scene'; id: string }
  | { type: 'sceneSummary'; id: string }
  | { type: 'chapter'; id: string }
  | { type: 'outline' }
  | { type: 'manuscript' }
  | { type: 'text'; text: string };

export type ChatMessage = { id: string; role: 'user' | 'assistant'; content: string; reasoning?: string; model?: string; createdAt: string };
export type Thread = {
  id: string;
  title: string;
  promptId: string;
  inputs: Record<string, string | string[]>;
  context: ContextItem[];
  pinned: boolean;
  target?: EditTarget;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
};

export type Settings = {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number | null;
  maxTokens: number | null;
  disableThinking: boolean;
  persona: string;
  userName: string;
  avatar: string;
  tts: TtsSettings;
};

export type TtsSettings = {
  provider: 'chatterbox' | 'elevenlabs' | 'openai';
  baseUrl: string;
  apiKey: string;
  model: string;
  defaultVoice: string;
  exaggeration: number | null;
  cfgWeight: number | null;
  temperature: number | null;
};

/** Voice per speaker for read-aloud. `characters` maps codex entry id -> voice id. */
export type NovelVoices = { narrator?: string; characters?: Record<string, string> };

export type AudioSegment = { para: number; speaker: string; text: string; quote: boolean };
export type AudioScript = { chapterId: string; hash: string; mode: 'simple' | 'ai'; segments: AudioSegment[]; overrides?: Record<string, string> };

/** What a chat thread is allowed to edit. */
export type EditTarget = { type: 'scene' | 'chapter'; id: string } | null;

export type HistoryEntry = { file: string; savedAt: string; label: string; auto: boolean; words: number };

export type Task =
  | { kind: 'beat'; sceneId: string; beatId: string }
  | { kind: 'summary'; sceneId: string }
  | { kind: 'replace'; sceneId: string; blockId: string; start: number; end: number }
  | { kind: 'chat'; threadId: string; message?: string; retry?: boolean };

export type GenerateRequest = {
  novelId: string;
  promptId: string;
  model?: string;
  inputs?: Record<string, string | string[]>;
  context?: ContextItem[];
  target?: EditTarget;
  task: Task;
};
