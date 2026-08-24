/**
 * @spec-meta
 * {"playwrightEnv":"stage","accountProfile":"default","goldenSet":"approval-list"}
 */
import fs from 'fs';
import path from 'path';
import { test, expect } from '../../fixtures';
import { assertNotLoginLikePage } from '../../../../src/utils/login-detection';
import { waitForPostInteractionPaint, withScreenshotRunSegment } from '../../../../src/utils/screenshot';
import { bindStepCapture, step } from '../../../utils/optimized-actions';

test.describe('Golden Set · 我的审批列表', () => {
  test('审批列表页可见', async ({ page }) => {
    test.setTimeout(90_000);

    const screenshotDir = withScreenshotRunSegment('screenshots/stage/golden-set/03-approval-list');
    fs.mkdirSync(screenshotDir, { recursive: true });
    const runDir = path.join(screenshotDir, new Date().toISOString().replace(/[:.]/g, '-'));
    bindStepCapture({ page, runDir });

    await step('打开审批列表', async () => {
      await page.goto('/main/approve', { waitUntil: 'load', timeout: 60_000 });
      await page
        .waitForResponse(
          (resp) => resp.url().includes('/api/approvals/pendingApproval') && resp.status() === 200,
          { timeout: 20_000 },
        )
        .catch(() => {});
      await assertNotLoginLikePage(page, 'golden-set approval-list');
    });

    await step('断言列表信号', async () => {
      await expect(page.getByText(/我的审批|待审批/).first()).toBeVisible({ timeout: 20_000 });
      await expect(page.locator('.ant-table').first()).toBeVisible({ timeout: 20_000 });

      const dataRows = page.locator('.ant-table-tbody tr').filter({ visible: true });
      await expect
        .poll(async () => await dataRows.count().catch(() => 0), {
          timeout: 20_000,
          message: '待审批列表未渲染出数据行',
        })
        .toBeGreaterThan(0);

      await waitForPostInteractionPaint(page);
    }, { snapshot: 'approval-list', state: 'normal' });
  });
});
