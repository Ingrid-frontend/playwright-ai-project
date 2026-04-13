import { test, expect } from '../../src/fixtures/auth.fixture';
import { LoginPage } from '../../src/pages/LoginPage';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { env as currentEnv } from '../../playwright.config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function getLoginCredentials(): { username: string; password: string } {
  const username = process.env.TEST_USERNAME;
  const password = process.env.TEST_PASSWORD;
  if (username && password) return { username, password };

  const accountsPath = path.resolve(__dirname, '../../datasource/accounts.json');
  if (fs.existsSync(accountsPath)) {
    const accounts = JSON.parse(fs.readFileSync(accountsPath, 'utf-8')) as Record<
      string,
      { username: string; password: string }
    >;
    const acc = accounts[currentEnv];
    if (acc?.username && acc?.password) return { username: acc.username, password: acc.password };
  }

  throw new Error(
    `缺少登录凭据：请设置 TEST_USERNAME/TEST_PASSWORD 或提供 datasource/accounts.json（当前 env=${currentEnv}）`,
  );
}

/**
 * 登录功能 E2E 测试
 * 使用语义化定位符和 POM 模式
 */
test.describe('登录功能', () => {
  test('应该能够成功登录', async ({ loginPage }) => {
    await loginPage.goto();
    const { username, password } = getLoginCredentials();
    await loginPage.login(username, password);
    await loginPage.expectLoginSuccess();
  });

  test('错误密码应该显示错误信息', async ({ loginPage }) => {
    await loginPage.goto();
    const { username } = getLoginCredentials();
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
