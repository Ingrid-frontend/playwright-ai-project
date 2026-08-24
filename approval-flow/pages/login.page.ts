import { type Page, expect } from '@playwright/test';
import { env } from '../utils/env';
import { waitForAppRoot, type AppRoot } from '../utils/app-frame';

export class LoginPage {
  readonly page: Page;
  private root: AppRoot | null = null;

  constructor(page: Page) {
    this.page = page;
  }

  private scope() {
    if (!this.root) {
      throw new Error('LoginPage：请先调用 goto()');
    }
    return this.root.scope;
  }

  async goto() {
    await this.page.goto('/', { waitUntil: 'domcontentloaded', timeout: 60_000 });
    this.root = await waitForAppRoot(this.page);
  }

  async login(username = env.username, password = env.password) {
    if (!this.root) {
      this.root = await waitForAppRoot(this.page);
    }
    const s = this.scope();
    await s.getByText('账号登录').click();
    const usernameInput = s.locator('input.user-name').first();
    await usernameInput.waitFor({ state: 'visible', timeout: 15_000 });
    await usernameInput.fill(username);
    await s.locator('input[type="password"]').first().fill(password);

    const box = s.locator('.ant-checkbox-input').first();
    if (!(await box.isChecked().catch(() => false))) {
      await s.locator('.ant-checkbox').first().click();
    }
    await s.locator('button.login-refactoring-btn').click();

    const agree = s.getByRole('button', { name: /已阅读并同意/ });
    if (await agree.isVisible({ timeout: 3000 }).catch(() => false)) {
      await agree.click();
    }
  }

  async expectLoggedIn() {
    await expect(this.page).toHaveURL(/\/main\b/, { timeout: 60_000 });
  }
}
