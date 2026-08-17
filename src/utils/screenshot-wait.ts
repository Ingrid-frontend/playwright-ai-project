import { Page, expect } from '@playwright/test';

export async function waitForPostInteractionPaint(page: Page): Promise<void> {
  await page.locator('.ant-spin-spinning, .ant-loading').first().waitFor({ state: 'hidden', timeout: 8_000 }).catch(() => {});
  await page.locator('.page-loading-mask').first().waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => {});

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

  for (const sel of antdAnimationSelectors) {
    await page.locator(sel).first().waitFor({ state: 'attached', timeout: 1_500 }).catch(() => {});
  }

  await page.waitForTimeout(150);
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
