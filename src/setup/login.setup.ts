import { test as setup, expect } from '@playwright/test';
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { env, curConfig } from "../../playwright.config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let accounts: Record<string, { username: string; password: string }> = {};

try {
  const accountsPath = path.resolve(__dirname, '../../datasource/accounts.json');
  if (fs.existsSync(accountsPath)) {
    accounts = JSON.parse(fs.readFileSync(accountsPath, 'utf-8'));
  } else {
    console.log("⚠️  未找到 datasource/accounts.json，将使用环境变量");
  }
} catch (error) {
  console.log("⚠️  未找到 datasource/accounts.json，将使用环境变量");
}

/**
 * 使用 Project Setup 模式
 * 优势：自动享受 Trace Viewer、自动重试、并行隔离
 */
const STORAGE_PATH = curConfig.storageState;

const ACCOUNT = {
  username: process.env.TEST_USERNAME || accounts[env as keyof typeof accounts]?.username,
  password: process.env.TEST_PASSWORD || accounts[env as keyof typeof accounts]?.password
};

setup('🔐 全局登录并持久化状态', async ({ page }) => {
  
  // 确保目录存在
  const dir = path.dirname(STORAGE_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  // 1. 检查状态是否存在且有效 (保持你之前的逻辑)
  if (fs.existsSync(STORAGE_PATH) && fs.statSync(STORAGE_PATH).size > 10) {
    console.log("💡 检测到 loginState.json 已存在，跳过登录");
    return;
  }

  console.log(`🚀 正在执行 [${env}] 环境登录...`);

  // 2. 访问登录页
  await page.goto(curConfig.baseURL, { waitUntil: "load" });

  // 3. 执行登录操作
  // 建议：此处未来可以替换为 LoginPage POM 调用
  await page.getByRole('tab', { name: '账号登录' }).click();
  await page.getByRole('textbox', { name: '请输入手机号/邮箱' }).fill(ACCOUNT.username);
  await page.getByRole('textbox', { name: '密码' }).fill(ACCOUNT.password);
  
  // 勾选协议
  await page.locator('label')
    .filter({ hasText: '我已阅读并同意《用户协议》和《隐私协议》' })
    .click();

  // 4. 点击登录并等待跳转
  // 使用 Promise.all 确保点击动作和网络跳转同时被捕获
  await Promise.all([
    page.getByRole('button', { name: '登 录' }).click(),
    page.waitForNavigation({ waitUntil: "networkidle" })
  ]);

  // 5. 关键验证：确保真正进入了系统（例如 URL 不再包含 login）
  // 这比固定等待 5s 更稳健
  await expect(page).not.toHaveURL(/.*login.*/);

  // 6. 保存状态
  await page.context().storageState({ path: STORAGE_PATH });
  
  console.log("✅ 登录成功，状态已保存至:", STORAGE_PATH);
});