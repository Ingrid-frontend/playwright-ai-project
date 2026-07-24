import fs from 'fs';
import type { Page } from '@playwright/test';

export type StorageStateValidity = {
  valid: boolean;
  reason?: string;
};

const LOGIN_URL_PATTERN = /(?:^|[/?#&=._-])login(?:[/?#&=._-]|$)/i;
const LOGIN_TEXT_PATTERNS = [
  /账号登录/,
  /请输入手机号\/邮箱/,
  /用户协议/,
  /隐私协议/,
];

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
    const cookieCount = Array.isArray(state.cookies) ? state.cookies.length : 0;
    const localStorageCount = Array.isArray(state.origins)
      ? state.origins.reduce((sum, origin) => sum + (Array.isArray(origin.localStorage) ? origin.localStorage.length : 0), 0)
      : 0;
    if (cookieCount === 0 && localStorageCount === 0) {
      return { valid: false, reason: `storageState 不含 cookies/localStorage: ${storagePath}` };
    }
    return { valid: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { valid: false, reason: `storageState 无法解析: ${message}` };
  }
}

export async function isLoginLikePage(page: Page): Promise<boolean> {
  const url = page.url();
  if (isLoginLikeUrl(url)) return true;
  try {
    const visibleSignals = await page.evaluate((patterns) => {
      const text = document.body?.innerText || '';
      return patterns.filter((p) => new RegExp(p).test(text)).length;
    }, LOGIN_TEXT_PATTERNS.map((p) => p.source));
    if (visibleSignals >= 2) return true;
  } catch {
    // 页面可能正在跳转或 frame 被销毁，降级为 false
  }
  return false;
}

export async function assertNotLoginLikePage(page: Page, context: string): Promise<void> {
  if (!(await isLoginLikePage(page))) return;
  throw new Error(
    `检测到当前页面仍是登录页，已阻止截图以避免污染截图对比数据。请检查登录状态、账号密码或执行 PLAYWRIGHT_REFRESH_STORAGE=1 重新登录。上下文: ${context}，URL: ${page.url()}`,
  );
}
