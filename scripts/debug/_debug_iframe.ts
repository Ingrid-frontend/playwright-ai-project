import { chromium } from 'playwright';

async function main() {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    storageState: 'storage/loginState/stage.json',
    viewport: { width: 1280, height: 720 },
  });
  const page = await context.newPage();

  // 导航到首页
  await page.goto('https://stage.huilianyi.com/', { waitUntil: 'networkidle' });
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(3000);

  // 检查 iframe
  const iframes = page.locator('iframe');
  const iframeCount = await iframes.count();
  console.log('iframe 数量:', iframeCount);

  for (let i = 0; i < iframeCount; i++) {
    const frame = page.frameLocator('iframe').nth(i);
    const text = await frame.locator('body').textContent().catch(() => 'N/A');
    console.log(`iframe[${i}] 内容 (前100字符):`, text.substring(0, 100));
  }

  // 尝试在第一个 iframe 中查找"合同"
  const firstFrame = page.frameLocator('iframe').first();
  const contractEl = firstFrame.getByText('合同').filter({ visible: true }).first();
  const contractVisible = await contractEl.isVisible().catch(() => false);
  console.log('第一个 iframe 中"合同"可见:', contractVisible);

  if (contractVisible) {
    console.log('点击"合同"...');
    await contractEl.click();
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(3000);

    // 检查"新建合同"按钮
    const newContractBtn = page.getByRole('button', { name: '新建合同' }).filter({ visible: true }).first();
    const newContractVisible = await newContractBtn.isVisible().catch(() => false);
    console.log('"新建合同"按钮可见:', newContractVisible);

    if (!newContractVisible) {
      // 检查当前 URL
      console.log('当前 URL:', page.url());
      
      // 检查 iframe 中的内容
      for (let i = 0; i < iframeCount; i++) {
        const frame = page.frameLocator('iframe').nth(i);
        const text = await frame.locator('body').textContent().catch(() => 'N/A');
        console.log(`点击后 iframe[${i}] 内容 (前200字符):`, text.substring(0, 200));
      }
    }
  }

  await page.waitForTimeout(5000);
  await browser.close();
}

main().catch(console.error);
