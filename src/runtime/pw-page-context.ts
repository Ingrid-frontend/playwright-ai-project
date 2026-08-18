import type { Browser, Page } from 'playwright';
import { waitForContentReady, waitForPostInteractionPaint, waitForRouteStable } from '../utils/screenshot-wait.js';
import { probeStorageState, type StorageStateProbeResult } from '../utils/login-detection.js';

export type FrameTextSample = {
  scope: 'page' | 'iframe';
  frameIndex: number;
  url: string;
  text: string;
};

export async function waitForPwReady(page: Page, opts: { afterNav?: boolean } = {}): Promise<void> {
  await page.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: opts.afterNav ? 8_000 : 3_000 }).catch(() => {});
  await page.locator('.ant-spin-spinning, .ant-loading').first().waitFor({ state: 'hidden', timeout: 8_000 }).catch(() => {});
  await page.locator('.page-loading-mask').first().waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => {});
  await page.locator('iframe').first().waitFor({ state: 'attached', timeout: 3_000 }).catch(() => {});
  await waitForPostInteractionPaint(page).catch(() => {});
  await waitForRouteStable(page, opts.afterNav ? 4_000 : 2_000).catch(() => {});
  await waitForContentReady(page).catch(() => {});
}

export async function collectFrameTextSamples(page: Page, maxChars = 1200): Promise<FrameTextSample[]> {
  const frames = page.frames();
  const items = await Promise.all(
    frames.map(async (frame, index) => {
      try {
        const text = await frame.evaluate(
          (limit) => (document.body?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, limit),
          maxChars,
        );
        const url = frame.url() || '';
        const scope = index === 0 ? 'page' : 'iframe';
        return { scope, frameIndex: index, url, text } satisfies FrameTextSample;
      } catch {
        return null;
      }
    }),
  );
  return items.filter((item): item is FrameTextSample => Boolean(item && item.text));
}

export function formatFrameTextSamples(items: FrameTextSample[]): string {
  if (items.length === 0) return '';
  return items
    .map((item) => {
      const title = item.scope === 'page' ? '主页面' : `iframe#${item.frameIndex}`;
      return `[${title}] ${item.url || '(无 URL)'}\n${item.text}`;
    })
    .join('\n\n');
}

export async function verifyStorageStateForRun(
  browser: Browser,
  storagePath: string | undefined,
  opts: { baseURL?: string; entry?: string; allowMissing?: boolean } = {},
): Promise<StorageStateProbeResult> {
  if (!storagePath) {
    return opts.allowMissing
      ? { valid: true, reason: '未配置 storageState，允许按未登录态执行' }
      : { valid: false, reason: '未配置 storageState，请先执行 npm run login' };
  }
  return probeStorageState(browser, storagePath, { baseURL: opts.baseURL, entry: opts.entry || '/' });
}
