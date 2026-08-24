import type { FrameLocator, Page } from '@playwright/test';

/**
 * 有 zoom iframe 时进 iframe，否则用主页面。
 * dev 实机 /main/approve 内容在 iframe[src*="openBySelf=zoom"] 内。
 */
export type AppRoot = {
  page: Page;
  /** 业务操作作用域：iframe 或 page 本身 */
  scope: FrameLocator | Page;
  inIframe: boolean;
};

export function appFrame(page: Page): FrameLocator {
  return page.frameLocator('iframe[src*="openBySelf=zoom"]');
}

export async function waitForAppRoot(page: Page, timeout = 60_000): Promise<AppRoot> {
  const deadline = Date.now() + timeout;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      const iframe = page.locator('iframe[src*="openBySelf=zoom"]');
      if (await iframe.count()) {
        const scope = appFrame(page);
        await scope.locator('body').waitFor({ timeout: 5_000 });
        return { page, scope, inIframe: true };
      }

      // 无 iframe：登录页或已登录主站直接渲染在顶层
      const bodyText = await page.locator('body').innerText({ timeout: 2_000 }).catch(() => '');
      if (
        /账号登录|二维码登录|工作台|数据分析|自定义报表|审批|待审批|已审批|我发起的/.test(
          bodyText
        )
      ) {
        return { page, scope: page, inIframe: false };
      }
    } catch (e) {
      lastError = e;
    }
    await page.waitForTimeout(500);
  }

  const url = page.url();
  const html = await page.content().catch(() => '');
  throw new Error(
    `等待业务页超时（url=${url}）${lastError ? `；last=${String(lastError)}` : ''}；html=${html.slice(0, 300)}`
  );
}
