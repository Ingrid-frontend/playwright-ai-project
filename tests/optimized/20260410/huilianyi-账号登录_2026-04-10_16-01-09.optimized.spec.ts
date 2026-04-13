import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { takeStepScreenshot } from '../../../utils/screenshot';

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
  const screenshotDir = 'screenshots/20260410/huilianyi-账号登录_2026-04-10_16-01-09';
  if (!fs.existsSync(screenshotDir)) {
    fs.mkdirSync(screenshotDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const runDir = path.join(screenshotDir, timestamp);
  // 定义 Iframe 引用
  let iframeContent: any = null;

  // 统一存量 optimized 用例截图入口（保留原调用形态）
  const originalScreenshot = page.screenshot.bind(page);
  (page as any).screenshot = async (options: any) => {
    if (options?.path) {
      await takeStepScreenshot(page, options.path, { fullPage: Boolean(options.fullPage) });
      return;
    }
    return await originalScreenshot(options);
  };
  
  await step('获取 Iframe 内容', async () => {
    console.log('🔍 查找并获取 Iframe');
    const iframe = page.locator('iframe').first();
    // 某些页面的 iframe 可能是隐藏/延迟渲染的，不要强依赖 visible
    await iframe.waitFor({ state: 'attached', timeout: 15000 }).catch(() => {});
    
    try {
      iframeContent = await iframe.contentFrame();
    } catch (e) {
      console.log('⚠️ 获取 iframe contentFrame 失败:', e.message);
      iframeContent = null;
    }

    if (!iframeContent) {
      console.log('⚠️ 未能直接获取 iframe contentFrame，稍后会继续使用 page 上下文');
    } else {
      console.log('✅ Iframe 加载成功: 已获取');
    }
  });



  // 检查是否有页面导航操作
  const hasGotoAction = true;
  
  if (!hasGotoAction) {
    // 如果没有页面导航，添加一个默认的
    await step('导航到首页', async () => {
      console.log('🌐 导航到: https://stage.huilianyi.com/');
      await page.goto('https://stage.huilianyi.com/', { waitUntil: 'networkidle' });
      await page.waitForLoadState('networkidle');
      await page.screenshot({ path: path.join(runDir, `step-1-before-action.png`), fullPage: true });
    });
  }

    await step('导航到页面', async () => {
    console.log('🌐 导航到: https://stage.huilianyi.com/');
    await page.goto('https://stage.huilianyi.com/', { waitUntil: 'networkidle' });
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: path.join(runDir, `step-1-before-action.png`), fullPage: true });
  });

  await step('ControlOrMetaa', async () => {
    await page.screenshot({ path: path.join(runDir, `step-2-before-action.png`), fullPage: true });
    const baseContext = iframeContent || page;
    const locator = baseContext.getByRole('textbox', { name: '请输入手机号/邮箱' }).filter({ visible: true }).first();
    
    try {
      await locator.waitFor({ state: 'visible', timeout: 10000 });
    } catch (e) {
      console.log('⚠️ 元素不可见，尝试暂停调试');
      await maybePause(page, '元素不可见');
    }
    try {
      await locator.press("ControlOrMeta+a");
    } catch (e) {
      console.log(`⚠️ 按键失败: ${e.message}`);
      await maybePause(page, '按键失败');
    }
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-2-after-action.png`), fullPage: true });
  });

  await step('action', async () => {
    await page.screenshot({ path: path.join(runDir, `step-3-before-action.png`), fullPage: true });
    const baseContext = iframeContent || page;
    const locator = baseContext.locator('form').filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, 'action');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-3-after-action.png`), fullPage: true });
  });

  await step('action', async () => {
    await page.screenshot({ path: path.join(runDir, `step-4-before-action.png`), fullPage: true });
    const baseContext = iframeContent || page;
    const locator = baseContext.locator('div').filter({ hasText: /^报销单$/ }).nth(2);
    await expect(locator).toBeVisible();
    await smartClick(locator, 'action');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-4-after-action.png`), fullPage: true });
  });

  await step('新建报销单', async () => {
    await page.screenshot({ path: path.join(runDir, `step-5-before-action.png`), fullPage: true });
    const baseContext = iframeContent || page;
    const locator = baseContext.getByRole('button', { name: '新建报销单' }).filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, '新建报销单');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-5-after-action.png`), fullPage: true });
  });

  await step('action', async () => {
    await page.screenshot({ path: path.join(runDir, `step-6-before-action.png`), fullPage: true });
    const baseContext = iframeContent || page;
    const locator = baseContext.locator('#formOid > .ant-select-selection > .ant-select-selection__rendered').filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, 'action');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-6-after-action.png`), fullPage: true });
  });

  await step('action', async () => {
    await page.screenshot({ path: path.join(runDir, `step-7-before-action.png`), fullPage: true });
    const baseContext = iframeContent || page;
    const locator = baseContext.locator('#formOid > .ant-select-selection > .ant-select-selection__rendered > .ant-select-selection__placeholder').filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, 'action');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-7-after-action.png`), fullPage: true });
  });

  await step('Close', async () => {
    await page.screenshot({ path: path.join(runDir, `step-8-before-action.png`), fullPage: true });
    const baseContext = iframeContent || page;
    const locator = baseContext.getByRole('button', { name: 'Close', exact: true }).filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, 'Close');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-8-after-action.png`), fullPage: true });
  });

  await step('取-消', async () => {
    await page.screenshot({ path: path.join(runDir, `step-9-before-action.png`), fullPage: true });
    const baseContext = iframeContent || page;
    const locator = baseContext.getByRole('button', { name: '取 消' }).filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, '取-消');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-9-after-action.png`), fullPage: true });
  });

  await step('action', async () => {
    await page.screenshot({ path: path.join(runDir, `step-10-before-action.png`), fullPage: true });
    const baseContext = iframeContent || page;
    const locator = baseContext.locator('.anticon.anticon-close > svg').filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, 'action');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-10-after-action.png`), fullPage: true });
  });

  await step('action', async () => {
    await page.screenshot({ path: path.join(runDir, `step-11-before-action.png`), fullPage: true });
    const baseContext = iframeContent || page;
    const locator = baseContext.locator('.button-text.ant-tooltip-open > .helios-icon').filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, 'action');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-11-after-action.png`), fullPage: true });
  });

  await step('管理员', async () => {
    await page.screenshot({ path: path.join(runDir, `step-12-before-action.png`), fullPage: true });
    const baseContext = iframeContent || page;
    const locator = baseContext.getByText('管理员').nth(1).filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, '管理员');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-12-after-action.png`), fullPage: true });
  });

  await step('基本信息', async () => {
    await page.screenshot({ path: path.join(runDir, `step-13-before-action.png`), fullPage: true });
    const baseContext = iframeContent || page;
    const locator = baseContext.getByText('基本信息').filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, '基本信息');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-13-after-action.png`), fullPage: true });
  });

  await step('action', async () => {
    await page.screenshot({ path: path.join(runDir, `step-14-before-action.png`), fullPage: true });
    const baseContext = iframeContent || page;
    const locator = baseContext.getByTitle('单据信息').filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, 'action');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-14-after-action.png`), fullPage: true });
  });

  await step('费用明细', async () => {
    await page.screenshot({ path: path.join(runDir, `step-15-before-action.png`), fullPage: true });
    const baseContext = iframeContent || page;
    const locator = baseContext.getByText('费用明细*').filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, '费用明细');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-15-after-action.png`), fullPage: true });
  });

  await step('action', async () => {
    await page.screenshot({ path: path.join(runDir, `step-16-before-action.png`), fullPage: true });
    const baseContext = iframeContent || page;
    const locator = baseContext.getByTitle('收款信息').filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, 'action');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-16-after-action.png`), fullPage: true });
  });

  await step('查看扩展字段', async () => {
    await page.screenshot({ path: path.join(runDir, `step-17-before-action.png`), fullPage: true });
    const baseContext = iframeContent || page;
    const locator = baseContext.getByText('查看扩展字段').filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, '查看扩展字段');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-17-after-action.png`), fullPage: true });
  });

  await step('关-闭', async () => {
    await page.screenshot({ path: path.join(runDir, `step-18-before-action.png`), fullPage: true });
    const baseContext = iframeContent || page;
    const locator = baseContext.getByRole('button', { name: '关 闭' }).filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, '关-闭');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-18-after-action.png`), fullPage: true });
  });

  await step('详情', async () => {
    await page.screenshot({ path: path.join(runDir, `step-19-before-action.png`), fullPage: true });
    const baseContext = iframeContent || page;
    const locator = baseContext.locator('#payment').getByText('详情', { exact: true }).filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, '详情');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-19-after-action.png`), fullPage: true });
  });

  await step('Close', async () => {
    await page.screenshot({ path: path.join(runDir, `step-20-before-action.png`), fullPage: true });
    const baseContext = iframeContent || page;
    const locator = baseContext.getByRole('button', { name: 'Close' }).filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, 'Close');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-20-after-action.png`), fullPage: true });
  });

  await step('action', async () => {
    await page.screenshot({ path: path.join(runDir, `step-21-before-action.png`), fullPage: true });
    const baseContext = iframeContent || page;
    const locator = baseContext.locator('div').filter({ hasText: '工作台报销单' }).nth(4);
    await expect(locator).toBeVisible();
    await smartClick(locator, 'action');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-21-after-action.png`), fullPage: true });
  });

  await step('action', async () => {
    await page.screenshot({ path: path.join(runDir, `step-22-before-action.png`), fullPage: true });
    const baseContext = iframeContent || page;
    const locator = baseContext.locator('.ant-table-body-inner > .ant-table-fixed > .ant-table-tbody > .ant-table-row.rejected-expense.ant-table-row-hover > .table-header-end > .column-overflow-observe-container > .space > div:nth-child(3) > a').filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, 'action');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-22-after-action.png`), fullPage: true });
  });

  await step('取-消', async () => {
    await page.screenshot({ path: path.join(runDir, `step-23-before-action.png`), fullPage: true });
    const baseContext = iframeContent || page;
    const locator = baseContext.getByRole('button', { name: '取 消' }).filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, '取-消');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-23-after-action.png`), fullPage: true });
  });

  await step('action', async () => {
    await page.screenshot({ path: path.join(runDir, `step-24-before-action.png`), fullPage: true });
    const baseContext = iframeContent || page;
    const locator = baseContext.locator('.ant-table-body-inner > .ant-table-fixed > .ant-table-tbody > .ant-table-row.rejected-expense.ant-table-row-hover > .table-header-end > .column-overflow-observe-container > .space > div > a').first();
    await expect(locator).toBeVisible();
    await smartClick(locator, 'action');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-24-after-action.png`), fullPage: true });
  });

  await step('action', async () => {
    await page.screenshot({ path: path.join(runDir, `step-25-before-action.png`), fullPage: true });
    const baseContext = iframeContent || page;
    const locator = baseContext.locator('.slide-title > .warp-svg-icon > .helios-icon > path').first();
    await expect(locator).toBeVisible();
    await smartClick(locator, 'action');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-25-after-action.png`), fullPage: true });
  });

  await step('其他费用', async () => {
    await page.screenshot({ path: path.join(runDir, `step-26-before-action.png`), fullPage: true });
    const baseContext = iframeContent || page;
    const locator = baseContext.getByText('其他费用').filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, '其他费用');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-26-after-action.png`), fullPage: true });
  });



  // 停止 tracing 由 Playwright 配置自动处理

  console.log('');
  console.log('🎉 测试完成: ' + 'test');
});
