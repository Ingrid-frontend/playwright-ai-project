import { Page, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MENU_ITEMS = JSON.parse(fs.readFileSync(path.join(__dirname, '../datasource/menu_items.json'), 'utf-8'));
const MENU_ROUTES = JSON.parse(fs.readFileSync(path.join(__dirname, '../datasource/menu_routes.json'), 'utf-8'));

/**
 * 使用 CSS 像素尺寸出图（与 viewport 宽高一致）。
 * 默认 scale=device 会按 DPR 放大（如 1280→2560），易与 playwright 里设置的视口不一致，并出现「截图比浏览器宽/高」、对比报告留白异常。
 */
const SCREENSHOT_SCALE: 'css' | 'device' = 'css';

/**
 * 与 playwright.config 中 `optimized` project 一致。
 * 菜单/路由切换后，整页文档 scrollWidth、滚动条可能变化；fullPage 截图会按「文档最大宽高」出图，PNG 尺寸会漂移。
 * 出图前强制 setViewportSize，保证视口一致；默认截图用视口（非 fullPage），宽度稳定为 1280。
 */
const SNAPSHOT_VIEWPORT = { width: 1280, height: 720 } as const;

function useFullPageByDefault(): boolean {
  return process.env.SCREENSHOT_FULL_PAGE === '1';
}

async function lockViewportForSnapshot(page: Page): Promise<void> {
  await page.setViewportSize(SNAPSHOT_VIEWPORT);
}

let freezeAnimationsApplied = false;

/** 可选：禁用 CSS 动画/过渡，减少截图抖动（config/ui-regression.json → screenshot.freezeAnimations） */
async function applyScreenshotStabilityStyles(page: Page): Promise<void> {
  if (freezeAnimationsApplied) return;
  let enabled = process.env.SCREENSHOT_FREEZE_ANIMATIONS !== '0';
  try {
    const cfgPath = path.join(__dirname, '../config/ui-regression.json');
    if (fs.existsSync(cfgPath)) {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8')) as {
        screenshot?: { freezeAnimations?: boolean };
      };
      if (cfg.screenshot?.freezeAnimations === false) enabled = false;
      if (cfg.screenshot?.freezeAnimations === true) enabled = true;
    }
  } catch {
    /* use env default */
  }
  if (!enabled) return;
  try {
    await page.addStyleTag({
      content: `*, *::before, *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        transition-duration: 0s !important;
        transition-delay: 0s !important;
      }`,
    });
    freezeAnimationsApplied = true;
  } catch {
    /* frame 可能已销毁 */
  }
}

/**
 * 多浏览器串跑时区分截图目录，便于 compare-screenshots 按浏览器归档。
 * 目录名需包含 `-chromium-` / `-webkit-` 等片段（见 compare-screenshots 的 browser 检测）。
 * `tests/optimized/<env>/<日期>/` 下 spec：`import { test, expect } from '../../fixtures'`（层级随 env/date 段数变化，见 `test-env-path.cjs`）。
 */
export function withScreenshotRunSegment(baseScreenshotDir: string): string {
  const seg = process.env.PLAYWRIGHT_SCREENSHOT_RUN_SEGMENT?.trim();
  if (!seg) return baseScreenshotDir;
  return path.join(baseScreenshotDir, seg);
}

function getRouteDisplayName(route: string): string {
  for (const [key, routeValue] of Object.entries(MENU_ROUTES)) {
    const normalizedRouteValue = String(routeValue).replace(/\//g, '_').replace(/^_/, '');
    if (normalizedRouteValue === route) {
      return MENU_ITEMS[key] || route;
    }
  }
  
  return route;
}

export async function screenshotWhenStable(page: Page, path: string, options: { fullPage?: boolean } = {}): Promise<{ path: string; route: string }> {
  const fullPage = options.fullPage ?? useFullPageByDefault();

  await lockViewportForSnapshot(page);
  await applyScreenshotStabilityStyles(page);

  await waitForRouteStable(page, 2000);

  try {
    await page.waitForLoadState('networkidle', { timeout: 2000 });
  } catch (error) {
    console.log('⚠️  等待网络空闲超时，继续执行截图');
  }

  const loadingSelectors = [
    '.ant-spin',
    '.ant-spin-spinning',
    '.page-loading-mask',
  ];

  for (const sel of loadingSelectors) {
    try {
      const el = page.locator(sel);
      const count = await el.count();
      if (count > 0) {
        await expect(el, `等待 ${sel} 消失`).toBeHidden({ timeout: 1500 });
      }
    } catch (error) {
      continue;
    }
  }

  await waitForContentReady(page);

  await page.waitForTimeout(200);

  const route = await getCurrentRoute(page);
  const routePath = addRouteToPath(path, route);
  await lockViewportForSnapshot(page);
  await page.screenshot({ path: routePath, fullPage, scale: SCREENSHOT_SCALE });
  
  return { path: routePath, route };
}

/**
 * 点击/填写等操作后：等待全局 loading 消失并留一帧给 Drawer/Tab CSS 动画，减少「after 截图花屏、空白、半开抽屉」。
 */
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

export async function takeStepScreenshot(
  page: Page,
  filePath: string,
  options: { fullPage?: boolean; mode?: 'fast' | 'stable' } = {},
): Promise<{ path: string; route: string }> {
  const envMode = process.env.SCREENSHOT_MODE === 'stable' ? 'stable' : 'fast';
  const mode = options.mode ?? envMode;
  const fullPage = options.fullPage ?? useFullPageByDefault();

  if (mode === 'stable') {
    return await screenshotWhenStable(page, filePath, { fullPage });
  }

  await lockViewportForSnapshot(page);
  await page.screenshot({ path: filePath, fullPage, scale: SCREENSHOT_SCALE });
  return { path: filePath, route: page.url() };
}

function addRouteToPath(originalPath: string, route: string): string {
  const dir = path.dirname(originalPath);
  const filename = path.basename(originalPath, '.png');
  const ext = path.extname(originalPath);
  
  const sanitizedRoute = route.replace(/[^a-zA-Z0-9\-_]/g, '_').substring(0, 50);
  const routeDisplayName = getRouteDisplayName(sanitizedRoute);
  const newFilename = `${filename}_${routeDisplayName}${ext}`;
  
  return path.join(dir, newFilename);
}

async function waitForRouteStable(page: Page, maxWaitTime: number = 3000): Promise<void> {
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
  } catch (error) {
    console.log('⚠️  路由稳定检测失败，继续执行');
  }
}

async function getCurrentRoute(page: Page): Promise<string> {
  try {
    const route = await page.evaluate(() => {
      const pathname = window.location.pathname;
      const search = window.location.search;
      const hash = window.location.hash;
      return pathname + search + hash;
    });
    return route;
  } catch (error) {
    return '';
  }
}

async function waitForContentReady(page: Page): Promise<void> {
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
  } catch (error) {
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
