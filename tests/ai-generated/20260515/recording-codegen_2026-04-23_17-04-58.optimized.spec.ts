import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { takeStepScreenshot } from '../../../utils/screenshot';
import { step, smartClick } from '../../utils/optimized-actions';

test('test', async ({ page }) => {
  test.setTimeout(120000);

  // 初始化截图目录
  const screenshotDir = 'screenshots/20260515/recording-codegen_2026-04-23_17-04-58';
  if (!fs.existsSync(screenshotDir)) {
    fs.mkdirSync(screenshotDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const runDir = path.join(screenshotDir, timestamp);
  // 定义 Iframe 引用
  let iframeContent: any = null;
  
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
      console.log('🌐 导航到: / (基于 baseURL)');
      await page.goto('/', { waitUntil: 'networkidle' });
      await page.waitForLoadState('networkidle');
      await takeStepScreenshot(page, path.join(runDir, `step-1-导航到首页.png`), { fullPage: true });
    });
  }

    await step('导航到页面', async () => {
    console.log('🌐 导航到: https://stage.huilianyi.com/main/home');
    await page.goto('https://stage.huilianyi.com/main/home', { waitUntil: 'networkidle' });
    await page.waitForLoadState('networkidle');
    await takeStepScreenshot(page, path.join(runDir, `step-1-导航到页面.png`), { fullPage: true });
  });

  await step('申请单', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-2-申请单-before.png`), { fullPage: true });
    const baseContext = iframeContent || page;
    const locator = baseContext.getByText('申请单', { exact: true }).filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, '申请单');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await takeStepScreenshot(page, path.join(runDir, `step-2-申请单-after.png`), { fullPage: true });
  });

  await step('action', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-3-action-before.png`), { fullPage: true });
    const baseContext = iframeContent || page;
    const locator = baseContext.locator('.anticon.anticon-close > svg').first();
    await expect(locator).toBeVisible();
    await smartClick(locator, 'action');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await takeStepScreenshot(page, path.join(runDir, `step-3-action-after.png`), { fullPage: true });
  });

  await step('1', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-4-1-before.png`), { fullPage: true });
    const baseContext = iframeContent || page;
    const locator = baseContext.getByRole('cell', { name: '1' }).filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, '1');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await takeStepScreenshot(page, path.join(runDir, `step-4-1-after.png`), { fullPage: true });
  });



  // 停止 tracing 由 Playwright 配置自动处理

  console.log('');
  console.log('🎉 测试完成: ' + 'test');
});
