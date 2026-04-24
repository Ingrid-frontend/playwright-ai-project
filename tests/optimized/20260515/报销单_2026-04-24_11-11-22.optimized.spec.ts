import { test, expect } from '../fixtures';
import fs from 'fs';
import path from 'path';
import { takeStepScreenshot, waitForPostInteractionPaint, withScreenshotRunSegment } from '../../../utils/screenshot';
import { step, maybePause, smartClick } from '../../utils/optimized-actions';

test('test', async ({ page }) => {
  test.setTimeout(120000);

  // 初始化截图目录（PLAYWRIGHT_SCREENSHOT_RUN_SEGMENT 用于多浏览器串跑分子目录）
  const screenshotDir = withScreenshotRunSegment('screenshots/20260515/报销单_2026-04-24_11-11-22');
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

  await step('报销单', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-2-报销单-before.png`));
    const locator = page.getByText('报销单').filter({ visible: true }).first();
    await expect(locator).toBeVisible({ timeout: 5000 });
    await smartClick(locator, '报销单');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-2-报销单-after.png`), { mode: 'stable' });
  });

  await step('action', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-3-action-before.png`));
    await page.locator('iframe').last().waitFor({ state: 'attached', timeout: 20000 }).catch(() => {});
    const _childFrames = page.frames().filter((f) => f !== page.mainFrame());
    const baseContext = _childFrames.length > 0 ? _childFrames[_childFrames.length - 1]! : page.mainFrame();
    const locator = baseContext.locator('.anticon.anticon-close > svg').filter({ visible: true }).first();
    await expect(locator).toBeVisible({ timeout: 25000 });
    await smartClick(locator, 'action');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-3-action-after.png`), { mode: 'stable' });
  });

  await step('action', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-4-action-before.png`));
    await page.locator('iframe').last().waitFor({ state: 'attached', timeout: 20000 }).catch(() => {});
    const _childFrames = page.frames().filter((f) => f !== page.mainFrame());
    const baseContext = _childFrames.length > 0 ? _childFrames[_childFrames.length - 1]! : page.mainFrame();
    const locator = baseContext.getByRole('row', { name: '+ 图标: down' }).getByLabel('', { exact: true }).filter({ visible: true }).first();
    await expect(locator).toBeVisible({ timeout: 25000 });
    try {
      await locator.waitFor({ state: 'visible', timeout: this.actionUsesIframeContext(action) ? 25000 : 10000 });
    } catch (e) {
      console.log('⚠️ 元素不可见，尝试暂停调试');
      await maybePause(page, '元素不可见');
    }
    try {
      await locator.check();
    } catch (e) {
      console.log(`⚠️ 勾选失败: ${e.message}`);
      await maybePause(page, '勾选失败');
    }
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-4-action-after.png`), { mode: 'stable' });
  });

  await step('1', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-5-1-before.png`));
    await page.locator('iframe').last().waitFor({ state: 'attached', timeout: 20000 }).catch(() => {});
    const _childFrames = page.frames().filter((f) => f !== page.mainFrame());
    const baseContext = _childFrames.length > 0 ? _childFrames[_childFrames.length - 1]! : page.mainFrame();
    const locator = baseContext.getByRole('cell', { name: '1', exact: true }).filter({ visible: true }).first();
    await expect(locator).toBeVisible({ timeout: 25000 });
    await smartClick(locator, '1');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-5-1-after.png`), { mode: 'stable' });
  });

  await step('其他费用', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-6-其他费用-before.png`));
    await page.locator('iframe').last().waitFor({ state: 'attached', timeout: 20000 }).catch(() => {});
    const _childFrames = page.frames().filter((f) => f !== page.mainFrame());
    const baseContext = _childFrames.length > 0 ? _childFrames[_childFrames.length - 1]! : page.mainFrame();
    const locator = baseContext.getByText('其他费用').filter({ visible: true }).first();
    await expect(locator).toBeVisible({ timeout: 25000 });
    await smartClick(locator, '其他费用');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-6-其他费用-after.png`), { mode: 'stable' });
  });

  await step('取-消', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-7-取-消-before.png`));
    await page.locator('iframe').last().waitFor({ state: 'attached', timeout: 20000 }).catch(() => {});
    const _childFrames = page.frames().filter((f) => f !== page.mainFrame());
    const baseContext = _childFrames.length > 0 ? _childFrames[_childFrames.length - 1]! : page.mainFrame();
    const locator = baseContext.getByRole('button', { name: '取 消' }).filter({ visible: true }).first();
    await expect(locator).toBeVisible({ timeout: 25000 });
    await smartClick(locator, '取-消');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-7-取-消-after.png`), { mode: 'stable' });
  });

  await step('查看扩展字段', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-8-查看扩展字段-before.png`));
    await page.locator('iframe').last().waitFor({ state: 'attached', timeout: 20000 }).catch(() => {});
    const _childFrames = page.frames().filter((f) => f !== page.mainFrame());
    const baseContext = _childFrames.length > 0 ? _childFrames[_childFrames.length - 1]! : page.mainFrame();
    const locator = baseContext.getByText('查看扩展字段').filter({ visible: true }).first();
    await expect(locator).toBeVisible({ timeout: 25000 });
    await smartClick(locator, '查看扩展字段');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-8-查看扩展字段-after.png`), { mode: 'stable' });
  });

  // 停止 tracing 由 Playwright 配置自动处理

  console.log('');
  console.log('🎉 测试完成: ' + 'test');
});
