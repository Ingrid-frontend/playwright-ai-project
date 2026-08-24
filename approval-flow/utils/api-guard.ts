import type { Page, Request, Response } from '@playwright/test';

export type ApiFailureKind = 'http' | 'business' | 'requestfailed';

export type ApiFailure = {
  kind: ApiFailureKind;
  url: string;
  method: string;
  status?: number;
  bodySummary?: string;
  errorText?: string;
};

export type ApiGuardOptions = {
  /** 仅匹配这些 URL；默认关注 /api、/report/api 等业务接口 */
  urlIncludes?: RegExp[];
  /** 忽略静态资源、埋点等 */
  urlIgnores?: RegExp[];
  /** HTTP 状态码视为失败；默认 >= 400 */
  failStatusFrom?: number;
  /** 是否解析 JSON 业务失败（success:false / 非 0 code 等） */
  checkBusinessBody?: boolean;
  /** body 摘要最大字符数 */
  bodySummaryMaxLen?: number;
};

const DEFAULT_URL_INCLUDES: RegExp[] = [
  /\/api\b/i,
  /\/report\/api\b/i,
  /\/oauth\b/i,
];

const DEFAULT_URL_IGNORES: RegExp[] = [
  /\.(?:js|css|mjs|map|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|eot|mp4|webm)(?:\?|$)/i,
  /(?:sensorsdata|google-analytics|googletagmanager|gtag\/|hm\.baidu|sentry\.io|browser-intake)/i,
  /(?:hotjar|fullstory|segment\.io|clarity\.ms|facebook\.net|doubleclick)/i,
  /\/tongji\b|\/analysis\/track/i,
  // 性能/埋点监控，失败不影响业务用例（如 call minos fail）
  /\/api\/monitor\/performance\b/i,
  /\/monitor\/performance\b/i,
  // 工作台可选小组件，dev 上 404，与审批列表无关
  /\/mobile\/api\/work\/widget\/global-entry\/find\b/i,
];

/** 展示用 URL：保留 path + 有意义的 query，去掉 hlyRequestID 等噪声 */
function pathnameOf(url: string): string {
  try {
    const u = new URL(url);
    const drop = new Set(['hlyRequestID', 'hlyrequestid']);
    const kept: string[] = [];
    u.searchParams.forEach((value, key) => {
      if (drop.has(key)) return;
      kept.push(`${key}=${value}`);
    });
    return kept.length ? `${u.pathname}?${kept.join('&')}` : u.pathname;
  } catch {
    return url;
  }
}

function truncate(text: string, max: number): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  if (oneLine.length <= max) return oneLine;
  return `${oneLine.slice(0, max)}…`;
}

/**
 * 识别常见业务失败体：
 * - success === false
 * - code / errorCode 表示失败（非 0/200/"0"/"OK"）
 * - HTTP 已是 4xx/5xx 时也会附带 message 摘要
 */
export function detectBusinessFailure(data: unknown): string | null {
  if (data == null || typeof data !== 'object' || Array.isArray(data)) return null;
  const obj = data as Record<string, unknown>;

  if (obj.success === false) {
    const msg = pickMessage(obj);
    return msg || 'success:false';
  }

  if ('success' in obj && obj.success === true) return null;

  const code = obj.code ?? obj.errorCode ?? obj.errCode;
  if (code !== undefined && code !== null && code !== '') {
    const okCodes = new Set([0, 200, '0', '200', 'OK', 'ok', 'SUCCESS', 'success']);
    if (!okCodes.has(code as string | number)) {
      if (typeof code === 'number' || (typeof code === 'string' && /^\d+$/.test(code))) {
        const msg = pickMessage(obj);
        return msg || `code=${String(code)}`;
      }
      if (typeof code === 'string' && pickMessage(obj)) {
        return `${code}: ${pickMessage(obj)}`;
      }
    }
  }

  return null;
}

