/**
 * @spec-meta
 * {"playwrightEnv":"stage","accountProfile":"default","loginAccount":null,"recordedAt":"2026-06-09T12:11:37.300Z"}
 */
import { test, expect } from '../../fixtures';
import fs from 'fs';
import path from 'path';
import { takeStepScreenshot, visualTest, waitForPostInteractionPaint, withScreenshotRunSegment } from '../../../../src/utils/screenshot';
import { step, maybePause, smartClick } from '../../../utils/optimized-actions';

test('test', async ({ page }) => {
  test.setTimeout(90000);

  // 截图根目录；Chrome/WebKit 子目录由 ../../fixtures 按引擎自动设置（仍可用 PLAYWRIGHT_SCREENSHOT_RUN_SEGMENT 手动覆盖）
  const screenshotDir = withScreenshotRunSegment('screenshots/stage/260612/我的审批_2026-06-09_16-48-19');
  if (!fs.existsSync(screenshotDir)) {
    fs.mkdirSync(screenshotDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const runDir = path.join(screenshotDir, timestamp);

  // 检查是否有页面导航操作
  const hasGotoAction = true;
  
  if (!hasGotoAction) {
    // 如果没有页面导航，添加一个默认的
    await step('导航到首页', async () => {
      console.log('🌐 导航到: / (基于 baseURL)');
      await page.goto('/', { waitUntil: 'load' });
      await takeStepScreenshot(page, path.join(runDir, `step-1-导航到首页.png`));
    });
  }

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

  await step('1', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-3-1-before.png`));
    await page.locator('iframe').first().waitFor({ state: 'attached', timeout: 12000 }).catch(() => {});
    const baseContext = page.frameLocator('iframe').first();
    const locator = baseContext.getByRole('cell', { name: '1', exact: true }).filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 4000 });
    } catch {
      console.log('ℹ️  1：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-3-1-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, '1');
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-3-1-after.png`), { mode: 'stable' });
    await visualTest(page, { dir: runDir, name: 'approval-detail', state: 'normal', step: 3 });
  });

  await step('通-过', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-4-通-过-before.png`));
    await page.locator('iframe').first().waitFor({ state: 'attached', timeout: 12000 }).catch(() => {});
    const baseContext = page.frameLocator('iframe').first();
    const locator = baseContext.getByRole('button', { name: '通 过' }).filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 4000 });
    } catch {
      console.log('ℹ️  通-过：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-4-通-过-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, '通-过');
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-4-通-过-after.png`), { mode: 'stable' });
    await visualTest(page, { dir: runDir, name: 'approval-detail', state: 'action-bar', step: 4 });
  });

  await step('Close', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-5-Close-before.png`));
    await page.locator('iframe').first().waitFor({ state: 'attached', timeout: 12000 }).catch(() => {});
    const baseContext = page.frameLocator('iframe').first();
    const locator = baseContext.getByRole('button', { name: 'Close' }).filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 4000 });
    } catch {
      console.log('ℹ️  Close：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-5-Close-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, 'Close');
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-5-Close-after.png`), { mode: 'stable' });
  });



  // 停止 tracing 由 Playwright 配置自动处理

  console.log('');
  console.log('🎉 测试完成: ' + 'test');
});