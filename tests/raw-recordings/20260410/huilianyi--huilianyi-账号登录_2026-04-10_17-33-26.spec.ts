import { test, expect } from '@playwright/test';
test.use({
  storageState: 'storage/loginState/stage.json'
});

test('test', async ({ page }) => {
  await page.goto('https://stage.huilianyi.com/');
  await page.frameLocator('iframe').locator('div').filter({ hasText: '汇联易管理系统二维码登录账号登录请使用汇联易APP' }).nth(3).click();
  await page.frameLocator('iframe').getByRole('tab', { name: '账号登录' }).click();
  await page.frameLocator('iframe').locator('div').filter({ hasText: '汇联易管理系统二维码登录账号登录请使用汇联易APP' }).nth(3).click();
  await page.frameLocator('iframe').getByRole('textbox', { name: '请输入手机号/邮箱' }).click();
  await page.frameLocator('iframe').getByRole('textbox', { name: '请输入手机号/邮箱' }).fill('183202411010@e-elitech.com');
  await page.frameLocator('iframe').locator('div').filter({ hasText: '汇联易管理系统二维码登录账号登录请使用汇联易APP' }).nth(3).click();
  await page.frameLocator('iframe').getByRole('textbox', { name: '密码' }).click();
  await page.frameLocator('iframe').getByRole('textbox', { name: '密码' }).fill('jc123456');
  await page.frameLocator('iframe').locator('label').click();
  await page.frameLocator('iframe').getByRole('checkbox', { name: '我已阅读并同意《用户协议》和《隐私协议》，未激活的账号在登录后将自动激活' }).uncheck();
  await page.frameLocator('iframe').getByRole('checkbox', { name: '我已阅读并同意《用户协议》和《隐私协议》，未激活的账号在登录后将自动激活' }).check();
  await page.frameLocator('iframe').getByRole('button', { name: '登 录' }).click();
  await page.frameLocator('iframe').locator('.hover-pointer-icon').first().click();
  await page.frameLocator('iframe').locator('.ant-popover-open > .hover-pointer-icon').click();
  await page.frameLocator('iframe').locator('.single-index.hover-click > .index-name > div:nth-child(2) > .hover-pointer-icon').click();
  await page.frameLocator('iframe').locator('#home-main-charts-guide-id').getByRole('textbox', { name: '请选择日期' }).click();
  await page.frameLocator('iframe').getByText('二月', { exact: true }).click();
  await page.frameLocator('iframe').getByText('个人首页').click();
  await page.frameLocator('iframe').getByText('请选择代理人').click();
  await page.frameLocator('iframe').locator('.ant-select-arrow').first().click();
  await page.frameLocator('iframe').locator('.ant-select-arrow').first().click();
  await page.frameLocator('iframe').getByText('工作台个人首页设置首页面板个人首页管理员首页').click();
  await page.frameLocator('iframe').locator('.down-triangle').click();
  await page.frameLocator('iframe').locator('.down-triangle > path').click();
});