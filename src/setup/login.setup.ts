import { test as setup, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { env, curConfig } from '../../playwright.config';
import { getLoginCredentials } from '../utils/credentials';
import { resolveStorageState, shouldRefreshStorageState } from '../utils/env-config';

/**
 * 使用 Project Setup 模式
 * 优势：自动享受 Trace Viewer、自动重试、并行隔离
 */
const STORAGE_PATH = resolveStorageState(env);
const forceRefresh = shouldRefreshStorageState();

setup('🔐 全局登录并持久化状态', { timeout: 120_000 }, async ({ page }) => {
  const dir = path.dirname(STORAGE_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (!forceRefresh && fs.existsSync(STORAGE_PATH) && fs.statSync(STORAGE_PATH).size > 10) {
    console.log(`💡 检测到 loginState 已存在，跳过登录（${STORAGE_PATH}）`);
    console.log('💡 换账号请设置 PLAYWRIGHT_REFRESH_STORAGE=1 或执行 npm run login:force');
    return;
  }

  const ACCOUNT = getLoginCredentials(env);
  console.log(`🚀 正在执行 [${env}] 环境登录（profile=${ACCOUNT.profile}）...`);

  await page.goto(curConfig.baseURL, { waitUntil: 'load', timeout: 60_000 });

  const iframe = page.locator('iframe').first();
  await iframe.waitFor({ state: 'attached', timeout: 30_000 });
  const iframeContent = await iframe.contentFrame();

  if (!iframeContent) {
    throw new Error('无法获取 iframe 内容');
  }

  await iframeContent.getByRole('tab', { name: '账号登录' }).click({ timeout: 30_000 });
  await iframeContent.getByRole('textbox', { name: '请输入手机号/邮箱' }).fill(ACCOUNT.username, {
    timeout: 30_000,
  });
  await iframeContent.getByRole('textbox', { name: '密码' }).fill(ACCOUNT.password, { timeout: 30_000 });

  await iframeContent
    .locator('label')
    .filter({ hasText: '我已阅读并同意《用户协议》和《隐私协议》' })
    .click({ timeout: 30_000 });

  await iframeContent.getByRole('button', { name: '登 录' }).click({ timeout: 30_000 });
  // 避免 networkidle（长连接/轮询页面可能永远达不到），改为 URL 离开登录页
  await expect(page).not.toHaveURL(/.*login.*/, { timeout: 60_000 });

  await page.context().storageState({ path: STORAGE_PATH });

  console.log(`✅ 登录成功，状态已保存至: ${STORAGE_PATH}`);
});
