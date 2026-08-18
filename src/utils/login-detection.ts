import fs from 'fs';
import type { Browser, Page } from 'playwright';

export type StorageStateValidity = {
  valid: boolean;
  reason?: string;
};

export type StorageStateProbeResult = StorageStateValidity & {
  currentUrl?: string;
};

const LOGIN_URL_PATTERN = /(?:^|[/?#&=._-])login(?:[/?#&=._-]|$)/i;
const LOGIN_TEXT_PATTERNS = [
  /账号登录/,
  /二维码登录/,
  /扫码登录/,
  /请输入手机号\/邮箱/,
  /用户协议/,
  /隐私协议/,
];
const LOGIN_TEXT_HIT_MIN = 2;

export function isLoginLikeUrl(url: string): boolean {
  return LOGIN_URL_PATTERN.test(url);
}

export function isLoginLikeRoute(route: string): boolean {
  return LOGIN_URL_PATTERN.test(route.replace(/_/g, '/')) || /(^|_)login($|_)/i.test(route);
}

export function validateStorageStateFile(storagePath: string): StorageStateValidity {
  if (!fs.existsSync(storagePath)) {
    return { valid: false, reason: `storageState 不存在: ${storagePath}` };
  }
  try {
    const stat = fs.statSync(storagePath);
    if (stat.size <= 10) {
      return { valid: false, reason: `storageState 文件过小: ${storagePath}` };
    }
    const state = JSON.parse(fs.readFileSync(storagePath, 'utf-8')) as {
      cookies?: unknown[];
      origins?: Array<{ localStorage?: unknown[] }>;
    };
    const cookieCount = liveCookieCount(state.cookies);
    const localStorageCount = Array.isArray(state.origins)
      ? state.origins.reduce((sum, origin) => sum + (Array.isArray(origin.localStorage) ? origin.localStorage.length : 0), 0)
      : 0;
    if (cookieCount === 0 && localStorageCount === 0) {
      return { valid: false, reason: `storageState 不含有效 cookies/localStorage: ${storagePath}` };
    }
    return { valid: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { valid: false, reason: `storageState 无法解析: ${message}` };
  }
}

function liveCookieCount(cookies: unknown[] | undefined): number {
  if (!Array.isArray(cookies)) return 0;
  const now = Date.now() / 1000;
  return cookies.filter((item) => {
    if (!item || typeof item !== 'object') return false;
    const expires = (item as { expires?: number }).expires;
    if (expires == null || expires < 0) return true;
    return expires > now;
  }).length;
}

export function isLoginLikeText(text: string): boolean {
  if (!text) return false;
  return LOGIN_TEXT_PATTERNS.filter((p) => p.test(text)).length >= LOGIN_TEXT_HIT_MIN;
}

export async function isLoginLikePage(page: Page): Promise<boolean> {
  const url = page.url();
  if (isLoginLikeUrl(url)) return true;
  try {
    for (const frame of page.frames()) {
      try {
        const text = await frame.evaluate(() => document.body?.innerText || '');
        if (isLoginLikeText(text)) return true;
      } catch {
        /* frame 可能已销毁 */
      }
    }
  } catch {
    /* 页面可能正在跳转 */
  }
  return false;
}

export async function assertNotLoginLikePage(page: Page, context: string): Promise<void> {
  if (!(await isLoginLikePage(page))) return;
  throw new Error(
    `检测到当前页面仍是登录页，已阻止截图以避免污染截图对比数据。请检查登录状态、账号密码或执行 PLAYWRIGHT_REFRESH_STORAGE=1 重新登录。上下文: ${context}，URL: ${page.url()}`,
  );
}

export async function probeStorageState(
  browser: Browser,
  storagePath: string,
  opts: { baseURL?: string; entry?: string } = {},
): Promise<StorageStateProbeResult> {
  const validity = validateStorageStateFile(storagePath);
  if (!validity.valid) return validity;
  const context = await browser.newContext({
    ...(opts.baseURL ? { baseURL: opts.baseURL } : {}),
    storageState: storagePath,
  });
  const page = await context.newPage();
  const target = opts.entry || '/';
  try {
    await page.goto(target, { waitUntil: 'load', timeout: 30_000 });
    await page.locator('iframe').first().waitFor({ state: 'attached', timeout: 8_000 }).catch(() => {});
    if (await isLoginLikePage(page)) {
      return {
        valid: false,
        reason: `storageState 已失效，当前仍处于登录页: ${page.url()}`,
        currentUrl: page.url(),
      };
    }
    return { valid: true, currentUrl: page.url() };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { valid: false, reason: `storageState 探测失败: ${message}`, currentUrl: page.url() };
  } finally {
    await context.close().catch(() => {});
  }
}
