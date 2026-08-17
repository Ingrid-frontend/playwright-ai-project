/**
 * @spec-meta
 * {"playwrightEnv":"stage","accountProfile":"default","loginAccount":null,"recordedAt":"2026-06-09T12:11:37.300Z"}
 */
import { test, expect } from '../../fixtures';
import fs from 'fs';
import path from 'path';
import { takeStepScreenshot, visualTest, waitForPostInteractionPaint, withScreenshotRunSegment } from '../../../../src/utils/screenshot';
import { step, smartClick } from '../../../utils/optimized-actions';

test('test', async ({ page }) => {
  test.setTimeout(90000);

  const screenshotDir = withScreenshotRunSegment('screenshots/stage/260612/我的审批_2026-06-09_16-48-19');
  if (!fs.existsSync(screenshotDir)) {
    fs.mkdirSync(screenshotDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const runDir = path.join(screenshotDir, timestamp);

  await step('导航到页面', async () => {
    console.log('🌐 导航到: /');
    await page.goto('/', { waitUntil: 'load' });
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    await takeStepScreenshot(page, path.join(runDir, `step-1-导航到页面.png`));
  });

  await step('我的审批', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-2-我的审批-before.png`));
    await page.locator('iframe').first().waitFor({ state: 'attached', timeout: 12000 }).catch(() => {});
    const iframeLoc = page.frameLocator('iframe').first().getByText('我的审批').filter({ visible: true }).first();
    const pageLoc = page.getByRole('menuitem', { name: /我的审批/ }).filter({ visible: true }).first();
    const locator = (await iframeLoc.count().catch(() => 0)) > 0 ? iframeLoc : pageLoc;
    await expect(locator).toBeVisible({ timeout: 12000 });
    await smartClick(locator, '我的审批');
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-2-我的审批-after.png`), { mode: 'stable' });
    await visualTest(page, { dir: runDir, name: 'approval-list', state: 'normal', step: 2 });
  });

  await step('列表可见', async () => {
    await page.locator('iframe').first().waitFor({ state: 'attached', timeout: 12000 }).catch(() => {});
    const frame = page.frameLocator('iframe').first();
    const listSignal = frame.getByText(/审批|待办|单据/).filter({ visible: true }).first();
    await expect(listSignal).toBeVisible({ timeout: 12000 });
    await takeStepScreenshot(page, path.join(runDir, `step-3-列表可见.png`), { mode: 'stable' });
  });

  // optional 步骤：显式捕获并继续，不伪装成通过关键路径
  await step('打开首条可选', async () => {
    await page.locator('iframe').first().waitFor({ state: 'attached', timeout: 12000 }).catch(() => {});
    const baseContext = page.frameLocator('iframe').first();
    const locator = baseContext.getByRole('cell', { name: '1', exact: true }).filter({ visible: true }).first();
    const visible = await locator.isVisible().catch(() => false);
    if (!visible) {
      console.log('ℹ️  optional：首条单元格不可见，跳过打开详情');
      await takeStepScreenshot(page, path.join(runDir, `step-4-打开首条-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, '1');
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-4-打开首条-after.png`), { mode: 'stable' });
    await visualTest(page, { dir: runDir, name: 'approval-detail', state: 'normal', step: 4 });
  });

  console.log('');
  console.log('🎉 测试完成: ' + 'test');
});
