import { setTimeout as delay } from 'node:timers/promises';

export type AiProvider = 'anthropic' | 'deepseek' | 'openai';

export interface LlmConfig {
  provider: AiProvider;
  apiKey: string;
  model: string;
  baseUrl?: string;
}

export interface AiBudgetOptions {
  /** Unix 毫秒绝对截止时间；默认从创建起 10 分钟，仅限制 AI 调用。 */
  deadline?: number;
  /** HTTP 尝试总数（含重试、解析及自愈），默认 20。 */
  maxCalls?: number;
  signal?: AbortSignal;
}

export interface AiBudget {
  readonly deadline: number;
  readonly maxCalls: number;
  readonly signal?: AbortSignal;
  readonly callsUsed: number;
  assertAvailable(): void;
  consumeCall(): void;
}

export class AiBudgetExceededError extends Error {
  constructor(readonly kind: 'deadline' | 'maxCalls') {
    super(kind === 'deadline' ? 'AI budget deadline exceeded' : 'AI budget maxCalls exhausted');
    this.name = 'AiBudgetExceededError';
  }
}

/** 每轮创建并显式传递；不使用进程级可变预算。 */
export function createAiBudget(options: AiBudgetOptions = {}): AiBudget {
  const deadline = options.deadline ?? Date.now() + 10 * 60_000;
  const maxCalls = options.maxCalls ?? 20;
  if (!Number.isFinite(deadline)) throw new RangeError('AI deadline must be finite Unix milliseconds');
  if (!Number.isSafeInteger(maxCalls) || maxCalls < 0) throw new RangeError('AI maxCalls must be a non-negative integer');
  let callsUsed = 0;
  const budget: AiBudget = {
    deadline,
    maxCalls,
    signal: options.signal,
    get callsUsed() { return callsUsed; },
    assertAvailable() {
      budget.signal?.throwIfAborted();
      if (Date.now() >= deadline) throw new AiBudgetExceededError('deadline');
      if (callsUsed >= maxCalls) throw new AiBudgetExceededError('maxCalls');
    },
    consumeCall() {
      budget.assertAvailable();
      callsUsed++;
    },
  };
  return Object.freeze(budget);
}

export interface CompleteTextOptions {
  system?: string;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  /** Unix 毫秒绝对截止时间，覆盖所有尝试、body 读取及退避；与 budget 取更早值。 */
  deadline?: number;
  budget?: AiBudget;
  /** 注入 fetch 以便离线测试重试/超时逻辑；默认 globalThis.fetch */
  fetchImpl?: typeof fetch;
}

type AiControlOptions = Pick<CompleteTextOptions, 'signal' | 'budget'>;

export function throwIfAiCancelled(options: AiControlOptions): void {
  options.signal?.throwIfAborted();
  options.budget?.signal?.throwIfAborted();
}

function checkAiDeadline(options: CompleteTextOptions): void {
  throwIfAiCancelled(options);
  for (const deadline of [options.deadline, options.budget?.deadline]) {
    if (deadline === undefined) continue;
    if (!Number.isFinite(deadline)) throw new RangeError('AI deadline must be finite Unix milliseconds');
    if (Date.now() >= deadline) throw new AiBudgetExceededError('deadline');
  }
}

/** runtime 的自愈/可选步骤不能把取消或预算耗尽降级为普通失败。 */
export function rethrowAiControlError(error: unknown, options: AiControlOptions): void {
  throwIfAiCancelled(options);
  if (error instanceof AiBudgetExceededError || (error instanceof Error && error.name === 'AbortError')) {
    throw error;
  }
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
/** 重试次数（不含首次），仅对 429/5xx/网络错误/单次超时生效；覆盖：AI_TEST_RETRIES */
const LLM_RETRIES = () => envInt('AI_TEST_RETRIES', 2);
const LLM_BACKOFF_MS = 2_000;
const MAX_BACKOFF_MS = 30_000;

class LlmTimeoutError extends Error {
  constructor(timeout: number) {
    super(`LLM request timed out after ${timeout}ms (including response body)`);
    this.name = 'TimeoutError';
  }
}

class HttpError extends Error {}

function retryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

function isNetworkError(error: unknown): boolean {
  if (error instanceof TypeError) return true; // fetch/body 流的网络失败
  const code = (error as { code?: string } | null)?.code;
  return typeof code === 'string' && /^(ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|ENOTFOUND|EAI_AGAIN|UND_ERR_.*)$/.test(code);
}

/** 显式释放计时器/外部监听器；绝对 deadline 不会在重试时重新起算。 */
function abortScope(signals: (AbortSignal | undefined)[], deadline?: number, reason?: Error) {
  const controller = new AbortController();
  const cleanups: (() => void)[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  for (const signal of signals) {
    if (!signal) continue;
    if (signal.aborted) {
      controller.abort(signal.reason);
      break;
    }
    const onAbort = () => controller.abort(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    cleanups.push(() => signal.removeEventListener('abort', onAbort));
  }
  const schedule = () => {
    if (deadline === undefined || controller.signal.aborted) return;
    const remaining = deadline - Date.now();
    if (remaining <= 0) controller.abort(reason);
    else timer = setTimeout(schedule, Math.min(remaining, 2_147_483_647));
  };
  schedule();
  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timer);
      for (const cleanup of cleanups) cleanup();
    },
  };
}

