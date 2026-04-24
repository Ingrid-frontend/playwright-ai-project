import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { takeStepScreenshot } from '../../../utils/screenshot';
import { step, smartClick } from '../../utils/optimized-actions';

test('test', async ({ page }) => {
  test.setTimeout(120000);

  // 初始化截图目录
  const screenshotDir = 'screenshots/20260515/中控首页-浏览_2026-04-22_11-15-33';
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
    console.log('🌐 导航到: https://stage.huilianyi.com/');
    await page.goto('https://stage.huilianyi.com/', { waitUntil: 'networkidle' });
    await page.waitForLoadState('networkidle');
    await takeStepScreenshot(page, path.join(runDir, `step-1-导航到页面.png`), { fullPage: true });
  });

  await step('action', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-2-action-before.png`), { fullPage: true });
    const baseContext = iframeContent || page;
    const locator = baseContext.locator('.hover-pointer-icon').first();
    await expect(locator).toBeVisible();
    await smartClick(locator, 'action');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await takeStepScreenshot(page, path.join(runDir, `step-2-action-after.png`), { fullPage: true });
  });

  await step('action', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-3-action-before.png`), { fullPage: true });
    const baseContext = iframeContent || page;
    const locator = baseContext.locator('.ant-popover-open > .hover-pointer-icon').filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, 'action');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await takeStepScreenshot(page, path.join(runDir, `step-3-action-after.png`), { fullPage: true });
  });

  await step('action', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-4-action-before.png`), { fullPage: true });
    const baseContext = iframeContent || page;
    const locator = baseContext.locator('.single-index.hover-click > .index-name > div:nth-child(2) > .hover-pointer-icon').filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, 'action');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await takeStepScreenshot(page, path.join(runDir, `step-4-action-after.png`), { fullPage: true });
  });

  await step('请选择日期', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-5-请选择日期-before.png`), { fullPage: true });
    const baseContext = iframeContent || page;
    const locator = baseContext.locator('#home-main-charts-guide-id').getByRole('textbox', { name: '请选择日期' }).filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, '请选择日期');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await takeStepScreenshot(page, path.join(runDir, `step-5-请选择日期-after.png`), { fullPage: true });
  });

  await step('二月', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-6-二月-before.png`), { fullPage: true });
    const baseContext = iframeContent || page;
    const locator = baseContext.getByText('二月', { exact: true }).filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, '二月');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await takeStepScreenshot(page, path.join(runDir, `step-6-二月-after.png`), { fullPage: true });
  });

  await step('个人首页', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-7-个人首页-before.png`), { fullPage: true });
    const baseContext = iframeContent || page;
    const locator = baseContext.getByText('个人首页').filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, '个人首页');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await takeStepScreenshot(page, path.join(runDir, `step-7-个人首页-after.png`), { fullPage: true });
  });

  await step('请选择代理人', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-8-请选择代理人-before.png`), { fullPage: true });
    const baseContext = iframeContent || page;
    const locator = baseContext.getByText('请选择代理人').filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, '请选择代理人');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await takeStepScreenshot(page, path.join(runDir, `step-8-请选择代理人-after.png`), { fullPage: true });
  });

  await step('action', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-9-action-before.png`), { fullPage: true });
    const baseContext = iframeContent || page;
    const locator = baseContext.locator('.ant-select-arrow').first().filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, 'action');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await takeStepScreenshot(page, path.join(runDir, `step-9-action-after.png`), { fullPage: true });
  });

  await step('工作台个人首页设置首页面板个人首页管理员首页', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-10-工作台个人首页设置首页面板个人首页管理员首页-before.png`), { fullPage: true });
    const baseContext = iframeContent || page;
    const locator = baseContext.getByText('工作台个人首页设置首页面板个人首页管理员首页').filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, '工作台个人首页设置首页面板个人首页管理员首页');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await takeStepScreenshot(page, path.join(runDir, `step-10-工作台个人首页设置首页面板个人首页管理员首页-after.png`), { fullPage: true });
  });

  await step('action', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-11-action-before.png`), { fullPage: true });
    const baseContext = iframeContent || page;
    const locator = baseContext.locator('.down-triangle').filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, 'action');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await takeStepScreenshot(page, path.join(runDir, `step-11-action-after.png`), { fullPage: true });
  });

  await step('action', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-12-action-before.png`), { fullPage: true });
    const baseContext = iframeContent || page;
    const locator = baseContext.locator('.down-triangle').filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, 'action');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await takeStepScreenshot(page, path.join(runDir, `step-12-action-after.png`), { fullPage: true });
  });



  // 停止 tracing 由 Playwright 配置自动处理

  console.log('');
  console.log('🎉 测试完成: ' + 'test');
});
