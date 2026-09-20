export type AiProvider = 'anthropic' | 'deepseek' | 'openai';

export interface LlmConfig {
  provider: AiProvider;
  apiKey: string;
  model: string;
  baseUrl?: string;
}

export interface CompleteTextOptions {
  system?: string;
  temperature?: number;
  maxTokens?: number;
  /** 注入 fetch 以便离线测试重试/超时逻辑；默认 globalThis.fetch */
  fetchImpl?: typeof fetch;
}

function envValue(...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  return undefined;
}

function envInt(key: string, fallback: number): number {
  const v = Number.parseInt(process.env[key] ?? '', 10);
  return Number.isFinite(v) && v >= 0 ? v : fallback;
}

/** LLM 补全耗时远大于普通接口，超时给足（默认 120s）；覆盖：AI_TEST_TIMEOUT_MS */
const LLM_TIMEOUT_MS = () => envInt('AI_TEST_TIMEOUT_MS', 120_000);
/** 重试次数（不含首次），仅对 429/5xx/网络错误生效；覆盖：AI_TEST_RETRIES */
const LLM_RETRIES = () => envInt('AI_TEST_RETRIES', 2);
const LLM_BACKOFF_MS = 2_000;
const MAX_BACKOFF_MS = 30_000;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return '';
  }
}

/** 429 优先按 Retry-After（秒）退避，否则指数退避，封顶 MAX_BACKOFF_MS */
function retryDelayMs(res: Response | null, attempt: number): number {
  const ra = res?.headers.get('retry-after');
  if (ra) {
    const secs = Number(ra);
    if (Number.isFinite(secs) && secs > 0) return Math.min(secs * 1000, MAX_BACKOFF_MS);
  }
  return Math.min(LLM_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS);
}

/**
 * 带超时 + 指数退避重试的 POST JSON 请求。
 * - 超时经 AbortController 实现（默认 120s，LLM 补全慢）
 * - 仅对网络错误 / 超时 / 429 / 5xx 重试；其它 4xx（鉴权、请求非法）直接抛，重试无意义
 */
async function postJson<T>(
  label: string,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  fetchImpl: typeof fetch,
): Promise<T> {
  const timeout = LLM_TIMEOUT_MS();
  const retries = LLM_RETRIES();
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const isLast = attempt === retries;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    let res: Response | null = null;
    let networkError: Error | null = null;
    try {
      res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      networkError = err instanceof Error ? err : new Error(String(err));
    } finally {
      clearTimeout(timer);
    }

    if (networkError) {
      lastError = networkError;
      if (isLast) throw networkError;
      await sleep(retryDelayMs(null, attempt));
      continue;
    }

    const status = res!.status;
    if (status === 429 || status >= 500) {
      lastError = new Error(`${label} API ${status}: ${await safeText(res!)}`);
      if (isLast) throw lastError;
      await sleep(retryDelayMs(res!, attempt));
      continue;
    }
    if (!res!.ok) {
      throw new Error(`${label} API ${status}: ${await safeText(res!)}`);
    }
    return (await res!.json()) as T;
  }

  throw lastError ?? new Error(`${label} API request failed`);
}

export function buildChatCompletionsUrl(baseUrl: string | undefined, defaultBase: string): string {
  const base = (baseUrl || defaultBase).replace(/\/$/, '');
  if (base.endsWith('/chat/completions')) return base;
  if (base.endsWith('/v1') || base.endsWith('/v3')) return `${base}/chat/completions`;
  return `${base}/v1/chat/completions`;
}

