import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { takeStepScreenshot } from '../../../src/utils/screenshot';
import { step, smartClick } from '../../utils/optimized-actions';

test('test', async ({ page }) => {
  test.setTimeout(120000);

  // 初始化截图目录
  const screenshotDir = 'screenshots/260515/recording-codegen_2026-04-23_16-52-02';
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

  await step('我的审批', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-2-我的审批-before.png`), { fullPage: true });
    const baseContext = iframeContent || page;
    const locator = baseContext.getByText('我的审批').filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, '我的审批');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await takeStepScreenshot(page, path.join(runDir, `step-2-我的审批-after.png`), { fullPage: true });
  });

  await step('action', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-3-action-before.png`), { fullPage: true });
    const baseContext = iframeContent || page;
    const locator = baseContext.getByRole('row', { name: '1 - 张艳华 出差 CNY 2,122.00' }).getByLabel('', { exact: true }).filter({ visible: true }).first();
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
    await takeStepScreenshot(page, path.join(runDir, `step-3-action-after.png`), { fullPage: true });
  });

  await step('通-过', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-4-通-过-before.png`), { fullPage: true });
    const baseContext = iframeContent || page;
    const locator = baseContext.getByRole('button', { name: '通 过' }).filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, '通-过');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await takeStepScreenshot(page, path.join(runDir, `step-4-通-过-after.png`), { fullPage: true });
  });

  await step('Close', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-5-Close-before.png`), { fullPage: true });
    const baseContext = iframeContent || page;
    const locator = baseContext.getByRole('button', { name: 'Close' }).filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, 'Close');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await takeStepScreenshot(page, path.join(runDir, `step-5-Close-after.png`), { fullPage: true });
  });

  await step('1', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-6-1-before.png`), { fullPage: true });
    const baseContext = iframeContent || page;
    const locator = baseContext.getByRole('cell', { name: '1', exact: true }).filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, '1');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await takeStepScreenshot(page, path.join(runDir, `step-6-1-after.png`), { fullPage: true });
  });

  await step('审批历史', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-7-审批历史-before.png`), { fullPage: true });
    const baseContext = iframeContent || page;
    const locator = baseContext.getByRole('tab', { name: '审批历史' }).filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, '审批历史');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await takeStepScreenshot(page, path.join(runDir, `step-7-审批历史-after.png`), { fullPage: true });
  });

  await step('关联脉络', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-8-关联脉络-before.png`), { fullPage: true });
    const baseContext = iframeContent || page;
    const locator = baseContext.getByRole('tab', { name: '关联脉络' }).filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, '关联脉络');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await takeStepScreenshot(page, path.join(runDir, `step-8-关联脉络-after.png`), { fullPage: true });
  });

  await step('收起', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-9-收起-before.png`), { fullPage: true });
    const baseContext = iframeContent || page;
    const locator = baseContext.getByText('收起').filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, '收起');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await takeStepScreenshot(page, path.join(runDir, `step-9-收起-after.png`), { fullPage: true });
  });

  await step('action', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-10-action-before.png`), { fullPage: true });
    const baseContext = iframeContent || page;
    const locator = baseContext.locator('img').nth(1).filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, 'action');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await takeStepScreenshot(page, path.join(runDir, `step-10-action-after.png`), { fullPage: true });
  });

  await step('action', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-11-action-before.png`), { fullPage: true });
    const baseContext = iframeContent || page;
    const locator = baseContext.locator('.warp-svg-icon.ant-tooltip-open > .helios-icon').filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, 'action');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await takeStepScreenshot(page, path.join(runDir, `step-11-action-after.png`), { fullPage: true });
  });

  await step('返-回', async () => {
    await takeStepScreenshot(page, path.join(runDir, `step-12-返-回-before.png`), { fullPage: true });
    const baseContext = iframeContent || page;
    const locator = baseContext.getByRole('button', { name: '返 回' }).filter({ visible: true }).first();
    await expect(locator).toBeVisible();
    await smartClick(locator, '返-回');
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await takeStepScreenshot(page, path.join(runDir, `step-12-返-回-after.png`), { fullPage: true });
  });



  // 停止 tracing 由 Playwright 配置自动处理

  console.log('');
  console.log('🎉 测试完成: ' + 'test');
});
