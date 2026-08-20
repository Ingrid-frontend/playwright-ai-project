/**
 * @spec-meta
 * {"playwrightEnv":"stage","accountProfile":"default","goldenSet":"approval-list"}
 */
import fs from 'fs';
import path from 'path';
import { test, expect } from '../../fixtures';
import { assertNotLoginLikePage } from '../../../../src/utils/login-detection';
import { visualTest, waitForPostInteractionPaint, withScreenshotRunSegment } from '../../../../src/utils/screenshot';
import { step } from '../../../utils/optimized-actions';

test.describe('Golden Set · 我的审批列表', () => {
  test('审批列表页可见', async ({ page }) => {
    test.setTimeout(90_000);

    const screenshotDir = withScreenshotRunSegment('screenshots/stage/golden-set/03-approval-list');
    fs.mkdirSync(screenshotDir, { recursive: true });
    const runDir = path.join(screenshotDir, new Date().toISOString().replace(/[:.]/g, '-'));

    await step('打开审批列表', async () => {
      await page.goto('/main/approve', { waitUntil: 'load', timeout: 60_000 });
      await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
      await assertNotLoginLikePage(page, 'golden-set approval-list');
    });

    await step('断言列表信号', async () => {
      await page.locator('iframe').first().waitFor({ state: 'attached', timeout: 30_000 });
      const app = page.frameLocator('iframe').first();

      await expect(app.getByText(/我的审批|待审批/).first()).toBeVisible({ timeout: 20_000 });
      await expect(app.locator('.ant-table, table, [role="tablist"]').first()).toBeVisible({
        timeout: 20_000,
      });

      await waitForPostInteractionPaint(page);
      await visualTest(page, { dir: runDir, name: 'approval-list', state: 'normal', step: 1 });
    });
  });
});
