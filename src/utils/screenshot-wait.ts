import { type FrameLocator, Page, expect } from '@playwright/test';

const SPIN_SEL = '.ant-spin-spinning, .ant-loading, .ant-skeleton-active, .page-loading-mask';

async function waitSpinHidden(scope: Page | FrameLocator, timeout: number): Promise<void> {
  await scope.locator(SPIN_SEL).first().waitFor({ state: 'hidden', timeout }).catch(() => undefined);
}

/** 顶层 + zoom iframe 内的 loading / skeleton 均消失后再截图 */
export async function waitForAppLoadingHidden(page: Page, timeout = 15_000): Promise<void> {
  await waitSpinHidden(page, timeout);
  if (await page.locator('iframe[src*="openBySelf=zoom"]').count()) {
    await waitSpinHidden(page.frameLocator('iframe[src*="openBySelf=zoom"]'), timeout);
  }
}

/** 等两帧 rAF：让浏览器真正完成一次绘制后再返回，替代定长 waitForTimeout 盲等 */
export async function waitForNextPaint(page: Page): Promise<void> {
  try {
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }),
    );
  } catch {
    /* frame 可能已销毁，按已稳定处理 */
  }
}

export async function waitForPostInteractionPaint(page: Page): Promise<void> {
  await waitForAppLoadingHidden(page, 8_000);

  const antdAnimationSelectors = [
    '.ant-drawer-open',
    '.ant-drawer.ant-drawer-open .ant-drawer-content-wrapper',
    '.ant-modal-wrap',
    '.ant-modal.ant-zoom-enter',
    '.ant-modal.ant-zoom-enter-active',
    '.ant-notification-notice',
    '.ant-message-notice',
    '.ant-dropdown.ant-slide-down-enter',
    '.ant-dropdown.ant-slide-down-enter-active',
    '.ant-select-dropdown.ant-slide-up-enter',
    '.ant-select-dropdown.ant-slide-up-enter-active',
    '.ant-tabs.ant-tabs-card > .ant-tabs-bar .ant-tabs-tab-active',
    '.ant-collapse > .ant-collapse-item.ant-collapse-item-active',
  ];

  const parallel = process.env.SCREENSHOT_WAIT_SERIAL !== '1';
  const animTimeout = parallel ? 3_000 : 1_500;
  const waits = antdAnimationSelectors.map((sel) =>
    page.locator(sel).first().waitFor({ state: 'attached', timeout: animTimeout }).catch(() => undefined),
  );
  if (parallel) {
    await Promise.all(waits);
  } else {
    for (const wait of waits) await wait;
  }

  await waitForNextPaint(page);
}

export async function waitForRouteStable(page: Page, maxWaitTime: number = 3000): Promise<void> {
  try {
    let currentRoute = await getCurrentRoute(page);
    await page.waitForTimeout(300);
    
    let stableCount = 0;
    const maxStableCount = 3;
    const startTime = Date.now();
    
    while (stableCount < maxStableCount) {
      if (Date.now() - startTime > maxWaitTime) {
        console.log(`⚠️  路由稳定检测超时 (${maxWaitTime}ms)，使用当前路由: ${currentRoute}`);
        break;
      }
      
      const newRoute = await getCurrentRoute(page);
      
      if (newRoute === currentRoute) {
        stableCount++;
      } else {
        console.log(`🔄 路由变化: ${currentRoute} -> ${newRoute}`);
        currentRoute = newRoute;
        stableCount = 0;
      }

      // 达标即返回，避免确认稳定后再尾随一次无意义的采样等待
      if (stableCount >= maxStableCount) break;
      await page.waitForTimeout(150);
    }

    console.log(`✅ 路由稳定: ${currentRoute}`);
  } catch {
    console.log('⚠️  路由稳定检测失败，继续执行');
  }
}

export async function getCurrentRoute(page: Page): Promise<string> {
  try {
    const route = await page.evaluate(() => {
      const pathname = window.location.pathname;
      const search = window.location.search;
      const hash = window.location.hash;
      return pathname + search + hash;
    });
    return route;
  } catch {
    return '';
  }
}

export async function waitForViewportStable(page: Page, timeout: number = 3000): Promise<void> {
  // Playwright 已把 viewport 锁成固定尺寸时，window.innerWidth 由协议保证不变，
  // 无需再用轮询等满 ~1.1s；仅在 headed 的 viewport:null（跟随窗口）模式下才检测。
  if (page.viewportSize()) return;
  try {
    const initialViewport = await page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
    }));

    await page.waitForTimeout(500);

    let stableCount = 0;
    const maxStableCount = 3;
    const startTime = Date.now();

    while (stableCount < maxStableCount) {
      if (Date.now() - startTime > timeout) {
        console.log(`⚠️  视口稳定检测超时 (${timeout}ms)`);
        break;
      }

      const currentViewport = await page.evaluate(() => ({
        width: window.innerWidth,
        height: window.innerHeight,
      }));

      if (
        currentViewport.width === initialViewport.width &&
        currentViewport.height === initialViewport.height
      ) {
        stableCount++;
      } else {
        initialViewport.width = currentViewport.width;
        initialViewport.height = currentViewport.height;
        stableCount = 0;
      }

      // 达标即返回，避免确认稳定后再尾随一次无意义的采样等待
      if (stableCount >= maxStableCount) break;
      await page.waitForTimeout(200);
    }
  } catch {
    console.log('⚠️  视口稳定检测失败，继续执行');
  }
}

export async function waitForContentReady(page: Page): Promise<void> {
  try {
    const hasContent = await page.evaluate(() => {
      const body = document.body;
      if (!body) return false;

      const textContent = body.textContent?.trim() || '';
      const hasText = textContent.length > 10;

      const hasImages = body.querySelectorAll('img').length > 0;
      const hasButtons = body.querySelectorAll('button').length > 0;
      const hasInputs = body.querySelectorAll('input').length > 0;
      const hasTables = body.querySelectorAll('table').length > 0;
      const hasDivs = body.querySelectorAll('div').length > 5;

      return hasText || hasImages || hasButtons || hasInputs || hasTables || hasDivs;
    });

    if (!hasContent) {
      await page.waitForTimeout(300);
    }
  } catch {
    console.log('⚠️  内容检测失败，继续执行截图');
  }
}

export async function waitForElementVisible(page: Page, selector: string, timeout: number = 5000): Promise<void> {
  await expect(page.locator(selector)).toBeVisible({ timeout });
}

export async function waitForElementHidden(page: Page, selector: string, timeout: number = 5000): Promise<void> {
  await expect(page.locator(selector)).toBeHidden({ timeout });
}

export async function waitForApiResponse(page: Page, urlPattern: string | RegExp): Promise<void> {
  await page.waitForResponse(res => {
    const url = res.url();
    if (typeof urlPattern === 'string') {
      return url.includes(urlPattern) && res.ok();
    }
    return urlPattern.test(url) && res.ok();
  });
}
