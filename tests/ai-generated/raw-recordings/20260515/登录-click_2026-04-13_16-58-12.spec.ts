import { test, expect } from '@playwright/test';

test.use({
  storageState: 'storage/loginState/stage.json'
});

test('test', async ({ page }) => {
await page.goto('/');
await page.getByText('登录').click();
});
