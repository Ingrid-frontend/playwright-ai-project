import type { Locator, Page } from '@playwright/test';

const PAUSE_ENABLED = process.env.ENABLE_PAUSE === '1';

export async function maybePause(page: Page, reason: string): Promise<void> {
  if (!PAUSE_ENABLED) return;
  console.log(`⏸️ 已启用 pause（ENABLE_PAUSE=1），原因: ${reason}`);
  await page.pause();
}

export async function smartClick(locator: Locator, stepName: string): Promise<void> {
  console.log(`🧠 执行智能点击: ${stepName}`);
  console.log(`🔍 元素数量: ${await locator.count()}`);

  try {
    await locator.waitFor({ state: 'visible', timeout: 10_000 });
  } catch (e: any) {
    console.log(`⚠️ 元素不可见: ${e?.message ?? String(e)}`);
    await maybePause(locator.page(), `元素不可见: ${stepName}`);
  }

  await locator.scrollIntoViewIfNeeded().catch(() => {});
  await locator
    .page()
    .locator('.ant-spin-spinning, .ant-loading')
    .waitFor({ state: 'hidden' })
    .catch(() => {});

  try {
    await locator.click();
  } catch (e: any) {
    console.log(`⚠️ 点击失败: ${e?.message ?? String(e)}`);
    await maybePause(locator.page(), `点击失败: ${stepName}`);
    throw e;
  }

  if (stepName.includes('选择') || stepName.includes('下拉') || locator.toString().includes('ant-select')) {
    await locator
      .page()
      .locator('.ant-select-dropdown:not(.ant-select-dropdown--hidden)')
      .waitFor({ timeout: 5_000 })
      .catch(() => {});
  }

  if (stepName.includes('日期') || locator.toString().includes('date')) {
    await locator
      .page()
      .locator('.ant-calendar-picker-container')
      .waitFor({ timeout: 5_000 })
      .catch(() => {});
  }
}

export async function smartFill(locator: Locator, text: string, stepName: string): Promise<void> {
  console.log(`🧠 执行智能填充: ${stepName}`);
  console.log(`🔍 元素数量: ${await locator.count()}`);

  try {
    await locator.waitFor({ state: 'visible', timeout: 10_000 });
  } catch (e: any) {
    console.log(`⚠️ 元素不可见: ${e?.message ?? String(e)}`);
    await maybePause(locator.page(), `元素不可见: ${stepName}`);
  }

  await locator.scrollIntoViewIfNeeded().catch(() => {});
  await locator
    .page()
    .locator('.ant-spin-spinning, .ant-loading')
    .waitFor({ state: 'hidden' })
    .catch(() => {});

  try {
    await locator.fill(text);
  } catch (e: any) {
    console.log(`⚠️ 填充失败: ${e?.message ?? String(e)}`);
    await maybePause(locator.page(), `填充失败: ${stepName}`);
    throw e;
  }
}

export async function step(name: string, fn: () => Promise<void>): Promise<void> {
  console.log(`\n👉 ${name}`);
  try {
    await fn();
    console.log(`✅ ${name} 完成`);
  } catch (error: any) {
    console.log(`❌ ${name} 失败: ${error?.message ?? String(error)}`);
    throw error;
  }
}

