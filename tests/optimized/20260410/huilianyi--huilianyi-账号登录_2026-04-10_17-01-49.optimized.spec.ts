import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

// 定义智能动作函数
async function smartClick(locator, stepName) {
  console.log(`🧠 执行智能点击: ${stepName}`);
  console.log(`🔍 元素数量: ${await locator.count()}`);
  
  // 等待元素可见
  try {
    await locator.waitFor({ state: 'visible', timeout: 10000 });
  } catch (e) {
    console.log(`⚠️ 元素不可见: ${e.message}`);
    // 在元素不可见时暂停，便于调试
    await locator.page().pause();
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
    // 在点击失败时暂停，便于调试
    await locator.page().pause();
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
    // 在元素不可见时暂停，便于调试
    await locator.page().pause();
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
    // 在填充失败时暂停，便于调试
    await locator.page().pause();
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

test.use({
  storageState: 'storage/loginState/stage.json'
});

test('test', async ({ page }) => {
  test.setTimeout(120000);

  // 初始化截图目录
  const screenshotDir = 'screenshots/20260410/huilianyi--huilianyi-账号登录_2026-04-10_17-01-49';
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

  await step('action', async () => {
    await page.screenshot({ path: path.join(runDir, `step-2-before-action.png`), fullPage: true });
    const locator = page.locator('.hover-pointer-icon').first();
    await expect(locator).toBeVisible();
    await smartClick(locator, 'action');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-2-after-action.png`), fullPage: true });
  });

  await step('action', async () => {
    await page.screenshot({ path: path.join(runDir, `step-3-before-action.png`), fullPage: true });
    const locator = page.locator('.ant-popover-open > .hover-pointer-icon').filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, 'action');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-3-after-action.png`), fullPage: true });
  });

  await step('个人首页', async () => {
    await page.screenshot({ path: path.join(runDir, `step-4-before-action.png`), fullPage: true });
    const locator = page.getByText('个人首页').filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, '个人首页');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await page.screenshot({ path: path.join(runDir, `step-4-after-action.png`), fullPage: true });
  });



  // 停止 tracing 由 Playwright 配置自动处理

  console.log('');
  console.log('🎉 测试完成: ' + 'test');
});
