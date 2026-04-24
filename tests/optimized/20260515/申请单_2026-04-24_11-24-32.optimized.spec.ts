import { test, expect } from '../fixtures';
import fs from 'fs';
import path from 'path';
import { takeStepScreenshot, waitForPostInteractionPaint, withScreenshotRunSegment } from '../../../utils/screenshot';
import { step, maybePause, smartClick } from '../../utils/optimized-actions';

test('test', async ({ page }) => {
  test.setTimeout(120000);

  // 初始化截图目录（PLAYWRIGHT_SCREENSHOT_RUN_SEGMENT 用于多浏览器串跑分子目录）
  const screenshotDir = withScreenshotRunSegment('screenshots/20260515/申请单_2026-04-24_11-24-32');
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

  await step('申请单', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-2-申请单-before.png`));
    const locator = page.getByText('申请单', { exact: true }).filter({ visible: true }).first();
    await expect(locator).toBeVisible({ timeout: 5000 });
    await smartClick(locator, '申请单');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-2-申请单-after.png`), { mode: 'stable' });
  });

  await step('action', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-3-action-before.png`));
    await page.locator('iframe').last().waitFor({ state: 'attached', timeout: 20000 }).catch(() => {});
    const _childFrames = page.frames().filter((f) => f !== page.mainFrame());
    const baseContext = _childFrames.length > 0 ? _childFrames[_childFrames.length - 1]! : page.mainFrame();
    // 关闭按钮：可能在主页面 Modal（挡住 iframe）或子框架内；AntD 多为 .ant-modal-close，而非 anticon-close > svg
    const closeName = /close|关闭/i;
    const mainClose = page
      .locator('.ant-modal-wrap:visible')
      .getByRole('button', { name: closeName })
      .or(page.locator('.ant-modal-wrap:visible .ant-modal-close'))
      .first();
    const frameClose = baseContext
      .getByRole('button', { name: closeName })
      .or(baseContext.locator('.ant-modal-close, .ant-drawer-close, .anticon.anticon-close'))
      .first();
    const locator = (await mainClose.isVisible().catch(() => false)) ? mainClose : frameClose;
    await expect(locator).toBeVisible({ timeout: 25000 });
    await smartClick(locator, 'action');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-3-action-after.png`), { mode: 'stable' });
  });

  await step('UI走查测试', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-4-UI走查测试-before.png`));
    await page.locator('iframe').last().waitFor({ state: 'attached', timeout: 20000 }).catch(() => {});
    const _childFrames = page.frames().filter((f) => f !== page.mainFrame());
    const baseContext = _childFrames.length > 0 ? _childFrames[_childFrames.length - 1]! : page.mainFrame();
    const locator = baseContext.getByText('UI走查测试').filter({ visible: true }).first();
    await expect(locator).toBeVisible({ timeout: 25000 });
    await smartClick(locator, 'UI走查测试');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-4-UI走查测试-after.png`), { mode: 'stable' });
  });

  await step('1', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-5-1-before.png`));
    await page.locator('iframe').last().waitFor({ state: 'attached', timeout: 20000 }).catch(() => {});
    const _childFrames = page.frames().filter((f) => f !== page.mainFrame());
    const baseContext = _childFrames.length > 0 ? _childFrames[_childFrames.length - 1]! : page.mainFrame();
    const locator = baseContext.getByRole('cell', { name: '1' }).filter({ visible: true }).first();
    await expect(locator).toBeVisible({ timeout: 25000 });
    // 表格单元格常被发票助手等浮层挡住指针，force 与录制目标一致时可用
    await smartClick(locator, '1', { force: true });
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-5-1-after.png`), { mode: 'stable' });
  });

  await step('轮船', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-6-轮船-before.png`));
    await page.locator('iframe').last().waitFor({ state: 'attached', timeout: 20000 }).catch(() => {});
    const _childFrames = page.frames().filter((f) => f !== page.mainFrame());
    const baseContext = _childFrames.length > 0 ? _childFrames[_childFrames.length - 1]! : page.mainFrame();
    const locator = baseContext.locator('[id="1901974039556173826"]').getByText('轮船').filter({ visible: true }).first();
    await expect(locator).toBeVisible({ timeout: 25000 });
    await smartClick(locator, '轮船');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-6-轮船-after.png`), { mode: 'stable' });
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

  await step('新建行程', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-8-新建行程-before.png`));
    await page.locator('iframe').last().waitFor({ state: 'attached', timeout: 20000 }).catch(() => {});
    const _childFrames = page.frames().filter((f) => f !== page.mainFrame());
    const baseContext = _childFrames.length > 0 ? _childFrames[_childFrames.length - 1]! : page.mainFrame();
    const locator = baseContext.getByRole('button', { name: '新建行程' }).filter({ visible: true }).first();
    await expect(locator).toBeVisible({ timeout: 25000 });
    await smartClick(locator, '新建行程');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-8-新建行程-after.png`), { mode: 'stable' });
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

  await step('计算差补', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-10-计算差补-before.png`));
    await page.locator('iframe').last().waitFor({ state: 'attached', timeout: 20000 }).catch(() => {});
    const _childFrames = page.frames().filter((f) => f !== page.mainFrame());
    const baseContext = _childFrames.length > 0 ? _childFrames[_childFrames.length - 1]! : page.mainFrame();
    const locator = baseContext.getByRole('button', { name: '计算差补' }).filter({ visible: true }).first();
    await expect(locator).toBeVisible({ timeout: 25000 });
    await smartClick(locator, '计算差补');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-10-计算差补-after.png`), { mode: 'stable' });
  });

  await step('取-消', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-11-取-消-before.png`));
    await page.locator('iframe').last().waitFor({ state: 'attached', timeout: 20000 }).catch(() => {});
    const _childFrames = page.frames().filter((f) => f !== page.mainFrame());
    const baseContext = _childFrames.length > 0 ? _childFrames[_childFrames.length - 1]! : page.mainFrame();
    const locator = baseContext.getByRole('button', { name: '取 消' }).filter({ visible: true }).first();
    await expect(locator).toBeVisible({ timeout: 25000 });
    await smartClick(locator, '取-消');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-11-取-消-after.png`), { mode: 'stable' });
  });

  await step('批量删除明细', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-12-批量删除明细-before.png`));
    await page.locator('iframe').last().waitFor({ state: 'attached', timeout: 20000 }).catch(() => {});
    const _childFrames = page.frames().filter((f) => f !== page.mainFrame());
    const baseContext = _childFrames.length > 0 ? _childFrames[_childFrames.length - 1]! : page.mainFrame();
    const locator = baseContext.getByRole('button', { name: '批量删除明细' }).filter({ visible: true }).first();
    await expect(locator).toBeVisible({ timeout: 25000 });
    await smartClick(locator, '批量删除明细');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-12-批量删除明细-after.png`), { mode: 'stable' });
  });



  // 停止 tracing 由 Playwright 配置自动处理

  console.log('');
  console.log('🎉 测试完成: ' + 'test');
});
