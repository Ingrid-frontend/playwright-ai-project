import { test, expect } from '@playwright/test';

test.use({
  storageState: 'storage/loginState/stage.json'
});

test('test', async ({ page }) => {
  await page.goto('https://stage.huilianyi.com/main/home');
  await page.locator('#home-main-charts-guide-id').getByRole('textbox', { name: '请选择日期' }).click();
  await page.getByText('一月', { exact: true }).click();
  await page.locator('#helios-service-charts-guide-id-CHECK_INVOICE').getByRole('button', { name: '查看订单' }).click();
  await page.getByRole('button', { name: '查看详情' }).first().click();
  await page.getByRole('img').first().click();
  await page.getByRole('img').first().click();
  await page.getByText('按月份').click();
  await page.getByRole('option', { name: '按季度' }).click();
});