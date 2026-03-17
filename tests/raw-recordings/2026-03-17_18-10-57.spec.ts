import { test, expect } from '@playwright/test';

test.use({
  storageState: 'storage/loginState/stage.json'
});

test('test', async ({ page }) => {
  await page.goto('https://stage.huilianyi.com/main/home');
  await page.getByText('报销单').click();
  await page.locator('.anticon.anticon-close > svg').click();
  await page.getByRole('cell', { name: '1', exact: true }).click();
  await page.getByText('办公用品类').first().click();
  await page.getByRole('button', { name: '取 消' }).click();
  await page.getByText('冲借款').nth(2).click();
  await page.getByRole('button', { name: '取 消' }).click();
  await page.getByRole('button', { name: '返 回' }).click();
});