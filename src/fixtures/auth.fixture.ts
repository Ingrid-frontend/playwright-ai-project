import { test as base, expect, Page } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';

/**
 * 增强型 Fixture：自动登录
 * 可以在测试中直接使用 authenticatedPage，无需手动登录
 */
type AuthFixtures = {
  authenticatedPage: Page;
  loginPage: LoginPage;
};

export const test = base.extend<AuthFixtures>({
  // 自动登录的页面
  authenticatedPage: async ({ page }, use) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto();
    
    // 使用环境变量或默认测试账号
    const username = process.env.TEST_USERNAME || 'test@example.com';
    const password = process.env.TEST_PASSWORD || 'password123';
    
    await loginPage.login(username, password);
    await loginPage.expectLoginSuccess();
    
    // 将已登录的 page 传递给测试
    await use(page);
  },

  // 登录页面对象
  loginPage: async ({ page }, use) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await use(loginPage);
  },
});

export { expect };
