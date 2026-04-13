import { test, expect } from '@playwright/test';

test.use({
  storageState: 'storage/loginState/stage.json'
});

test('test', async ({ page }) => {
await page.goto('https://stage.huilianyi.com/');
await page.locator('div').filter({ hasText: '汇联易管理系统二维码登录账号登录请使用汇联易APP' }).nth(3).click();
await page.getByRole('tab', { name: '账号登录' }).click();
await page.getByRole('textbox', { name: '请输入手机号/邮箱' }).fill('183202411010@e-elitech.com');
await page.getByRole('textbox', { name: '密码' }).fill('jc123456');
await page.getByRole('checkbox', { name: '我已阅读并同意《用户协议》和《隐私协议》，未激活的账号在登录后将自动激活' }).check();
await page.getByRole('button', { name: '登 录' }).click();
// 登录后的操作
await page.locator('.hover-pointer-icon').first().click();
await page.locator('.ant-popover-open > .hover-pointer-icon').click();
await page.getByText('个人首页').click();
});
