import { chromium, FullConfig } from "@playwright/test";
import fs from "fs";
import { LoginPage } from "../pages/LoginPage";
import { env, curConfig } from "../../playwright.config";
import accounts from "../../datasource/accounts.json";

const STORAGE_PATH = curConfig.storageState;
const ACCOUNT = accounts[env as keyof typeof accounts];

async function globalSetup(config: FullConfig) {
    // 默认禁用：仓库已切到 Project Dependencies（setup 项目生成 storageState）
    // 回滚/启用：设置 ENABLE_GLOBAL_SETUP=1
    if (process.env.ENABLE_GLOBAL_SETUP !== '1') {
        console.log('ℹ️  globalSetup 已默认禁用（ENABLE_GLOBAL_SETUP!=1），请使用 setup 项目生成 storageState');
        return;
    }

    // 1. 检查状态是否已存在
    if (fs.existsSync(STORAGE_PATH) && fs.statSync(STORAGE_PATH).size > 10) {
        console.log("💡 检测到 loginState.json，跳过登录");
        return;
    }

    console.log("🔐 正在通过 POM 生成新的登录状态...");
    const browser = await chromium.launch();
    const context = await browser.newContext({
        locale: 'zh-CN',
    });
    const page = await context.newPage();

    try {
        const loginPage = new LoginPage(page);
        
        // 2. 执行登录流程
        await loginPage.goto(curConfig.baseURL);
        await loginPage.login(ACCOUNT.username, ACCOUNT.password);

        // 3. 额外等待及保存状态
        await page.waitForTimeout(2000); // 正常情况下 networkidle 已足够，此处按需保留
        await context.storageState({ path: STORAGE_PATH });
        
        console.log("✅ 登录成功，状态已存入:", STORAGE_PATH);
    } catch (error) {
        console.error("❌ 登录失败:", error);
        throw error;
    } finally {
        await browser.close();
    }
}

export default globalSetup;