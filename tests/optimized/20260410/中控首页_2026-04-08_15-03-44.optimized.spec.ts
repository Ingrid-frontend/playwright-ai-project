import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

test.use({
  storageState: 'storage/loginState/stage.json'
});

test('test', async ({ page }) => {
  test.setTimeout(60000);

  const screenshotDir = 'screenshots/20260410/中控首页_2026-04-08_15-03-44';
  if (!fs.existsSync(screenshotDir)) {
    fs.mkdirSync(screenshotDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const runDir = path.join(screenshotDir, timestamp);
  fs.mkdirSync(runDir, { recursive: true });


  // Step 1: Go to https://stage.huilianyi.com/
  await page.goto('https://stage.huilianyi.com/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-1-before-action.png`), fullPage: true });

  // Step 2: action
  await page.screenshot({ path: path.join(runDir, `step-2-before-action.png`), fullPage: true });
  const _locator2 =   page.locator('.hover-pointer-icon').first();
  await page.waitForTimeout(1000).catch(() => {});
  await _locator2.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator2.scrollIntoViewIfNeeded().catch(() => {});
  await _locator2.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-2-after-action.png`), fullPage: true });

  // Step 3: action
  await page.screenshot({ path: path.join(runDir, `step-3-before-action.png`), fullPage: true });
  const _locator3 =   page.locator('.ant-popover-open > .hover-pointer-icon');
  await page.waitForTimeout(1000).catch(() => {});
  await _locator3.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator3.scrollIntoViewIfNeeded().catch(() => {});
  await _locator3.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-3-after-action.png`), fullPage: true });

  // Step 4: action
  await page.screenshot({ path: path.join(runDir, `step-4-before-action.png`), fullPage: true });
  const _locator4 =   page.locator('.single-index.hover-click > .index-name > div:nth-child(2) > .hover-pointer-icon');
  await page.waitForTimeout(1000).catch(() => {});
  await _locator4.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator4.scrollIntoViewIfNeeded().catch(() => {});
  await _locator4.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-4-after-action.png`), fullPage: true });

  // Step 5: 请选择日期
  await page.screenshot({ path: path.join(runDir, `step-5-before-action.png`), fullPage: true });
  const _locator5 =   page.locator('#home-main-charts-guide-id').getByRole('textbox', { name: '请选择日期' });
  await page.waitForTimeout(1000).catch(() => {});
  await _locator5.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator5.scrollIntoViewIfNeeded().catch(() => {});
  await _locator5.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-5-after-action.png`), fullPage: true });

  // Step 6: 二月
  await page.screenshot({ path: path.join(runDir, `step-6-before-action.png`), fullPage: true });
  const _locator6 =   page.getByText('二月', { exact: true });
  await page.waitForTimeout(1000).catch(() => {});
  await _locator6.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator6.scrollIntoViewIfNeeded().catch(() => {});
  await _locator6.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-6-after-action.png`), fullPage: true });

  // Step 7: 个人首页
  await page.screenshot({ path: path.join(runDir, `step-7-before-action.png`), fullPage: true });
  const _locator7 =   page.getByText('个人首页');
  await page.waitForTimeout(1000).catch(() => {});
  await _locator7.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator7.scrollIntoViewIfNeeded().catch(() => {});
  await _locator7.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-7-after-action.png`), fullPage: true });

  // Step 8: 请选择代理人
  await page.screenshot({ path: path.join(runDir, `step-8-before-action.png`), fullPage: true });
  const _locator8 =   page.getByText('请选择代理人');
  await page.waitForTimeout(1000).catch(() => {});
  await _locator8.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator8.scrollIntoViewIfNeeded().catch(() => {});
  await _locator8.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-8-after-action.png`), fullPage: true });

  // Step 9: action
  await page.screenshot({ path: path.join(runDir, `step-9-before-action.png`), fullPage: true });
  const _locator9 =   page.locator('.ant-select-arrow').first();
  await page.waitForTimeout(1000).catch(() => {});
  await _locator9.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator9.scrollIntoViewIfNeeded().catch(() => {});
  await _locator9.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-9-after-action.png`), fullPage: true });

  // Step 10: action
  await page.screenshot({ path: path.join(runDir, `step-10-before-action.png`), fullPage: true });
  const _locator10 =   page.locator('.ant-select-arrow').first();
  await page.waitForTimeout(1000).catch(() => {});
  await _locator10.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator10.scrollIntoViewIfNeeded().catch(() => {});
  await _locator10.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-10-after-action.png`), fullPage: true });

  // Step 11: 工作台个人首页设置首页面板个人首页管理员首页
  await page.screenshot({ path: path.join(runDir, `step-11-before-action.png`), fullPage: true });
  const _locator11 =   page.getByText('工作台个人首页设置首页面板个人首页管理员首页');
  await page.waitForTimeout(1000).catch(() => {});
  await _locator11.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator11.scrollIntoViewIfNeeded().catch(() => {});
  await _locator11.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-11-after-action.png`), fullPage: true });

  // Step 12: action
  await page.screenshot({ path: path.join(runDir, `step-12-before-action.png`), fullPage: true });
  const _locator12 =   page.locator('.down-triangle');
  await page.waitForTimeout(1000).catch(() => {});
  await _locator12.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator12.scrollIntoViewIfNeeded().catch(() => {});
  await _locator12.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-12-after-action.png`), fullPage: true });

  // Step 13: action
  await page.screenshot({ path: path.join(runDir, `step-13-before-action.png`), fullPage: true });
  const _locator13 =   page.locator('.down-triangle > path');
  await page.waitForTimeout(1000).catch(() => {});
  await _locator13.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator13.scrollIntoViewIfNeeded().catch(() => {});
  await _locator13.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-13-after-action.png`), fullPage: true });

  console.log('✅ 测试完成: test');
});