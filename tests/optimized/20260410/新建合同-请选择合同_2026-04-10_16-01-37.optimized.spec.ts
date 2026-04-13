import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { takeStepScreenshot } from '../../utils/screenshot';

const PAUSE_ENABLED = process.env.ENABLE_PAUSE === '1';
async function maybePause(page, reason: string) {
  if (!PAUSE_ENABLED) return;
  console.log(`⏸️ 已启用 pause（ENABLE_PAUSE=1），原因: ${reason}`);
  await page.pause();
}

// 定义智能动作函数
async function smartClick(locator, stepName) {
  console.log(`🧠 执行智能点击: ${stepName}`);
  console.log(`🔍 元素数量: ${await locator.count()}`);
  
  // 等待元素可见
  try {
    await locator.waitFor({ state: 'visible', timeout: 10000 });
  } catch (e) {
    console.log(`⚠️ 元素不可见: ${e.message}`);
    await maybePause(locator.page(), `元素不可见: ${stepName}`);
  }
  
  // 滚动到元素
  await locator.scrollIntoViewIfNeeded().catch(() => {});
  
  // 处理 AntD 全局 Loading 遮罩
  await locator.page().locator('.ant-spin-spinning, .ant-loading').waitFor({ state: 'hidden' }).catch(() => {});
  
  // 执行点击
  try {
    await locator.click();
  } catch (e) {
    console.log(`⚠️ 点击失败: ${e.message}`);
    await maybePause(locator.page(), `点击失败: ${stepName}`);
    throw e;
  }
  
  // 处理 Ant Design 3.x 下拉框
  if (stepName.includes('选择') || stepName.includes('下拉') || locator.toString().includes('ant-select')) {
    // 等待下拉框出现
    await locator.page().locator('.ant-select-dropdown:not(.ant-select-dropdown--hidden)').waitFor({ timeout: 5000 }).catch(() => {});
  }
  
  // 处理 Ant Design 3.x 日期选择器
  if (stepName.includes('日期') || locator.toString().includes('date')) {
    // 等待日期选择器面板出现
    await locator.page().locator('.ant-calendar-picker-container').waitFor({ timeout: 5000 }).catch(() => {});
  }
}

async function smartFill(locator, text, stepName) {
  console.log(`🧠 执行智能填充: ${stepName}`);
  console.log(`🔍 元素数量: ${await locator.count()}`);
  
  // 等待元素可见
  try {
    await locator.waitFor({ state: 'visible', timeout: 10000 });
  } catch (e) {
    console.log(`⚠️ 元素不可见: ${e.message}`);
    await maybePause(locator.page(), `元素不可见: ${stepName}`);
  }
  
  // 滚动到元素
  await locator.scrollIntoViewIfNeeded().catch(() => {});
  
  // 处理 AntD 全局 Loading 遮罩
  await locator.page().locator('.ant-spin-spinning, .ant-loading').waitFor({ state: 'hidden' }).catch(() => {});
  
  // 执行填充
  try {
    await locator.fill(text);
  } catch (e) {
    console.log(`⚠️ 填充失败: ${e.message}`);
    await maybePause(locator.page(), `填充失败: ${stepName}`);
    throw e;
  }
}

// 定义step函数，提高可读性
async function step(name: string, fn: () => Promise<void>) {
  console.log(`
👉 ${name}`);
  try {
    await fn();
    console.log(`✅ ${name} 完成`);
  } catch (error) {
    console.log(`❌ ${name} 失败: ${error.message}`);
    throw error;
  }
};

