import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

test.use({
  storageState: 'storage/loginState/stage.json'
});

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

  // Step 2: action
  await page.screenshot({ path: path.join(runDir, `step-2-before-action.png`), fullPage: true });
  const _locator2 =   page.locator('form');
  await page.waitForTimeout(1000).catch(() => {});
  await _locator2.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator2.scrollIntoViewIfNeeded().catch(() => {});
  await _locator2.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-2-after-action.png`), fullPage: true });

  // Step 3: action
  await page.screenshot({ path: path.join(runDir, `step-3-before-action.png`), fullPage: true });
  const _locator3 =   page.locator('div').filter({ hasText: /^报销单$/ }).nth(2);
  await page.waitForTimeout(1000).catch(() => {});
  await _locator3.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator3.scrollIntoViewIfNeeded().catch(() => {});
  await _locator3.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-3-after-action.png`), fullPage: true });

  // Step 4: 新建报销单
  await page.screenshot({ path: path.join(runDir, `step-4-before-action.png`), fullPage: true });
  const _locator4 =   page.getByRole('button', { name: '新建报销单' });
  await page.waitForTimeout(1000).catch(() => {});
  await _locator4.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator4.scrollIntoViewIfNeeded().catch(() => {});
  await _locator4.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-4-after-action.png`), fullPage: true });

  // Step 5: action
  await page.screenshot({ path: path.join(runDir, `step-5-before-action.png`), fullPage: true });
  const _locator5 =   page.locator('#formOid > .ant-select-selection > .ant-select-selection__rendered');
  await page.waitForTimeout(1000).catch(() => {});
  await _locator5.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator5.scrollIntoViewIfNeeded().catch(() => {});
  await _locator5.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-5-after-action.png`), fullPage: true });

  // Step 6: action
  await page.screenshot({ path: path.join(runDir, `step-6-before-action.png`), fullPage: true });
  const _locator6 =   page.locator('#formOid > .ant-select-selection > .ant-select-selection__rendered > .ant-select-selection__placeholder');
  await page.waitForTimeout(1000).catch(() => {});
  await _locator6.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator6.scrollIntoViewIfNeeded().catch(() => {});
  await _locator6.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-6-after-action.png`), fullPage: true });

  // Step 7: action
  await page.screenshot({ path: path.join(runDir, `step-7-before-action.png`), fullPage: true });
  const _locator7 =   page.locator('#formOid > .ant-select-selection > .ant-select-selection__rendered > .ant-select-selection__placeholder');
  await page.waitForTimeout(1000).catch(() => {});
  await _locator7.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator7.scrollIntoViewIfNeeded().catch(() => {});
  await _locator7.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-7-after-action.png`), fullPage: true });

  // Step 8: Close
  await page.screenshot({ path: path.join(runDir, `step-8-before-action.png`), fullPage: true });
  const _locator8 =   page.getByRole('button', { name: 'Close', exact: true });
  await page.waitForTimeout(1000).catch(() => {});
  await _locator8.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator8.scrollIntoViewIfNeeded().catch(() => {});
  await _locator8.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-8-after-action.png`), fullPage: true });

  // Step 9: 取-消
  await page.screenshot({ path: path.join(runDir, `step-9-before-action.png`), fullPage: true });
  const _locator9 =   page.getByRole('button', { name: '取 消' });
  await page.waitForTimeout(1000).catch(() => {});
  await _locator9.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator9.scrollIntoViewIfNeeded().catch(() => {});
  await _locator9.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-9-after-action.png`), fullPage: true });

  // Step 10: action
  await page.screenshot({ path: path.join(runDir, `step-10-before-action.png`), fullPage: true });
  const _locator10 =   page.locator('.anticon.anticon-close');
  await page.waitForTimeout(1000).catch(() => {});
  await _locator10.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator10.scrollIntoViewIfNeeded().catch(() => {});
  await _locator10.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-10-after-action.png`), fullPage: true });

  // Step 11: action
  await page.screenshot({ path: path.join(runDir, `step-11-before-action.png`), fullPage: true });
  const _locator11 =   page.locator('.button-text.ant-tooltip-open > .helios-icon');
  await page.waitForTimeout(1000).catch(() => {});
  await _locator11.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator11.scrollIntoViewIfNeeded().catch(() => {});
  await _locator11.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-11-after-action.png`), fullPage: true });

  // Step 12: action
  await page.screenshot({ path: path.join(runDir, `step-12-before-action.png`), fullPage: true });
  const _locator12 =   page.locator('.button-text.ant-tooltip-open > .helios-icon');
  await page.waitForTimeout(1000).catch(() => {});
  await _locator12.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator12.scrollIntoViewIfNeeded().catch(() => {});
  await _locator12.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-12-after-action.png`), fullPage: true });

  // Step 13: 管理员
  await page.screenshot({ path: path.join(runDir, `step-13-before-action.png`), fullPage: true });
  const _locator13 =   page.getByText('管理员').nth(1);
  await page.waitForTimeout(1000).catch(() => {});
  await _locator13.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator13.scrollIntoViewIfNeeded().catch(() => {});
  await _locator13.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-13-after-action.png`), fullPage: true });

  // Step 14: 基本信息
  await page.screenshot({ path: path.join(runDir, `step-14-before-action.png`), fullPage: true });
  const _locator14 =   page.getByText('基本信息');
  await page.waitForTimeout(1000).catch(() => {});
  await _locator14.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator14.scrollIntoViewIfNeeded().catch(() => {});
  await _locator14.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-14-after-action.png`), fullPage: true });

  // Step 15: action
  await page.screenshot({ path: path.join(runDir, `step-15-before-action.png`), fullPage: true });
  const _locator15 =   page.getByTitle('单据信息');
  await page.waitForTimeout(1000).catch(() => {});
  await _locator15.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator15.scrollIntoViewIfNeeded().catch(() => {});
  await _locator15.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-15-after-action.png`), fullPage: true });

  // Step 16: 费用明细
  await page.screenshot({ path: path.join(runDir, `step-16-before-action.png`), fullPage: true });
  const _locator16 =   page.getByText('费用明细*');
  await page.waitForTimeout(1000).catch(() => {});
  await _locator16.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator16.scrollIntoViewIfNeeded().catch(() => {});
  await _locator16.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-16-after-action.png`), fullPage: true });

  // Step 17: action
  await page.screenshot({ path: path.join(runDir, `step-17-before-action.png`), fullPage: true });
  const _locator17 =   page.getByTitle('收款信息');
  await page.waitForTimeout(1000).catch(() => {});
  await _locator17.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator17.scrollIntoViewIfNeeded().catch(() => {});
  await _locator17.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-17-after-action.png`), fullPage: true });

  // Step 18: 查看扩展字段
  await page.screenshot({ path: path.join(runDir, `step-18-before-action.png`), fullPage: true });
  const _locator18 =   page.getByText('查看扩展字段').first();
  await page.waitForTimeout(1000).catch(() => {});
  await _locator18.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator18.scrollIntoViewIfNeeded().catch(() => {});
  await _locator18.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-18-after-action.png`), fullPage: true });

  // Step 19: 关-闭
  await page.screenshot({ path: path.join(runDir, `step-19-before-action.png`), fullPage: true });
  const _locator19 =   page.getByRole('button', { name: '关 闭' });
  await page.waitForTimeout(1000).catch(() => {});
  await _locator19.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator19.scrollIntoViewIfNeeded().catch(() => {});
  await _locator19.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-19-after-action.png`), fullPage: true });

  // Step 20: 详情
  await page.screenshot({ path: path.join(runDir, `step-20-before-action.png`), fullPage: true });
  const _locator20 =   page.locator('#payment').getByText('详情', { exact: true });
  await page.waitForTimeout(1000).catch(() => {});
  await _locator20.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator20.scrollIntoViewIfNeeded().catch(() => {});
  await _locator20.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-20-after-action.png`), fullPage: true });

  // Step 21: Close
  await page.screenshot({ path: path.join(runDir, `step-21-before-action.png`), fullPage: true });
  const _locator21 =   page.getByRole('button', { name: 'Close' });
  await page.waitForTimeout(1000).catch(() => {});
  await _locator21.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator21.scrollIntoViewIfNeeded().catch(() => {});
  await _locator21.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-21-after-action.png`), fullPage: true });

  // Step 22: action
  await page.screenshot({ path: path.join(runDir, `step-22-before-action.png`), fullPage: true });
  const _locator22 =   page.locator('div').filter({ hasText: '工作台报销单' }).nth(4);
  await page.waitForTimeout(1000).catch(() => {});
  await _locator22.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator22.scrollIntoViewIfNeeded().catch(() => {});
  await _locator22.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-22-after-action.png`), fullPage: true });

  // Step 23: action
  await page.screenshot({ path: path.join(runDir, `step-23-before-action.png`), fullPage: true });
  const _locator23 =   page.locator('.ant-table-body-inner > .ant-table-fixed > .ant-table-tbody > .ant-table-row.rejected-expense.ant-table-row-hover > .table-header-end > .column-overflow-observe-container > .space > div:nth-child(3) > a');
  await page.waitForTimeout(1000).catch(() => {});
  await _locator23.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator23.scrollIntoViewIfNeeded().catch(() => {});
  await _locator23.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-23-after-action.png`), fullPage: true });

  // Step 24: 取-消
  await page.screenshot({ path: path.join(runDir, `step-24-before-action.png`), fullPage: true });
  const _locator24 =   page.getByRole('button', { name: '取 消' });
  await page.waitForTimeout(1000).catch(() => {});
  await _locator24.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator24.scrollIntoViewIfNeeded().catch(() => {});
  await _locator24.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-24-after-action.png`), fullPage: true });

  // Step 25: action
  await page.screenshot({ path: path.join(runDir, `step-25-before-action.png`), fullPage: true });
  const _locator25 =   page.locator('.ant-table-body-inner > .ant-table-fixed > .ant-table-tbody > .ant-table-row.rejected-expense.ant-table-row-hover > .table-header-end > .column-overflow-observe-container > .space > div > a').first();
  await page.waitForTimeout(1000).catch(() => {});
  await _locator25.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator25.scrollIntoViewIfNeeded().catch(() => {});
  await _locator25.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-25-after-action.png`), fullPage: true });

  // Step 26: action
  await page.screenshot({ path: path.join(runDir, `step-26-before-action.png`), fullPage: true });
  const _locator26 =   page.locator('.slide-title > .warp-svg-icon > .helios-icon > path').first();
  await page.waitForTimeout(1000).catch(() => {});
  await _locator26.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator26.scrollIntoViewIfNeeded().catch(() => {});
  await _locator26.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-26-after-action.png`), fullPage: true });

  // Step 27: 其他费用
  await page.screenshot({ path: path.join(runDir, `step-27-before-action.png`), fullPage: true });
  const _locator27 =   page.getByText('其他费用').first();
  await page.waitForTimeout(1000).catch(() => {});
  await _locator27.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator27.scrollIntoViewIfNeeded().catch(() => {});
  await _locator27.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-27-after-action.png`), fullPage: true });

  console.log('✅ 测试完成: test');
});