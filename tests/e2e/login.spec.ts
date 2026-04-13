import { test, expect } from '../../src/fixtures/auth.fixture';
import { LoginPage } from '../../src/pages/LoginPage';
import { env as currentEnv } from '../../playwright.config';
import { getLoginCredentials } from '../../src/utils/credentials';

/**
 * 登录功能 E2E 测试
 * 使用语义化定位符和 POM 模式
 */
test.describe('登录功能', () => {
  test('应该能够成功登录', async ({ loginPage }) => {
    await loginPage.goto();
    const { username, password } = getLoginCredentials(currentEnv);
    await loginPage.login(username, password);
    await loginPage.expectLoginSuccess();
  });

  test('错误密码应该显示错误信息', async ({ loginPage }) => {
    await loginPage.goto();
    const { username } = getLoginCredentials(currentEnv);
    await loginPage.login(username, 'wrongpassword');
    await loginPage.expectLoginFailure('用户名或密码错误');
  });

  test('空字段应该显示验证提示', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await page.waitForTimeout(1000);
    await loginPage.loginButton.click();
    
    // 验证必填字段提示
    await expect(loginPage.usernameInput).toBeFocused();
  });
});
