/**
 * 飞书 API 共享工具：带超时与重试的 fetch 封装
 */

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_RETRIES = 2;
const DEFAULT_BACKOFF_MS = 1_000;

export interface FetchWithRetryOptions extends RequestInit {
  /** 请求超时毫秒数（默认 15s） */
  timeout?: number;
  /** 重试次数（默认 2） */
  retries?: number;
  /** 退避基数毫秒（默认 1000，指数退避：1s, 2s, 4s…） */
  backoffMs?: number;
}

/**
 * 带超时和指数退避重试的 fetch 封装。
 * - 超时通过 AbortController 实现
 * - 仅对网络错误、超时、5xx 进行重试；4xx 不重试
 */
export async function fetchWithRetry(
  url: string,
  opts: FetchWithRetryOptions = {},
): Promise<Response> {
  const { timeout = DEFAULT_TIMEOUT_MS, retries = DEFAULT_RETRIES, backoffMs = DEFAULT_BACKOFF_MS, ...fetchOpts } = opts;

  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const res = await fetch(url, { ...fetchOpts, signal: controller.signal });
      clearTimeout(timer);
      // 5xx 服务端错误可重试
      if (res.status >= 500 && attempt < retries) {
        lastError = new Error(`HTTP ${res.status}`);
        await sleep(backoffMs * Math.pow(2, attempt));
        continue;
      }
      return res;
    } catch (err: unknown) {
      clearTimeout(timer);
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < retries) {
        await sleep(backoffMs * Math.pow(2, attempt));
      }
    }
  }
  throw lastError ?? new Error('fetchWithRetry: 未知错误');
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
