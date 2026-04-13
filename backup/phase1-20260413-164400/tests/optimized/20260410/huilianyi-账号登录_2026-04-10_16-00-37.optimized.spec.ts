import { test, expect } from '@playwright/test';
import fs from 'fs';

test('test', async ({ page }) => {

  const tracingStarted = await page.context().tracing.start({ screenshots: true, snapshots: true }).catch(() => false);

  const screenshotRoot = 'screenshots/20260410/huilianyi-账号登录_2026-04-10_16-00-37';
  const now = new Date();
  const runTimestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}-${String(now.getSeconds()).padStart(2, '0')}`;
  const testId = Math.random().toString(36).substring(2, 9);
  let browserInfo = 'unknown';
  let runDir = '';
  const getScreenshotPath = (step: number, label: string) => `${runDir}/step-${step}-${label}.png`;

  test.setTimeout(60000);
  await page.goto('/');
  await expect(page).toHaveURL(/.*huilianyi.*/);
  browserInfo = await page.context().browser()?.browserType().name() || 'unknown';
  runDir = `${screenshotRoot}/${runTimestamp}-${browserInfo}-${testId}`;
  if (!fs.existsSync(runDir)) {
    fs.mkdirSync(runDir, { recursive: true });
  }

  if (tracingStarted) {

    await page.context().tracing.stop({ path: `${runDir}/trace.zip` });

  }
});