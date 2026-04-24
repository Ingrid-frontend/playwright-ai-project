import { test, expect } from '@playwright/test';

test.use({
  storageState: 'storage/loginState/stage.json'
});

test('test', async ({ page }) => {
  await page.goto('https://stage.huilianyi.com/main/home');
  await page.getByText('我的审批').click();
  await page.locator('iframe').contentFrame().getByText('张艳华').click();
  await page.locator('iframe').contentFrame().getByText('张艳华').click();
  await page.locator('iframe').contentFrame().getByRole('cell', { name: '1', exact: true }).click();
});