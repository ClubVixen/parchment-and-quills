// OpenAI-compatible client for the local vLLM server. Streams `reasoning` and `content` deltas separately.

function endpoint(settings, p) {
  return settings.baseUrl.replace(/\/+$/, '') + p;
}
function headers(settings) {
  return { 'Content-Type': 'application/json', ...(settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {}) };
}

export async function listModels(settings) {
  const res = await fetch(endpoint(settings, '/models'), { headers: headers(settings), signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Model list failed: HTTP ${res.status}`);
  const json = await res.json();
  return (json.data || []).map((m) => ({ id: m.id, maxLen: m.max_model_len ?? null }));
}

/**
 * Stream a chat completion. Calls onDelta({ reasoning?, content? }) per chunk.
 * Body mirrors NovelCrafter (model + stream + messages); optional settings are only added when set.
 */
export async function streamChat(settings, { model, messages }, onDelta, signal) {
  const body = { model: model || settings.model, stream: true, messages };
  if (settings.temperature != null && settings.temperature !== '') body.temperature = Number(settings.temperature);
  if (settings.maxTokens) body.max_tokens = Number(settings.maxTokens);
  if (settings.disableThinking) body.chat_template_kwargs = { enable_thinking: false };

  const res = await fetch(endpoint(settings, '/chat/completions'), { method: 'POST', headers: headers(settings), body: JSON.stringify(body), signal });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`AI server returned HTTP ${res.status}: ${text.slice(0, 500)}`);
  }
  const decoder = new TextDecoder();
  let buf = '', content = '', reasoning = '', finish = null, usage = null;
  for await (const chunk of res.body) {
    buf += decoder.decode(chunk, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') continue;
      let json;
      try { json = JSON.parse(data); } catch { continue; }
      if (json.usage) usage = json.usage;
      const choice = json.choices?.[0];
      if (!choice) continue;
      const d = choice.delta || {};
      const r = d.reasoning ?? d.reasoning_content;
      if (r) { reasoning += r; onDelta({ reasoning: r }); }
      if (d.content) { content += d.content; onDelta({ content: d.content }); }
      if (choice.finish_reason) finish = choice.finish_reason;
    }
  }
  return { content, reasoning, finish, usage, model: body.model };
}
