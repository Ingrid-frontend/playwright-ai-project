import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: path.resolve(__dirname, '.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });

const baseURL = process.env.BASE_URL || 'https://dev.huilianyi.com';

function resolveRetries(): number {
  const explicit = Number(process.env.PLAYWRIGHT_RETRIES);
  if (Number.isFinite(explicit) && explicit >= 0) return explicit;
  return process.env.CI ? 2 : 0;
}

function resolvePositiveMs(envName: string, fallback: number): number {
  const value = Number(process.env[envName]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: resolveRetries(),
  workers: 1, // 必须为 1：fixtures 里 worker 级共用同一个浏览器窗口
  timeout: resolvePositiveMs('PW_TEST_TIMEOUT', 180_000),
  expect: {
    timeout: resolvePositiveMs('PW_EXPECT_TIMEOUT', 15_000),
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.02,
      animations: 'disabled',
      caret: 'hide',
    },
  },
  snapshotPathTemplate: '{testDir}/ui-baselines/{testFileName}/{arg}-{platform}{ext}',
  reporter: [['html', { open: 'never' }], ['list']],
  use: {
    baseURL,
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    /* 每次用例结束都截图；失败时保留录像（见 fixtures 里 sharedContext.recordVideo） */
    screenshot: 'on',
    video: 'retain-on-failure',
    trace: process.env.FLOW_TRACE === 'on'
      ? 'on'
      : process.env.FLOW_TRACE === 'retain-on-failure'
        ? 'retain-on-failure'
        : 'on-first-retry',
    actionTimeout: resolvePositiveMs('PW_ACTION_TIMEOUT', 20_000),
    navigationTimeout: resolvePositiveMs('PW_NAVIGATION_TIMEOUT', 60_000),
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
