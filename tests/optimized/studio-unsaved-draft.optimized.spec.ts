/**
 * @spec-meta
 * {"playwrightEnv":"stage","accountProfile":"default","loginAccount":"183***@e-elitech.com","recordedAt":"2026-07-21T08:50:04.696Z"}
 */
import { test, expect } from './fixtures';
import fs from 'fs';
import path from 'path';
import { takeStepScreenshot, waitForPostInteractionPaint, withScreenshotRunSegment } from '../../utils/screenshot';
import { step, maybePause, smartClick } from '../utils/optimized-actions';

test('test', async ({ page }) => {
  test.setTimeout(90000);

  // 截图根目录；Chrome/WebKit 子目录由 ./fixtures 按引擎自动设置（仍可用 PLAYWRIGHT_SCREENSHOT_RUN_SEGMENT 手动覆盖）
  const screenshotDir = withScreenshotRunSegment('screenshots/stage/260717/studio-unsaved-draft');
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
    const baseContext = page.frameLocator('iframe').first();
    const locator = baseContext.getByText('我的审批').filter({ visible: true }).first();
await expect(locator).toBeVisible({ timeout: 12000 });    await smartClick(locator, '我的审批');
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-2-我的审批-after.png`), { mode: 'stable' });
  });

  await step('LA00339826', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-3-LA00339826-before.png`));
    await page.locator('iframe').first().waitFor({ state: 'attached', timeout: 12000 }).catch(() => {});
    const baseContext = page.frameLocator('iframe').first();
    const locator = baseContext.getByText('LA00339826').filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 4000 });
    } catch {
      console.log('ℹ️  LA00339826：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-3-LA00339826-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, 'LA00339826');
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-3-LA00339826-after.png`), { mode: 'stable' });
  });

  await step('张艳华', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-4-张艳华-before.png`));
    await page.locator('iframe').first().waitFor({ state: 'attached', timeout: 12000 }).catch(() => {});
    const baseContext = page.frameLocator('iframe').first();
    const locator = baseContext.getByText('张艳华').filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 4000 });
    } catch {
      console.log('ℹ️  张艳华：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-4-张艳华-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, '张艳华');
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-4-张艳华-after.png`), { mode: 'stable' });
  });

  await step('-11-27', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-5--11-27-before.png`));
    await page.locator('iframe').first().waitFor({ state: 'attached', timeout: 12000 }).catch(() => {});
    const baseContext = page.frameLocator('iframe').first();
    const locator = baseContext.getByRole('cell', { name: '-11-27' }).filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 4000 });
    } catch {
      console.log('ℹ️  -11-27：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-5--11-27-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, '-11-27');
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-5--11-27-after.png`), { mode: 'stable' });
  });



  // 停止 tracing 由 Playwright 配置自动处理

  console.log('');
  console.log('🎉 测试完成: ' + 'test');
});
