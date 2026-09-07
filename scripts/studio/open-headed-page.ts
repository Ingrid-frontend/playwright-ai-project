/**
 * Studio 有头调试：加载 profile 登录态后打开 baseURL 根路径，关闭浏览器即退出。
 *
 * npx tsx scripts/studio/open-headed-page.ts --baseURL=https://dev.huilianyi.com --entry=/
 */
import fs from 'fs';
import { chromium } from '@playwright/test';

function getArg(name: string, fallback = ''): string {
  const prefix = `--${name}=`;
  const hit = process.argv.slice(2).find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
}

async function main(): Promise<void> {
  const baseURL = getArg('baseURL').trim();
  const entry = getArg('entry', '/') || '/';
  const storageState = getArg('storageState').trim();

  if (!baseURL) {
    console.error('[headed-debug] 缺少 --baseURL');
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: false });
  const contextOpts: Parameters<typeof browser.newContext>[0] = {
    baseURL,
    locale: 'zh-CN',
    viewport: null,
  };
  if (storageState && fs.existsSync(storageState)) {
    contextOpts.storageState = storageState;
  }

  const context = await browser.newContext(contextOpts);
  const page = await context.newPage();
  const path = entry.startsWith('/') ? entry : `/${entry}`;
  await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  console.log(`[headed-debug] 已打开 ${baseURL.replace(/\/$/, '')}${path}`);

  await new Promise<void>((resolve) => {
    browser.on('disconnected', () => resolve());
  });
}

main().catch((e) => {
  console.error('[headed-debug] 启动失败:', e instanceof Error ? e.message : e);
  process.exit(1);
});
