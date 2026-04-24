import { test, expect } from '../fixtures';
import fs from 'fs';
import path from 'path';
import { takeStepScreenshot, waitForPostInteractionPaint, withScreenshotRunSegment } from '../../../utils/screenshot';
import { step, maybePause, smartClick } from '../../utils/optimized-actions';

test('test', async ({ page }) => {
  test.setTimeout(120000);

  // 初始化截图目录（PLAYWRIGHT_SCREENSHOT_RUN_SEGMENT 用于多浏览器串跑分子目录）
  const screenshotDir = withScreenshotRunSegment('screenshots/20260515/我的审批_2026-04-24_10-50-01');
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

  await step('我的审批', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-2-我的审批-before.png`));
    const locator = page.getByText('我的审批').filter({ visible: true }).first();
    await expect(locator).toBeVisible({ timeout: 5000 });
    await smartClick(locator, '我的审批');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-2-我的审批-after.png`), { mode: 'stable' });
  });

  await step('已审批', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-3-已审批-before.png`));
    await page.locator('iframe').last().waitFor({ state: 'attached', timeout: 20000 }).catch(() => {});
    const _childFrames = page.frames().filter((f) => f !== page.mainFrame());
    const baseContext = _childFrames.length > 0 ? _childFrames[_childFrames.length - 1]! : page.mainFrame();
    const locator = baseContext.getByRole('tab', { name: '已审批' }).filter({ visible: true }).first();
    await expect(locator).toBeVisible({ timeout: 25000 });
    await smartClick(locator, '已审批');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-3-已审批-after.png`), { mode: 'stable' });
  });

  await step('抄送我', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-4-抄送我-before.png`));
    await page.locator('iframe').last().waitFor({ state: 'attached', timeout: 20000 }).catch(() => {});
    const _childFrames = page.frames().filter((f) => f !== page.mainFrame());
    const baseContext = _childFrames.length > 0 ? _childFrames[_childFrames.length - 1]! : page.mainFrame();
    const locator = baseContext.getByText('抄送我').filter({ visible: true }).first();
    await expect(locator).toBeVisible({ timeout: 25000 });
    await smartClick(locator, '抄送我');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-4-抄送我-after.png`), { mode: 'stable' });
  });

  await step('已读', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-5-已读-before.png`));
    await page.locator('iframe').last().waitFor({ state: 'attached', timeout: 20000 }).catch(() => {});
    const _childFrames = page.frames().filter((f) => f !== page.mainFrame());
    const baseContext = _childFrames.length > 0 ? _childFrames[_childFrames.length - 1]! : page.mainFrame();
    const locator = baseContext.getByRole('tab', { name: '已读' }).filter({ visible: true }).first();
    await expect(locator).toBeVisible({ timeout: 25000 });
    await smartClick(locator, '已读');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-5-已读-after.png`), { mode: 'stable' });
  });

  await step('操作历史', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-6-操作历史-before.png`));
    await page.locator('iframe').last().waitFor({ state: 'attached', timeout: 20000 }).catch(() => {});
    const _childFrames = page.frames().filter((f) => f !== page.mainFrame());
    const baseContext = _childFrames.length > 0 ? _childFrames[_childFrames.length - 1]! : page.mainFrame();
    const locator = baseContext.getByRole('tab', { name: '操作历史' }).filter({ visible: true }).first();
    await expect(locator).toBeVisible({ timeout: 25000 });
    await smartClick(locator, '操作历史');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-6-操作历史-after.png`), { mode: 'stable' });
  });

  await step('FYBXD202412110005', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-7-FYBXD202412110005-before.png`));
    await page.locator('iframe').last().waitFor({ state: 'attached', timeout: 20000 }).catch(() => {});
    const _childFrames = page.frames().filter((f) => f !== page.mainFrame());
    const baseContext = _childFrames.length > 0 ? _childFrames[_childFrames.length - 1]! : page.mainFrame();
    const locator = baseContext.locator('#helios-content-id').getByText('FYBXD202412110005').filter({ visible: true }).first();
    await expect(locator).toBeVisible({ timeout: 25000 });
    await smartClick(locator, 'FYBXD202412110005');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-7-FYBXD202412110005-after.png`), { mode: 'stable' });
  });



  // 停止 tracing 由 Playwright 配置自动处理

  console.log('');
  console.log('🎉 测试完成: ' + 'test');
});
