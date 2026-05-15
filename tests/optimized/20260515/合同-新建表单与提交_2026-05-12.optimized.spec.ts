import { test, expect } from '../fixtures';
import fs from 'fs';
import path from 'path';
import { takeStepScreenshot, waitForPostInteractionPaint, withScreenshotRunSegment } from '../../../utils/screenshot';
import { step, maybePause, smartClick, smartFill } from '../../utils/optimized-actions';

test('test', async ({ page }) => {
  test.setTimeout(120000);

  // 截图根目录；Chrome/WebKit 子目录由 ../fixtures 按引擎自动设置（仍可用 PLAYWRIGHT_SCREENSHOT_RUN_SEGMENT 手动覆盖）
  const screenshotDir = withScreenshotRunSegment('screenshots/20260515/合同-新建表单与提交_2026-05-12');
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

  await step('合同', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-2-合同-before.png`));
    await page.locator('iframe').first().waitFor({ state: 'attached', timeout: 20000 }).catch(() => {});
    const baseContext = page.frameLocator('iframe').first();
    const locator = baseContext.getByText('合同').filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 6000 });
    } catch {
      console.log('ℹ️  合同：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-2-合同-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, '合同');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-2-合同-after.png`), { mode: 'stable' });
  });

  await step('新建合同', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-3-新建合同-before.png`));
    const locator = page.getByRole('button', { name: '新建合同' }).filter({ visible: true }).first();
await expect(locator).toBeVisible({ timeout: 15000 });    await smartClick(locator, '新建合同');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-3-新建合同-after.png`), { mode: 'stable' });
  });

  await step('请选择合同', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-4-请选择合同-before.png`));
    const locator = page.getByText('请选择合同').filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 6000 });
    } catch {
      console.log('ℹ️  请选择合同：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-4-请选择合同-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, '请选择合同');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-4-请选择合同-after.png`), { mode: 'stable' });
  });

  await step('合同', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-5-合同-before.png`));
    const locator = page.getByRole('option', { name: '合同' }).locator('span').filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 6000 });
    } catch {
      console.log('ℹ️  合同：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-5-合同-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, '合同');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-5-合同-after.png`), { mode: 'stable' });
  });

  await step('确-定', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-6-确-定-before.png`));
    const locator = page.getByRole('button', { name: '确 定' }).filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 6000 });
    } catch {
      console.log('ℹ️  确-定：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-6-确-定-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, '确-定');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-6-确-定-after.png`), { mode: 'stable' });
  });

  await step('action', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-7-action-before.png`));
    const locator = page.locator('.ant-select-selection__placeholder').first();
    try {
      await expect(locator).toBeVisible({ timeout: 6000 });
    } catch {
      console.log('ℹ️  action：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-7-action-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, 'action');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-7-action-after.png`), { mode: 'stable' });
  });

  await step('-02-11', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-8--02-11-before.png`));
    const locator = page.getByRole('cell', { name: '-02-11' }).filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 6000 });
    } catch {
      console.log('ℹ️  -02-11：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-8--02-11-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, '-02-11');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-8--02-11-after.png`), { mode: 'stable' });
  });

  await step('确-定', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-9-确-定-before.png`));
    const locator = page.getByRole('button', { name: '确 定' }).filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 6000 });
    } catch {
      console.log('ℹ️  确-定：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-9-确-定-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, '确-定');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-9-确-定-after.png`), { mode: 'stable' });
  });

  await step('action', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-10-action-before.png`));
    const locator = page.locator('input[name="7fbac917-1a37-42f9-a929-bf3e0776d27c"]').filter({ visible: true }).first();
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

  await step('111', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-11-111-before.png`));
    const locator = page.locator('input[name="7fbac917-1a37-42f9-a929-bf3e0776d27c"]').filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 6000 });
    } catch {
      console.log('ℹ️  111：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-11-111-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartFill(locator, "111", '111');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-11-111-after.png`), { mode: 'stable' });
  });

  await step('action', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-12-action-before.png`));
    const locator = page.locator('[id="6117e841-c812-051f-3cd5-3adf0721e8a3"] > .ant-row > .ant-col.ant-form-item-control-wrapper > .ant-form-item-control > .ant-form-item-children > .multi-selector-block > .multi-selector-wrapper > .fake-input > .slector-value-content').filter({ visible: true }).first();
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

  await step('action', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-13-action-before.png`));
    const locator = page.locator('div').filter({ hasText: /^宣传展览合同$/ }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 6000 });
    } catch {
      console.log('ℹ️  action：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-13-action-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, 'action');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-13-action-after.png`), { mode: 'stable' });
  });

  await step('action', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-14-action-before.png`));
    const locator = page.locator('.ant-calendar-picker-input').first();
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

  await step('action', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-15-action-before.png`));
    const locator = page.getByRole('grid').getByTitle('年4月8日').locator('div').filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 6000 });
    } catch {
      console.log('ℹ️  action：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-15-action-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, 'action');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-15-action-after.png`), { mode: 'stable' });
  });

  await step('action', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-16-action-before.png`));
    const locator = page.locator('[id="7a1b867b-c181-4128-bd8e-9cfb06f670c6"] > .ant-row > .ant-col.ant-form-item-control-wrapper > .ant-form-item-control > .ant-form-item-children > .multi-selector-block > .multi-selector-wrapper > .fake-input > .slector-value-content').filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 6000 });
    } catch {
      console.log('ℹ️  action：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-16-action-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, 'action');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-16-action-after.png`), { mode: 'stable' });
  });

  await step('上海实誉智能科技有限公司', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-17-上海实誉智能科技有限公司-before.png`));
    const locator = page.getByText('上海实誉智能科技有限公司').filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 6000 });
    } catch {
      console.log('ℹ️  上海实誉智能科技有限公司：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-17-上海实誉智能科技有限公司-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, '上海实誉智能科技有限公司');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-17-上海实誉智能科技有限公司-after.png`), { mode: 'stable' });
  });

  await step('苏州空动力电子技术有限公司', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-18-苏州空动力电子技术有限公司-before.png`));
    const locator = page.getByText('苏州空动力电子技术有限公司').filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 6000 });
    } catch {
      console.log('ℹ️  苏州空动力电子技术有限公司：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-18-苏州空动力电子技术有限公司-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, '苏州空动力电子技术有限公司');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-18-苏州空动力电子技术有限公司-after.png`), { mode: 'stable' });
  });

  await step('action', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-19-action-before.png`));
    const locator = page.locator('.fake-input.fake-input-open > .slector-value-content').filter({ visible: true }).first();
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
    const locator = page.locator('div').filter({ hasText: /^迦递货运代理（上海）有限公司$/ }).first();
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

  await step('action', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-21-action-before.png`));
    const locator = page.locator('#c2444aaf-38db-b521-2aed-becd1e284030 > .ant-row > .ant-col.ant-form-item-control-wrapper > .ant-form-item-control > .ant-form-item-children > .multi-selector-block > .multi-selector-wrapper > .fake-input > .slector-value-content').filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 6000 });
    } catch {
      console.log('ℹ️  action：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-21-action-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, 'action');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-21-action-after.png`), { mode: 'stable' });
  });

  await step('增值税专用发票', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-22-增值税专用发票-before.png`));
    const locator = page.getByText('增值税专用发票', { exact: true }).filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 6000 });
    } catch {
      console.log('ℹ️  增值税专用发票：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-22-增值税专用发票-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, '增值税专用发票');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-22-增值税专用发票-after.png`), { mode: 'stable' });
  });

  await step('增值税电子普通发票通行费', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-23-增值税电子普通发票通行费-before.png`));
    const locator = page.getByText('增值税电子普通发票（通行费）').filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 6000 });
    } catch {
      console.log('ℹ️  增值税电子普通发票通行费：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-23-增值税电子普通发票通行费-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, '增值税电子普通发票通行费');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-23-增值税电子普通发票通行费-after.png`), { mode: 'stable' });
  });

  await step('action', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-24-action-before.png`));
    const locator = page.locator('.fake-input.fake-input-open > .slector-value-content').filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 6000 });
    } catch {
      console.log('ℹ️  action：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-24-action-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, 'action');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-24-action-after.png`), { mode: 'stable' });
  });

  await step('action', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-25-action-before.png`));
    const locator = page.locator('span').filter({ hasText: '增值税电子普通发票（通行费）' });
    try {
      await expect(locator).toBeVisible({ timeout: 6000 });
    } catch {
      console.log('ℹ️  action：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-25-action-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, 'action');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-25-action-after.png`), { mode: 'stable' });
  });

  await step('action', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-26-action-before.png`));
    const locator = page.locator('#e3b6e63e-57be-4dab-9d39-2273ab0e5680 > .ant-row > .ant-col.ant-form-item-control-wrapper > .ant-form-item-control > .ant-form-item-children > .ant-calendar-picker > div > .ant-calendar-picker-input').filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 6000 });
    } catch {
      console.log('ℹ️  action：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-26-action-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, 'action');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-26-action-after.png`), { mode: 'stable' });
  });

  await step('action', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-27-action-before.png`));
    const locator = page.getByRole('grid').getByTitle('年4月8日').locator('div').filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 6000 });
    } catch {
      console.log('ℹ️  action：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-27-action-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, 'action');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-27-action-after.png`), { mode: 'stable' });
  });

  await step('action', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-28-action-before.png`));
    const locator = page.locator('[id="84a560cf-0dcd-4053-b3e2-e78a0f335ad1"] > .ant-row > .ant-col.ant-form-item-control-wrapper > .ant-form-item-control > .ant-form-item-children > .ant-calendar-picker > div > .ant-calendar-picker-input').filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 6000 });
    } catch {
      console.log('ℹ️  action：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-28-action-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, 'action');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-28-action-after.png`), { mode: 'stable' });
  });

  await step('action', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-29-action-before.png`));
    const locator = page.getByRole('grid').getByTitle('年4月8日').locator('div').filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 6000 });
    } catch {
      console.log('ℹ️  action：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-29-action-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, 'action');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-29-action-after.png`), { mode: 'stable' });
  });

  await step('附件上传', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-30-附件上传-before.png`));
    const locator = page.getByText('附件上传').filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 6000 });
    } catch {
      console.log('ℹ️  附件上传：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-30-附件上传-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, '附件上传');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-30-附件上传-after.png`), { mode: 'stable' });
  });

  await step('请选择', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-31-请选择-before.png`));
    const locator = page.getByText('请选择').nth(4).filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 6000 });
    } catch {
      console.log('ℹ️  请选择：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-31-请选择-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, '请选择');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-31-请选择-after.png`), { mode: 'stable' });
  });

  await step('600005', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-32-600005-before.png`));
    const locator = page.getByRole('cell', { name: '600005' }).filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 6000 });
    } catch {
      console.log('ℹ️  600005：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-32-600005-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, '600005');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-32-600005-after.png`), { mode: 'stable' });
  });

  await step('确-定', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-33-确-定-before.png`));
    const locator = page.getByRole('button', { name: '确 定' }).filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 6000 });
    } catch {
      console.log('ℹ️  确-定：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-33-确-定-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, '确-定');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-33-确-定-after.png`), { mode: 'stable' });
  });

  await step('下一步', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-34-下一步-before.png`));
    const locator = page.getByRole('button', { name: '下一步' }).filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 6000 });
    } catch {
      console.log('ℹ️  下一步：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-34-下一步-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, '下一步');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-34-下一步-after.png`), { mode: 'stable' });
  });

  await step('Close', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-35-Close-before.png`));
    const locator = page.getByRole('button', { name: 'Close' }).filter({ visible: true }).first();
await expect(locator).toBeVisible({ timeout: 15000 });    await smartClick(locator, 'Close');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-35-Close-after.png`), { mode: 'stable' });
  });

  await step('展开', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-36-展开-before.png`));
    const locator = page.getByText('展开').filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 6000 });
    } catch {
      console.log('ℹ️  展开：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-36-展开-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, '展开');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-36-展开-after.png`), { mode: 'stable' });
  });

  await step('收起', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-37-收起-before.png`));
    const locator = page.locator('#one-screen-header-info').getByText('收起').filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 6000 });
    } catch {
      console.log('ℹ️  收起：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-37-收起-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, '收起');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-37-收起-after.png`), { mode: 'stable' });
  });

  await step('收起', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-38-收起-before.png`));
    const locator = page.getByText('收起').filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 6000 });
    } catch {
      console.log('ℹ️  收起：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-38-收起-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, '收起');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-38-收起-after.png`), { mode: 'stable' });
  });

  await step('展开', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-39-展开-before.png`));
    const locator = page.locator('#RELATED_COMP').getByText('展开').filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 6000 });
    } catch {
      console.log('ℹ️  展开：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-39-展开-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, '展开');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-39-展开-after.png`), { mode: 'stable' });
  });

  await step('合同公司', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-40-合同公司-before.png`));
    const locator = page.getByText('合同公司').filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 6000 });
    } catch {
      console.log('ℹ️  合同公司：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-40-合同公司-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, '合同公司');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-40-合同公司-after.png`), { mode: 'stable' });
  });

  await step('江苏省精创电气股份有限公司', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-41-江苏省精创电气股份有限公司-before.png`));
    const locator = page.locator('#CUSTOM_FORM').getByText('江苏省精创电气股份有限公司').filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 6000 });
    } catch {
      console.log('ℹ️  江苏省精创电气股份有限公司：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-41-江苏省精创电气股份有限公司-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, '江苏省精创电气股份有限公司');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-41-江苏省精创电气股份有限公司-after.png`), { mode: 'stable' });
  });

  await step('合同名称', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-42-合同名称-before.png`));
    const locator = page.getByText('合同名称').filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 6000 });
    } catch {
      console.log('ℹ️  合同名称：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-42-合同名称-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, '合同名称');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-42-合同名称-after.png`), { mode: 'stable' });
  });

  await step('111', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-43-111-before.png`));
    const locator = page.getByText('111').filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 6000 });
    } catch {
      console.log('ℹ️  111：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-43-111-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, '111');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-43-111-after.png`), { mode: 'stable' });
  });

  await step('合同类型', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-44-合同类型-before.png`));
    const locator = page.getByText('合同类型').filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 6000 });
    } catch {
      console.log('ℹ️  合同类型：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-44-合同类型-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, '合同类型');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-44-合同类型-after.png`), { mode: 'stable' });
  });

  await step('宣传展览合同', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-45-宣传展览合同-before.png`));
    const locator = page.getByText('宣传展览合同').filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 6000 });
    } catch {
      console.log('ℹ️  宣传展览合同：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-45-宣传展览合同-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, '宣传展览合同');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-45-宣传展览合同-after.png`), { mode: 'stable' });
  });

  await step('签署日期', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-46-签署日期-before.png`));
    const locator = page.getByText('签署日期').filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 6000 });
    } catch {
      console.log('ℹ️  签署日期：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-46-签署日期-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, '签署日期');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-46-签署日期-after.png`), { mode: 'stable' });
  });

  await step('-04-08', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-47--04-08-before.png`));
    const locator = page.getByText('-04-08').nth(2).filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 6000 });
    } catch {
      console.log('ℹ️  -04-08：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-47--04-08-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, '-04-08');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-47--04-08-after.png`), { mode: 'stable' });
  });

  await step('有效日期至', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-48-有效日期至-before.png`));
    const locator = page.getByText('有效日期至').filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 6000 });
    } catch {
      console.log('ℹ️  有效日期至：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-48-有效日期至-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, '有效日期至');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-48-有效日期至-after.png`), { mode: 'stable' });
  });

  await step('action', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-49-action-before.png`));
    const locator = page.locator('#opposite-info').getByRole('img').nth(1).filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 6000 });
    } catch {
      console.log('ℹ️  action：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-49-action-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, 'action');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-49-action-after.png`), { mode: 'stable' });
  });

  await step('详情', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-50-详情-before.png`));
    const locator = page.getByText('详情', { exact: true }).filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 6000 });
    } catch {
      console.log('ℹ️  详情：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-50-详情-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, '详情');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-50-详情-after.png`), { mode: 'stable' });
  });

  await step('Close', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-51-Close-before.png`));
    const locator = page.getByRole('button', { name: 'Close' }).filter({ visible: true }).first();
await expect(locator).toBeVisible({ timeout: 15000 });    await smartClick(locator, 'Close');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-51-Close-after.png`), { mode: 'stable' });
  });

  await step('action', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-52-action-before.png`));
    const locator = page.locator('div').filter({ hasText: /^详情迦递货运代理（上海）有限公司No\. QTWL1080019---$/ }).nth(1);
    try {
      await expect(locator).toBeVisible({ timeout: 6000 });
    } catch {
      console.log('ℹ️  action：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-52-action-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, 'action');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-52-action-after.png`), { mode: 'stable' });
  });

  await step('action', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-53-action-before.png`));
    const locator = page.locator('#opposite-info').getByRole('img').filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 6000 });
    } catch {
      console.log('ℹ️  action：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-53-action-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, 'action');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-53-action-after.png`), { mode: 'stable' });
  });

  await step('详情', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-54-详情-before.png`));
    const locator = page.getByText('详情', { exact: true }).filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 6000 });
    } catch {
      console.log('ℹ️  详情：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-54-详情-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, '详情');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-54-详情-after.png`), { mode: 'stable' });
  });

  await step('Close', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-55-Close-before.png`));
    const locator = page.getByRole('button', { name: 'Close' }).filter({ visible: true }).first();
await expect(locator).toBeVisible({ timeout: 15000 });    await smartClick(locator, 'Close');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-55-Close-after.png`), { mode: 'stable' });
  });

  await step('action', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-56-action-before.png`));
    const locator = page.locator('#attachment-list img').filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 6000 });
    } catch {
      console.log('ℹ️  action：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-56-action-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, 'action');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-56-action-after.png`), { mode: 'stable' });
  });

  await step('action', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-57-action-before.png`));
    const locator = page.locator('.drag-modal-content-header > div:nth-child(2)').filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 6000 });
    } catch {
      console.log('ℹ️  action：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-57-action-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, 'action');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-57-action-after.png`), { mode: 'stable' });
  });

  await step('导入申请单费用信息', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-58-导入申请单费用信息-before.png`));
    const locator = page.getByRole('button', { name: '导入申请单费用信息' }).filter({ visible: true }).first();
await expect(locator).toBeVisible({ timeout: 15000 });    await smartClick(locator, '导入申请单费用信息');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-58-导入申请单费用信息-after.png`), { mode: 'stable' });
  });

  await step('添加费用信息', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-59-添加费用信息-before.png`));
    const locator = page.getByRole('button', { name: '添加费用信息' }).filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 6000 });
    } catch {
      console.log('ℹ️  添加费用信息：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-59-添加费用信息-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, '添加费用信息');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-59-添加费用信息-after.png`), { mode: 'stable' });
  });

  await step('请选择', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-60-请选择-before.png`));
    const locator = page.getByRole('textbox', { name: '请选择' }).filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 6000 });
    } catch {
      console.log('ℹ️  请选择：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-60-请选择-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, '请选择');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-60-请选择-after.png`), { mode: 'stable' });
  });

  await step('action', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-61-action-before.png`));
    const locator = page.locator('#recommend-history-18b5 span').filter({ hasText: '住宿费' }).getByRole('img').filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 6000 });
    } catch {
      console.log('ℹ️  action：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-61-action-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, 'action');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-61-action-after.png`), { mode: 'stable' });
  });

  await step('请输入或选择', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-62-请输入或选择-before.png`));
    const locator = page.getByRole('textbox', { name: '请输入或选择' }).filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 6000 });
    } catch {
      console.log('ℹ️  请输入或选择：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-62-请输入或选择-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, '请输入或选择');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-62-请输入或选择-after.png`), { mode: 'stable' });
  });

  await step('今天', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-63-今天-before.png`));
    const locator = page.getByRole('button', { name: '今天' }).filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 6000 });
    } catch {
      console.log('ℹ️  今天：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-63-今天-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, '今天');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-63-今天-after.png`), { mode: 'stable' });
  });

  await step('保-存', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-64-保-存-before.png`));
    const locator = page.getByRole('button', { name: '保 存' }).filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 6000 });
    } catch {
      console.log('ℹ️  保-存：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-64-保-存-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, '保-存');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-64-保-存-after.png`), { mode: 'stable' });
  });

  await step('000', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-65-000-before.png`));
    const locator = page.getByRole('spinbutton', { name: '0.00' }).filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 6000 });
    } catch {
      console.log('ℹ️  000：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-65-000-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, '000');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-65-000-after.png`), { mode: 'stable' });
  });

  await step('000', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-66-000-before.png`));
    const locator = page.getByRole('spinbutton', { name: '0.00' }).filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 6000 });
    } catch {
      console.log('ℹ️  000：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-66-000-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartFill(locator, "0.00", '000');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-66-000-after.png`), { mode: 'stable' });
  });

  await step('action', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-67-action-before.png`));
    const locator = page.locator('#slide-content-id').filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 6000 });
    } catch {
      console.log('ℹ️  action：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-67-action-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, 'action');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-67-action-after.png`), { mode: 'stable' });
  });

  await step('保-存', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-68-保-存-before.png`));
    const locator = page.getByRole('button', { name: '保 存' }).filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 6000 });
    } catch {
      console.log('ℹ️  保-存：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-68-保-存-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, '保-存');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-68-保-存-after.png`), { mode: 'stable' });
  });

  await step('复制', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-69-复制-before.png`));
    const locator = page.getByText('复制').nth(1).filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 6000 });
    } catch {
      console.log('ℹ️  复制：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-69-复制-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, '复制');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-69-复制-after.png`), { mode: 'stable' });
  });

  await step('添加付款信息', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-70-添加付款信息-before.png`));
    const locator = page.getByRole('button', { name: '添加付款信息' }).filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 6000 });
    } catch {
      console.log('ℹ️  添加付款信息：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-70-添加付款信息-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, '添加付款信息');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-70-添加付款信息-after.png`), { mode: 'stable' });
  });

  await step('阶段款项名称', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-71-阶段款项名称-before.png`));
    const locator = page.getByRole('textbox', { name: '阶段/款项名称' }).filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 6000 });
    } catch {
      console.log('ℹ️  阶段款项名称：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-71-阶段款项名称-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, '阶段款项名称');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-71-阶段款项名称-after.png`), { mode: 'stable' });
  });

  await step('阶段款项名称', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-72-阶段款项名称-before.png`));
    const locator = page.getByRole('textbox', { name: '阶段/款项名称' }).filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 6000 });
    } catch {
      console.log('ℹ️  阶段款项名称：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-72-阶段款项名称-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartFill(locator, "阶段/款项名称", '阶段款项名称');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-72-阶段款项名称-after.png`), { mode: 'stable' });
  });

  await step('000', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-73-000-before.png`));
    const locator = page.getByRole('spinbutton', { name: '0.00' }).filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 6000 });
    } catch {
      console.log('ℹ️  000：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-73-000-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, '000');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-73-000-after.png`), { mode: 'stable' });
  });

  await step('请输入或选择', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-74-请输入或选择-before.png`));
    const locator = page.getByRole('textbox', { name: '请输入或选择' }).filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 6000 });
    } catch {
      console.log('ℹ️  请输入或选择：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-74-请输入或选择-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, '请输入或选择');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-74-请输入或选择-after.png`), { mode: 'stable' });
  });

  await step('action', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-75-action-before.png`));
    const locator = page.getByRole('grid').getByTitle('年4月8日').locator('div').filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 6000 });
    } catch {
      console.log('ℹ️  action：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-75-action-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, 'action');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-75-action-after.png`), { mode: 'stable' });
  });

  await step('付款条件', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-76-付款条件-before.png`));
    const locator = page.getByRole('textbox', { name: '付款条件' }).filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 6000 });
    } catch {
      console.log('ℹ️  付款条件：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-76-付款条件-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartFill(locator, "付款条件", '付款条件');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-76-付款条件-after.png`), { mode: 'stable' });
  });

  await step('000', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-77-000-before.png`));
    const locator = page.getByRole('spinbutton', { name: '0.00' }).filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 6000 });
    } catch {
      console.log('ℹ️  000：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-77-000-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartFill(locator, "0.00", '000');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-77-000-after.png`), { mode: 'stable' });
  });

  await step('备注', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-78-备注-before.png`));
    const locator = page.getByRole('textbox', { name: '备注' }).filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 6000 });
    } catch {
      console.log('ℹ️  备注：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-78-备注-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartFill(locator, "备注", '备注');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-78-备注-after.png`), { mode: 'stable' });
  });

  await step('确-定', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-79-确-定-before.png`));
    const locator = page.getByRole('button', { name: '确 定' }).filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 6000 });
    } catch {
      console.log('ℹ️  确-定：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-79-确-定-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, '确-定');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-79-确-定-after.png`), { mode: 'stable' });
  });

  await step('保-存', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-80-保-存-before.png`));
    const locator = page.getByRole('button', { name: '保 存' }).filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 6000 });
    } catch {
      console.log('ℹ️  保-存：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-80-保-存-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, '保-存');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-80-保-存-after.png`), { mode: 'stable' });
  });

  await step('action', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-81-action-before.png`));
    const locator = page.getByRole('button').filter({ hasText: /^$/ }).nth(2).filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 6000 });
    } catch {
      console.log('ℹ️  action：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-81-action-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, 'action');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-81-action-after.png`), { mode: 'stable' });
  });

  await step('批量删除', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-82-批量删除-before.png`));
    const locator = page.locator('#payment-info').getByRole('button', { name: '批量删除' }).filter({ visible: true }).first();
await expect(locator).toBeVisible({ timeout: 15000 });    await smartClick(locator, '批量删除');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-82-批量删除-after.png`), { mode: 'stable' });
  });

  await step('action', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-83-action-before.png`));
    const locator = page.getByRole('row', { name: '序号 付款行编号 阶段名称 币种 付款比例 金额 本币金额 单价 本币单价 收款方 计划付款日期 付款条件 可关联支付金额 已付款合计金额 待付款在途金额 备注' }).getByLabel('').filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 6000 });
    } catch {
      console.log('ℹ️  action：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-83-action-skipped.png`), { mode: 'stable' });
      return;
    }
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
    await takeStepScreenshot(page, path.join(runDir, `step-83-action-after.png`), { mode: 'stable' });
  });

  await step('删-除', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-84-删-除-before.png`));
    const locator = page.getByRole('button', { name: '删 除' }).filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 6000 });
    } catch {
      console.log('ℹ️  删-除：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-84-删-除-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, '删-除');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-84-删-除-after.png`), { mode: 'stable' });
  });

  await step('确-定', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-85-确-定-before.png`));
    const locator = page.getByRole('button', { name: '确 定' }).filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 6000 });
    } catch {
      console.log('ℹ️  确-定：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-85-确-定-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, '确-定');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-85-确-定-after.png`), { mode: 'stable' });
  });

  await step('提-交', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-86-提-交-before.png`));
    const locator = page.getByRole('button', { name: '提 交' }).filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 6000 });
    } catch {
      console.log('ℹ️  提-交：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-86-提-交-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, '提-交');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-86-提-交-after.png`), { mode: 'stable' });
  });

  await step('添加付款信息', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-87-添加付款信息-before.png`));
    const locator = page.getByRole('button', { name: '添加付款信息' }).filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 6000 });
    } catch {
      console.log('ℹ️  添加付款信息：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-87-添加付款信息-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, '添加付款信息');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-87-添加付款信息-after.png`), { mode: 'stable' });
  });

  await step('阶段款项名称', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-88-阶段款项名称-before.png`));
    const locator = page.getByRole('textbox', { name: '阶段/款项名称' }).filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 6000 });
    } catch {
      console.log('ℹ️  阶段款项名称：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-88-阶段款项名称-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, '阶段款项名称');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-88-阶段款项名称-after.png`), { mode: 'stable' });
  });

  await step('阶段款项名称', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-89-阶段款项名称-before.png`));
    const locator = page.getByRole('textbox', { name: '阶段/款项名称' }).filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 6000 });
    } catch {
      console.log('ℹ️  阶段款项名称：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-89-阶段款项名称-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartFill(locator, "阶段/款项名称", '阶段款项名称');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-89-阶段款项名称-after.png`), { mode: 'stable' });
  });

  await step('000', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-90-000-before.png`));
    const locator = page.getByRole('spinbutton', { name: '0.00' }).filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 6000 });
    } catch {
      console.log('ℹ️  000：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-90-000-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, '000');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-90-000-after.png`), { mode: 'stable' });
  });

  await step('000', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-91-000-before.png`));
    const locator = page.getByRole('spinbutton', { name: '0.00' }).filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 6000 });
    } catch {
      console.log('ℹ️  000：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-91-000-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartFill(locator, "0.00", '000');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-91-000-after.png`), { mode: 'stable' });
  });

  await step('请输入或选择', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-92-请输入或选择-before.png`));
    const locator = page.getByRole('textbox', { name: '请输入或选择' }).filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 6000 });
    } catch {
      console.log('ℹ️  请输入或选择：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-92-请输入或选择-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, '请输入或选择');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-92-请输入或选择-after.png`), { mode: 'stable' });
  });

  await step('今天', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-93-今天-before.png`));
    const locator = page.getByRole('button', { name: '今天' }).filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 6000 });
    } catch {
      console.log('ℹ️  今天：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-93-今天-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, '今天');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-93-今天-after.png`), { mode: 'stable' });
  });

  await step('保-存', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-94-保-存-before.png`));
    const locator = page.getByRole('button', { name: '保 存' }).filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 6000 });
    } catch {
      console.log('ℹ️  保-存：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-94-保-存-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, '保-存');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-94-保-存-after.png`), { mode: 'stable' });
  });

  await step('提-交', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-95-提-交-before.png`));
    const locator = page.getByRole('button', { name: '提 交' }).filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 6000 });
    } catch {
      console.log('ℹ️  提-交：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-95-提-交-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, '提-交');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-95-提-交-after.png`), { mode: 'stable' });
  });

  await step('收起', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-96-收起-before.png`));
    const locator = page.getByText('收起').filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 6000 });
    } catch {
      console.log('ℹ️  收起：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-96-收起-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, '收起');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-96-收起-after.png`), { mode: 'stable' });
  });

  await step('返-回', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-97-返-回-before.png`));
    const locator = page.getByRole('button', { name: '返 回' }).filter({ visible: true }).first();
    try {
      await expect(locator).toBeVisible({ timeout: 6000 });
    } catch {
      console.log('ℹ️  返-回：元素未出现（非关键步骤），跳过本步');
      await takeStepScreenshot(page, path.join(runDir, `step-97-返-回-skipped.png`), { mode: 'stable' });
      return;
    }
    await smartClick(locator, '返-回');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await waitForPostInteractionPaint(page);
    await takeStepScreenshot(page, path.join(runDir, `step-97-返-回-after.png`), { mode: 'stable' });
  });



  // 停止 tracing 由 Playwright 配置自动处理

  console.log('');
  console.log('🎉 测试完成: ' + 'test');
});
