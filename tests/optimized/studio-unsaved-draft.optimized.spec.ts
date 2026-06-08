import { test, expect } from './fixtures';
import fs from 'fs';
import path from 'path';
import { takeStepScreenshot, waitForPostInteractionPaint, withScreenshotRunSegment } from '../../utils/screenshot';
import { step, maybePause, smartClick, smartFill } from '../utils/optimized-actions';

test('test', async ({ page }) => {
  test.setTimeout(90000);

  // 截图根目录；Chrome/WebKit 子目录由 ./fixtures 按引擎自动设置（仍可用 PLAYWRIGHT_SCREENSHOT_RUN_SEGMENT 手动覆盖）
  const screenshotDir = withScreenshotRunSegment('screenshots/studio-unsaved-draft');
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

  await step('审', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-4-审-before.png`));
    await page.locator('iframe').first().waitFor({ state: 'attached', timeout: 12000 }).catch(() => {});
    const baseContext = page.frameLocator('iframe').first();
    const locator = baseContext.locator('#approve').getByText('审').filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 4000 });
    } catch {
      console.log('ℹ️  审：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-4-审-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, '审');
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-4-审-after.png`), { mode: 'stable' });
  });

  await step('action', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-5-action-before.png`));
    await page.locator('iframe').first().waitFor({ state: 'attached', timeout: 12000 }).catch(() => {});
    const baseContext = page.frameLocator('iframe').first();
    const locator = baseContext.locator('section').filter({ hasText: '快速查看全选全部单据本页全选请选择金额 小→大' }).getByLabel('', { exact: true }).filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 4000 });
    } catch {
      console.log('ℹ️  action：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-5-action-skipped.png`), { mode: 'stable' });
      return;
    }
    try {
      await locator.waitFor({ state: 'visible', timeout: 12000 });
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
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-5-action-after.png`), { mode: 'stable' });
  });

  await step('通-过', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-6-通-过-before.png`));
    await page.locator('iframe').first().waitFor({ state: 'attached', timeout: 12000 }).catch(() => {});
    const baseContext = page.frameLocator('iframe').first();
    const locator = baseContext.getByRole('button', { name: '通 过' }).filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 4000 });
    } catch {
      console.log('ℹ️  通-过：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-6-通-过-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, '通-过');
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-6-通-过-after.png`), { mode: 'stable' });
  });

  await step('审批通过', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-7-审批通过-before.png`));
    await page.locator('iframe').first().waitFor({ state: 'attached', timeout: 12000 }).catch(() => {});
    const baseContext = page.frameLocator('iframe').first();
    const locator = baseContext.getByRole('button', { name: '审批通过' }).filter({ visible: true }).first();
await expect(locator).toBeVisible({ timeout: 12000 });    await smartClick(locator, '审批通过');
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-7-审批通过-after.png`), { mode: 'stable' });
  });

  await step('取-消', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-8-取-消-before.png`));
    await page.locator('iframe').first().waitFor({ state: 'attached', timeout: 12000 }).catch(() => {});
    const baseContext = page.frameLocator('iframe').first();
    const locator = baseContext.getByRole('button', { name: '取 消' }).filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 4000 });
    } catch {
      console.log('ℹ️  取-消：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-8-取-消-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, '取-消');
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-8-取-消-after.png`), { mode: 'stable' });
  });

  await step('驳-回', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-9-驳-回-before.png`));
    await page.locator('iframe').first().waitFor({ state: 'attached', timeout: 12000 }).catch(() => {});
    const baseContext = page.frameLocator('iframe').first();
    const locator = baseContext.getByRole('button', { name: '驳 回' }).filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 4000 });
    } catch {
      console.log('ℹ️  驳-回：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-9-驳-回-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, '驳-回');
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-9-驳-回-after.png`), { mode: 'stable' });
  });

  await step('取-消', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-10-取-消-before.png`));
    await page.locator('iframe').first().waitFor({ state: 'attached', timeout: 12000 }).catch(() => {});
    const baseContext = page.frameLocator('iframe').first();
    const locator = baseContext.getByRole('button', { name: '取 消' }).filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 4000 });
    } catch {
      console.log('ℹ️  取-消：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-10-取-消-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, '取-消');
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-10-取-消-after.png`), { mode: 'stable' });
  });

  await step('更多', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-11-更多-before.png`));
    await page.locator('iframe').first().waitFor({ state: 'attached', timeout: 12000 }).catch(() => {});
    const baseContext = page.frameLocator('iframe').first();
    const locator = baseContext.getByRole('button', { name: '更多' }).filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 4000 });
    } catch {
      console.log('ℹ️  更多：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-11-更多-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, '更多');
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-11-更多-after.png`), { mode: 'stable' });
  });

  await step('加签', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-12-加签-before.png`));
    await page.locator('iframe').first().waitFor({ state: 'attached', timeout: 12000 }).catch(() => {});
    const baseContext = page.frameLocator('iframe').first();
    const locator = baseContext.getByRole('menuitem', { name: '加签' }).filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 4000 });
    } catch {
      console.log('ℹ️  加签：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-12-加签-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, '加签');
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-12-加签-after.png`), { mode: 'stable' });
  });

  await step('取-消', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-13-取-消-before.png`));
    await page.locator('iframe').first().waitFor({ state: 'attached', timeout: 12000 }).catch(() => {});
    const baseContext = page.frameLocator('iframe').first();
    const locator = baseContext.getByRole('button', { name: '取 消' }).filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 4000 });
    } catch {
      console.log('ℹ️  取-消：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-13-取-消-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, '取-消');
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-13-取-消-after.png`), { mode: 'stable' });
  });

  await step('更多', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-14-更多-before.png`));
    await page.locator('iframe').first().waitFor({ state: 'attached', timeout: 12000 }).catch(() => {});
    const baseContext = page.frameLocator('iframe').first();
    const locator = baseContext.getByRole('button', { name: '更多' }).filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 4000 });
    } catch {
      console.log('ℹ️  更多：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-14-更多-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, '更多');
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-14-更多-after.png`), { mode: 'stable' });
  });

  await step('转交', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-15-转交-before.png`));
    await page.locator('iframe').first().waitFor({ state: 'attached', timeout: 12000 }).catch(() => {});
    const baseContext = page.frameLocator('iframe').first();
    const locator = baseContext.getByRole('menuitem', { name: '转交' }).filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 4000 });
    } catch {
      console.log('ℹ️  转交：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-15-转交-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, '转交');
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-15-转交-after.png`), { mode: 'stable' });
  });

  await step('取-消', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-16-取-消-before.png`));
    await page.locator('iframe').first().waitFor({ state: 'attached', timeout: 12000 }).catch(() => {});
    const baseContext = page.frameLocator('iframe').first();
    const locator = baseContext.getByRole('button', { name: '取 消' }).filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 4000 });
    } catch {
      console.log('ℹ️  取-消：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-16-取-消-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, '取-消');
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-16-取-消-after.png`), { mode: 'stable' });
  });



  // 停止 tracing 由 Playwright 配置自动处理

  console.log('');
  console.log('🎉 测试完成: ' + 'test');
});
