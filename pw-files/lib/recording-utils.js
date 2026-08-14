function generateSampleScript(url) {
  return `import { test, expect } from '@playwright/test';

test('recorded test', async ({ page }) => {
  await page.goto('${url}');
  await page.waitForTimeout(2000);
  
  // 点击导航链接
  await page.click('a[href="/docs"]');
  await page.waitForTimeout(1500);
  
  // 搜索输入
  await page.click('input[type="search"]');
  await page.fill('input[type="search"]', 'playwright test');
  await page.waitForTimeout(1000);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2000);
  
  // 点击搜索结果
  await page.click('.search-result:first-child a');
  await page.waitForTimeout(1500);
  
  // 验证页面
  const title = await page.title();
  console.log('Page title:', title);
});
`;
}

function simulateRecording(ws, session, url, stopRecording) {
  let elapsed = 0;
  const interval = setInterval(() => {
    elapsed++;
    if (!session.recording || elapsed > 30) {
      clearInterval(interval);
      if (session.recording) stopRecording(ws, session);
    }
  }, 1000);
  session._simInterval = interval;
}

module.exports = { generateSampleScript, simulateRecording };
