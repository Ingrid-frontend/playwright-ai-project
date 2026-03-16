import { test, expect } from '@playwright/test';

test.use({
  storageState: 'storage/loginState/stage.json'
});

test('test', async ({ page }) => {
  await page.goto('https://stage.huilianyi.com/main/home');
  await page.getByText('申请单', { exact: true }).click();
  await page.locator('.anticon.anticon-close > svg').first().click();
  await page.getByRole('cell', { name: '1' }).first().click();
});