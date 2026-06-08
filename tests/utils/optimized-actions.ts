import type { Locator, Page } from '@playwright/test';

const PAUSE_ENABLED = process.env.ENABLE_PAUSE === '1';
const RETRY_DELAY_MS = 400;

export async function maybePause(page: Page, reason: string): Promise<void> {
  if (!PAUSE_ENABLED) return;
  console.log(`⏸️ 已启用 pause（ENABLE_PAUSE=1），原因: ${reason}`);
  await page.pause();
}

export type SmartClickOptions = {
  force?: boolean;
};

async function waitForPageStable(page: Page): Promise<void> {
  await page
    .locator('.ant-spin-spinning, .ant-loading')
    .waitFor({ state: 'hidden', timeout: 6_000 })
    .catch(() => {});
}

async function attemptClick(locator: Locator, force: boolean): Promise<boolean> {
  try {
    if (force) {
      await locator.click({ force: true });
    } else {
      await locator.click();
    }
    return true;
  } catch {
    return false;
  }
}

async function clickWithEvaluate(locator: Locator): Promise<boolean> {
  try {
    await locator.evaluate((el) => (el as HTMLElement).click());
    return true;
  } catch {
    return false;
  }
}

async function dismissOverlay(page: Page): Promise<void> {
  const overlaySelectors = [
    '.ant-drawer-mask',
    '.ant-modal-mask',
    '.ant-dropdown:not(.ant-select-dropdown)',
  ];
  for (const sel of overlaySelectors) {
    const overlay = page.locator(sel).last();
    if (await overlay.isVisible().catch(() => false)) {
      console.log(`⚠️ 检测到遮挡层: ${sel}，尝试关闭`);
      await overlay.click({ force: true }).catch(() => {});
      await page.waitForTimeout(150);
    }
  }
}

export async function smartClick(
  locator: Locator,
  stepName: string,
  options: SmartClickOptions = {}
): Promise<void> {
  const { force = false } = options;
  console.log(`🧠 执行智能点击: ${stepName}`);
  console.log(`🔍 元素数量: ${await locator.count()}`);

  try {
    await locator.waitFor({ state: 'visible', timeout: 5_000 });
  } catch (e: any) {
    console.log(`⚠️ 元素不可见: ${e?.message ?? String(e)}`);
    await maybePause(locator.page(), `元素不可见: ${stepName}`);
  }

  await locator.scrollIntoViewIfNeeded().catch(() => {});
  await waitForPageStable(locator.page());

  const page = locator.page();

  await dismissOverlay(page);

  if (force) {
    const ok = await attemptClick(locator, true);
    if (ok) {
      await waitForPostClick(page, stepName, locator);
      return;
    }
    console.log('⚠️ force 点击失败，尝试原生 evaluate 兜底');
    const evalOk = await clickWithEvaluate(locator);
    if (evalOk) {
      await waitForPostClick(page, stepName, locator);
      return;
    }
    console.log(`❌ 点击失败: ${stepName}`);
    await maybePause(page, `点击失败: ${stepName}`);
    throw new Error(`smartClick 失败（force+evaluate 均失败）: ${stepName}`);
  }

  const succeeded = await attemptClick(locator, false);
  if (succeeded) {
    await waitForPostClick(page, stepName, locator);
    return;
  }

  console.log(`⚠️ 首次点击失败，${RETRY_DELAY_MS}ms 后重试 (force)`);
  await page.waitForTimeout(RETRY_DELAY_MS);
  await waitForPageStable(page);

  const retryOk = await attemptClick(locator, true);
  if (retryOk) {
    await waitForPostClick(page, stepName, locator);
    return;
  }

  console.log('⚠️ 二次点击失败，尝试原生 evaluate 兜底');
  const evalOk = await clickWithEvaluate(locator);
  if (evalOk) {
    await waitForPostClick(page, stepName, locator);
    return;
  }

  console.log(`❌ 三级重试均失败: ${stepName}`);
  await maybePause(page, `点击失败: ${stepName}`);
  throw new Error(`smartClick 三级重试均失败: ${stepName}`);
}

async function waitForPostClick(page: Page, stepName: string, locator: Locator): Promise<void> {
  if (stepName.includes('选择') || stepName.includes('下拉') || locator.toString().includes('ant-select')) {
    await page
      .locator('.ant-select-dropdown:not(.ant-select-dropdown--hidden)')
      .waitFor({ timeout: 3_000 })
      .catch(() => {});
  }

  if (stepName.includes('日期') || locator.toString().includes('date')) {
    await page
      .locator('.ant-calendar-picker-container')
      .waitFor({ timeout: 3_000 })
      .catch(() => {});
  }
}

export async function smartFill(locator: Locator, text: string, stepName: string): Promise<void> {
  console.log(`🧠 执行智能填充: ${stepName}`);
  console.log(`🔍 元素数量: ${await locator.count()}`);

  try {
    await locator.waitFor({ state: 'visible', timeout: 5_000 });
  } catch (e: any) {
    console.log(`⚠️ 元素不可见: ${e?.message ?? String(e)}`);
    await maybePause(locator.page(), `元素不可见: ${stepName}`);
  }

  await locator.scrollIntoViewIfNeeded().catch(() => {});
  await waitForPageStable(locator.page());

  const page = locator.page();

  try {
    await locator.fill(text);
    return;
  } catch (e: any) {
    console.log(`⚠️ 首次填充失败: ${e?.message ?? String(e)}`);
  }

  console.log(`⚠️ 首次填充失败，${RETRY_DELAY_MS}ms 后重试`);
  await page.waitForTimeout(RETRY_DELAY_MS);
  await waitForPageStable(page);

  try {
    await locator.fill(text);
    return;
  } catch (e: any) {
    console.log(`⚠️ 二次填充失败: ${e?.message ?? String(e)}`);
  }

  console.log('⚠️ 二次填充失败，尝试 evaluate 方式设置值');
  try {
    await locator.evaluate((el, value) => {
      const input = el as HTMLInputElement;
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, 'value'
      )?.set;
      nativeInputValueSetter?.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, text);
    return;
  } catch {
    // fall through to final error
  }

  console.log(`❌ 三级重试均失败: ${stepName}`);
  await maybePause(page, `填充失败: ${stepName}`);
  throw new Error(`smartFill 三级重试均失败: ${stepName}`);
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

