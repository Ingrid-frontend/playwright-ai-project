/**
 * @spec-meta
 * {"playwrightEnv":"stage","accountProfile":"default","goldenSet":"login"}
 */
import fs from 'fs';
import path from 'path';
import { test, expect } from '../../fixtures';
import { env } from '../../../../playwright.config';
import { getLoginCredentials } from '../../../../src/utils/credentials';
import { isLoginLikePage } from '../../../../src/utils/login-detection';
import { visualTest, withScreenshotRunSegment } from '../../../../src/utils/screenshot';
import { step } from '../../../utils/optimized-actions';

test.describe('Golden Set · 登录', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('账号密码登录进入工作台', async ({ page }) => {
    test.setTimeout(120_000);
    const { username, password } = getLoginCredentials(env);

    const screenshotDir = withScreenshotRunSegment('screenshots/stage/golden-set/01-login');
    fs.mkdirSync(screenshotDir, { recursive: true });
    const runDir = path.join(screenshotDir, new Date().toISOString().replace(/[:.]/g, '-'));

    await step('打开登录页', async () => {
      await page.goto('/', { waitUntil: 'load', timeout: 60_000 });
      await expect.poll(async () => isLoginLikePage(page), { timeout: 30_000 }).toBe(true);
    });

    await step('账号登录', async () => {
      const iframe = page.locator('iframe').first();
      await iframe.waitFor({ state: 'attached', timeout: 30_000 });
      const frame = await iframe.contentFrame();
      if (!frame) throw new Error('无法获取登录 iframe');

      await frame.getByRole('tab', { name: '账号登录' }).click({ timeout: 30_000 });
      await frame.getByRole('textbox', { name: '请输入手机号/邮箱' }).fill(username, { timeout: 30_000 });
      await frame.getByRole('textbox', { name: '密码' }).fill(password, { timeout: 30_000 });
      await frame
        .locator('label')
        .filter({ hasText: '我已阅读并同意《用户协议》和《隐私协议》' })
        .click({ timeout: 30_000 });
      await frame.getByRole('button', { name: '登 录' }).click({ timeout: 30_000 });
    });

    await step('进入工作台', async () => {
      await expect.poll(async () => !(await isLoginLikePage(page)), { timeout: 60_000 }).toBe(true);
      await expect(page).not.toHaveURL(/login/i);

      await page.locator('iframe').first().waitFor({ state: 'attached', timeout: 30_000 });
      const app = page.frameLocator('iframe').first();
      await expect(app.getByRole('tab', { name: '工作台' })).toBeVisible({ timeout: 30_000 });
      await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
      await visualTest(page, { dir: runDir, name: 'home', state: 'normal', step: 1 });
    });
  });
});
