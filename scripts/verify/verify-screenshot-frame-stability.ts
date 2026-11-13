import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { applyScreenshotStabilityStyles, waitForScreenshotStable } from '../../src/utils/screenshot-capture.js';

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const content = '<html><head></head><body><iframe srcdoc="<html><head></head><body><input></body></html>"></iframe></body></html>';
  for (let i = 0; i < 2; i++) {
    await page.goto(`data:text/html,${encodeURIComponent(content)}`);
    await page.frameLocator('iframe').locator('input').waitFor();
    await applyScreenshotStabilityStyles(page);
    await applyScreenshotStabilityStyles(page);
    await waitForScreenshotStable(page);
    for (const frame of page.frames()) {
      assert.equal(await frame.locator('#ui-regression-stability-style').count(), 1,
        '主文档、iframe 及导航后的新文档均应注入一次');
      assert.equal(await frame.locator('body').evaluate(el => getComputedStyle(el).transitionDuration), '0s');
    }
  }
  const other = await browser.newPage();
  await other.setContent('<html><head></head><body>another page</body></html>');
  await applyScreenshotStabilityStyles(other);
  assert.equal(await other.locator('#ui-regression-stability-style').count(), 1, '不能以进程全局标志跳过新页面');
  console.log('✓ 主文档 / iframe 动画冻结、重复注入去重、导航和新页面重新生效、字体及绘制等待');
} finally {
  await browser.close();
}