export function resolveLlmConfig(providerHint?: string): LlmConfig {
  const provider = (providerHint || envValue('AI_TEST_PROVIDER') || 'deepseek') as AiProvider;

  if (provider === 'anthropic') {
    const apiKey = envValue('AI_TEST_ANTHROPIC_API_KEY', 'ANTHROPIC_API_KEY');
    const model = envValue('AI_TEST_MODEL', 'ANTHROPIC_MODEL') || 'claude-sonnet-4-20250514';
    if (!apiKey) throw new Error('未配置 Anthropic API Key，请设置 ANTHROPIC_API_KEY');
    return { provider, apiKey, model, baseUrl: envValue('AI_TEST_ANTHROPIC_BASE_URL', 'ANTHROPIC_API_BASE') };
  }

  if (provider === 'openai') {
    const apiKey = envValue('AI_TEST_OPENAI_API_KEY', 'OPENAI_API_KEY');
    const model = envValue('AI_TEST_MODEL', 'OPENAI_MODEL') || 'gpt-4.1';
    if (!apiKey) throw new Error('未配置 OpenAI API Key，请设置 OPENAI_API_KEY');
    return { provider, apiKey, model, baseUrl: envValue('AI_TEST_OPENAI_BASE_URL', 'OPENAI_API_BASE') };
  }

  const apiKey = envValue('AI_TEST_DEEPSEEK_API_KEY', 'DEEPSEEK_API_KEY');
  const model = envValue('AI_TEST_MODEL', 'DEEPSEEK_MODEL') || 'deepseek-chat';
  if (!apiKey) throw new Error('未配置 DeepSeek API Key，请设置 DEEPSEEK_API_KEY');
  return { provider, apiKey, model, baseUrl: envValue('AI_TEST_DEEPSEEK_BASE_URL', 'DEEPSEEK_API_BASE') };
}

export async function completeText(prompt: string, options: CompleteTextOptions = {}): Promise<string> {
  const config = resolveLlmConfig();
  const system = options.system?.trim();
  const temperature = options.temperature ?? 0.1;
  const maxTokens = options.maxTokens ?? 8000;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  if (config.provider === 'anthropic') {
    const base = (config.baseUrl || 'https://api.anthropic.com').replace(/\/$/, '');
    const json = await postJson<{ content?: { type: string; text?: string }[] }>(
      'Anthropic',
      `${base}/v1/messages`,
      {
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
      },
      {
        model: config.model,
        max_tokens: maxTokens,
        temperature,
        ...(system ? { system } : {}),
        messages: [{ role: 'user', content: prompt }],
      },
      fetchImpl,
    );
    return json.content?.find((block) => block.type === 'text')?.text || '';
  }

  const defaultBase =
    config.provider === 'deepseek' ? 'https://api.deepseek.com' : 'https://api.openai.com';
  const url = buildChatCompletionsUrl(config.baseUrl, defaultBase);
  const messages = [
    ...(system ? [{ role: 'system', content: system }] : []),
    { role: 'user', content: prompt },
  ];

  const json = await postJson<{ choices?: { message?: { content?: string } }[] }>(
    config.provider,
    url,
    { Authorization: `Bearer ${config.apiKey}` },
    {
      model: config.model,
      messages,
      temperature,
      max_tokens: maxTokens,
      stream: false,
    },
    fetchImpl,
  );
  return json.choices?.[0]?.message?.content || '';
}

export function extractFirstJsonValue(text: string): string {
  const trimmed = text.trim();
  const start = trimmed.search(/[[{]/);
  if (start < 0) return trimmed;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') {
      depth--;
      if (depth === 0) return trimmed.slice(start, i + 1);
    }
  }

  return trimmed.slice(start);
}

export function stripJsonFence(text: string): string {
  const trimmed = text.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence?.[1]?.trim() ?? trimmed;
  return extractFirstJsonValue(body);
}

export async function completeJson<T>(
  prompt: string,
  options: CompleteTextOptions = {},
): Promise<T> {
  const raw = await completeText(prompt, options);
  const jsonText = stripJsonFence(raw);
  try {
    return JSON.parse(jsonText) as T;
  } catch (error) {
    throw new Error(`模型返回的不是合法 JSON: ${error instanceof Error ? error.message : String(error)}\n${raw.slice(0, 800)}`);
  }
}
