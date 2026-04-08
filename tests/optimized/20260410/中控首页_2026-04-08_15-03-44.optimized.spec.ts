import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

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
  const _locator2 =   page.locator('iframe').contentFrame().locator('div').filter({ hasText: '汇联易管理系统二维码登录账号登录请使用汇联易APP' }).nth(3);
  await page.waitForTimeout(1000).catch(() => {});
  await _locator2.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator2.scrollIntoViewIfNeeded().catch(() => {});
  await _locator2.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-2-after-action.png`), fullPage: true });

  // Step 3: 账号登录
  await page.screenshot({ path: path.join(runDir, `step-3-before-action.png`), fullPage: true });
  const _locator3 =   page.locator('iframe').contentFrame().getByRole('tab', { name: '账号登录' });
  await page.waitForTimeout(1000).catch(() => {});
  await _locator3.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator3.scrollIntoViewIfNeeded().catch(() => {});
  await _locator3.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-3-after-action.png`), fullPage: true });

  // Step 4: action
  await page.screenshot({ path: path.join(runDir, `step-4-before-action.png`), fullPage: true });
  const _locator4 =   page.locator('iframe').contentFrame().locator('div').filter({ hasText: '汇联易管理系统二维码登录账号登录请使用汇联易APP' }).nth(3);
  await page.waitForTimeout(1000).catch(() => {});
  await _locator4.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator4.scrollIntoViewIfNeeded().catch(() => {});
  await _locator4.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-4-after-action.png`), fullPage: true });

  // Step 5: 请输入手机号邮箱
  await page.screenshot({ path: path.join(runDir, `step-5-before-action.png`), fullPage: true });
  const _locator5 =   page.locator('iframe').contentFrame().getByRole('textbox', { name: '请输入手机号/邮箱' });
  await page.waitForTimeout(1000).catch(() => {});
  await _locator5.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator5.scrollIntoViewIfNeeded().catch(() => {});
  await _locator5.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-5-after-action.png`), fullPage: true });

  // Step 6: 请输入手机号邮箱
  await page.screenshot({ path: path.join(runDir, `step-6-before-action.png`), fullPage: true });
  const _locator6 =   page.locator('iframe').contentFrame().getByRole('textbox', { name: '请输入手机号/邮箱' });
  await page.waitForTimeout(1000).catch(() => {});
  await _locator6.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator6.scrollIntoViewIfNeeded().catch(() => {});
  await _locator6.fill("请输入手机号/邮箱", { timeout: 30000 });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-6-after-action.png`), fullPage: true });

  // Step 7: action
  await page.screenshot({ path: path.join(runDir, `step-7-before-action.png`), fullPage: true });
  const _locator7 =   page.locator('iframe').contentFrame().locator('div').filter({ hasText: '汇联易管理系统二维码登录账号登录请使用汇联易APP' }).nth(3);
  await page.waitForTimeout(1000).catch(() => {});
  await _locator7.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator7.scrollIntoViewIfNeeded().catch(() => {});
  await _locator7.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-7-after-action.png`), fullPage: true });

  // Step 8: 密码
  await page.screenshot({ path: path.join(runDir, `step-8-before-action.png`), fullPage: true });
  const _locator8 =   page.locator('iframe').contentFrame().getByRole('textbox', { name: '密码' });
  await page.waitForTimeout(1000).catch(() => {});
  await _locator8.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator8.scrollIntoViewIfNeeded().catch(() => {});
  await _locator8.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-8-after-action.png`), fullPage: true });

  // Step 9: 密码
  await page.screenshot({ path: path.join(runDir, `step-9-before-action.png`), fullPage: true });
  const _locator9 =   page.locator('iframe').contentFrame().getByRole('textbox', { name: '密码' });
  await page.waitForTimeout(1000).catch(() => {});
  await _locator9.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator9.scrollIntoViewIfNeeded().catch(() => {});
  await _locator9.fill("密码", { timeout: 30000 });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-9-after-action.png`), fullPage: true });

  // Step 10: action
  await page.screenshot({ path: path.join(runDir, `step-10-before-action.png`), fullPage: true });
  const _locator10 =   page.locator('iframe').contentFrame().locator('label');
  await page.waitForTimeout(1000).catch(() => {});
  await _locator10.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator10.scrollIntoViewIfNeeded().catch(() => {});
  await _locator10.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-10-after-action.png`), fullPage: true });

  // Step 11: action
  await page.screenshot({ path: path.join(runDir, `step-11-before-action.png`), fullPage: true });
  const _locator11 =   page.locator('iframe').contentFrame().getByRole('checkbox', { name: '我已阅读并同意《用户协议》和《隐私协议》，未激活的账号在登录后将自动激活' });
  await page.waitForTimeout(1000).catch(() => {});
  await _locator11.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator11.scrollIntoViewIfNeeded().catch(() => {});
  await _locator11.check({ timeout: 30000 });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-11-after-action.png`), fullPage: true });

  // Step 12: 登-录
  await page.screenshot({ path: path.join(runDir, `step-12-before-action.png`), fullPage: true });
  const _locator12 =   page.locator('iframe').contentFrame().getByRole('button', { name: '登 录' });
  await page.waitForTimeout(1000).catch(() => {});
  await _locator12.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator12.scrollIntoViewIfNeeded().catch(() => {});
  await _locator12.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-12-after-action.png`), fullPage: true });

  // Step 13: action
  await page.screenshot({ path: path.join(runDir, `step-13-before-action.png`), fullPage: true });
  const _locator13 =   page.locator('iframe').contentFrame().locator('.hover-pointer-icon').first();
  await page.waitForTimeout(1000).catch(() => {});
  await _locator13.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator13.scrollIntoViewIfNeeded().catch(() => {});
  await _locator13.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-13-after-action.png`), fullPage: true });

  // Step 14: action
  await page.screenshot({ path: path.join(runDir, `step-14-before-action.png`), fullPage: true });
  const _locator14 =   page.locator('iframe').contentFrame().locator('.ant-popover-open > .hover-pointer-icon');
  await page.waitForTimeout(1000).catch(() => {});
  await _locator14.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator14.scrollIntoViewIfNeeded().catch(() => {});
  await _locator14.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-14-after-action.png`), fullPage: true });

  // Step 15: action
  await page.screenshot({ path: path.join(runDir, `step-15-before-action.png`), fullPage: true });
  const _locator15 =   page.locator('iframe').contentFrame().locator('.single-index.hover-click > .index-name > div:nth-child(2) > .hover-pointer-icon');
  await page.waitForTimeout(1000).catch(() => {});
  await _locator15.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator15.scrollIntoViewIfNeeded().catch(() => {});
  await _locator15.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-15-after-action.png`), fullPage: true });

  // Step 16: 请选择日期
  await page.screenshot({ path: path.join(runDir, `step-16-before-action.png`), fullPage: true });
  const _locator16 =   page.locator('iframe').contentFrame().locator('#home-main-charts-guide-id').getByRole('textbox', { name: '请选择日期' });
  await page.waitForTimeout(1000).catch(() => {});
  await _locator16.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator16.scrollIntoViewIfNeeded().catch(() => {});
  await _locator16.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-16-after-action.png`), fullPage: true });

  // Step 17: 二月
  await page.screenshot({ path: path.join(runDir, `step-17-before-action.png`), fullPage: true });
  const _locator17 =   page.locator('iframe').contentFrame().getByText('二月', { exact: true });
  await page.waitForTimeout(1000).catch(() => {});
  await _locator17.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator17.scrollIntoViewIfNeeded().catch(() => {});
  await _locator17.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-17-after-action.png`), fullPage: true });

  // Step 18: 个人首页
  await page.screenshot({ path: path.join(runDir, `step-18-before-action.png`), fullPage: true });
  const _locator18 =   page.locator('iframe').contentFrame().getByText('个人首页');
  await page.waitForTimeout(1000).catch(() => {});
  await _locator18.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator18.scrollIntoViewIfNeeded().catch(() => {});
  await _locator18.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-18-after-action.png`), fullPage: true });

  // Step 19: 请选择代理人
  await page.screenshot({ path: path.join(runDir, `step-19-before-action.png`), fullPage: true });
  const _locator19 =   page.locator('iframe').contentFrame().getByText('请选择代理人');
  await page.waitForTimeout(1000).catch(() => {});
  await _locator19.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator19.scrollIntoViewIfNeeded().catch(() => {});
  await _locator19.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-19-after-action.png`), fullPage: true });

  // Step 20: action
  await page.screenshot({ path: path.join(runDir, `step-20-before-action.png`), fullPage: true });
  const _locator20 =   page.locator('iframe').contentFrame().locator('.ant-select-arrow').first();
  await page.waitForTimeout(1000).catch(() => {});
  await _locator20.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator20.scrollIntoViewIfNeeded().catch(() => {});
  await _locator20.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-20-after-action.png`), fullPage: true });

  // Step 21: action
  await page.screenshot({ path: path.join(runDir, `step-21-before-action.png`), fullPage: true });
  const _locator21 =   page.locator('iframe').contentFrame().locator('.ant-select-arrow').first();
  await page.waitForTimeout(1000).catch(() => {});
  await _locator21.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator21.scrollIntoViewIfNeeded().catch(() => {});
  await _locator21.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-21-after-action.png`), fullPage: true });

  // Step 22: 工作台个人首页设置首页面板个人首页管理员首页
  await page.screenshot({ path: path.join(runDir, `step-22-before-action.png`), fullPage: true });
  const _locator22 =   page.locator('iframe').contentFrame().getByText('工作台个人首页设置首页面板个人首页管理员首页');
  await page.waitForTimeout(1000).catch(() => {});
  await _locator22.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator22.scrollIntoViewIfNeeded().catch(() => {});
  await _locator22.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-22-after-action.png`), fullPage: true });

  // Step 23: action
  await page.screenshot({ path: path.join(runDir, `step-23-before-action.png`), fullPage: true });
  const _locator23 =   page.locator('iframe').contentFrame().locator('.down-triangle');
  await page.waitForTimeout(1000).catch(() => {});
  await _locator23.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator23.scrollIntoViewIfNeeded().catch(() => {});
  await _locator23.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-23-after-action.png`), fullPage: true });

  // Step 24: action
  await page.screenshot({ path: path.join(runDir, `step-24-before-action.png`), fullPage: true });
  const _locator24 =   page.locator('iframe').contentFrame().locator('.down-triangle > path');
  await page.waitForTimeout(1000).catch(() => {});
  await _locator24.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator24.scrollIntoViewIfNeeded().catch(() => {});
  await _locator24.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-24-after-action.png`), fullPage: true });

  console.log('✅ 测试完成: test');
});