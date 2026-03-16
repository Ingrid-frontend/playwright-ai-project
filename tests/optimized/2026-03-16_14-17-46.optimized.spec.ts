import { test, expect } from '@playwright/test';
import fs from 'fs';
import { screenshotWhenStable } from '../../utils/screenshot';

test.use({
  storageState: 'storage/loginState/stage.json'
});

test('test', async ({ page }) => {

  const tracingStarted = await page.context().tracing.start({ screenshots: true, snapshots: true }).catch(() => false);

  const screenshotRoot = 'screenshots/2026-03-16_14-17-46';
  const now = new Date();
  const runTimestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}-${String(now.getSeconds()).padStart(2, '0')}`;
  const testId = Math.random().toString(36).substring(2, 9);
  let browserInfo = 'unknown';
  let runDir = '';
  const getScreenshotPath = (step: number, label: string) => `${runDir}/step-${step}-${label}.png`;

  test.setTimeout(60000);
  await page.goto('https://stage.huilianyi.com/main/home');
  await expect(page).toHaveURL(/.*huilianyi.*/);
  browserInfo = await page.context().browser()?.browserType().name() || 'unknown';
  runDir = `${screenshotRoot}/${runTimestamp}-${browserInfo}-${testId}`;
  if (!fs.existsSync(runDir)) {
    fs.mkdirSync(runDir, { recursive: true });
  }
  await test.step('step-1-action', async () => {
  const { path: beforePath, route: beforeRoute } = await screenshotWhenStable(page, getScreenshotPath(1, 'before-action'));
    console.log('📍 当前路由:', beforeRoute);
    try {
  const _locator = page.getByText('申请单', { exact: true }).filter({ visible: true });
  await _locator.click({ force: true, delay: 100 });
    } catch (error) {
      console.log(`❌ 步骤执行失败: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  const { path: afterPath, route: afterRoute } = await screenshotWhenStable(page, getScreenshotPath(1, 'after-action'));
    console.log('📍 当前路由:', afterRoute);
  });
  await test.step('step-2-action', async () => {
  const { path: beforePath, route: beforeRoute } = await screenshotWhenStable(page, getScreenshotPath(2, 'before-action'));
    console.log('📍 当前路由:', beforeRoute);
    try {
  const _locator = page.locator(".anticon.anticon-close > svg").filter({ visible: true }).first();
  await _locator.click({ force: true, delay: 100 });
    } catch (error) {
      console.log(`❌ 步骤执行失败: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  const { path: afterPath, route: afterRoute } = await screenshotWhenStable(page, getScreenshotPath(2, 'after-action'));
    console.log('📍 当前路由:', afterRoute);
  });
  await test.step('step-3-1', async () => {
  const { path: beforePath, route: beforeRoute } = await screenshotWhenStable(page, getScreenshotPath(3, 'before-1'));
    console.log('📍 当前路由:', beforeRoute);
    try {
  const _locator = page.getByRole('cell', { name: '1' }).filter({ visible: true }).first();
  await _locator.click({ force: true, delay: 100 });
    } catch (error) {
      console.log(`❌ 步骤执行失败: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  const { path: afterPath, route: afterRoute } = await screenshotWhenStable(page, getScreenshotPath(3, 'after-1'));
    console.log('📍 当前路由:', afterRoute);
  });

  if (tracingStarted) {

    await page.context().tracing.stop({ path: `${runDir}/trace.zip` });

  }
});