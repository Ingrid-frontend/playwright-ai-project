import { test, expect } from '../fixtures';
import fs from 'fs';
import path from 'path';
import { takeStepScreenshot, waitForPostInteractionPaint, withScreenshotRunSegment } from '../../../utils/screenshot';
import { step, maybePause, smartClick } from '../../utils/optimized-actions';

test('test', async ({ page }) => {
  test.setTimeout(120000);

  // 截图根目录；Chrome/WebKit 子目录由 ../fixtures 按引擎自动设置（仍可用 PLAYWRIGHT_SCREENSHOT_RUN_SEGMENT 手动覆盖）
  const screenshotDir = withScreenshotRunSegment('screenshots/20260515/对公支付单_2026-04-24_15-15-19');
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
    console.log('🌐 导航到: https://stage.huilianyi.com/main/home');
    await page.goto('https://stage.huilianyi.com/main/home', { waitUntil: 'networkidle' });
    await page.waitForLoadState('networkidle');
    await takeStepScreenshot(page, path.join(runDir, `step-1-导航到页面.png`));
  });

  await step('对公支付单', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-2-对公支付单-before.png`));
    const locator = page.getByText('对公支付单', { exact: true }).filter({ visible: true }).first();
    await expect(locator).toBeVisible({ timeout: 5000 });
    await smartClick(locator, '对公支付单');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-2-对公支付单-after.png`), { mode: 'stable' });
  });

  await step('未结业务汇总', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-3-未结业务汇总-before.png`));
    await page.locator('iframe').last().waitFor({ state: 'attached', timeout: 20000 }).catch(() => {});
    const _childFrames = page.frames().filter((f) => f !== page.mainFrame());
    const baseContext = _childFrames.length > 0 ? _childFrames[_childFrames.length - 1]! : page.mainFrame();
    const locator = baseContext.getByRole('tab', { name: '未结业务汇总' }).filter({ visible: true }).first();
    await expect(locator).toBeVisible({ timeout: 25000 });
    await smartClick(locator, '未结业务汇总');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-3-未结业务汇总-after.png`), { mode: 'stable' });
  });

  await step('未结业务明细', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-4-未结业务明细-before.png`));
    await page.locator('iframe').last().waitFor({ state: 'attached', timeout: 20000 }).catch(() => {});
    const _childFrames = page.frames().filter((f) => f !== page.mainFrame());
    const baseContext = _childFrames.length > 0 ? _childFrames[_childFrames.length - 1]! : page.mainFrame();
    const locator = baseContext.getByRole('tab', { name: '未结业务明细' }).filter({ visible: true }).first();
    await expect(locator).toBeVisible({ timeout: 25000 });
    await smartClick(locator, '未结业务明细');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-4-未结业务明细-after.png`), { mode: 'stable' });
  });

  await step('对公支付单', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-5-对公支付单-before.png`));
    await page.locator('iframe').last().waitFor({ state: 'attached', timeout: 20000 }).catch(() => {});
    const _childFrames = page.frames().filter((f) => f !== page.mainFrame());
    const baseContext = _childFrames.length > 0 ? _childFrames[_childFrames.length - 1]! : page.mainFrame();
    const locator = baseContext.getByRole('tab', { name: '对公支付单' }).filter({ visible: true }).first();
    await expect(locator).toBeVisible({ timeout: 25000 });
    await smartClick(locator, '对公支付单');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-5-对公支付单-after.png`), { mode: 'stable' });
  });

  await step('action', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-6-action-before.png`));
    await page.locator('iframe').last().waitFor({ state: 'attached', timeout: 20000 }).catch(() => {});
    const _childFrames = page.frames().filter((f) => f !== page.mainFrame());
    const baseContext = _childFrames.length > 0 ? _childFrames[_childFrames.length - 1]! : page.mainFrame();
    const locator = baseContext.locator('.anticon.anticon-close > svg').filter({ visible: true }).first();
    await expect(locator).toBeVisible({ timeout: 25000 });
    await smartClick(locator, 'action');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-6-action-after.png`), { mode: 'stable' });
  });

  await step('1', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-7-1-before.png`));
    await page.locator('iframe').last().waitFor({ state: 'attached', timeout: 20000 }).catch(() => {});
    const _childFrames = page.frames().filter((f) => f !== page.mainFrame());
    const baseContext = _childFrames.length > 0 ? _childFrames[_childFrames.length - 1]! : page.mainFrame();
    const locator = baseContext.getByRole('cell', { name: '1', exact: true }).filter({ visible: true }).first();
    await expect(locator).toBeVisible({ timeout: 25000 });
    await smartClick(locator, '1');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-7-1-after.png`), { mode: 'stable' });
  });

  await step('到票支付', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-8-到票支付-before.png`));
    await page.locator('iframe').last().waitFor({ state: 'attached', timeout: 20000 }).catch(() => {});
    const _childFrames = page.frames().filter((f) => f !== page.mainFrame());
    const baseContext = _childFrames.length > 0 ? _childFrames[_childFrames.length - 1]! : page.mainFrame();
    const locator = baseContext.getByRole('button', { name: '到票支付' }).filter({ visible: true }).first();
    await expect(locator).toBeVisible({ timeout: 25000 });
    await smartClick(locator, '到票支付');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-8-到票支付-after.png`), { mode: 'stable' });
  });

  await step('取-消', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-9-取-消-before.png`));
    await page.locator('iframe').last().waitFor({ state: 'attached', timeout: 20000 }).catch(() => {});
    const _childFrames = page.frames().filter((f) => f !== page.mainFrame());
    const baseContext = _childFrames.length > 0 ? _childFrames[_childFrames.length - 1]! : page.mainFrame();
    const locator = baseContext.getByRole('button', { name: '取 消' }).filter({ visible: true }).first();
    await expect(locator).toBeVisible({ timeout: 25000 });
    await smartClick(locator, '取-消');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-9-取-消-after.png`), { mode: 'stable' });
  });

  await step('前期发票付款', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-10-前期发票付款-before.png`));
    await page.locator('iframe').last().waitFor({ state: 'attached', timeout: 20000 }).catch(() => {});
    const _childFrames = page.frames().filter((f) => f !== page.mainFrame());
    const baseContext = _childFrames.length > 0 ? _childFrames[_childFrames.length - 1]! : page.mainFrame();
    const locator = baseContext.getByRole('button', { name: '前期发票付款' }).filter({ visible: true }).first();
    await expect(locator).toBeVisible({ timeout: 25000 });
    await smartClick(locator, '前期发票付款');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-10-前期发票付款-after.png`), { mode: 'stable' });
  });



  // 停止 tracing 由 Playwright 配置自动处理

  console.log('');
  console.log('🎉 测试完成: ' + 'test');
});
