import { test, expect } from '../fixtures';
import fs from 'fs';
import path from 'path';
import { takeStepScreenshot, waitForPostInteractionPaint, withScreenshotRunSegment } from '../../../utils/screenshot';
import { step, maybePause, smartClick } from '../../utils/optimized-actions';

test('test', async ({ page }) => {
  test.setTimeout(120000);

  // 截图根目录；Chrome/WebKit 子目录由 ../fixtures 按引擎自动设置（仍可用 PLAYWRIGHT_SCREENSHOT_RUN_SEGMENT 手动覆盖）
  const screenshotDir = withScreenshotRunSegment('screenshots/20260515/报销单-新建与浏览_2026-05-12');
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
    const locator = baseContext.locator('div').filter({ hasText: /^报销单$/ }).nth(2);
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

  await step('新建报销单', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-3-新建报销单-before.png`));
    await page.locator('iframe').first().waitFor({ state: 'attached', timeout: 20000 }).catch(() => {});
    const baseContext = page.frameLocator('iframe').first();
    const locator = baseContext.getByRole('button', { name: '新建报销单' }).filter({ visible: true }).first();
await expect(locator).toBeVisible({ timeout: 25000 });    await smartClick(locator, '新建报销单');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-3-新建报销单-after.png`), { mode: 'stable' });
  });

  await step('action', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-4-action-before.png`));
    await page.locator('iframe').first().waitFor({ state: 'attached', timeout: 20000 }).catch(() => {});
    const baseContext = page.frameLocator('iframe').first();
    const locator = baseContext.locator('#formOid > .ant-select-selection > .ant-select-selection__rendered').filter({ visible: true }).first();
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

  await step('action', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-5-action-before.png`));
    await page.locator('iframe').first().waitFor({ state: 'attached', timeout: 20000 }).catch(() => {});
    const baseContext = page.frameLocator('iframe').first();
    const locator = baseContext.locator('#formOid > .ant-select-selection > .ant-select-selection__rendered > .ant-select-selection__placeholder').filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 6000 });
    } catch {
      console.log('ℹ️  action：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-5-action-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, 'action');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-5-action-after.png`), { mode: 'stable' });
  });

  await step('Close', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-6-Close-before.png`));
    await page.locator('iframe').first().waitFor({ state: 'attached', timeout: 20000 }).catch(() => {});
    const baseContext = page.frameLocator('iframe').first();
    const locator = baseContext.getByRole('button', { name: 'Close', exact: true }).filter({ visible: true }).first();
await expect(locator).toBeVisible({ timeout: 25000 });    await smartClick(locator, 'Close');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-6-Close-after.png`), { mode: 'stable' });
  });

  await step('取-消', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-7-取-消-before.png`));
    await page.locator('iframe').first().waitFor({ state: 'attached', timeout: 20000 }).catch(() => {});
    const baseContext = page.frameLocator('iframe').first();
    const locator = baseContext.getByRole('button', { name: '取 消' }).filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 6000 });
    } catch {
      console.log('ℹ️  取-消：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-7-取-消-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, '取-消');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-7-取-消-after.png`), { mode: 'stable' });
  });

  await step('action', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-8-action-before.png`));
    await page.locator('iframe').first().waitFor({ state: 'attached', timeout: 20000 }).catch(() => {});
    const baseContext = page.frameLocator('iframe').first();
    const locator = baseContext.locator('.anticon.anticon-close > svg').filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 6000 });
    } catch {
      console.log('ℹ️  action：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-8-action-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, 'action');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-8-action-after.png`), { mode: 'stable' });
  });

  await step('action', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-9-action-before.png`));
    await page.locator('iframe').first().waitFor({ state: 'attached', timeout: 20000 }).catch(() => {});
    const baseContext = page.frameLocator('iframe').first();
    const locator = baseContext.locator('.button-text.ant-tooltip-open > .helios-icon').filter({ visible: true }).first();
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

  await step('管理员', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-10-管理员-before.png`));
    await page.locator('iframe').first().waitFor({ state: 'attached', timeout: 20000 }).catch(() => {});
    const baseContext = page.frameLocator('iframe').first();
    const locator = baseContext.getByText('管理员').nth(1).filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 6000 });
    } catch {
      console.log('ℹ️  管理员：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-10-管理员-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, '管理员');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-10-管理员-after.png`), { mode: 'stable' });
  });

  await step('基本信息', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-11-基本信息-before.png`));
    await page.locator('iframe').first().waitFor({ state: 'attached', timeout: 20000 }).catch(() => {});
    const baseContext = page.frameLocator('iframe').first();
    const locator = baseContext.getByText('基本信息').filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 6000 });
    } catch {
      console.log('ℹ️  基本信息：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-11-基本信息-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, '基本信息');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-11-基本信息-after.png`), { mode: 'stable' });
  });

  await step('action', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-12-action-before.png`));
    await page.locator('iframe').first().waitFor({ state: 'attached', timeout: 20000 }).catch(() => {});
    const baseContext = page.frameLocator('iframe').first();
    const locator = baseContext.getByTitle('单据信息').filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 6000 });
    } catch {
      console.log('ℹ️  action：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-12-action-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, 'action');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-12-action-after.png`), { mode: 'stable' });
  });

  await step('费用明细', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-13-费用明细-before.png`));
    await page.locator('iframe').first().waitFor({ state: 'attached', timeout: 20000 }).catch(() => {});
    const baseContext = page.frameLocator('iframe').first();
    const locator = baseContext.getByText('费用明细*').filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 6000 });
    } catch {
      console.log('ℹ️  费用明细：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-13-费用明细-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, '费用明细');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-13-费用明细-after.png`), { mode: 'stable' });
  });

  await step('action', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-14-action-before.png`));
    await page.locator('iframe').first().waitFor({ state: 'attached', timeout: 20000 }).catch(() => {});
    const baseContext = page.frameLocator('iframe').first();
    const locator = baseContext.getByTitle('收款信息').filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 6000 });
    } catch {
      console.log('ℹ️  action：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-14-action-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, 'action');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-14-action-after.png`), { mode: 'stable' });
  });

  await step('查看扩展字段', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-15-查看扩展字段-before.png`));
    await page.locator('iframe').first().waitFor({ state: 'attached', timeout: 20000 }).catch(() => {});
    const baseContext = page.frameLocator('iframe').first();
    const locator = baseContext.getByText('查看扩展字段').filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 6000 });
    } catch {
      console.log('ℹ️  查看扩展字段：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-15-查看扩展字段-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, '查看扩展字段');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-15-查看扩展字段-after.png`), { mode: 'stable' });
  });

  await step('关-闭', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-16-关-闭-before.png`));
    await page.locator('iframe').first().waitFor({ state: 'attached', timeout: 20000 }).catch(() => {});
    const baseContext = page.frameLocator('iframe').first();
    const locator = baseContext.getByRole('button', { name: '关 闭' }).filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 6000 });
    } catch {
      console.log('ℹ️  关-闭：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-16-关-闭-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, '关-闭');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-16-关-闭-after.png`), { mode: 'stable' });
  });

  await step('详情', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-17-详情-before.png`));
    await page.locator('iframe').first().waitFor({ state: 'attached', timeout: 20000 }).catch(() => {});
    const baseContext = page.frameLocator('iframe').first();
    const locator = baseContext.locator('#payment').getByText('详情', { exact: true }).filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 6000 });
    } catch {
      console.log('ℹ️  详情：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-17-详情-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, '详情');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-17-详情-after.png`), { mode: 'stable' });
  });

  await step('Close', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-18-Close-before.png`));
    await page.locator('iframe').first().waitFor({ state: 'attached', timeout: 20000 }).catch(() => {});
    const baseContext = page.frameLocator('iframe').first();
    const locator = baseContext.getByRole('button', { name: 'Close' }).filter({ visible: true }).first();
await expect(locator).toBeVisible({ timeout: 25000 });    await smartClick(locator, 'Close');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-18-Close-after.png`), { mode: 'stable' });
  });

  await step('action', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-19-action-before.png`));
    await page.locator('iframe').first().waitFor({ state: 'attached', timeout: 20000 }).catch(() => {});
    const baseContext = page.frameLocator('iframe').first();
    const locator = baseContext.locator('div').filter({ hasText: '工作台报销单' }).nth(4);
    try {
      await expect(locator).toBeVisible({ timeout: 6000 });
    } catch {
      console.log('ℹ️  action：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-19-action-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, 'action');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-19-action-after.png`), { mode: 'stable' });
  });

  await step('action', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-20-action-before.png`));
    await page.locator('iframe').first().waitFor({ state: 'attached', timeout: 20000 }).catch(() => {});
    const baseContext = page.frameLocator('iframe').first();
    const locator = baseContext.locator('.ant-table-body-inner > .ant-table-fixed > .ant-table-tbody > .ant-table-row.rejected-expense.ant-table-row-hover > .table-header-end > .column-overflow-observe-container > .space > div:nth-child(3) > a').filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 6000 });
    } catch {
      console.log('ℹ️  action：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-20-action-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, 'action');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-20-action-after.png`), { mode: 'stable' });
  });

  await step('取-消', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-21-取-消-before.png`));
    await page.locator('iframe').first().waitFor({ state: 'attached', timeout: 20000 }).catch(() => {});
    const baseContext = page.frameLocator('iframe').first();
    const locator = baseContext.getByRole('button', { name: '取 消' }).filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 6000 });
    } catch {
      console.log('ℹ️  取-消：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-21-取-消-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, '取-消');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-21-取-消-after.png`), { mode: 'stable' });
  });

  await step('action', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-22-action-before.png`));
    await page.locator('iframe').first().waitFor({ state: 'attached', timeout: 20000 }).catch(() => {});
    const baseContext = page.frameLocator('iframe').first();
    const locator = baseContext.locator('.ant-table-body-inner > .ant-table-fixed > .ant-table-tbody > .ant-table-row.rejected-expense.ant-table-row-hover > .table-header-end > .column-overflow-observe-container > .space > div > a').first();
    try {
      await expect(locator).toBeVisible({ timeout: 6000 });
    } catch {
      console.log('ℹ️  action：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-22-action-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, 'action');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-22-action-after.png`), { mode: 'stable' });
  });

  await step('action', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-23-action-before.png`));
    await page.locator('iframe').first().waitFor({ state: 'attached', timeout: 20000 }).catch(() => {});
    const baseContext = page.frameLocator('iframe').first();
    const locator = baseContext.locator('.slide-title > .warp-svg-icon > .helios-icon').first();
    try {
      await expect(locator).toBeVisible({ timeout: 6000 });
    } catch {
      console.log('ℹ️  action：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-23-action-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, 'action');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-23-action-after.png`), { mode: 'stable' });
  });

  await step('其他费用', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-24-其他费用-before.png`));
    await page.locator('iframe').first().waitFor({ state: 'attached', timeout: 20000 }).catch(() => {});
    const baseContext = page.frameLocator('iframe').first();
    const locator = baseContext.getByText('其他费用').filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 6000 });
    } catch {
      console.log('ℹ️  其他费用：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-24-其他费用-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, '其他费用');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-24-其他费用-after.png`), { mode: 'stable' });
  });



  // 停止 tracing 由 Playwright 配置自动处理

  console.log('');
  console.log('🎉 测试完成: ' + 'test');
});
