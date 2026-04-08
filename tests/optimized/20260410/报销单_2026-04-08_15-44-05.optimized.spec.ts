import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

test('test', async ({ page }) => {
  test.setTimeout(60000);

  const screenshotDir = 'screenshots/20260410/报销单_2026-04-08_15-44-05';
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

  // Step 2: 账号登录
  await page.screenshot({ path: path.join(runDir, `step-2-before-action.png`), fullPage: true });
  const _locator2 =   page.locator('iframe').contentFrame().getByRole('tab', { name: '账号登录' });
  await page.waitForTimeout(1000).catch(() => {});
  await _locator2.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator2.scrollIntoViewIfNeeded().catch(() => {});
  await _locator2.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-2-after-action.png`), fullPage: true });

  // Step 3: 请输入手机号邮箱
  await page.screenshot({ path: path.join(runDir, `step-3-before-action.png`), fullPage: true });
  const _locator3 =   page.locator('iframe').contentFrame().getByRole('textbox', { name: '请输入手机号/邮箱' });
  await page.waitForTimeout(1000).catch(() => {});
  await _locator3.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator3.scrollIntoViewIfNeeded().catch(() => {});
  await _locator3.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-3-after-action.png`), fullPage: true });

  // Step 4: 请输入手机号邮箱
  await page.screenshot({ path: path.join(runDir, `step-4-before-action.png`), fullPage: true });
  const _locator4 =   page.locator('iframe').contentFrame().getByRole('textbox', { name: '请输入手机号/邮箱' });
  await page.waitForTimeout(1000).catch(() => {});
  await _locator4.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator4.scrollIntoViewIfNeeded().catch(() => {});
  await _locator4.fill("请输入手机号/邮箱", { timeout: 30000 });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-4-after-action.png`), fullPage: true });

  // Step 5: action
  await page.screenshot({ path: path.join(runDir, `step-5-before-action.png`), fullPage: true });
  const _locator5 =   page.locator('iframe').contentFrame().locator('div').filter({ hasText: '汇联易管理系统二维码登录账号登录请使用汇联易APP' }).nth(3);
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
  await _locator6.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-6-after-action.png`), fullPage: true });

  // Step 7: 请输入手机号邮箱
  await page.screenshot({ path: path.join(runDir, `step-7-before-action.png`), fullPage: true });
  const _locator7 =   page.locator('iframe').contentFrame().getByRole('textbox', { name: '请输入手机号/邮箱' });
  await page.waitForTimeout(1000).catch(() => {});
  await _locator7.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator7.scrollIntoViewIfNeeded().catch(() => {});
  await _locator7.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-7-after-action.png`), fullPage: true });

  // Step 8: action
  await page.screenshot({ path: path.join(runDir, `step-8-before-action.png`), fullPage: true });
  const _locator8 =   page.locator('iframe').contentFrame().getByRole('textbox', { name: '请输入手机号/邮箱' });
  await page.waitForTimeout(1000).catch(() => {});
  await _locator8.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator8.scrollIntoViewIfNeeded().catch(() => {});
  await _locator8.press("", { timeout: 30000 });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-8-after-action.png`), fullPage: true });

  // Step 9: 请输入手机号邮箱
  await page.screenshot({ path: path.join(runDir, `step-9-before-action.png`), fullPage: true });
  const _locator9 =   page.locator('iframe').contentFrame().getByRole('textbox', { name: '请输入手机号/邮箱' });
  await page.waitForTimeout(1000).catch(() => {});
  await _locator9.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator9.scrollIntoViewIfNeeded().catch(() => {});
  await _locator9.fill("请输入手机号/邮箱", { timeout: 30000 });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-9-after-action.png`), fullPage: true });

  // Step 10: 密码
  await page.screenshot({ path: path.join(runDir, `step-10-before-action.png`), fullPage: true });
  const _locator10 =   page.locator('iframe').contentFrame().getByRole('textbox', { name: '密码' });
  await page.waitForTimeout(1000).catch(() => {});
  await _locator10.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator10.scrollIntoViewIfNeeded().catch(() => {});
  await _locator10.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-10-after-action.png`), fullPage: true });

  // Step 11: action
  await page.screenshot({ path: path.join(runDir, `step-11-before-action.png`), fullPage: true });
  const _locator11 =   page.locator('iframe').contentFrame().locator('div').filter({ hasText: '汇联易管理系统二维码登录账号登录请使用汇联易APP' }).nth(3);
  await page.waitForTimeout(1000).catch(() => {});
  await _locator11.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator11.scrollIntoViewIfNeeded().catch(() => {});
  await _locator11.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-11-after-action.png`), fullPage: true });

  // Step 12: action
  await page.screenshot({ path: path.join(runDir, `step-12-before-action.png`), fullPage: true });
  const _locator12 =   page.locator('iframe').contentFrame().locator('form');
  await page.waitForTimeout(1000).catch(() => {});
  await _locator12.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator12.scrollIntoViewIfNeeded().catch(() => {});
  await _locator12.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-12-after-action.png`), fullPage: true });

  // Step 13: 密码
  await page.screenshot({ path: path.join(runDir, `step-13-before-action.png`), fullPage: true });
  const _locator13 =   page.locator('iframe').contentFrame().getByRole('textbox', { name: '密码' });
  await page.waitForTimeout(1000).catch(() => {});
  await _locator13.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator13.scrollIntoViewIfNeeded().catch(() => {});
  await _locator13.fill("密码", { timeout: 30000 });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-13-after-action.png`), fullPage: true });

  // Step 14: action
  await page.screenshot({ path: path.join(runDir, `step-14-before-action.png`), fullPage: true });
  const _locator14 =   page.locator('iframe').contentFrame().getByRole('checkbox', { name: '我已阅读并同意《用户协议》和《隐私协议》，未激活的账号在登录后将自动激活' });
  await page.waitForTimeout(1000).catch(() => {});
  await _locator14.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator14.scrollIntoViewIfNeeded().catch(() => {});
  await _locator14.check({ timeout: 30000 });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-14-after-action.png`), fullPage: true });

  // Step 15: 登-录
  await page.screenshot({ path: path.join(runDir, `step-15-before-action.png`), fullPage: true });
  const _locator15 =   page.locator('iframe').contentFrame().getByRole('button', { name: '登 录' });
  await page.waitForTimeout(1000).catch(() => {});
  await _locator15.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator15.scrollIntoViewIfNeeded().catch(() => {});
  await _locator15.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-15-after-action.png`), fullPage: true });

  // Step 16: action
  await page.screenshot({ path: path.join(runDir, `step-16-before-action.png`), fullPage: true });
  const _locator16 =   page.locator('iframe').contentFrame().locator('div').filter({ hasText: /^报销单$/ }).nth(2);
  await page.waitForTimeout(1000).catch(() => {});
  await _locator16.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator16.scrollIntoViewIfNeeded().catch(() => {});
  await _locator16.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-16-after-action.png`), fullPage: true });

  // Step 17: 新建报销单
  await page.screenshot({ path: path.join(runDir, `step-17-before-action.png`), fullPage: true });
  const _locator17 =   page.locator('iframe').contentFrame().getByRole('button', { name: '新建报销单' });
  await page.waitForTimeout(1000).catch(() => {});
  await _locator17.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator17.scrollIntoViewIfNeeded().catch(() => {});
  await _locator17.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-17-after-action.png`), fullPage: true });

  // Step 18: action
  await page.screenshot({ path: path.join(runDir, `step-18-before-action.png`), fullPage: true });
  const _locator18 =   page.locator('iframe').contentFrame().locator('#formOid > .ant-select-selection > .ant-select-selection__rendered');
  await page.waitForTimeout(1000).catch(() => {});
  await _locator18.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator18.scrollIntoViewIfNeeded().catch(() => {});
  await _locator18.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-18-after-action.png`), fullPage: true });

  // Step 19: action
  await page.screenshot({ path: path.join(runDir, `step-19-before-action.png`), fullPage: true });
  const _locator19 =   page.locator('iframe').contentFrame().locator('#formOid > .ant-select-selection > .ant-select-selection__rendered > .ant-select-selection__placeholder');
  await page.waitForTimeout(1000).catch(() => {});
  await _locator19.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator19.scrollIntoViewIfNeeded().catch(() => {});
  await _locator19.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-19-after-action.png`), fullPage: true });

  // Step 20: action
  await page.screenshot({ path: path.join(runDir, `step-20-before-action.png`), fullPage: true });
  const _locator20 =   page.locator('iframe').contentFrame().locator('#formOid > .ant-select-selection > .ant-select-selection__rendered > .ant-select-selection__placeholder');
  await page.waitForTimeout(1000).catch(() => {});
  await _locator20.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator20.scrollIntoViewIfNeeded().catch(() => {});
  await _locator20.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-20-after-action.png`), fullPage: true });

  // Step 21: Close
  await page.screenshot({ path: path.join(runDir, `step-21-before-action.png`), fullPage: true });
  const _locator21 =   page.locator('iframe').contentFrame().getByRole('button', { name: 'Close', exact: true });
  await page.waitForTimeout(1000).catch(() => {});
  await _locator21.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator21.scrollIntoViewIfNeeded().catch(() => {});
  await _locator21.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-21-after-action.png`), fullPage: true });

  // Step 22: 取-消
  await page.screenshot({ path: path.join(runDir, `step-22-before-action.png`), fullPage: true });
  const _locator22 =   page.locator('iframe').contentFrame().getByRole('button', { name: '取 消' });
  await page.waitForTimeout(1000).catch(() => {});
  await _locator22.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator22.scrollIntoViewIfNeeded().catch(() => {});
  await _locator22.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-22-after-action.png`), fullPage: true });

  // Step 23: action
  await page.screenshot({ path: path.join(runDir, `step-23-before-action.png`), fullPage: true });
  const _locator23 =   page.locator('iframe').contentFrame().locator('.anticon.anticon-close > svg');
  await page.waitForTimeout(1000).catch(() => {});
  await _locator23.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator23.scrollIntoViewIfNeeded().catch(() => {});
  await _locator23.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-23-after-action.png`), fullPage: true });

  // Step 24: action
  await page.screenshot({ path: path.join(runDir, `step-24-before-action.png`), fullPage: true });
  const _locator24 =   page.locator('iframe').contentFrame().locator('.button-text.ant-tooltip-open > .helios-icon');
  await page.waitForTimeout(1000).catch(() => {});
  await _locator24.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator24.scrollIntoViewIfNeeded().catch(() => {});
  await _locator24.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-24-after-action.png`), fullPage: true });

  // Step 25: action
  await page.screenshot({ path: path.join(runDir, `step-25-before-action.png`), fullPage: true });
  const _locator25 =   page.locator('iframe').contentFrame().locator('.button-text.ant-tooltip-open > .helios-icon');
  await page.waitForTimeout(1000).catch(() => {});
  await _locator25.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator25.scrollIntoViewIfNeeded().catch(() => {});
  await _locator25.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-25-after-action.png`), fullPage: true });

  // Step 26: 管理员
  await page.screenshot({ path: path.join(runDir, `step-26-before-action.png`), fullPage: true });
  const _locator26 =   page.locator('iframe').contentFrame().getByText('管理员').nth(1);
  await page.waitForTimeout(1000).catch(() => {});
  await _locator26.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator26.scrollIntoViewIfNeeded().catch(() => {});
  await _locator26.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-26-after-action.png`), fullPage: true });

  // Step 27: 基本信息
  await page.screenshot({ path: path.join(runDir, `step-27-before-action.png`), fullPage: true });
  const _locator27 =   page.locator('iframe').contentFrame().getByText('基本信息');
  await page.waitForTimeout(1000).catch(() => {});
  await _locator27.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator27.scrollIntoViewIfNeeded().catch(() => {});
  await _locator27.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-27-after-action.png`), fullPage: true });

  // Step 28: action
  await page.screenshot({ path: path.join(runDir, `step-28-before-action.png`), fullPage: true });
  const _locator28 =   page.locator('iframe').contentFrame().getByTitle('单据信息');
  await page.waitForTimeout(1000).catch(() => {});
  await _locator28.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator28.scrollIntoViewIfNeeded().catch(() => {});
  await _locator28.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-28-after-action.png`), fullPage: true });

  // Step 29: 费用明细
  await page.screenshot({ path: path.join(runDir, `step-29-before-action.png`), fullPage: true });
  const _locator29 =   page.locator('iframe').contentFrame().getByText('费用明细*');
  await page.waitForTimeout(1000).catch(() => {});
  await _locator29.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator29.scrollIntoViewIfNeeded().catch(() => {});
  await _locator29.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-29-after-action.png`), fullPage: true });

  // Step 30: action
  await page.screenshot({ path: path.join(runDir, `step-30-before-action.png`), fullPage: true });
  const _locator30 =   page.locator('iframe').contentFrame().getByTitle('收款信息');
  await page.waitForTimeout(1000).catch(() => {});
  await _locator30.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator30.scrollIntoViewIfNeeded().catch(() => {});
  await _locator30.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-30-after-action.png`), fullPage: true });

  // Step 31: 查看扩展字段
  await page.screenshot({ path: path.join(runDir, `step-31-before-action.png`), fullPage: true });
  const _locator31 =   page.locator('iframe').contentFrame().getByText('查看扩展字段').first();
  await page.waitForTimeout(1000).catch(() => {});
  await _locator31.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator31.scrollIntoViewIfNeeded().catch(() => {});
  await _locator31.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-31-after-action.png`), fullPage: true });

  // Step 32: 关-闭
  await page.screenshot({ path: path.join(runDir, `step-32-before-action.png`), fullPage: true });
  const _locator32 =   page.locator('iframe').contentFrame().getByRole('button', { name: '关 闭' });
  await page.waitForTimeout(1000).catch(() => {});
  await _locator32.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator32.scrollIntoViewIfNeeded().catch(() => {});
  await _locator32.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-32-after-action.png`), fullPage: true });

  // Step 33: 详情
  await page.screenshot({ path: path.join(runDir, `step-33-before-action.png`), fullPage: true });
  const _locator33 =   page.locator('iframe').contentFrame().locator('#payment').getByText('详情', { exact: true });
  await page.waitForTimeout(1000).catch(() => {});
  await _locator33.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator33.scrollIntoViewIfNeeded().catch(() => {});
  await _locator33.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-33-after-action.png`), fullPage: true });

  // Step 34: Close
  await page.screenshot({ path: path.join(runDir, `step-34-before-action.png`), fullPage: true });
  const _locator34 =   page.locator('iframe').contentFrame().getByRole('button', { name: 'Close' });
  await page.waitForTimeout(1000).catch(() => {});
  await _locator34.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator34.scrollIntoViewIfNeeded().catch(() => {});
  await _locator34.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-34-after-action.png`), fullPage: true });

  // Step 35: action
  await page.screenshot({ path: path.join(runDir, `step-35-before-action.png`), fullPage: true });
  const _locator35 =   page.locator('iframe').contentFrame().locator('div').filter({ hasText: '工作台报销单' }).nth(4);
  await page.waitForTimeout(1000).catch(() => {});
  await _locator35.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator35.scrollIntoViewIfNeeded().catch(() => {});
  await _locator35.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-35-after-action.png`), fullPage: true });

  // Step 36: action
  await page.screenshot({ path: path.join(runDir, `step-36-before-action.png`), fullPage: true });
  const _locator36 =   page.locator('iframe').contentFrame().locator('.ant-table-body-inner > .ant-table-fixed > .ant-table-tbody > .ant-table-row.rejected-expense.ant-table-row-hover > .table-header-end > .column-overflow-observe-container > .space > div:nth-child(3) > a');
  await page.waitForTimeout(1000).catch(() => {});
  await _locator36.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator36.scrollIntoViewIfNeeded().catch(() => {});
  await _locator36.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-36-after-action.png`), fullPage: true });

  // Step 37: 取-消
  await page.screenshot({ path: path.join(runDir, `step-37-before-action.png`), fullPage: true });
  const _locator37 =   page.locator('iframe').contentFrame().getByRole('button', { name: '取 消' });
  await page.waitForTimeout(1000).catch(() => {});
  await _locator37.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator37.scrollIntoViewIfNeeded().catch(() => {});
  await _locator37.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-37-after-action.png`), fullPage: true });

  // Step 38: action
  await page.screenshot({ path: path.join(runDir, `step-38-before-action.png`), fullPage: true });
  const _locator38 =   page.locator('iframe').contentFrame().locator('.ant-table-body-inner > .ant-table-fixed > .ant-table-tbody > .ant-table-row.rejected-expense.ant-table-row-hover > .table-header-end > .column-overflow-observe-container > .space > div > a').first();
  await page.waitForTimeout(1000).catch(() => {});
  await _locator38.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator38.scrollIntoViewIfNeeded().catch(() => {});
  await _locator38.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-38-after-action.png`), fullPage: true });

  // Step 39: action
  await page.screenshot({ path: path.join(runDir, `step-39-before-action.png`), fullPage: true });
  const _locator39 =   page.locator('iframe').contentFrame().locator('.slide-title > .warp-svg-icon > .helios-icon > path').first();
  await page.waitForTimeout(1000).catch(() => {});
  await _locator39.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator39.scrollIntoViewIfNeeded().catch(() => {});
  await _locator39.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-39-after-action.png`), fullPage: true });

  // Step 40: 其他费用
  await page.screenshot({ path: path.join(runDir, `step-40-before-action.png`), fullPage: true });
  const _locator40 =   page.locator('iframe').contentFrame().getByText('其他费用').first();
  await page.waitForTimeout(1000).catch(() => {});
  await _locator40.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator40.scrollIntoViewIfNeeded().catch(() => {});
  await _locator40.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-40-after-action.png`), fullPage: true });

  console.log('✅ 测试完成: test');
});