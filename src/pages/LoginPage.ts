import { Page, Locator, expect } from "@playwright/test";

export class LoginPage {
    readonly page: Page;
    readonly accountTab: Locator;
    readonly usernameInput: Locator;
    readonly passwordInput: Locator;
    readonly agreementCheckbox: Locator;
    readonly loginButton: Locator;

    constructor(page: Page) {
        this.page = page;
        // 使用语义化定位器 (Role)，这是 2026 年的官方推荐做法
        this.accountTab = page.getByRole('tab', { name: '账号登录' });
        this.usernameInput = page.getByRole('textbox', { name: '请输入手机号/邮箱' });
        this.passwordInput = page.getByRole('textbox', { name: '密码' });
        this.agreementCheckbox = page.locator('label').filter({ 
            hasText: '我已阅读并同意《用户协议》和《隐私协议》' 
        });
        this.loginButton = page.getByRole('button', { name: '登 录' });
    }

    async goto(baseURL?: string) {
        const url = baseURL || 'https://stage.huilianyi.com/';
        await this.page.goto(url, { waitUntil: "load" });
    }

    async login(username: string, password: string) {
        await this.accountTab.click();
        await this.usernameInput.fill(username);
        await this.passwordInput.fill(password);
        await this.agreementCheckbox.click();
        
        // 使用并发等待机制，确保点击后跳转完成
        await Promise.all([
            this.loginButton.click(),
            this.page.waitForNavigation({ waitUntil: "networkidle" })
        ]);
    }

    async expectLoginSuccess() {
        await expect(this.page).not.toHaveURL(/.*login.*/);
    }

    async expectLoginFailure(errorMessage: string) {
        await expect(this.page.getByText(errorMessage)).toBeVisible();
    }
}