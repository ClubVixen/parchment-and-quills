import type { AudioScript, FunctionDoc, GenerateRequest, HistoryEntry, Novel, NovelSummary, Prompt, PromptMessage, Settings, Thread } from './types';

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data as T;
}

export const api = {
  settings: () => call<Settings>('GET', '/settings'),
  saveSettings: (s: Partial<Settings>) => call<Settings>('PUT', '/settings', s),
  models: () => call<{ id: string; maxLen: number | null }[]>('GET', '/models'),
  prompts: () => call<Prompt[]>('GET', '/prompts'),
  saveCustomPrompts: (list: Prompt[]) => call<Prompt[]>('PUT', '/prompts/custom', list),
  templateFunctions: () => call<FunctionDoc[]>('GET', '/template-functions'),

  novels: () => call<NovelSummary[]>('GET', '/novels'),
  createNovel: (opts: { title: string; author: string; language: string }) => call<Novel>('POST', '/novels', opts),
  novel: (id: string) => call<Novel>('GET', `/novels/${id}`),
  saveNovel: (n: Novel) => call<{ updatedAt: string }>('PUT', `/novels/${n.id}`, n),
  deleteNovel: (id: string) => call<{ ok: true }>('DELETE', `/novels/${id}`),

  history: (id: string) => call<HistoryEntry[]>('GET', `/novels/${id}/history`),
  snapshot: (id: string, label: string) => call<HistoryEntry>('POST', `/novels/${id}/history`, { label }),
  version: (id: string, file: string) => call<{ savedAt: string; label: string; novel: Novel }>('GET', `/novels/${id}/history/${file}`),
  labelVersion: (id: string, file: string, label: string) => call('PATCH', `/novels/${id}/history/${file}`, { label }),
  restore: (id: string, file: string, sceneId?: string) => call<Novel>('POST', `/novels/${id}/history/${file}/restore`, { sceneId }),

  chats: (id: string) => call<Thread[]>('GET', `/novels/${id}/chats`),
  newThread: (id: string, promptId?: string) => call<Thread>('POST', `/novels/${id}/chats`, { promptId }),
  updateThread: (id: string, tid: string, patch: Partial<Thread>) => call<Thread>('PATCH', `/novels/${id}/chats/${tid}`, patch),
  deleteThread: (id: string, tid: string) => call('DELETE', `/novels/${id}/chats/${tid}`),
  deleteMessage: (id: string, tid: string, mid: string) => call<Thread>('DELETE', `/novels/${id}/chats/${tid}/messages/${mid}`),

  setCover: (id: string, dataUrl: string) => call<{ cover: number }>('PUT', `/novels/${id}/cover`, { dataUrl }),
  removeCover: (id: string) => call<{ cover: null }>('DELETE', `/novels/${id}/cover`),
  coverUrl: (id: string, v: number) => `/api/novels/${id}/cover?v=${v}`,

  voices: () => call<{ id: string; name: string }[]>('GET', '/tts/voices'),
  audioScript: (id: string, chapterId: string) => call<AudioScript>('GET', `/novels/${id}/audio/${chapterId}`),
  saveOverrides: (id: string, chapterId: string, overrides: Record<string, string>) => call<AudioScript>('PUT', `/novels/${id}/audio/${chapterId}`, { overrides }),
  aiSpeakers: (id: string, chapterId: string) => call<AudioScript & { labelled: number }>('POST', `/novels/${id}/audio/${chapterId}/ai`),
  /** Speech for one piece of text, as an object URL ready for an <audio> element. */
  async speak(text: string, voice: string, signal?: AbortSignal) {
    const res = await fetch('/api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, voice }), signal });
    if (!res.ok) { const t = await res.text(); throw new Error((t && JSON.parse(t).error) || `HTTP ${res.status}`); }
    return URL.createObjectURL(await res.blob());
  },

  preview: (req: GenerateRequest) => call<{ messages: PromptMessage[]; codex: string[] }>('POST', '/preview', req),
};

export type StreamHandlers = {
  onMeta?: (m: { codex: string[]; messageCount: number; promptTokensApprox: number }) => void;
  onDelta?: (d: { reasoning?: string; content?: string }) => void;
};
export type StreamResult = { content: string; reasoning: string; finish: string | null; model: string };

/** POST /api/generate and read the server-sent events. Resolves with the final result; rejects on error. */
export async function generate(req: GenerateRequest, h: StreamHandlers, signal?: AbortSignal): Promise<StreamResult> {
  const res = await fetch('/api/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req), signal });
  if (!res.ok || !res.body) {
    const t = await res.text();
    throw new Error((t && JSON.parse(t).error) || `HTTP ${res.status}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let done: StreamResult | null = null;
  for (;;) {
    const { value, done: end } = await reader.read();
    if (end) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const raw = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const ev = raw.match(/^event: (\w+)/m)?.[1];
      const data = JSON.parse(raw.match(/^data: (.*)$/m)?.[1] || 'null');
      if (ev === 'meta') h.onMeta?.(data);
      else if (ev === 'delta') h.onDelta?.(data);
      else if (ev === 'done') done = data;
      else if (ev === 'error') throw new Error(data.message);
    }
  }
  if (!done) throw new Error('Generation stopped');
  return done;
}
