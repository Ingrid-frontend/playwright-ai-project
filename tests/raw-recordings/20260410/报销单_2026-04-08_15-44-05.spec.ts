import { test, expect } from '@playwright/test';
test.use({
  storageState: 'storage/loginState/stage.json'
});

test('test', async ({ page }) => {
  await page.goto('https://stage.huilianyi.com/');
  await page.getByRole('tab', { name: '账号登录' }).click();
  await page.getByRole('textbox', { name: '请输入手机号/邮箱' }).click();
  await page.getByRole('textbox', { name: '请输入手机号/邮箱' }).fill('npx playwright codegen https://stage.huilianyi.com/');
  await page.locator('div').filter({ hasText: '汇联易管理系统二维码登录账号登录请使用汇联易APP' }).nth(3).click();
  await page.getByRole('textbox', { name: '请输入手机号/邮箱' }).click();
  await page.getByRole('textbox', { name: '请输入手机号/邮箱' }).click();
  await page.getByRole('textbox', { name: '请输入手机号/邮箱' }).press('ControlOrMeta+a');
  await page.getByRole('textbox', { name: '请输入手机号/邮箱' }).fill('183202411010@e-elitech.com');
  await page.getByRole('textbox', { name: '密码' }).click();
  await page.locator('div').filter({ hasText: '汇联易管理系统二维码登录账号登录请使用汇联易APP' }).nth(3).click();
  await page.locator('form').click();
  await page.getByRole('textbox', { name: '密码' }).fill('jc123456');
  await page.getByRole('checkbox', { name: '我已阅读并同意《用户协议》和《隐私协议》，未激活的账号在登录后将自动激活' }).check();
  await page.getByRole('button', { name: '登 录' }).click();
  await page.locator('div').filter({ hasText: /^报销单$/ }).nth(2).click();
  await page.getByRole('button', { name: '新建报销单' }).click();
  await page.locator('#formOid > .ant-select-selection > .ant-select-selection__rendered').click();
  await page.locator('#formOid > .ant-select-selection > .ant-select-selection__rendered > .ant-select-selection__placeholder').click();
  await page.locator('#formOid > .ant-select-selection > .ant-select-selection__rendered > .ant-select-selection__placeholder').click();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: '取 消' }).click();
  await page.locator('.anticon.anticon-close > svg').click();
  await page.locator('.button-text.ant-tooltip-open > .helios-icon').click();
  await page.locator('.button-text.ant-tooltip-open > .helios-icon').click();
  await page.getByText('管理员').nth(1).click();
  await page.getByText('基本信息').click();
  await page.getByTitle('单据信息').click();
  await page.getByText('费用明细*').click();
  await page.getByTitle('收款信息').click();
  await page.getByText('查看扩展字段').first().click();
  await page.getByRole('button', { name: '关 闭' }).click();
  await page.locator('#payment').getByText('详情', { exact: true }).click();
  await page.getByRole('button', { name: 'Close' }).click();
  await page.locator('div').filter({ hasText: '工作台报销单' }).nth(4).click();
  await page.locator('.ant-table-body-inner > .ant-table-fixed > .ant-table-tbody > .ant-table-row.rejected-expense.ant-table-row-hover > .table-header-end > .column-overflow-observe-container > .space > div:nth-child(3) > a').click();
  await page.getByRole('button', { name: '取 消' }).click();
  await page.locator('.ant-table-body-inner > .ant-table-fixed > .ant-table-tbody > .ant-table-row.rejected-expense.ant-table-row-hover > .table-header-end > .column-overflow-observe-container > .space > div > a').first().click();
  await page.locator('.slide-title > .warp-svg-icon > .helios-icon > path').first().click();
  await page.getByText('其他费用').first().click();
});