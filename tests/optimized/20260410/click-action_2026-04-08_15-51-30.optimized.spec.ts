import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

test.use({
  storageState: 'storage/loginState/stage.json'
});

test('test', async ({ page }) => {
  test.setTimeout(60000);

  const screenshotDir = 'screenshots/20260410/click-action_2026-04-08_15-51-30';
  if (!fs.existsSync(screenshotDir)) {
    fs.mkdirSync(screenshotDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const runDir = path.join(screenshotDir, timestamp);
  fs.mkdirSync(runDir, { recursive: true });

  // 导航到首页
  await page.goto('https://stage.huilianyi.com/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  // Step 1: 新建合同
  await page.screenshot({ path: path.join(runDir, `step-1-before-action.png`), fullPage: true });
  const _locator1 =   page.getByRole('button', { name: '新建合同' });
  await page.waitForTimeout(1000).catch(() => {});
  await _locator1.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator1.scrollIntoViewIfNeeded().catch(() => {});
  await _locator1.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-1-after-action.png`), fullPage: true });

  // Step 2: 请选择合同
  await page.screenshot({ path: path.join(runDir, `step-2-before-action.png`), fullPage: true });
  const _locator2 =   page.getByText('请选择合同');
  await page.waitForTimeout(1000).catch(() => {});
  await _locator2.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator2.scrollIntoViewIfNeeded().catch(() => {});
  await _locator2.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-2-after-action.png`), fullPage: true });

  // Step 3: 合同
  await page.screenshot({ path: path.join(runDir, `step-3-before-action.png`), fullPage: true });
  const _locator3 =   page.getByRole('option', { name: '合同' }).locator('span').first();
  await page.waitForTimeout(1000).catch(() => {});
  await _locator3.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator3.scrollIntoViewIfNeeded().catch(() => {});
  await _locator3.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-3-after-action.png`), fullPage: true });

  // Step 4: 确-定
  await page.screenshot({ path: path.join(runDir, `step-4-before-action.png`), fullPage: true });
  const _locator4 =   page.getByRole('button', { name: '确 定' });
  await page.waitForTimeout(1000).catch(() => {});
  await _locator4.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator4.scrollIntoViewIfNeeded().catch(() => {});
  await _locator4.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-4-after-action.png`), fullPage: true });

  // Step 5: action
  await page.screenshot({ path: path.join(runDir, `step-5-before-action.png`), fullPage: true });
  const _locator5 =   page.locator('.ant-select-selection__placeholder').first();
  await page.waitForTimeout(1000).catch(() => {});
  await _locator5.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator5.scrollIntoViewIfNeeded().catch(() => {});
  await _locator5.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-5-after-action.png`), fullPage: true });

  // Step 6: -02-11
  await page.screenshot({ path: path.join(runDir, `step-6-before-action.png`), fullPage: true });
  const _locator6 =   page.getByRole('cell', { name: '-02-11' });
  await page.waitForTimeout(1000).catch(() => {});
  await _locator6.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator6.scrollIntoViewIfNeeded().catch(() => {});
  await _locator6.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-6-after-action.png`), fullPage: true });

  // Step 7: 确-定
  await page.screenshot({ path: path.join(runDir, `step-7-before-action.png`), fullPage: true });
  const _locator7 =   page.getByRole('button', { name: '确 定' });
  await page.waitForTimeout(1000).catch(() => {});
  await _locator7.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator7.scrollIntoViewIfNeeded().catch(() => {});
  await _locator7.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-7-after-action.png`), fullPage: true });

  // Step 8: action
  await page.screenshot({ path: path.join(runDir, `step-8-before-action.png`), fullPage: true });
  const _locator8 =   page.locator('input[name=7fbac917-1a37-42f9-a929-bf3e0776d27c]');
  await page.waitForTimeout(1000).catch(() => {});
  await _locator8.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator8.scrollIntoViewIfNeeded().catch(() => {});
  await _locator8.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-8-after-action.png`), fullPage: true });

  // Step 9: 111
  await page.screenshot({ path: path.join(runDir, `step-9-before-action.png`), fullPage: true });
  const _locator9 =   page.locator('input[name=7fbac917-1a37-42f9-a929-bf3e0776d27c]');
  await page.waitForTimeout(1000).catch(() => {});
  await _locator9.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator9.scrollIntoViewIfNeeded().catch(() => {});
  await _locator9.fill("111", { timeout: 30000 });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-9-after-action.png`), fullPage: true });

  // Step 10: action
  await page.screenshot({ path: path.join(runDir, `step-10-before-action.png`), fullPage: true });
  const _locator10 =   page.locator('[id=6117e841-c812-051f-3cd5-3adf0721e8a3] > .ant-row > .ant-col.ant-form-item-control-wrapper > .ant-form-item-control > .ant-form-item-children > .multi-selector-block > .multi-selector-wrapper > .fake-input > .slector-value-content');
  await page.waitForTimeout(1000).catch(() => {});
  await _locator10.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator10.scrollIntoViewIfNeeded().catch(() => {});
  await _locator10.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-10-after-action.png`), fullPage: true });

  // Step 11: action
  await page.screenshot({ path: path.join(runDir, `step-11-before-action.png`), fullPage: true });
  const _locator11 =   page.locator('div').filter({ hasText: /^宣传展览合同$/ }).first();
  await page.waitForTimeout(1000).catch(() => {});
  await _locator11.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator11.scrollIntoViewIfNeeded().catch(() => {});
  await _locator11.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-11-after-action.png`), fullPage: true });

  // Step 12: action
  await page.screenshot({ path: path.join(runDir, `step-12-before-action.png`), fullPage: true });
  const _locator12 =   page.locator('.ant-calendar-picker-input').first();
  await page.waitForTimeout(1000).catch(() => {});
  await _locator12.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator12.scrollIntoViewIfNeeded().catch(() => {});
  await _locator12.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-12-after-action.png`), fullPage: true });

  // Step 13: action
  await page.screenshot({ path: path.join(runDir, `step-13-before-action.png`), fullPage: true });
  const _locator13 =   page.getByRole('grid').getByTitle('年4月8日').locator('div');
  await page.waitForTimeout(1000).catch(() => {});
  await _locator13.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator13.scrollIntoViewIfNeeded().catch(() => {});
  await _locator13.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-13-after-action.png`), fullPage: true });

  // Step 14: action
  await page.screenshot({ path: path.join(runDir, `step-14-before-action.png`), fullPage: true });
  const _locator14 =   page.locator('[id=7a1b867b-c181-4128-bd8e-9cfb06f670c6] > .ant-row > .ant-col.ant-form-item-control-wrapper > .ant-form-item-control > .ant-form-item-children > .multi-selector-block > .multi-selector-wrapper > .fake-input > .slector-value-content');
  await page.waitForTimeout(1000).catch(() => {});
  await _locator14.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator14.scrollIntoViewIfNeeded().catch(() => {});
  await _locator14.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-14-after-action.png`), fullPage: true });

  // Step 15: 上海实誉智能科技有限公司
  await page.screenshot({ path: path.join(runDir, `step-15-before-action.png`), fullPage: true });
  const _locator15 =   page.getByText('上海实誉智能科技有限公司');
  await page.waitForTimeout(1000).catch(() => {});
  await _locator15.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator15.scrollIntoViewIfNeeded().catch(() => {});
  await _locator15.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-15-after-action.png`), fullPage: true });

  // Step 16: 苏州空动力电子技术有限公司
  await page.screenshot({ path: path.join(runDir, `step-16-before-action.png`), fullPage: true });
  const _locator16 =   page.getByText('苏州空动力电子技术有限公司');
  await page.waitForTimeout(1000).catch(() => {});
  await _locator16.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator16.scrollIntoViewIfNeeded().catch(() => {});
  await _locator16.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-16-after-action.png`), fullPage: true });

  // Step 17: action
  await page.screenshot({ path: path.join(runDir, `step-17-before-action.png`), fullPage: true });
  const _locator17 =   page.locator('.fake-input.fake-input-open > .slector-value-content');
  await page.waitForTimeout(1000).catch(() => {});
  await _locator17.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator17.scrollIntoViewIfNeeded().catch(() => {});
  await _locator17.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-17-after-action.png`), fullPage: true });

  // Step 18: action
  await page.screenshot({ path: path.join(runDir, `step-18-before-action.png`), fullPage: true });
  const _locator18 =   page.locator('div').filter({ hasText: /^迦递货运代理（上海）有限公司$/ }).first();
  await page.waitForTimeout(1000).catch(() => {});
  await _locator18.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator18.scrollIntoViewIfNeeded().catch(() => {});
  await _locator18.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-18-after-action.png`), fullPage: true });

  // Step 19: action
  await page.screenshot({ path: path.join(runDir, `step-19-before-action.png`), fullPage: true });
  const _locator19 =   page.locator('#c2444aaf-38db-b521-2aed-becd1e284030 > .ant-row > .ant-col.ant-form-item-control-wrapper > .ant-form-item-control > .ant-form-item-children > .multi-selector-block > .multi-selector-wrapper > .fake-input > .slector-value-content');
  await page.waitForTimeout(1000).catch(() => {});
  await _locator19.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator19.scrollIntoViewIfNeeded().catch(() => {});
  await _locator19.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-19-after-action.png`), fullPage: true });

  // Step 20: 增值税专用发票
  await page.screenshot({ path: path.join(runDir, `step-20-before-action.png`), fullPage: true });
  const _locator20 =   page.getByText('增值税专用发票', { exact: true });
  await page.waitForTimeout(1000).catch(() => {});
  await _locator20.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator20.scrollIntoViewIfNeeded().catch(() => {});
  await _locator20.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-20-after-action.png`), fullPage: true });

  // Step 21: 增值税电子普通发票通行费
  await page.screenshot({ path: path.join(runDir, `step-21-before-action.png`), fullPage: true });
  const _locator21 =   page.getByText('增值税电子普通发票（通行费）');
  await page.waitForTimeout(1000).catch(() => {});
  await _locator21.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator21.scrollIntoViewIfNeeded().catch(() => {});
  await _locator21.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-21-after-action.png`), fullPage: true });

  // Step 22: action
  await page.screenshot({ path: path.join(runDir, `step-22-before-action.png`), fullPage: true });
  const _locator22 =   page.locator('.fake-input.fake-input-open > .slector-value-content');
  await page.waitForTimeout(1000).catch(() => {});
  await _locator22.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator22.scrollIntoViewIfNeeded().catch(() => {});
  await _locator22.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-22-after-action.png`), fullPage: true });

  // Step 23: action
  await page.screenshot({ path: path.join(runDir, `step-23-before-action.png`), fullPage: true });
  const _locator23 =   page.locator('span').filter({ hasText: '增值税电子普通发票（通行费）' });
  await page.waitForTimeout(1000).catch(() => {});
  await _locator23.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator23.scrollIntoViewIfNeeded().catch(() => {});
  await _locator23.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-23-after-action.png`), fullPage: true });

  // Step 24: action
  await page.screenshot({ path: path.join(runDir, `step-24-before-action.png`), fullPage: true });
  const _locator24 =   page.locator('#e3b6e63e-57be-4dab-9d39-2273ab0e5680 > .ant-row > .ant-col.ant-form-item-control-wrapper > .ant-form-item-control > .ant-form-item-children > .ant-calendar-picker > div > .ant-calendar-picker-input');
  await page.waitForTimeout(1000).catch(() => {});
  await _locator24.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator24.scrollIntoViewIfNeeded().catch(() => {});
  await _locator24.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-24-after-action.png`), fullPage: true });

  // Step 25: action
  await page.screenshot({ path: path.join(runDir, `step-25-before-action.png`), fullPage: true });
  const _locator25 =   page.getByRole('grid').getByTitle('年4月8日').locator('div');
  await page.waitForTimeout(1000).catch(() => {});
  await _locator25.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator25.scrollIntoViewIfNeeded().catch(() => {});
  await _locator25.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-25-after-action.png`), fullPage: true });

  // Step 26: action
  await page.screenshot({ path: path.join(runDir, `step-26-before-action.png`), fullPage: true });
  const _locator26 =   page.locator('[id=84a560cf-0dcd-4053-b3e2-e78a0f335ad1] > .ant-row > .ant-col.ant-form-item-control-wrapper > .ant-form-item-control > .ant-form-item-children > .ant-calendar-picker > div > .ant-calendar-picker-input');
  await page.waitForTimeout(1000).catch(() => {});
  await _locator26.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator26.scrollIntoViewIfNeeded().catch(() => {});
  await _locator26.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-26-after-action.png`), fullPage: true });

  // Step 27: action
  await page.screenshot({ path: path.join(runDir, `step-27-before-action.png`), fullPage: true });
  const _locator27 =   page.getByRole('grid').getByTitle('年4月8日').locator('div');
  await page.waitForTimeout(1000).catch(() => {});
  await _locator27.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator27.scrollIntoViewIfNeeded().catch(() => {});
  await _locator27.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-27-after-action.png`), fullPage: true });

  // Step 28: 附件上传
  await page.screenshot({ path: path.join(runDir, `step-28-before-action.png`), fullPage: true });
  const _locator28 =   page.getByText('附件上传').first();
  await page.waitForTimeout(1000).catch(() => {});
  await _locator28.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator28.scrollIntoViewIfNeeded().catch(() => {});
  await _locator28.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-28-after-action.png`), fullPage: true });

  // Step 29: 请选择
  await page.screenshot({ path: path.join(runDir, `step-29-before-action.png`), fullPage: true });
  const _locator29 =   page.getByText('请选择').nth(4);
  await page.waitForTimeout(1000).catch(() => {});
  await _locator29.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator29.scrollIntoViewIfNeeded().catch(() => {});
  await _locator29.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-29-after-action.png`), fullPage: true });

  // Step 30: 600005
  await page.screenshot({ path: path.join(runDir, `step-30-before-action.png`), fullPage: true });
  const _locator30 =   page.getByRole('cell', { name: '600005' });
  await page.waitForTimeout(1000).catch(() => {});
  await _locator30.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator30.scrollIntoViewIfNeeded().catch(() => {});
  await _locator30.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-30-after-action.png`), fullPage: true });

  // Step 31: 确-定
  await page.screenshot({ path: path.join(runDir, `step-31-before-action.png`), fullPage: true });
  const _locator31 =   page.getByRole('button', { name: '确 定' });
  await page.waitForTimeout(1000).catch(() => {});
  await _locator31.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator31.scrollIntoViewIfNeeded().catch(() => {});
  await _locator31.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-31-after-action.png`), fullPage: true });

  // Step 32: 下一步
  await page.screenshot({ path: path.join(runDir, `step-32-before-action.png`), fullPage: true });
  const _locator32 =   page.getByRole('button', { name: '下一步' });
  await page.waitForTimeout(1000).catch(() => {});
  await _locator32.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator32.scrollIntoViewIfNeeded().catch(() => {});
  await _locator32.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-32-after-action.png`), fullPage: true });

  // Step 33: 管理员0001江苏省精创电气股份有限公司江苏省精创电气股份有限公司手工财务中心
  await page.screenshot({ path: path.join(runDir, `step-33-before-action.png`), fullPage: true });
  const _locator33 =   page.getByText('管理员0001江苏省精创电气股份有限公司江苏省精创电气股份有限公司（手工）|财务中心');
  await page.waitForTimeout(1000).catch(() => {});
  await _locator33.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator33.scrollIntoViewIfNeeded().catch(() => {});
  await _locator33.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-33-after-action.png`), fullPage: true });

  // Step 34: Close
  await page.screenshot({ path: path.join(runDir, `step-34-before-action.png`), fullPage: true });
  const _locator34 =   page.getByRole('button', { name: 'Close' });
  await page.waitForTimeout(1000).catch(() => {});
  await _locator34.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator34.scrollIntoViewIfNeeded().catch(() => {});
  await _locator34.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-34-after-action.png`), fullPage: true });

  // Step 35: 展开
  await page.screenshot({ path: path.join(runDir, `step-35-before-action.png`), fullPage: true });
  const _locator35 =   page.getByText('展开');
  await page.waitForTimeout(1000).catch(() => {});
  await _locator35.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator35.scrollIntoViewIfNeeded().catch(() => {});
  await _locator35.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-35-after-action.png`), fullPage: true });

  // Step 36: 收起
  await page.screenshot({ path: path.join(runDir, `step-36-before-action.png`), fullPage: true });
  const _locator36 =   page.locator('#one-screen-header-info').getByText('收起');
  await page.waitForTimeout(1000).catch(() => {});
  await _locator36.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator36.scrollIntoViewIfNeeded().catch(() => {});
  await _locator36.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-36-after-action.png`), fullPage: true });

  // Step 37: 收起
  await page.screenshot({ path: path.join(runDir, `step-37-before-action.png`), fullPage: true });
  const _locator37 =   page.getByText('收起');
  await page.waitForTimeout(1000).catch(() => {});
  await _locator37.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator37.scrollIntoViewIfNeeded().catch(() => {});
  await _locator37.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-37-after-action.png`), fullPage: true });

  // Step 38: 展开
  await page.screenshot({ path: path.join(runDir, `step-38-before-action.png`), fullPage: true });
  const _locator38 =   page.locator('#RELATED_COMP').getByText('展开');
  await page.waitForTimeout(1000).catch(() => {});
  await _locator38.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator38.scrollIntoViewIfNeeded().catch(() => {});
  await _locator38.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-38-after-action.png`), fullPage: true });

  // Step 39: 合同公司
  await page.screenshot({ path: path.join(runDir, `step-39-before-action.png`), fullPage: true });
  const _locator39 =   page.getByText('合同公司');
  await page.waitForTimeout(1000).catch(() => {});
  await _locator39.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator39.scrollIntoViewIfNeeded().catch(() => {});
  await _locator39.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-39-after-action.png`), fullPage: true });

  // Step 40: 江苏省精创电气股份有限公司
  await page.screenshot({ path: path.join(runDir, `step-40-before-action.png`), fullPage: true });
  const _locator40 =   page.locator('#CUSTOM_FORM').getByText('江苏省精创电气股份有限公司');
  await page.waitForTimeout(1000).catch(() => {});
  await _locator40.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator40.scrollIntoViewIfNeeded().catch(() => {});
  await _locator40.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-40-after-action.png`), fullPage: true });

  // Step 41: 合同名称
  await page.screenshot({ path: path.join(runDir, `step-41-before-action.png`), fullPage: true });
  const _locator41 =   page.getByText('合同名称');
  await page.waitForTimeout(1000).catch(() => {});
  await _locator41.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator41.scrollIntoViewIfNeeded().catch(() => {});
  await _locator41.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-41-after-action.png`), fullPage: true });

  // Step 42: 111
  await page.screenshot({ path: path.join(runDir, `step-42-before-action.png`), fullPage: true });
  const _locator42 =   page.getByText('111');
  await page.waitForTimeout(1000).catch(() => {});
  await _locator42.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator42.scrollIntoViewIfNeeded().catch(() => {});
  await _locator42.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-42-after-action.png`), fullPage: true });

  // Step 43: 合同类型
  await page.screenshot({ path: path.join(runDir, `step-43-before-action.png`), fullPage: true });
  const _locator43 =   page.getByText('合同类型');
  await page.waitForTimeout(1000).catch(() => {});
  await _locator43.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator43.scrollIntoViewIfNeeded().catch(() => {});
  await _locator43.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-43-after-action.png`), fullPage: true });

  // Step 44: 宣传展览合同
  await page.screenshot({ path: path.join(runDir, `step-44-before-action.png`), fullPage: true });
  const _locator44 =   page.getByText('宣传展览合同');
  await page.waitForTimeout(1000).catch(() => {});
  await _locator44.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator44.scrollIntoViewIfNeeded().catch(() => {});
  await _locator44.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-44-after-action.png`), fullPage: true });

  // Step 45: 签署日期
  await page.screenshot({ path: path.join(runDir, `step-45-before-action.png`), fullPage: true });
  const _locator45 =   page.getByText('签署日期');
  await page.waitForTimeout(1000).catch(() => {});
  await _locator45.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator45.scrollIntoViewIfNeeded().catch(() => {});
  await _locator45.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-45-after-action.png`), fullPage: true });

  // Step 46: -04-08
  await page.screenshot({ path: path.join(runDir, `step-46-before-action.png`), fullPage: true });
  const _locator46 =   page.getByText('-04-08').nth(2);
  await page.waitForTimeout(1000).catch(() => {});
  await _locator46.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator46.scrollIntoViewIfNeeded().catch(() => {});
  await _locator46.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-46-after-action.png`), fullPage: true });

  // Step 47: 有效日期至
  await page.screenshot({ path: path.join(runDir, `step-47-before-action.png`), fullPage: true });
  const _locator47 =   page.getByText('有效日期至');
  await page.waitForTimeout(1000).catch(() => {});
  await _locator47.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator47.scrollIntoViewIfNeeded().catch(() => {});
  await _locator47.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-47-after-action.png`), fullPage: true });

  // Step 48: 单据信息编-辑合同公司江苏省精创电气股份有限公司合同名称
  await page.screenshot({ path: path.join(runDir, `step-48-before-action.png`), fullPage: true });
  const _locator48 =   page.getByText('单据信息编 辑合同公司江苏省精创电气股份有限公司合同名称');
  await page.waitForTimeout(1000).catch(() => {});
  await _locator48.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator48.scrollIntoViewIfNeeded().catch(() => {});
  await _locator48.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-48-after-action.png`), fullPage: true });

  // Step 49: 相对方信息签约主体江苏省精创电气股份有限公司签约对象供应商1个序号名称编号姓名电话邮箱操作1迦递货运代理上海有限公司QTWL1080019---详情
  await page.screenshot({ path: path.join(runDir, `step-49-before-action.png`), fullPage: true });
  const _locator49 =   page.getByText('相对方信息签约主体江苏省精创电气股份有限公司签约对象供应商(1个)序号名称编号姓名电话邮箱操作1迦递货运代理（上海）有限公司QTWL1080019---详情');
  await page.waitForTimeout(1000).catch(() => {});
  await _locator49.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator49.scrollIntoViewIfNeeded().catch(() => {});
  await _locator49.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-49-after-action.png`), fullPage: true });

  // Step 50: action
  await page.screenshot({ path: path.join(runDir, `step-50-before-action.png`), fullPage: true });
  const _locator50 =   page.locator('#opposite-info').getByRole('img').nth(1);
  await page.waitForTimeout(1000).catch(() => {});
  await _locator50.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator50.scrollIntoViewIfNeeded().catch(() => {});
  await _locator50.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-50-after-action.png`), fullPage: true });

  // Step 51: 详情
  await page.screenshot({ path: path.join(runDir, `step-51-before-action.png`), fullPage: true });
  const _locator51 =   page.getByText('详情', { exact: true });
  await page.waitForTimeout(1000).catch(() => {});
  await _locator51.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator51.scrollIntoViewIfNeeded().catch(() => {});
  await _locator51.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-51-after-action.png`), fullPage: true });

  // Step 52: Close
  await page.screenshot({ path: path.join(runDir, `step-52-before-action.png`), fullPage: true });
  const _locator52 =   page.getByRole('button', { name: 'Close' });
  await page.waitForTimeout(1000).catch(() => {});
  await _locator52.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator52.scrollIntoViewIfNeeded().catch(() => {});
  await _locator52.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-52-after-action.png`), fullPage: true });

  // Step 53: action
  await page.screenshot({ path: path.join(runDir, `step-53-before-action.png`), fullPage: true });
  const _locator53 =   page.locator('div').filter({ hasText: /^详情迦递货运代理（上海）有限公司No\. QTWL1080019---$/ }).nth(1);
  await page.waitForTimeout(1000).catch(() => {});
  await _locator53.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator53.scrollIntoViewIfNeeded().catch(() => {});
  await _locator53.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-53-after-action.png`), fullPage: true });

  // Step 54: action
  await page.screenshot({ path: path.join(runDir, `step-54-before-action.png`), fullPage: true });
  const _locator54 =   page.locator('#opposite-info').getByRole('img').first();
  await page.waitForTimeout(1000).catch(() => {});
  await _locator54.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator54.scrollIntoViewIfNeeded().catch(() => {});
  await _locator54.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-54-after-action.png`), fullPage: true });

  // Step 55: 详情
  await page.screenshot({ path: path.join(runDir, `step-55-before-action.png`), fullPage: true });
  const _locator55 =   page.getByText('详情', { exact: true });
  await page.waitForTimeout(1000).catch(() => {});
  await _locator55.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator55.scrollIntoViewIfNeeded().catch(() => {});
  await _locator55.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-55-after-action.png`), fullPage: true });

  // Step 56: Close
  await page.screenshot({ path: path.join(runDir, `step-56-before-action.png`), fullPage: true });
  const _locator56 =   page.getByRole('button', { name: 'Close' });
  await page.waitForTimeout(1000).catch(() => {});
  await _locator56.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator56.scrollIntoViewIfNeeded().catch(() => {});
  await _locator56.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-56-after-action.png`), fullPage: true });

  // Step 57: action
  await page.screenshot({ path: path.join(runDir, `step-57-before-action.png`), fullPage: true });
  const _locator57 =   page.locator('#attachment-list img');
  await page.waitForTimeout(1000).catch(() => {});
  await _locator57.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator57.scrollIntoViewIfNeeded().catch(() => {});
  await _locator57.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-57-after-action.png`), fullPage: true });

  // Step 58: action
  await page.screenshot({ path: path.join(runDir, `step-58-before-action.png`), fullPage: true });
  const _locator58 =   page.locator('.drag-modal-content-header > div:nth-child(2)');
  await page.waitForTimeout(1000).catch(() => {});
  await _locator58.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator58.scrollIntoViewIfNeeded().catch(() => {});
  await _locator58.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-58-after-action.png`), fullPage: true });

  // Step 59: 导入申请单费用信息
  await page.screenshot({ path: path.join(runDir, `step-59-before-action.png`), fullPage: true });
  const _locator59 =   page.getByRole('button', { name: '导入申请单费用信息' });
  await page.waitForTimeout(1000).catch(() => {});
  await _locator59.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator59.scrollIntoViewIfNeeded().catch(() => {});
  await _locator59.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-59-after-action.png`), fullPage: true });

  // Step 60: 添加费用信息
  await page.screenshot({ path: path.join(runDir, `step-60-before-action.png`), fullPage: true });
  const _locator60 =   page.getByRole('button', { name: '添加费用信息' });
  await page.waitForTimeout(1000).catch(() => {});
  await _locator60.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator60.scrollIntoViewIfNeeded().catch(() => {});
  await _locator60.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-60-after-action.png`), fullPage: true });

  // Step 61: 请选择
  await page.screenshot({ path: path.join(runDir, `step-61-before-action.png`), fullPage: true });
  const _locator61 =   page.getByRole('textbox', { name: '请选择' });
  await page.waitForTimeout(1000).catch(() => {});
  await _locator61.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator61.scrollIntoViewIfNeeded().catch(() => {});
  await _locator61.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-61-after-action.png`), fullPage: true });

  // Step 62: action
  await page.screenshot({ path: path.join(runDir, `step-62-before-action.png`), fullPage: true });
  const _locator62 =   page.locator('#recommend-history-18b5 span').filter({ hasText: '住宿费' }).getByRole('img');
  await page.waitForTimeout(1000).catch(() => {});
  await _locator62.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator62.scrollIntoViewIfNeeded().catch(() => {});
  await _locator62.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-62-after-action.png`), fullPage: true });

  // Step 63: 请输入或选择
  await page.screenshot({ path: path.join(runDir, `step-63-before-action.png`), fullPage: true });
  const _locator63 =   page.getByRole('textbox', { name: '请输入或选择' });
  await page.waitForTimeout(1000).catch(() => {});
  await _locator63.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator63.scrollIntoViewIfNeeded().catch(() => {});
  await _locator63.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-63-after-action.png`), fullPage: true });

  // Step 64: 今天
  await page.screenshot({ path: path.join(runDir, `step-64-before-action.png`), fullPage: true });
  const _locator64 =   page.getByRole('button', { name: '今天' });
  await page.waitForTimeout(1000).catch(() => {});
  await _locator64.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator64.scrollIntoViewIfNeeded().catch(() => {});
  await _locator64.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-64-after-action.png`), fullPage: true });

  // Step 65: 保-存
  await page.screenshot({ path: path.join(runDir, `step-65-before-action.png`), fullPage: true });
  const _locator65 =   page.getByRole('button', { name: '保 存' });
  await page.waitForTimeout(1000).catch(() => {});
  await _locator65.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator65.scrollIntoViewIfNeeded().catch(() => {});
  await _locator65.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-65-after-action.png`), fullPage: true });

  // Step 66: 000
  await page.screenshot({ path: path.join(runDir, `step-66-before-action.png`), fullPage: true });
  const _locator66 =   page.getByRole('spinbutton', { name: '0.00' });
  await page.waitForTimeout(1000).catch(() => {});
  await _locator66.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator66.scrollIntoViewIfNeeded().catch(() => {});
  await _locator66.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-66-after-action.png`), fullPage: true });

  // Step 67: 000
  await page.screenshot({ path: path.join(runDir, `step-67-before-action.png`), fullPage: true });
  const _locator67 =   page.getByRole('spinbutton', { name: '0.00' });
  await page.waitForTimeout(1000).catch(() => {});
  await _locator67.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator67.scrollIntoViewIfNeeded().catch(() => {});
  await _locator67.fill("0.00", { timeout: 30000 });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-67-after-action.png`), fullPage: true });

  // Step 68: action
  await page.screenshot({ path: path.join(runDir, `step-68-before-action.png`), fullPage: true });
  const _locator68 =   page.locator('#slide-content-id');
  await page.waitForTimeout(1000).catch(() => {});
  await _locator68.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator68.scrollIntoViewIfNeeded().catch(() => {});
  await _locator68.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-68-after-action.png`), fullPage: true });

  // Step 69: 保-存
  await page.screenshot({ path: path.join(runDir, `step-69-before-action.png`), fullPage: true });
  const _locator69 =   page.getByRole('button', { name: '保 存' });
  await page.waitForTimeout(1000).catch(() => {});
  await _locator69.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator69.scrollIntoViewIfNeeded().catch(() => {});
  await _locator69.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-69-after-action.png`), fullPage: true });

  // Step 70: 复制
  await page.screenshot({ path: path.join(runDir, `step-70-before-action.png`), fullPage: true });
  const _locator70 =   page.getByText('复制').nth(1);
  await page.waitForTimeout(1000).catch(() => {});
  await _locator70.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator70.scrollIntoViewIfNeeded().catch(() => {});
  await _locator70.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-70-after-action.png`), fullPage: true });

  // Step 71: 添加付款信息
  await page.screenshot({ path: path.join(runDir, `step-71-before-action.png`), fullPage: true });
  const _locator71 =   page.getByRole('button', { name: '添加付款信息' });
  await page.waitForTimeout(1000).catch(() => {});
  await _locator71.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator71.scrollIntoViewIfNeeded().catch(() => {});
  await _locator71.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-71-after-action.png`), fullPage: true });

  // Step 72: 阶段款项名称
  await page.screenshot({ path: path.join(runDir, `step-72-before-action.png`), fullPage: true });
  const _locator72 =   page.getByRole('textbox', { name: '阶段/款项名称' });
  await page.waitForTimeout(1000).catch(() => {});
  await _locator72.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator72.scrollIntoViewIfNeeded().catch(() => {});
  await _locator72.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-72-after-action.png`), fullPage: true });

  // Step 73: 阶段款项名称
  await page.screenshot({ path: path.join(runDir, `step-73-before-action.png`), fullPage: true });
  const _locator73 =   page.getByRole('textbox', { name: '阶段/款项名称' });
  await page.waitForTimeout(1000).catch(() => {});
  await _locator73.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator73.scrollIntoViewIfNeeded().catch(() => {});
  await _locator73.fill("阶段/款项名称", { timeout: 30000 });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-73-after-action.png`), fullPage: true });

  // Step 74: 000
  await page.screenshot({ path: path.join(runDir, `step-74-before-action.png`), fullPage: true });
  const _locator74 =   page.getByRole('spinbutton', { name: '0.00' });
  await page.waitForTimeout(1000).catch(() => {});
  await _locator74.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator74.scrollIntoViewIfNeeded().catch(() => {});
  await _locator74.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-74-after-action.png`), fullPage: true });

  // Step 75: 请输入或选择
  await page.screenshot({ path: path.join(runDir, `step-75-before-action.png`), fullPage: true });
  const _locator75 =   page.getByRole('textbox', { name: '请输入或选择' });
  await page.waitForTimeout(1000).catch(() => {});
  await _locator75.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator75.scrollIntoViewIfNeeded().catch(() => {});
  await _locator75.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-75-after-action.png`), fullPage: true });

  // Step 76: action
  await page.screenshot({ path: path.join(runDir, `step-76-before-action.png`), fullPage: true });
  const _locator76 =   page.getByRole('grid').getByTitle('年4月8日').locator('div');
  await page.waitForTimeout(1000).catch(() => {});
  await _locator76.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator76.scrollIntoViewIfNeeded().catch(() => {});
  await _locator76.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-76-after-action.png`), fullPage: true });

  // Step 77: action
  await page.screenshot({ path: path.join(runDir, `step-77-before-action.png`), fullPage: true });
  const _locator77 =   page.locator('span').filter({ hasText: '迦递货运代理（上海）有限公司457259249125' }).locator('path').first();
  await page.waitForTimeout(1000).catch(() => {});
  await _locator77.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator77.scrollIntoViewIfNeeded().catch(() => {});
  await _locator77.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-77-after-action.png`), fullPage: true });

  // Step 78: 付款条件
  await page.screenshot({ path: path.join(runDir, `step-78-before-action.png`), fullPage: true });
  const _locator78 =   page.getByRole('textbox', { name: '付款条件' });
  await page.waitForTimeout(1000).catch(() => {});
  await _locator78.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator78.scrollIntoViewIfNeeded().catch(() => {});
  await _locator78.fill("付款条件", { timeout: 30000 });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-78-after-action.png`), fullPage: true });

  // Step 79: 000
  await page.screenshot({ path: path.join(runDir, `step-79-before-action.png`), fullPage: true });
  const _locator79 =   page.getByRole('spinbutton', { name: '0.00' });
  await page.waitForTimeout(1000).catch(() => {});
  await _locator79.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator79.scrollIntoViewIfNeeded().catch(() => {});
  await _locator79.fill("0.00", { timeout: 30000 });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-79-after-action.png`), fullPage: true });

  // Step 80: 备注
  await page.screenshot({ path: path.join(runDir, `step-80-before-action.png`), fullPage: true });
  const _locator80 =   page.getByRole('textbox', { name: '备注' });
  await page.waitForTimeout(1000).catch(() => {});
  await _locator80.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator80.scrollIntoViewIfNeeded().catch(() => {});
  await _locator80.fill("备注", { timeout: 30000 });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-80-after-action.png`), fullPage: true });

  // Step 81: action
  await page.screenshot({ path: path.join(runDir, `step-81-before-action.png`), fullPage: true });
  const _locator81 =   page.locator('span').filter({ hasText: '迦递货运代理（上海）有限公司457259249125' }).locator('path').first();
  await page.waitForTimeout(1000).catch(() => {});
  await _locator81.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator81.scrollIntoViewIfNeeded().catch(() => {});
  await _locator81.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-81-after-action.png`), fullPage: true });

  // Step 82: 确-定
  await page.screenshot({ path: path.join(runDir, `step-82-before-action.png`), fullPage: true });
  const _locator82 =   page.getByRole('button', { name: '确 定' });
  await page.waitForTimeout(1000).catch(() => {});
  await _locator82.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator82.scrollIntoViewIfNeeded().catch(() => {});
  await _locator82.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-82-after-action.png`), fullPage: true });

  // Step 83: 保-存
  await page.screenshot({ path: path.join(runDir, `step-83-before-action.png`), fullPage: true });
  const _locator83 =   page.getByRole('button', { name: '保 存' });
  await page.waitForTimeout(1000).catch(() => {});
  await _locator83.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator83.scrollIntoViewIfNeeded().catch(() => {});
  await _locator83.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-83-after-action.png`), fullPage: true });

  // Step 84: action
  await page.screenshot({ path: path.join(runDir, `step-84-before-action.png`), fullPage: true });
  const _locator84 =   page.getByRole('button').filter({ hasText: /^$/ }).nth(2);
  await page.waitForTimeout(1000).catch(() => {});
  await _locator84.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator84.scrollIntoViewIfNeeded().catch(() => {});
  await _locator84.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-84-after-action.png`), fullPage: true });

  // Step 85: 批量删除
  await page.screenshot({ path: path.join(runDir, `step-85-before-action.png`), fullPage: true });
  const _locator85 =   page.locator('#payment-info').getByRole('button', { name: '批量删除' });
  await page.waitForTimeout(1000).catch(() => {});
  await _locator85.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator85.scrollIntoViewIfNeeded().catch(() => {});
  await _locator85.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-85-after-action.png`), fullPage: true });

  // Step 86: action
  await page.screenshot({ path: path.join(runDir, `step-86-before-action.png`), fullPage: true });
  const _locator86 =   page.getByRole('row', { name: '序号 付款行编号 阶段名称 币种 付款比例 金额 本币金额 单价 本币单价 收款方 计划付款日期 付款条件 可关联支付金额 已付款合计金额 待付款在途金额 备注' }).getByLabel('');
  await page.waitForTimeout(1000).catch(() => {});
  await _locator86.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator86.scrollIntoViewIfNeeded().catch(() => {});
  await _locator86.check({ timeout: 30000 });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-86-after-action.png`), fullPage: true });

  // Step 87: 删-除
  await page.screenshot({ path: path.join(runDir, `step-87-before-action.png`), fullPage: true });
  const _locator87 =   page.getByRole('button', { name: '删 除' });
  await page.waitForTimeout(1000).catch(() => {});
  await _locator87.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator87.scrollIntoViewIfNeeded().catch(() => {});
  await _locator87.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-87-after-action.png`), fullPage: true });

  // Step 88: 确-定
  await page.screenshot({ path: path.join(runDir, `step-88-before-action.png`), fullPage: true });
  const _locator88 =   page.getByRole('button', { name: '确 定' });
  await page.waitForTimeout(1000).catch(() => {});
  await _locator88.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator88.scrollIntoViewIfNeeded().catch(() => {});
  await _locator88.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-88-after-action.png`), fullPage: true });

  // Step 89: 提-交
  await page.screenshot({ path: path.join(runDir, `step-89-before-action.png`), fullPage: true });
  const _locator89 =   page.getByRole('button', { name: '提 交' });
  await page.waitForTimeout(1000).catch(() => {});
  await _locator89.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator89.scrollIntoViewIfNeeded().catch(() => {});
  await _locator89.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-89-after-action.png`), fullPage: true });

  // Step 90: 添加付款信息
  await page.screenshot({ path: path.join(runDir, `step-90-before-action.png`), fullPage: true });
  const _locator90 =   page.getByRole('button', { name: '添加付款信息' });
  await page.waitForTimeout(1000).catch(() => {});
  await _locator90.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator90.scrollIntoViewIfNeeded().catch(() => {});
  await _locator90.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-90-after-action.png`), fullPage: true });

  // Step 91: 阶段款项名称
  await page.screenshot({ path: path.join(runDir, `step-91-before-action.png`), fullPage: true });
  const _locator91 =   page.getByRole('textbox', { name: '阶段/款项名称' });
  await page.waitForTimeout(1000).catch(() => {});
  await _locator91.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator91.scrollIntoViewIfNeeded().catch(() => {});
  await _locator91.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-91-after-action.png`), fullPage: true });

  // Step 92: 阶段款项名称
  await page.screenshot({ path: path.join(runDir, `step-92-before-action.png`), fullPage: true });
  const _locator92 =   page.getByRole('textbox', { name: '阶段/款项名称' });
  await page.waitForTimeout(1000).catch(() => {});
  await _locator92.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator92.scrollIntoViewIfNeeded().catch(() => {});
  await _locator92.fill("阶段/款项名称", { timeout: 30000 });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-92-after-action.png`), fullPage: true });

  // Step 93: 000
  await page.screenshot({ path: path.join(runDir, `step-93-before-action.png`), fullPage: true });
  const _locator93 =   page.getByRole('spinbutton', { name: '0.00' });
  await page.waitForTimeout(1000).catch(() => {});
  await _locator93.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator93.scrollIntoViewIfNeeded().catch(() => {});
  await _locator93.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-93-after-action.png`), fullPage: true });

  // Step 94: 000
  await page.screenshot({ path: path.join(runDir, `step-94-before-action.png`), fullPage: true });
  const _locator94 =   page.getByRole('spinbutton', { name: '0.00' });
  await page.waitForTimeout(1000).catch(() => {});
  await _locator94.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator94.scrollIntoViewIfNeeded().catch(() => {});
  await _locator94.fill("0.00", { timeout: 30000 });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-94-after-action.png`), fullPage: true });

  // Step 95: 请输入或选择
  await page.screenshot({ path: path.join(runDir, `step-95-before-action.png`), fullPage: true });
  const _locator95 =   page.getByRole('textbox', { name: '请输入或选择' });
  await page.waitForTimeout(1000).catch(() => {});
  await _locator95.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator95.scrollIntoViewIfNeeded().catch(() => {});
  await _locator95.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-95-after-action.png`), fullPage: true });

  // Step 96: 今天
  await page.screenshot({ path: path.join(runDir, `step-96-before-action.png`), fullPage: true });
  const _locator96 =   page.getByRole('button', { name: '今天' });
  await page.waitForTimeout(1000).catch(() => {});
  await _locator96.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator96.scrollIntoViewIfNeeded().catch(() => {});
  await _locator96.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-96-after-action.png`), fullPage: true });

  // Step 97: 保-存
  await page.screenshot({ path: path.join(runDir, `step-97-before-action.png`), fullPage: true });
  const _locator97 =   page.getByRole('button', { name: '保 存' });
  await page.waitForTimeout(1000).catch(() => {});
  await _locator97.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator97.scrollIntoViewIfNeeded().catch(() => {});
  await _locator97.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-97-after-action.png`), fullPage: true });

  // Step 98: 提-交
  await page.screenshot({ path: path.join(runDir, `step-98-before-action.png`), fullPage: true });
  const _locator98 =   page.getByRole('button', { name: '提 交' });
  await page.waitForTimeout(1000).catch(() => {});
  await _locator98.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator98.scrollIntoViewIfNeeded().catch(() => {});
  await _locator98.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-98-after-action.png`), fullPage: true });

  // Step 99: 收起
  await page.screenshot({ path: path.join(runDir, `step-99-before-action.png`), fullPage: true });
  const _locator99 =   page.getByText('收起');
  await page.waitForTimeout(1000).catch(() => {});
  await _locator99.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator99.scrollIntoViewIfNeeded().catch(() => {});
  await _locator99.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-99-after-action.png`), fullPage: true });

  // Step 100: 返-回
  await page.screenshot({ path: path.join(runDir, `step-100-before-action.png`), fullPage: true });
  const _locator100 =   page.getByRole('button', { name: '返 回' });
  await page.waitForTimeout(1000).catch(() => {});
  await _locator100.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
  await _locator100.scrollIntoViewIfNeeded().catch(() => {});
  await _locator100.click({ timeout: 30000, force: true });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(runDir, `step-100-after-action.png`), fullPage: true });

  console.log('✅ 测试完成: test');
});