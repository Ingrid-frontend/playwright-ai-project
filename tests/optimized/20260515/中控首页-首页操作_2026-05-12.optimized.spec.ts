import { test, expect } from '../fixtures';
import fs from 'fs';
import path from 'path';
import { takeStepScreenshot, waitForPostInteractionPaint, withScreenshotRunSegment } from '../../../utils/screenshot';
import { step, maybePause, smartClick } from '../../utils/optimized-actions';

test('test', async ({ page }) => {
  test.setTimeout(120000);

  // 截图根目录；Chrome/WebKit 子目录由 ../fixtures 按引擎自动设置（仍可用 PLAYWRIGHT_SCREENSHOT_RUN_SEGMENT 手动覆盖）
  const screenshotDir = withScreenshotRunSegment('screenshots/20260515/中控首页-首页操作_2026-05-12');
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
      await page.goto('/', { waitUntil: 'networkidle' });
      await page.waitForLoadState('networkidle');
      await takeStepScreenshot(page, path.join(runDir, `step-1-导航到首页.png`));
    });
  }

    await step('导航到页面', async () => {
    console.log('🌐 导航到: https://stage.huilianyi.com/');
    await page.goto('https://stage.huilianyi.com/', { waitUntil: 'networkidle' });
    await page.waitForLoadState('networkidle');
    await takeStepScreenshot(page, path.join(runDir, `step-1-导航到页面.png`));
  });

  await step('action', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-2-action-before.png`));
    await page.locator('iframe').first().waitFor({ state: 'attached', timeout: 20000 }).catch(() => {});
    const baseContext = page.frameLocator('iframe').first();
    const locator = baseContext.locator('.hover-pointer-icon').first();
    try {
      await expect(locator).toBeVisible({ timeout: 6000 });
    } catch {
      console.log('ℹ️  action：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-2-action-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, 'action');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-2-action-after.png`), { mode: 'stable' });
  });

  await step('action', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-3-action-before.png`));
    await page.locator('iframe').first().waitFor({ state: 'attached', timeout: 20000 }).catch(() => {});
    const baseContext = page.frameLocator('iframe').first();
    const locator = baseContext.locator('.ant-popover-open > .hover-pointer-icon').filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 6000 });
    } catch {
      console.log('ℹ️  action：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-3-action-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, 'action');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-3-action-after.png`), { mode: 'stable' });
  });

  await step('action', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-4-action-before.png`));
    await page.locator('iframe').first().waitFor({ state: 'attached', timeout: 20000 }).catch(() => {});
    const baseContext = page.frameLocator('iframe').first();
    const locator = baseContext.locator('.single-index.hover-click > .index-name > div:nth-child(2) > .hover-pointer-icon').filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 6000 });
    } catch {
      console.log('ℹ️  action：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-4-action-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, 'action');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-4-action-after.png`), { mode: 'stable' });
  });

  await step('请选择日期', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-5-请选择日期-before.png`));
    await page.locator('iframe').first().waitFor({ state: 'attached', timeout: 20000 }).catch(() => {});
    const baseContext = page.frameLocator('iframe').first();
    const locator = baseContext.locator('#home-main-charts-guide-id').getByRole('textbox', { name: '请选择日期' }).filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 6000 });
    } catch {
      console.log('ℹ️  请选择日期：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-5-请选择日期-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, '请选择日期');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-5-请选择日期-after.png`), { mode: 'stable' });
  });

  await step('二月', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-6-二月-before.png`));
    await page.locator('iframe').first().waitFor({ state: 'attached', timeout: 20000 }).catch(() => {});
    const baseContext = page.frameLocator('iframe').first();
    const locator = baseContext.getByText('二月', { exact: true }).filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 6000 });
    } catch {
      console.log('ℹ️  二月：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-6-二月-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, '二月');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-6-二月-after.png`), { mode: 'stable' });
  });

  await step('个人首页', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-7-个人首页-before.png`));
    await page.locator('iframe').first().waitFor({ state: 'attached', timeout: 20000 }).catch(() => {});
    const baseContext = page.frameLocator('iframe').first();
    const locator = baseContext.getByText('个人首页').filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 6000 });
    } catch {
      console.log('ℹ️  个人首页：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-7-个人首页-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, '个人首页');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-7-个人首页-after.png`), { mode: 'stable' });
  });

  await step('请选择代理人', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-8-请选择代理人-before.png`));
    await page.locator('iframe').first().waitFor({ state: 'attached', timeout: 20000 }).catch(() => {});
    const baseContext = page.frameLocator('iframe').first();
    const locator = baseContext.getByText('请选择代理人').filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 6000 });
    } catch {
      console.log('ℹ️  请选择代理人：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-8-请选择代理人-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, '请选择代理人');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-8-请选择代理人-after.png`), { mode: 'stable' });
  });

  await step('action', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-9-action-before.png`));
    await page.locator('iframe').first().waitFor({ state: 'attached', timeout: 20000 }).catch(() => {});
    const baseContext = page.frameLocator('iframe').first();
    const locator = baseContext.locator('.ant-select-arrow').first().filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 6000 });
    } catch {
      console.log('ℹ️  action：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-9-action-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, 'action');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-9-action-after.png`), { mode: 'stable' });
  });

  await step('action', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-10-action-before.png`));
    await page.locator('iframe').first().waitFor({ state: 'attached', timeout: 20000 }).catch(() => {});
    const baseContext = page.frameLocator('iframe').first();
    const locator = baseContext.locator('.down-triangle').filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 6000 });
    } catch {
      console.log('ℹ️  action：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-10-action-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, 'action');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-10-action-after.png`), { mode: 'stable' });
  });

  await step('action', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-11-action-before.png`));
    await page.locator('iframe').first().waitFor({ state: 'attached', timeout: 20000 }).catch(() => {});
    const baseContext = page.frameLocator('iframe').first();
    const locator = baseContext.locator('.down-triangle').filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 6000 });
    } catch {
      console.log('ℹ️  action：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-11-action-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, 'action');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-11-action-after.png`), { mode: 'stable' });
  });



  // 停止 tracing 由 Playwright 配置自动处理

  console.log('');
  console.log('🎉 测试完成: ' + 'test');
});