function pickMessage(obj: Record<string, unknown>): string | null {
  for (const key of ['message', 'errorMessage', 'msg', 'errorMsg', 'error']) {
    const v = obj[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

export class ApiGuard {
  private readonly failures: ApiFailure[] = [];
  private readonly pending = new Set<Promise<void>>();
  private attached = false;
  private collecting = false;
  private readonly options: Required<ApiGuardOptions>;

  private onResponse = (response: Response) => {
    if (!this.collecting) return;
    const task = this.handleResponse(response).catch(() => undefined);
    this.pending.add(task);
    void task.finally(() => this.pending.delete(task));
  };

  private onRequestFailed = (request: Request) => {
    if (!this.collecting) return;
    const url = request.url();
    if (!this.shouldWatch(url)) return;
    const failure: string | null = request.failure()?.errorText ?? 'requestfailed';
    // 切页签会 abort 上一次列表请求，不算业务失败
    if (failure && /ERR_ABORTED|NS_BINDING_ABORTED/i.test(failure)) return;
    this.failures.push({
      kind: 'requestfailed',
      url: pathnameOf(url),
      method: request.method(),
      errorText: failure,
    });
  };

  constructor(
    private readonly page: Page,
    options: ApiGuardOptions = {}
  ) {
    this.options = {
      urlIncludes: options.urlIncludes ?? DEFAULT_URL_INCLUDES,
      urlIgnores: options.urlIgnores ?? DEFAULT_URL_IGNORES,
      failStatusFrom: options.failStatusFrom ?? 400,
      checkBusinessBody: options.checkBusinessBody ?? true,
      bodySummaryMaxLen: options.bodySummaryMaxLen ?? 280,
    };
  }

  attach(): void {
    if (this.attached) return;
    this.page.on('response', this.onResponse);
    this.page.on('requestfailed', this.onRequestFailed);
    this.attached = true;
  }

  detach(): void {
    if (!this.attached) return;
    this.page.off('response', this.onResponse);
    this.page.off('requestfailed', this.onRequestFailed);
    this.attached = false;
  }

  /** 开始收集（清空历史失败） */
  start(): void {
    this.attach();
    this.failures.length = 0;
    this.collecting = true;
  }

  /** 停止收集（不清空，便于 assert） */
  stopCollecting(): void {
    this.collecting = false;
  }

  getFailures(): readonly ApiFailure[] {
    return this.failures;
  }

  async flush(): Promise<void> {
    await Promise.all([...this.pending]);
  }

  async assertNoFailures(label = 'API'): Promise<void> {
    this.stopCollecting();
    await this.flush();
    if (this.failures.length === 0) return;

    const lines = this.failures.map((f, i) => {
      const status = f.status != null ? ` status=${f.status}` : '';
      const body = f.bodySummary ? ` body=${f.bodySummary}` : '';
      const err = f.errorText ? ` error=${f.errorText}` : '';
      return `  ${i + 1}. [${f.kind}] ${f.method} ${f.url}${status}${err}${body}`;
    });

    throw new Error(
      `${label} 监听发现 ${this.failures.length} 个失败接口：\n${lines.join('\n')}`
    );
  }

  private shouldWatch(url: string): boolean {
    if (this.options.urlIgnores.some((re) => re.test(url))) return false;
    return this.options.urlIncludes.some((re) => re.test(url));
  }

  private async handleResponse(response: Response): Promise<void> {
    const url = response.url();
    if (!this.shouldWatch(url)) return;

    const request = response.request();
    const method = request.method();
    const status = response.status();
    const shortUrl = pathnameOf(url);

    if (status >= 300 && status < this.options.failStatusFrom) return;

    let bodySummary: string | undefined;
    let businessMsg: string | null = null;

    const contentType = response.headers()['content-type'] || '';
    const maybeJson = /json/i.test(contentType) || status >= this.options.failStatusFrom;

    if (maybeJson && (status >= this.options.failStatusFrom || this.options.checkBusinessBody)) {
      try {
        const text = await response.text();
        if (text) {
          bodySummary = truncate(text, this.options.bodySummaryMaxLen);
          if (this.options.checkBusinessBody) {
            try {
              businessMsg = detectBusinessFailure(JSON.parse(text));
            } catch {
              /* 非 JSON */
            }
          }
        }
      } catch {
        /* 读 body 失败忽略 */
      }
    }

    if (status >= this.options.failStatusFrom) {
      if (status === 400 && /请求速度过快|"9960"/.test(bodySummary || '')) return;
      this.failures.push({
        kind: 'http',
        url: shortUrl,
        method,
        status,
        bodySummary: bodySummary || (businessMsg ?? undefined),
      });
      return;
    }

    if (businessMsg && status >= 200 && status < 300) {
      this.failures.push({
        kind: 'business',
        url: shortUrl,
        method,
        status,
        bodySummary: bodySummary || businessMsg,
      });
    }
  }
}

/** 在 Page 上创建并 attach ApiGuard（worker 级 page 可复用同一实例，每次 test start 清空） */
export function createApiGuard(page: Page, options?: ApiGuardOptions): ApiGuard {
  const guard = new ApiGuard(page, options);
  guard.attach();
  return guard;
}
