import { test, expect } from '@playwright/test';

test.use({
  storageState: 'storage/loginState/stage.json'
});

test('test', async ({ page }) => {
  await page.goto('https://stage.huilianyi.com/main/home');
  await page.getByText('我的审批').click();
  await page.locator('iframe').contentFrame().getByRole('row', { name: '1 - 张艳华 出差 CNY 2,122.00' }).getByLabel('', { exact: true }).check();
  await page.locator('iframe').contentFrame().getByRole('button', { name: '通 过' }).click();
  await page.locator('iframe').contentFrame().getByRole('button', { name: 'Close' }).click();
  await page.locator('iframe').contentFrame().getByRole('cell', { name: '1', exact: true }).click();
  await page.locator('iframe').contentFrame().getByRole('tab', { name: '审批历史' }).click();
  await page.locator('iframe').contentFrame().getByRole('tab', { name: '关联脉络' }).click();
  await page.locator('iframe').contentFrame().getByText('收起').click();
  await page.locator('iframe').contentFrame().locator('img').nth(1).click();
  await page.locator('iframe').contentFrame().locator('.warp-svg-icon.ant-tooltip-open > .helios-icon > path').click();
  await page.locator('iframe').contentFrame().getByRole('button', { name: '返 回' }).click();
});