test('test', async ({ page }) => {
  test.setTimeout(120000);

  // 初始化截图目录
  const screenshotDir = 'screenshots/20260410/新建合同-请选择合同_2026-04-10_16-01-37';
  if (!fs.existsSync(screenshotDir)) {
    fs.mkdirSync(screenshotDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const runDir = path.join(screenshotDir, timestamp);
  
  // 统一存量 optimized 用例截图入口（保留原调用形态）
  const originalScreenshot = page.screenshot.bind(page);
  (page as any).screenshot = async (options: any) => {
    if (options?.path) {
      await takeStepScreenshot(page, options.path, { fullPage: Boolean(options.fullPage) });
      return;
    }
    return await originalScreenshot(options);
  };


  // 检查是否有页面导航操作
  const hasGotoAction = false;
  
  if (!hasGotoAction) {
    // 如果没有页面导航，添加一个默认的
    await step('导航到首页', async () => {
      console.log('🌐 导航到: https://stage.huilianyi.com/');
      await page.goto('https://stage.huilianyi.com/', { waitUntil: 'networkidle' });
      await page.waitForLoadState('networkidle');
      await page.screenshot({ path: path.join(runDir, `step-1-before-action.png`), fullPage: true });
    });
  }

    await step('新建合同', async () => {
    await page.screenshot({ path: path.join(runDir, `step-1-before-action.png`), fullPage: true });
    const locator = page.getByRole('button', { name: '新建合同' }).filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, '新建合同');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-1-after-action.png`), fullPage: true });
  });

  await step('请选择合同', async () => {
    await page.screenshot({ path: path.join(runDir, `step-2-before-action.png`), fullPage: true });
    const locator = page.getByText('请选择合同').filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, '请选择合同');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-2-after-action.png`), fullPage: true });
  });

  await step('合同', async () => {
    await page.screenshot({ path: path.join(runDir, `step-3-before-action.png`), fullPage: true });
    const locator = page.getByRole('option', { name: '合同' }).locator('span').filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, '合同');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-3-after-action.png`), fullPage: true });
  });

  await step('确-定', async () => {
    await page.screenshot({ path: path.join(runDir, `step-4-before-action.png`), fullPage: true });
    const locator = page.getByRole('button', { name: '确 定' }).filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, '确-定');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-4-after-action.png`), fullPage: true });
  });

  await step('action', async () => {
    await page.screenshot({ path: path.join(runDir, `step-5-before-action.png`), fullPage: true });
    const locator = page.locator('.ant-select-selection__placeholder').first();
    await expect(locator).toBeVisible();
    await smartClick(locator, 'action');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-5-after-action.png`), fullPage: true });
  });

  await step('-02-11', async () => {
    await page.screenshot({ path: path.join(runDir, `step-6-before-action.png`), fullPage: true });
    const locator = page.getByRole('cell', { name: '-02-11' }).filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, '-02-11');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-6-after-action.png`), fullPage: true });
  });

  await step('确-定', async () => {
    await page.screenshot({ path: path.join(runDir, `step-7-before-action.png`), fullPage: true });
    const locator = page.getByRole('button', { name: '确 定' }).filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, '确-定');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-7-after-action.png`), fullPage: true });
  });

  await step('action', async () => {
    await page.screenshot({ path: path.join(runDir, `step-8-before-action.png`), fullPage: true });
    const locator = page.locator('input[name=7fbac917-1a37-42f9-a929-bf3e0776d27c]').filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, 'action');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-8-after-action.png`), fullPage: true });
  });

  await step('111', async () => {
    await page.screenshot({ path: path.join(runDir, `step-9-before-action.png`), fullPage: true });
    const locator = page.locator('input[name=7fbac917-1a37-42f9-a929-bf3e0776d27c]').filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartFill(locator, "111", '111');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-9-after-action.png`), fullPage: true });
  });

  await step('action', async () => {
    await page.screenshot({ path: path.join(runDir, `step-10-before-action.png`), fullPage: true });
    const locator = page.locator('[id=6117e841-c812-051f-3cd5-3adf0721e8a3] > .ant-row > .ant-col.ant-form-item-control-wrapper > .ant-form-item-control > .ant-form-item-children > .multi-selector-block > .multi-selector-wrapper > .fake-input > .slector-value-content').filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, 'action');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-10-after-action.png`), fullPage: true });
  });

  await step('action', async () => {
    await page.screenshot({ path: path.join(runDir, `step-11-before-action.png`), fullPage: true });
    const locator = page.locator('div').filter({ hasText: /^宣传展览合同$/ }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, 'action');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-11-after-action.png`), fullPage: true });
  });

  await step('action', async () => {
    await page.screenshot({ path: path.join(runDir, `step-12-before-action.png`), fullPage: true });
    const locator = page.locator('.ant-calendar-picker-input').first();
    await expect(locator).toBeVisible();
    await smartClick(locator, 'action');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-12-after-action.png`), fullPage: true });
  });

  await step('action', async () => {
    await page.screenshot({ path: path.join(runDir, `step-13-before-action.png`), fullPage: true });
    const locator = page.getByRole('grid').getByTitle('年4月8日').locator('div').filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, 'action');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-13-after-action.png`), fullPage: true });
  });

  await step('action', async () => {
    await page.screenshot({ path: path.join(runDir, `step-14-before-action.png`), fullPage: true });
    const locator = page.locator('[id=7a1b867b-c181-4128-bd8e-9cfb06f670c6] > .ant-row > .ant-col.ant-form-item-control-wrapper > .ant-form-item-control > .ant-form-item-children > .multi-selector-block > .multi-selector-wrapper > .fake-input > .slector-value-content').filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, 'action');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-14-after-action.png`), fullPage: true });
  });

  await step('上海实誉智能科技有限公司', async () => {
    await page.screenshot({ path: path.join(runDir, `step-15-before-action.png`), fullPage: true });
    const locator = page.getByText('上海实誉智能科技有限公司').filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, '上海实誉智能科技有限公司');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-15-after-action.png`), fullPage: true });
  });

  await step('苏州空动力电子技术有限公司', async () => {
    await page.screenshot({ path: path.join(runDir, `step-16-before-action.png`), fullPage: true });
    const locator = page.getByText('苏州空动力电子技术有限公司').filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, '苏州空动力电子技术有限公司');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-16-after-action.png`), fullPage: true });
  });

  await step('action', async () => {
    await page.screenshot({ path: path.join(runDir, `step-17-before-action.png`), fullPage: true });
    const locator = page.locator('.fake-input.fake-input-open > .slector-value-content').filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, 'action');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-17-after-action.png`), fullPage: true });
  });

  await step('action', async () => {
    await page.screenshot({ path: path.join(runDir, `step-18-before-action.png`), fullPage: true });
    const locator = page.locator('div').filter({ hasText: /^迦递货运代理（上海）有限公司$/ }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, 'action');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-18-after-action.png`), fullPage: true });
  });

  await step('action', async () => {
    await page.screenshot({ path: path.join(runDir, `step-19-before-action.png`), fullPage: true });
    const locator = page.locator('#c2444aaf-38db-b521-2aed-becd1e284030 > .ant-row > .ant-col.ant-form-item-control-wrapper > .ant-form-item-control > .ant-form-item-children > .multi-selector-block > .multi-selector-wrapper > .fake-input > .slector-value-content').filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, 'action');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-19-after-action.png`), fullPage: true });
  });

  await step('增值税专用发票', async () => {
    await page.screenshot({ path: path.join(runDir, `step-20-before-action.png`), fullPage: true });
    const locator = page.getByText('增值税专用发票', { exact: true }).filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, '增值税专用发票');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-20-after-action.png`), fullPage: true });
  });

  await step('增值税电子普通发票通行费', async () => {
    await page.screenshot({ path: path.join(runDir, `step-21-before-action.png`), fullPage: true });
    const locator = page.getByText('增值税电子普通发票（通行费）').filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, '增值税电子普通发票通行费');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-21-after-action.png`), fullPage: true });
  });

  await step('action', async () => {
    await page.screenshot({ path: path.join(runDir, `step-22-before-action.png`), fullPage: true });
    const locator = page.locator('.fake-input.fake-input-open > .slector-value-content').filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, 'action');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-22-after-action.png`), fullPage: true });
  });

  await step('action', async () => {
    await page.screenshot({ path: path.join(runDir, `step-23-before-action.png`), fullPage: true });
    const locator = page.locator('span').filter({ hasText: '增值税电子普通发票（通行费）' });
    await expect(locator).toBeVisible();
    await smartClick(locator, 'action');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-23-after-action.png`), fullPage: true });
  });

  await step('action', async () => {
    await page.screenshot({ path: path.join(runDir, `step-24-before-action.png`), fullPage: true });
    const locator = page.locator('#e3b6e63e-57be-4dab-9d39-2273ab0e5680 > .ant-row > .ant-col.ant-form-item-control-wrapper > .ant-form-item-control > .ant-form-item-children > .ant-calendar-picker > div > .ant-calendar-picker-input').filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, 'action');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-24-after-action.png`), fullPage: true });
  });

  await step('action', async () => {
    await page.screenshot({ path: path.join(runDir, `step-25-before-action.png`), fullPage: true });
    const locator = page.getByRole('grid').getByTitle('年4月8日').locator('div').filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, 'action');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-25-after-action.png`), fullPage: true });
  });

  await step('action', async () => {
    await page.screenshot({ path: path.join(runDir, `step-26-before-action.png`), fullPage: true });
    const locator = page.locator('[id=84a560cf-0dcd-4053-b3e2-e78a0f335ad1] > .ant-row > .ant-col.ant-form-item-control-wrapper > .ant-form-item-control > .ant-form-item-children > .ant-calendar-picker > div > .ant-calendar-picker-input').filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, 'action');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-26-after-action.png`), fullPage: true });
  });

  await step('action', async () => {
    await page.screenshot({ path: path.join(runDir, `step-27-before-action.png`), fullPage: true });
    const locator = page.getByRole('grid').getByTitle('年4月8日').locator('div').filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, 'action');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-27-after-action.png`), fullPage: true });
  });

  await step('附件上传', async () => {
    await page.screenshot({ path: path.join(runDir, `step-28-before-action.png`), fullPage: true });
    const locator = page.getByText('附件上传').filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, '附件上传');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-28-after-action.png`), fullPage: true });
  });

  await step('请选择', async () => {
    await page.screenshot({ path: path.join(runDir, `step-29-before-action.png`), fullPage: true });
    const locator = page.getByText('请选择').nth(4).filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, '请选择');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-29-after-action.png`), fullPage: true });
  });

  await step('600005', async () => {
    await page.screenshot({ path: path.join(runDir, `step-30-before-action.png`), fullPage: true });
    const locator = page.getByRole('cell', { name: '600005' }).filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, '600005');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-30-after-action.png`), fullPage: true });
  });

  await step('确-定', async () => {
    await page.screenshot({ path: path.join(runDir, `step-31-before-action.png`), fullPage: true });
    const locator = page.getByRole('button', { name: '确 定' }).filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, '确-定');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-31-after-action.png`), fullPage: true });
  });

  await step('下一步', async () => {
    await page.screenshot({ path: path.join(runDir, `step-32-before-action.png`), fullPage: true });
    const locator = page.getByRole('button', { name: '下一步' }).filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, '下一步');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-32-after-action.png`), fullPage: true });
  });

  await step('管理员0001江苏省精创电气股份有限公司江苏省精创电气股份有限公司手工财务中心', async () => {
    await page.screenshot({ path: path.join(runDir, `step-33-before-action.png`), fullPage: true });
    const locator = page.getByText('管理员0001江苏省精创电气股份有限公司江苏省精创电气股份有限公司（手工）|财务中心').filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, '管理员0001江苏省精创电气股份有限公司江苏省精创电气股份有限公司手工财务中心');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-33-after-action.png`), fullPage: true });
  });

  await step('Close', async () => {
    await page.screenshot({ path: path.join(runDir, `step-34-before-action.png`), fullPage: true });
    const locator = page.getByRole('button', { name: 'Close' }).filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, 'Close');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-34-after-action.png`), fullPage: true });
  });

  await step('展开', async () => {
    await page.screenshot({ path: path.join(runDir, `step-35-before-action.png`), fullPage: true });
    const locator = page.getByText('展开').filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, '展开');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-35-after-action.png`), fullPage: true });
  });

  await step('收起', async () => {
    await page.screenshot({ path: path.join(runDir, `step-36-before-action.png`), fullPage: true });
    const locator = page.locator('#one-screen-header-info').getByText('收起').filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, '收起');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-36-after-action.png`), fullPage: true });
  });

  await step('收起', async () => {
    await page.screenshot({ path: path.join(runDir, `step-37-before-action.png`), fullPage: true });
    const locator = page.getByText('收起').filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, '收起');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-37-after-action.png`), fullPage: true });
  });

  await step('展开', async () => {
    await page.screenshot({ path: path.join(runDir, `step-38-before-action.png`), fullPage: true });
    const locator = page.locator('#RELATED_COMP').getByText('展开').filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, '展开');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-38-after-action.png`), fullPage: true });
  });

  await step('合同公司', async () => {
    await page.screenshot({ path: path.join(runDir, `step-39-before-action.png`), fullPage: true });
    const locator = page.getByText('合同公司').filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, '合同公司');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-39-after-action.png`), fullPage: true });
  });

  await step('江苏省精创电气股份有限公司', async () => {
    await page.screenshot({ path: path.join(runDir, `step-40-before-action.png`), fullPage: true });
    const locator = page.locator('#CUSTOM_FORM').getByText('江苏省精创电气股份有限公司').filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, '江苏省精创电气股份有限公司');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-40-after-action.png`), fullPage: true });
  });

  await step('合同名称', async () => {
    await page.screenshot({ path: path.join(runDir, `step-41-before-action.png`), fullPage: true });
    const locator = page.getByText('合同名称').filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, '合同名称');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-41-after-action.png`), fullPage: true });
  });

  await step('111', async () => {
    await page.screenshot({ path: path.join(runDir, `step-42-before-action.png`), fullPage: true });
    const locator = page.getByText('111').filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, '111');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-42-after-action.png`), fullPage: true });
  });

  await step('合同类型', async () => {
    await page.screenshot({ path: path.join(runDir, `step-43-before-action.png`), fullPage: true });
    const locator = page.getByText('合同类型').filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, '合同类型');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-43-after-action.png`), fullPage: true });
  });

  await step('宣传展览合同', async () => {
    await page.screenshot({ path: path.join(runDir, `step-44-before-action.png`), fullPage: true });
    const locator = page.getByText('宣传展览合同').filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, '宣传展览合同');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-44-after-action.png`), fullPage: true });
  });

  await step('签署日期', async () => {
    await page.screenshot({ path: path.join(runDir, `step-45-before-action.png`), fullPage: true });
    const locator = page.getByText('签署日期').filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, '签署日期');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-45-after-action.png`), fullPage: true });
  });

  await step('-04-08', async () => {
    await page.screenshot({ path: path.join(runDir, `step-46-before-action.png`), fullPage: true });
    const locator = page.getByText('-04-08').nth(2).filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, '-04-08');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-46-after-action.png`), fullPage: true });
  });

  await step('有效日期至', async () => {
    await page.screenshot({ path: path.join(runDir, `step-47-before-action.png`), fullPage: true });
    const locator = page.getByText('有效日期至').filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, '有效日期至');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-47-after-action.png`), fullPage: true });
  });

  await step('单据信息编-辑合同公司江苏省精创电气股份有限公司合同名称', async () => {
    await page.screenshot({ path: path.join(runDir, `step-48-before-action.png`), fullPage: true });
    const locator = page.getByText('单据信息编 辑合同公司江苏省精创电气股份有限公司合同名称').filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, '单据信息编-辑合同公司江苏省精创电气股份有限公司合同名称');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-48-after-action.png`), fullPage: true });
  });

  await step('相对方信息签约主体江苏省精创电气股份有限公司签约对象供应商1个序号名称编号姓名电话邮箱操作1迦递货运代理上海有限公司QTWL1080019---详情', async () => {
    await page.screenshot({ path: path.join(runDir, `step-49-before-action.png`), fullPage: true });
    const locator = page.getByText('相对方信息签约主体江苏省精创电气股份有限公司签约对象供应商(1个)序号名称编号姓名电话邮箱操作1迦递货运代理（上海）有限公司QTWL1080019---详情').filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, '相对方信息签约主体江苏省精创电气股份有限公司签约对象供应商1个序号名称编号姓名电话邮箱操作1迦递货运代理上海有限公司QTWL1080019---详情');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-49-after-action.png`), fullPage: true });
  });

  await step('action', async () => {
    await page.screenshot({ path: path.join(runDir, `step-50-before-action.png`), fullPage: true });
    const locator = page.locator('#opposite-info').getByRole('img').nth(1).filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, 'action');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-50-after-action.png`), fullPage: true });
  });

  await step('详情', async () => {
    await page.screenshot({ path: path.join(runDir, `step-51-before-action.png`), fullPage: true });
    const locator = page.getByText('详情', { exact: true }).filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, '详情');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-51-after-action.png`), fullPage: true });
  });

  await step('Close', async () => {
    await page.screenshot({ path: path.join(runDir, `step-52-before-action.png`), fullPage: true });
    const locator = page.getByRole('button', { name: 'Close' }).filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, 'Close');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-52-after-action.png`), fullPage: true });
  });

  await step('action', async () => {
    await page.screenshot({ path: path.join(runDir, `step-53-before-action.png`), fullPage: true });
    const locator = page.locator('div').filter({ hasText: /^详情迦递货运代理（上海）有限公司No\. QTWL1080019---$/ }).nth(1);
    await expect(locator).toBeVisible();
    await smartClick(locator, 'action');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-53-after-action.png`), fullPage: true });
  });

  await step('action', async () => {
    await page.screenshot({ path: path.join(runDir, `step-54-before-action.png`), fullPage: true });
    const locator = page.locator('#opposite-info').getByRole('img').filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, 'action');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-54-after-action.png`), fullPage: true });
  });

  await step('详情', async () => {
    await page.screenshot({ path: path.join(runDir, `step-55-before-action.png`), fullPage: true });
    const locator = page.getByText('详情', { exact: true }).filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, '详情');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-55-after-action.png`), fullPage: true });
  });

  await step('Close', async () => {
    await page.screenshot({ path: path.join(runDir, `step-56-before-action.png`), fullPage: true });
    const locator = page.getByRole('button', { name: 'Close' }).filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, 'Close');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-56-after-action.png`), fullPage: true });
  });

  await step('action', async () => {
    await page.screenshot({ path: path.join(runDir, `step-57-before-action.png`), fullPage: true });
    const locator = page.locator('#attachment-list img').filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, 'action');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-57-after-action.png`), fullPage: true });
  });

  await step('action', async () => {
    await page.screenshot({ path: path.join(runDir, `step-58-before-action.png`), fullPage: true });
    const locator = page.locator('.drag-modal-content-header > div:nth-child(2)').filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, 'action');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-58-after-action.png`), fullPage: true });
  });

  await step('导入申请单费用信息', async () => {
    await page.screenshot({ path: path.join(runDir, `step-59-before-action.png`), fullPage: true });
    const locator = page.getByRole('button', { name: '导入申请单费用信息' }).filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, '导入申请单费用信息');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-59-after-action.png`), fullPage: true });
  });

  await step('添加费用信息', async () => {
    await page.screenshot({ path: path.join(runDir, `step-60-before-action.png`), fullPage: true });
    const locator = page.getByRole('button', { name: '添加费用信息' }).filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, '添加费用信息');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-60-after-action.png`), fullPage: true });
  });

  await step('请选择', async () => {
    await page.screenshot({ path: path.join(runDir, `step-61-before-action.png`), fullPage: true });
    const locator = page.getByRole('textbox', { name: '请选择' }).filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, '请选择');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-61-after-action.png`), fullPage: true });
  });

  await step('action', async () => {
    await page.screenshot({ path: path.join(runDir, `step-62-before-action.png`), fullPage: true });
    const locator = page.locator('#recommend-history-18b5 span').filter({ hasText: '住宿费' }).getByRole('img').filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, 'action');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-62-after-action.png`), fullPage: true });
  });

  await step('请输入或选择', async () => {
    await page.screenshot({ path: path.join(runDir, `step-63-before-action.png`), fullPage: true });
    const locator = page.getByRole('textbox', { name: '请输入或选择' }).filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, '请输入或选择');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-63-after-action.png`), fullPage: true });
  });

  await step('今天', async () => {
    await page.screenshot({ path: path.join(runDir, `step-64-before-action.png`), fullPage: true });
    const locator = page.getByRole('button', { name: '今天' }).filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, '今天');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-64-after-action.png`), fullPage: true });
  });

  await step('保-存', async () => {
    await page.screenshot({ path: path.join(runDir, `step-65-before-action.png`), fullPage: true });
    const locator = page.getByRole('button', { name: '保 存' }).filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, '保-存');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-65-after-action.png`), fullPage: true });
  });

  await step('000', async () => {
    await page.screenshot({ path: path.join(runDir, `step-66-before-action.png`), fullPage: true });
    const locator = page.getByRole('spinbutton', { name: '0.00' }).filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, '000');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-66-after-action.png`), fullPage: true });
  });

  await step('000', async () => {
    await page.screenshot({ path: path.join(runDir, `step-67-before-action.png`), fullPage: true });
    const locator = page.getByRole('spinbutton', { name: '0.00' }).filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartFill(locator, "0.00", '000');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-67-after-action.png`), fullPage: true });
  });

  await step('action', async () => {
    await page.screenshot({ path: path.join(runDir, `step-68-before-action.png`), fullPage: true });
    const locator = page.locator('#slide-content-id').filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, 'action');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-68-after-action.png`), fullPage: true });
  });

  await step('保-存', async () => {
    await page.screenshot({ path: path.join(runDir, `step-69-before-action.png`), fullPage: true });
    const locator = page.getByRole('button', { name: '保 存' }).filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, '保-存');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-69-after-action.png`), fullPage: true });
  });

  await step('复制', async () => {
    await page.screenshot({ path: path.join(runDir, `step-70-before-action.png`), fullPage: true });
    const locator = page.getByText('复制').nth(1).filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, '复制');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-70-after-action.png`), fullPage: true });
  });

  await step('添加付款信息', async () => {
    await page.screenshot({ path: path.join(runDir, `step-71-before-action.png`), fullPage: true });
    const locator = page.getByRole('button', { name: '添加付款信息' }).filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, '添加付款信息');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-71-after-action.png`), fullPage: true });
  });

  await step('阶段款项名称', async () => {
    await page.screenshot({ path: path.join(runDir, `step-72-before-action.png`), fullPage: true });
    const locator = page.getByRole('textbox', { name: '阶段/款项名称' }).filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, '阶段款项名称');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-72-after-action.png`), fullPage: true });
  });

  await step('阶段款项名称', async () => {
    await page.screenshot({ path: path.join(runDir, `step-73-before-action.png`), fullPage: true });
    const locator = page.getByRole('textbox', { name: '阶段/款项名称' }).filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartFill(locator, "阶段/款项名称", '阶段款项名称');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-73-after-action.png`), fullPage: true });
  });

  await step('000', async () => {
    await page.screenshot({ path: path.join(runDir, `step-74-before-action.png`), fullPage: true });
    const locator = page.getByRole('spinbutton', { name: '0.00' }).filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, '000');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-74-after-action.png`), fullPage: true });
  });

  await step('请输入或选择', async () => {
    await page.screenshot({ path: path.join(runDir, `step-75-before-action.png`), fullPage: true });
    const locator = page.getByRole('textbox', { name: '请输入或选择' }).filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, '请输入或选择');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-75-after-action.png`), fullPage: true });
  });

  await step('action', async () => {
    await page.screenshot({ path: path.join(runDir, `step-76-before-action.png`), fullPage: true });
    const locator = page.getByRole('grid').getByTitle('年4月8日').locator('div').filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, 'action');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-76-after-action.png`), fullPage: true });
  });

  await step('付款条件', async () => {
    await page.screenshot({ path: path.join(runDir, `step-77-before-action.png`), fullPage: true });
    const locator = page.getByRole('textbox', { name: '付款条件' }).filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartFill(locator, "付款条件", '付款条件');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-77-after-action.png`), fullPage: true });
  });

  await step('000', async () => {
    await page.screenshot({ path: path.join(runDir, `step-78-before-action.png`), fullPage: true });
    const locator = page.getByRole('spinbutton', { name: '0.00' }).filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartFill(locator, "0.00", '000');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-78-after-action.png`), fullPage: true });
  });

  await step('备注', async () => {
    await page.screenshot({ path: path.join(runDir, `step-79-before-action.png`), fullPage: true });
    const locator = page.getByRole('textbox', { name: '备注' }).filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartFill(locator, "备注", '备注');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-79-after-action.png`), fullPage: true });
  });

  await step('确-定', async () => {
    await page.screenshot({ path: path.join(runDir, `step-80-before-action.png`), fullPage: true });
    const locator = page.getByRole('button', { name: '确 定' }).filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, '确-定');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-80-after-action.png`), fullPage: true });
  });

  await step('保-存', async () => {
    await page.screenshot({ path: path.join(runDir, `step-81-before-action.png`), fullPage: true });
    const locator = page.getByRole('button', { name: '保 存' }).filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, '保-存');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-81-after-action.png`), fullPage: true });
  });

  await step('action', async () => {
    await page.screenshot({ path: path.join(runDir, `step-82-before-action.png`), fullPage: true });
    const locator = page.getByRole('button').filter({ hasText: /^$/ }).nth(2).filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, 'action');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-82-after-action.png`), fullPage: true });
  });

  await step('批量删除', async () => {
    await page.screenshot({ path: path.join(runDir, `step-83-before-action.png`), fullPage: true });
    const locator = page.locator('#payment-info').getByRole('button', { name: '批量删除' }).filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, '批量删除');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-83-after-action.png`), fullPage: true });
  });

  await step('action', async () => {
    await page.screenshot({ path: path.join(runDir, `step-84-before-action.png`), fullPage: true });
    const locator = page.getByRole('row', { name: '序号 付款行编号 阶段名称 币种 付款比例 金额 本币金额 单价 本币单价 收款方 计划付款日期 付款条件 可关联支付金额 已付款合计金额 待付款在途金额 备注' }).getByLabel('').filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    try {
      await locator.waitFor({ state: 'visible', timeout: 10000 });
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
    await page.screenshot({ path: path.join(runDir, `step-84-after-action.png`), fullPage: true });
  });

  await step('删-除', async () => {
    await page.screenshot({ path: path.join(runDir, `step-85-before-action.png`), fullPage: true });
    const locator = page.getByRole('button', { name: '删 除' }).filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, '删-除');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-85-after-action.png`), fullPage: true });
  });

  await step('确-定', async () => {
    await page.screenshot({ path: path.join(runDir, `step-86-before-action.png`), fullPage: true });
    const locator = page.getByRole('button', { name: '确 定' }).filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, '确-定');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-86-after-action.png`), fullPage: true });
  });

  await step('提-交', async () => {
    await page.screenshot({ path: path.join(runDir, `step-87-before-action.png`), fullPage: true });
    const locator = page.getByRole('button', { name: '提 交' }).filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, '提-交');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-87-after-action.png`), fullPage: true });
  });

  await step('添加付款信息', async () => {
    await page.screenshot({ path: path.join(runDir, `step-88-before-action.png`), fullPage: true });
    const locator = page.getByRole('button', { name: '添加付款信息' }).filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, '添加付款信息');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-88-after-action.png`), fullPage: true });
  });

  await step('阶段款项名称', async () => {
    await page.screenshot({ path: path.join(runDir, `step-89-before-action.png`), fullPage: true });
    const locator = page.getByRole('textbox', { name: '阶段/款项名称' }).filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, '阶段款项名称');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-89-after-action.png`), fullPage: true });
  });

  await step('阶段款项名称', async () => {
    await page.screenshot({ path: path.join(runDir, `step-90-before-action.png`), fullPage: true });
    const locator = page.getByRole('textbox', { name: '阶段/款项名称' }).filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartFill(locator, "阶段/款项名称", '阶段款项名称');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-90-after-action.png`), fullPage: true });
  });

  await step('000', async () => {
    await page.screenshot({ path: path.join(runDir, `step-91-before-action.png`), fullPage: true });
    const locator = page.getByRole('spinbutton', { name: '0.00' }).filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, '000');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-91-after-action.png`), fullPage: true });
  });

  await step('000', async () => {
    await page.screenshot({ path: path.join(runDir, `step-92-before-action.png`), fullPage: true });
    const locator = page.getByRole('spinbutton', { name: '0.00' }).filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartFill(locator, "0.00", '000');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-92-after-action.png`), fullPage: true });
  });

  await step('请输入或选择', async () => {
    await page.screenshot({ path: path.join(runDir, `step-93-before-action.png`), fullPage: true });
    const locator = page.getByRole('textbox', { name: '请输入或选择' }).filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, '请输入或选择');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-93-after-action.png`), fullPage: true });
  });

  await step('今天', async () => {
    await page.screenshot({ path: path.join(runDir, `step-94-before-action.png`), fullPage: true });
    const locator = page.getByRole('button', { name: '今天' }).filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, '今天');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-94-after-action.png`), fullPage: true });
  });

  await step('保-存', async () => {
    await page.screenshot({ path: path.join(runDir, `step-95-before-action.png`), fullPage: true });
    const locator = page.getByRole('button', { name: '保 存' }).filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, '保-存');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-95-after-action.png`), fullPage: true });
  });



  // 停止 tracing 由 Playwright 配置自动处理

  console.log('');
  console.log('🎉 测试完成: ' + 'test');
});
