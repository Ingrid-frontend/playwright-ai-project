/**
 * @spec-meta
 * {"playwrightEnv":"dev","accountProfile":"default","loginAccount":null,"recordedAt":"2026-06-09T06:56:33.580Z"}
 */
import { test, expect } from '../../fixtures';
import fs from 'fs';
import path from 'path';
import { takeStepScreenshot, waitForPostInteractionPaint, withScreenshotRunSegment } from '../../../../utils/screenshot';
import { step, maybePause, smartClick, smartFill } from '../../../utils/optimized-actions';

test('test', async ({ page }) => {
  test.setTimeout(90000);

  // 截图根目录；Chrome/WebKit 子目录由 ../../fixtures 按引擎自动设置（仍可用 PLAYWRIGHT_SCREENSHOT_RUN_SEGMENT 手动覆盖）
  const screenshotDir = withScreenshotRunSegment('screenshots/dev/260612/studio-unsaved-draft');
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

  await step('搜索菜单', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-2-搜索菜单-before.png`));
    await page.locator('iframe').first().waitFor({ state: 'attached', timeout: 12000 }).catch(() => {});
    const baseContext = page.frameLocator('iframe').first();
    const locator = baseContext.getByRole('textbox', { name: '搜索菜单' }).filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 4000 });
    } catch {
      console.log('ℹ️  搜索菜单：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-2-搜索菜单-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, '搜索菜单');
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-2-搜索菜单-after.png`), { mode: 'stable' });
  });

  await step('搜索菜单', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-3-搜索菜单-before.png`));
    await page.locator('iframe').first().waitFor({ state: 'attached', timeout: 12000 }).catch(() => {});
    const baseContext = page.frameLocator('iframe').first();
    const locator = baseContext.getByRole('textbox', { name: '搜索菜单' }).filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 4000 });
    } catch {
      console.log('ℹ️  搜索菜单：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-3-搜索菜单-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartFill(locator, "搜索菜单", '搜索菜单');
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-3-搜索菜单-after.png`), { mode: 'stable' });
  });

  await step('action', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-4-action-before.png`));
    await page.locator('iframe').first().waitFor({ state: 'attached', timeout: 12000 }).catch(() => {});
    const baseContext = page.frameLocator('iframe').first();
    const locator = baseContext.locator('div').filter({ hasText: /^我的审批$/ }).nth(2);
    try {
      await expect(locator).toBeVisible({ timeout: 4000 });
    } catch {
      console.log('ℹ️  action：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-4-action-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, 'action');
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-4-action-after.png`), { mode: 'stable' });
  });

  await step('通过', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-5-通过-before.png`));
    await page.locator('iframe').first().waitFor({ state: 'attached', timeout: 12000 }).catch(() => {});
    const baseContext = page.frameLocator('iframe').first();
    const locator = baseContext.getByRole('button', { name: '通过' }).filter({ visible: true }).first();
await expect(locator).toBeVisible({ timeout: 12000 });    await smartClick(locator, '通过');
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-5-通过-after.png`), { mode: 'stable' });
  });

  await step('Close', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-6-Close-before.png`));
    await page.locator('iframe').first().waitFor({ state: 'attached', timeout: 12000 }).catch(() => {});
    const baseContext = page.frameLocator('iframe').first();
    const locator = baseContext.getByRole('button', { name: 'Close' }).filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 4000 });
    } catch {
      console.log('ℹ️  Close：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-6-Close-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, 'Close');
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-6-Close-after.png`), { mode: 'stable' });
  });

  await step('驳回', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-7-驳回-before.png`));
    await page.locator('iframe').first().waitFor({ state: 'attached', timeout: 12000 }).catch(() => {});
    const baseContext = page.frameLocator('iframe').first();
    const locator = baseContext.getByRole('button', { name: '驳回' }).filter({ visible: true }).first();
await expect(locator).toBeVisible({ timeout: 12000 });    await smartClick(locator, '驳回');
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-7-驳回-after.png`), { mode: 'stable' });
  });

  await step('Close', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-8-Close-before.png`));
    await page.locator('iframe').first().waitFor({ state: 'attached', timeout: 12000 }).catch(() => {});
    const baseContext = page.frameLocator('iframe').first();
    const locator = baseContext.getByRole('button', { name: 'Close' }).filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 4000 });
    } catch {
      console.log('ℹ️  Close：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-8-Close-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, 'Close');
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-8-Close-after.png`), { mode: 'stable' });
  });



  // 停止 tracing 由 Playwright 配置自动处理

  console.log('');
  console.log('🎉 测试完成: ' + 'test');
});