const DEEPSEEK_API_BASE = (process.env.DEEPSEEK_API_BASE || 'https://api.deepseek.com').replace(/\/$/, '');
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';

async function streamDeepSeekChat(prompt, onChunk, apiKeyOverride, { signal } = {}) {
  const apiKey = apiKeyOverride || process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY 未配置');
  signal?.throwIfAborted();

  const url = `${DEEPSEEK_API_BASE}/chat/completions`;
  const res = await fetch(url, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      messages: [{ role: 'user', content: prompt }],
      stream: true,
    }),
  });

  if (!res.body) throw new Error(`DeepSeek API ${res.status}: 响应正文为空`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let cancelled = false;
  let rejectAbort;
  const aborted = new Promise((_, reject) => { rejectAbort = reject; });
  // Abort can occur between reads, before a Promise.race has subscribed.
  aborted.catch(() => {});
  const cancelReader = () => {
    if (cancelled) return;
    cancelled = true;
    // Do not let a stalled transport's cancel promise defeat the total deadline.
    try { Promise.resolve(reader.cancel()).catch(() => {}); } catch { /* already closed */ }
  };
  const onAbort = () => {
    cancelReader();
    rejectAbort(signal.reason || Object.assign(new Error('DeepSeek 请求已取消'), { name: 'AbortError' }));
  };
  signal?.addEventListener('abort', onAbort, { once: true });

  function consumeLine(line) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) return false;
    const data = trimmed.slice(5).trim();
    if (data === '[DONE]') return true;
    let json;
    try { json = JSON.parse(data); } catch { return false; }
    const piece = json.choices?.[0]?.delta?.content;
    signal?.throwIfAborted();
    if (piece) onChunk(piece);
    return false;
  }

  try {
    if (signal?.aborted) onAbort();
    while (true) {
      signal?.throwIfAborted();
      const { done, value } = await Promise.race([reader.read(), aborted]);
      signal?.throwIfAborted();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      if (!res.ok) {
        if (buffer.length >= 240) break;
        continue;
      }
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (consumeLine(line)) return;
      }
    }
    buffer += decoder.decode();
    if (!res.ok) throw new Error(`DeepSeek API ${res.status}: ${buffer.slice(0, 240)}`);
    if (buffer.trim()) consumeLine(buffer);
  } finally {
    signal?.removeEventListener('abort', onAbort);
    cancelReader();
    reader.releaseLock();
  }
}

module.exports = { streamDeepSeekChat };