/** 也保护不响应 signal 的注入 fetch/body；迟到的拒绝由 race 接住。 */
async function abortable<T>(signal: AbortSignal, operation: () => Promise<T>): Promise<T> {
  signal.throwIfAborted();
  let onAbort!: () => void;
  const cancelled = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([operation(), cancelled]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

async function safeText(res: Response, signal: AbortSignal): Promise<string> {
  try {
    const text = await res.text();
    signal.throwIfAborted();
    return text.slice(0, 500);
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof Error && error.name === 'AbortError') throw error;
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

/** 单次 120s（含 body）+ 默认两次重试；总 deadline 和外部取消均不可重试。 */
async function postJson<T>(
  label: string,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  options: CompleteTextOptions,
): Promise<T> {
  const timeout = LLM_TIMEOUT_MS();
  const retries = LLM_RETRIES();
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const deadlines = [options.deadline, options.budget?.deadline].filter((v): v is number => v !== undefined);
  if (deadlines.some((v) => !Number.isFinite(v))) throw new RangeError('AI deadline must be finite Unix milliseconds');
  const deadline = deadlines.length ? Math.min(...deadlines) : undefined;
  const total = abortScope([options.signal, options.budget?.signal], deadline, new AiBudgetExceededError('deadline'));
  const checkTotal = () => {
    total.signal.throwIfAborted();
    if (deadline !== undefined && Date.now() >= deadline) throw new AiBudgetExceededError('deadline');
  };

  try {
    checkTotal();
    const payload = JSON.stringify(body);
    for (let attempt = 0; attempt <= retries; attempt++) {
      checkTotal();
      options.budget?.assertAvailable();
      const request = abortScope([total.signal], Date.now() + timeout, new LlmTimeoutError(timeout));
      let res: Response | undefined;
      try {
        return await abortable(request.signal, async () => {
          options.budget?.consumeCall();
          res = await fetchImpl(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...headers },
            body: payload,
            signal: request.signal,
          });
          request.signal.throwIfAborted();
          if (!res.ok) throw new HttpError(`${label} API ${res.status}: ${await safeText(res, request.signal)}`);
          const json = await res.json() as T;
          request.signal.throwIfAborted();
          checkTotal();
          return json;
        });
      } catch (error) {
        checkTotal();
        rethrowAiControlError(error, options);
        // 已收到非重试状态时，连错误 body 超时也不能变成重试。
        if (res && !res.ok && !retryableStatus(res.status)) throw error;
        const retryable = error instanceof LlmTimeoutError || isNetworkError(error) ||
          (error instanceof HttpError && res !== undefined && retryableStatus(res.status));
        if (!retryable || attempt === retries) throw error;
      } finally {
        request.dispose(); // body 完成/失败之后才解除本次超时
      }

      checkTotal();
      options.budget?.assertAvailable(); // 无额度时，不先白等一次退避
      const waitMs = retryDelayMs(res ?? null, attempt);
      if (deadline !== undefined && Date.now() + waitMs >= deadline) throw new AiBudgetExceededError('deadline');
      try {
        await delay(waitMs, undefined, { signal: total.signal });
      } catch (error) {
        checkTotal(); // 保留调用者的原始 abort reason，而非 timers 的包装错误
        throw error;
      }
    }
    throw new Error(`${label} API request failed`);
  } finally {
    total.dispose();
  }
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
  checkAiDeadline(options);
  options.budget?.assertAvailable();
  const config = resolveLlmConfig();
  const system = options.system?.trim();
  const temperature = options.temperature ?? 0.1;
  const maxTokens = options.maxTokens ?? 8000;

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
      options,
    );
    checkAiDeadline(options);
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
    options,
  );
  checkAiDeadline(options);
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
  checkAiDeadline(options);
  const jsonText = stripJsonFence(raw);
  let value: T;
  try {
    value = JSON.parse(jsonText) as T;
  } catch (error) {
    throw new Error(`模型返回的不是合法 JSON: ${error instanceof Error ? error.message : String(error)}\n${raw.slice(0, 800)}`);
  }
  checkAiDeadline(options);
  return value;
}
