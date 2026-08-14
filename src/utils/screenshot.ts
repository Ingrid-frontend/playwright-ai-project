import { Page, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { assertNotLoginLikePage } from './login-detection.js';
import {
  resolveSnapshotViewports,
  scriptKeyFromScreenshotPath,
} from '../../scripts/report/ui-regression-config.js';
import {
  applyScreenshotStabilityStyles,
  captureScreenshotAtViewports,
  lockViewportForSnapshot,
  useFullPageByDefault,
} from './screenshot-capture.js';
import {
  getCurrentRoute,
  waitForContentReady,
  waitForRouteStable,
} from './screenshot-wait.js';

export {
  waitForApiResponse,
  waitForElementHidden,
  waitForElementVisible,
  waitForPostInteractionPaint,
} from './screenshot-wait.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MENU_ITEMS = JSON.parse(fs.readFileSync(path.join(__dirname, '../../datasource/menu_items.json'), 'utf-8'));
const MENU_ROUTES = JSON.parse(fs.readFileSync(path.join(__dirname, '../../datasource/menu_routes.json'), 'utf-8'));

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
  const viewports = resolveSnapshotViewports();
  const primaryVp = viewports.find((v) => v.default) || viewports[0]!;

  await lockViewportForSnapshot(page, primaryVp);
  await applyScreenshotStabilityStyles(page);

  await waitForRouteStable(page, 2000);

  try {
    await page.waitForLoadState('networkidle', { timeout: 2000 });
  } catch {
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
    } catch {
      continue;
    }
  }

  await waitForContentReady(page);

  await assertNotLoginLikePage(page, `stable screenshot: ${path}`);
  await page.waitForTimeout(200);

  const route = await getCurrentRoute(page);
  const routePath = addRouteToPath(path, route);
  const scriptKey = scriptKeyFromScreenshotPath(routePath);
  const savedPath = await captureScreenshotAtViewports(page, routePath, { fullPage, scriptKey });

  return { path: savedPath, route };
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

  await assertNotLoginLikePage(page, `fast screenshot: ${filePath}`);
  const scriptKey = scriptKeyFromScreenshotPath(filePath);
  const savedPath = await captureScreenshotAtViewports(page, filePath, {
    fullPage,
    scriptKey,
  });
  return { path: savedPath, route: page.url() };
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
