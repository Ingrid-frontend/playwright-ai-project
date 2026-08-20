/**
 * @spec-meta
 * {"playwrightEnv":"stage","accountProfile":"default","goldenSet":"dashboard"}
 */
import fs from 'fs';
import path from 'path';
import { test, expect } from '../../fixtures';
import { assertNotLoginLikePage } from '../../../../src/utils/login-detection';
import { visualTest, withScreenshotRunSegment } from '../../../../src/utils/screenshot';
import { step } from '../../../utils/optimized-actions';

test.describe('Golden Set · 工作台首页', () => {
  test('首页布局可见', async ({ page }) => {
    test.setTimeout(90_000);

    const screenshotDir = withScreenshotRunSegment('screenshots/stage/golden-set/02-dashboard');
    fs.mkdirSync(screenshotDir, { recursive: true });
    const runDir = path.join(screenshotDir, new Date().toISOString().replace(/[:.]/g, '-'));

    await step('打开工作台首页', async () => {
      await page.goto('/main/home', { waitUntil: 'load', timeout: 60_000 });
      await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
      await assertNotLoginLikePage(page, 'golden-set dashboard');
    });

    await step('断言主导航', async () => {
      await page.locator('iframe').first().waitFor({ state: 'attached', timeout: 30_000 });
      const app = page.frameLocator('iframe').first();

      await expect(app.getByRole('tab', { name: '工作台' })).toBeVisible({ timeout: 30_000 });
      await expect(app.getByRole('menuitem', { name: /我的审批|我的单据|报销单/ }).first()).toBeVisible({
        timeout: 30_000,
      });

      await visualTest(page, { dir: runDir, name: 'dashboard', state: 'normal', step: 1 });
    });
  });
});
