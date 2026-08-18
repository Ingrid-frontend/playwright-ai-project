import { test as setup, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { env, curConfig } from '../../playwright.config';
import { getLoginCredentials } from '../utils/credentials';
import { resolveStorageState, shouldRefreshStorageState } from '../utils/env-config';
import { isLoginLikePage, probeStorageState, validateStorageStateFile } from '../utils/login-detection';
import { annotateStorageStateMeta } from '../utils/storage-state-meta.js';

/**
 * 使用 Project Setup 模式
 * 优势：自动享受 Trace Viewer、自动重试、并行隔离
 */
const STORAGE_PATH = resolveStorageState(env, process.env.PLAYWRIGHT_ACCOUNT);
const forceRefresh = shouldRefreshStorageState();

setup('🔐 全局登录并持久化状态', async ({ page, browser }) => {
  setup.setTimeout(120_000);
  const dir = path.dirname(STORAGE_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (!forceRefresh && fs.existsSync(STORAGE_PATH)) {
    const validity = await probeStorageState(browser, STORAGE_PATH, { baseURL: curConfig.baseURL, entry: '/' });
    if (validity.valid) {
      console.log(`💡 检测到有效 loginState，跳过登录（${STORAGE_PATH}）`);
      console.log('💡 换账号请设置 PLAYWRIGHT_REFRESH_STORAGE=1 或执行 npm run login:force');
      return;
    } else {
      console.log(`⚠️  loginState 无效，将重新登录：${validity.reason}`);
    }
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
  await expect
    .poll(async () => !(await isLoginLikePage(page)), { timeout: 60_000 })
    .toBe(true);

  await page.context().storageState({ path: STORAGE_PATH });
  const savedStateValidity = validateStorageStateFile(STORAGE_PATH);
  if (!savedStateValidity.valid) {
    throw new Error(`登录后保存的 storageState 无效：${savedStateValidity.reason}`);
  }
  annotateStorageStateMeta(STORAGE_PATH, {
    loginAccount: ACCOUNT.username,
    env,
    source: 'login-setup',
  });

  console.log(`✅ 登录成功，状态已保存至: ${STORAGE_PATH}`);
});
