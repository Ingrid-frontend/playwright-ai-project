import { test, expect } from '@playwright/test';

/**
 * 示例测试用例
 * 演示 Playwright 的基本功能和语义化定位符的使用
 * 使用 Playwright 官方文档网站作为测试目标
 */
test.describe('Playwright 官方文档网站测试', () => {
  test('应该能够访问首页并验证标题', async ({ page }) => {
    // 导航到 Playwright 官网
    await page.goto('https://playwright.dev');
    
    // 使用语义化定位符验证页面标题
    await expect(page).toHaveTitle(/Playwright/);
    
    // 验证页面包含 "Get started" 按钮
    const getStartedButton = page.getByRole('link', { name: 'Get started' });
    await expect(getStartedButton).toBeVisible();
  });

  test('应该能够搜索文档', async ({ page }) => {
    await page.goto('https://playwright.dev');
    
    // 查找搜索框（使用语义化定位符）
    const searchButton = page.getByRole('button', { name: /search/i });
    await searchButton.click();
    
    // 输入搜索关键词
    const searchInput = page.getByPlaceholder(/search/i);
    await searchInput.fill('locators');
    await searchInput.press('Enter');
    
    // 验证搜索结果页面
    await expect(page).toHaveURL(/.*search.*/);
  });

  test('应该能够导航到文档页面', async ({ page }) => {
    await page.goto('https://playwright.dev');
    
    // 点击 "Docs" 链接
    const docsLink = page.getByRole('link', { name: 'Docs' });
    await docsLink.click();
    
    // 验证已导航到文档页面
    await expect(page).toHaveURL(/.*docs.*/);
    
    // 验证页面包含文档内容
    const heading = page.getByRole('heading', { level: 1 });
    await expect(heading).toBeVisible();
  });

  test('视觉回归测试示例', async ({ page }) => {
    await page.goto('https://playwright.dev');
    
    // 等待页面加载完成
    await page.waitForLoadState('networkidle');
    
    // 视觉回归测试：截图比对
    // 注意：首次运行会生成基准截图，后续运行会与基准对比
    await expect(page).toHaveScreenshot('playwright-homepage.png', {
      fullPage: true,
      maxDiffPixels: 100, // 允许的像素差异阈值
    });
  });
});
