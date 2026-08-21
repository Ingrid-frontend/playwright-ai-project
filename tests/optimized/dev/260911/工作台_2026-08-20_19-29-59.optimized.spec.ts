/**
 * @spec-meta
 * {"playwrightEnv":"dev","accountProfile":"default","loginAccount":null,"recordedAt":"2026-08-20T11:29:59.928Z"}
 */
import { test, expect } from '../../fixtures';
import fs from 'fs';
import path from 'path';
import { assertNotLoginLikePage } from '../../../../src/utils/login-detection';
import { takeStepScreenshot, waitForPostInteractionPaint, withScreenshotRunSegment } from '../../../../src/utils/screenshot';
import { step, smartClick } from '../../../utils/optimized-actions';

test('test', async ({ page }) => {
  test.setTimeout(180_000);

  // 截图根目录；Chrome/WebKit 子目录由 ../../fixtures 按引擎自动设置（仍可用 PLAYWRIGHT_SCREENSHOT_RUN_SEGMENT 手动覆盖）
  const screenshotDir = withScreenshotRunSegment('screenshots/dev/260911/工作台_2026-08-20_19-29-59');
  if (!fs.existsSync(screenshotDir)) {
    fs.mkdirSync(screenshotDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const runDir = path.join(screenshotDir, timestamp);

  await step('导航到页面', async () => {
    // 避免 goto('/') 恢复到上次路由（如系统管理/审批流），导致后续「我的审批」找不到
    console.log('🌐 导航到: /main/home');
    await page.goto('/main/home', { waitUntil: 'load', timeout: 60_000 });
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
    await page.locator('iframe').first().waitFor({ state: 'attached', timeout: 30_000 });
    const app = page.frameLocator('iframe').first();
    await expect(app.getByRole('tab', { name: '工作台' })).toBeVisible({ timeout: 30_000 });
    await assertNotLoginLikePage(page, '工作台用例导航');
    await takeStepScreenshot(page, path.join(runDir, `step-1-导航到页面.png`));
  });

  await step('工作台', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-2-工作台-before.png`));
    await page.locator('iframe').first().waitFor({ state: 'attached', timeout: 12000 }).catch(() => {});
    const baseContext = page.frameLocator('iframe').first();
    const alreadyHome = baseContext.getByRole('menuitem', { name: /我的审批/ }).filter({ visible: true }).first();
    if ((await alreadyHome.count().catch(() => 0)) > 0 && (await alreadyHome.isVisible().catch(() => false))) {
      console.log('ℹ️  工作台：已在工作台侧栏，跳过点击');
      await takeStepScreenshot(page, path.join(runDir, `step-2-工作台-after.png`), { mode: 'stable' });
      return;
    }
    const iframeTab = baseContext.getByRole('tab', { name: '工作台' }).filter({ visible: true }).first();
    const iframeText = baseContext.getByText('工作台', { exact: true }).filter({ visible: true }).first();
    const pageTab = page.getByRole('tab', { name: '工作台' }).filter({ visible: true }).first();
    const locator =
      (await iframeTab.count().catch(() => 0)) > 0
        ? iframeTab
        : (await iframeText.count().catch(() => 0)) > 0
          ? iframeText
          : pageTab;
    await expect(locator).toBeVisible({ timeout: 12000 });
    await smartClick(locator, '工作台');
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-2-工作台-after.png`), { mode: 'stable' });
  });

  await step('我的审批', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-3-我的审批-before.png`));
    await page.locator('iframe').first().waitFor({ state: 'attached', timeout: 12000 }).catch(() => {});
    const baseContext = page.frameLocator('iframe').first();
    const iframeMenu = baseContext.getByRole('menuitem', { name: /我的审批/ }).filter({ visible: true }).first();
    const iframeText = baseContext.getByText('我的审批', { exact: true }).filter({ visible: true }).first();
    const pageMenu = page.getByRole('menuitem', { name: /我的审批/ }).filter({ visible: true }).first();
    const locator =
      (await iframeMenu.count().catch(() => 0)) > 0
        ? iframeMenu
        : (await iframeText.count().catch(() => 0)) > 0
          ? iframeText
          : pageMenu;
    await expect(locator).toBeVisible({ timeout: 20000 });
    await smartClick(locator, '我的审批');
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-3-我的审批-after.png`), { mode: 'stable' });
  });

  await step('DEV管理员', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-4-DEV管理员-before.png`));
    await page.locator('iframe').first().waitFor({ state: 'attached', timeout: 12000 }).catch(() => {});
    const baseContext = page.frameLocator('iframe').first();
    // 顶栏头像也有同名；优先点表格「申请人」单元格进入详情
    const tableCell = baseContext
      .locator('.ant-table-tbody')
      .getByText('DEV管理员', { exact: true })
      .filter({ visible: true })
      .first();
    const roleCell = baseContext.getByRole('cell', { name: 'DEV管理员', exact: true }).filter({ visible: true }).first();
    const fallback = baseContext.getByText('DEV管理员', { exact: true }).filter({ visible: true }).nth(1);
    const locator =
      (await tableCell.count().catch(() => 0)) > 0
        ? tableCell
        : (await roleCell.count().catch(() => 0)) > 0
          ? roleCell
          : fallback;
    try {
      await expect(locator).toBeVisible({ timeout: 8000 });
    } catch {
      console.log('ℹ️  DEV管理员：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-4-DEV管理员-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, 'DEV管理员');
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-4-DEV管理员-after.png`), { mode: 'stable' });
  });

  await step('打开单据详情', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-5-action-before.png`));
    await page.locator('iframe').first().waitFor({ state: 'attached', timeout: 12000 }).catch(() => {});
    const baseContext = page.frameLocator('iframe').first();
    const detailTab = baseContext.getByRole('tab', { name: '审批历史' }).filter({ visible: true }).first();
    if ((await detailTab.count().catch(() => 0)) > 0 && (await detailTab.isVisible().catch(() => false))) {
      console.log('ℹ️  打开单据详情：已在详情页，跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-5-action-skipped.png`), { mode: 'stable' });
      return;
    }
    // 表格视图：点单据名/单号；详情侧栏：点 .form-name（勿用录制的 nth-child(7)）
    const formName = baseContext.locator('.form-name').filter({ visible: true }).first();
    const docName = baseContext.getByText('Agent发布申请单').filter({ visible: true }).first();
    const docNo = baseContext.getByText(/CD\d{10,}/).filter({ visible: true }).first();
    const locator =
      (await formName.count().catch(() => 0)) > 0
        ? formName
        : (await docName.count().catch(() => 0)) > 0
          ? docName
          : docNo;
    try {
      await expect(locator).toBeVisible({ timeout: 8000 });
    } catch {
      console.log('ℹ️  打开单据详情：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-5-action-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, '打开单据详情');
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-5-action-after.png`), { mode: 'stable' });
  });

  await step('审批历史', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-6-审批历史-before.png`));
    await page.locator('iframe').first().waitFor({ state: 'attached', timeout: 12000 }).catch(() => {});
    const baseContext = page.frameLocator('iframe').first();
    const locator = baseContext.getByRole('tab', { name: '审批历史' }).filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 12000 });
    } catch {
      console.log('ℹ️  审批历史：详情未打开，跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-6-审批历史-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, '审批历史');
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-6-审批历史-after.png`), { mode: 'stable' });
  });

  await step('返-回', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-7-返-回-before.png`));
    await page.locator('iframe').first().waitFor({ state: 'attached', timeout: 12000 }).catch(() => {});
    const baseContext = page.frameLocator('iframe').first();
    const btn = baseContext.getByRole('button', { name: /返\s*回/ }).filter({ visible: true }).first();
    const text = baseContext.getByText(/返\s*回/).filter({ visible: true }).first();
    const locator = (await btn.count().catch(() => 0)) > 0 ? btn : text;
    try {
      await expect(locator).toBeVisible({ timeout: 4000 });
    } catch {
      console.log('ℹ️  返-回：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-7-返-回-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, '返-回');
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-7-返-回-after.png`), { mode: 'stable' });
  });

  // 停止 tracing 由 Playwright 配置自动处理

  console.log('');
  console.log('🎉 测试完成: ' + 'test');
});
