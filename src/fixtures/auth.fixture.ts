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
    // 默认走 playwright.config.ts 的 Project Dependencies（setup -> storageState）
    // 如需回退到“每个用例内登录”，设置 ENABLE_LEGACY_LOGIN_FIXTURE=1
    const legacyLogin = process.env.ENABLE_LEGACY_LOGIN_FIXTURE === '1';
    if (legacyLogin) {
      const loginPage = new LoginPage(page);
      await loginPage.goto();

      // legacy 模式仍然只读环境变量（避免硬编码账号）
      const username = process.env.TEST_USERNAME;
      const password = process.env.TEST_PASSWORD;
      if (!username || !password) {
        throw new Error('ENABLE_LEGACY_LOGIN_FIXTURE=1 需要同时设置 TEST_USERNAME / TEST_PASSWORD');
      }

      await loginPage.login(username, password);
      await loginPage.expectLoginSuccess();
    }

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
