/**
 * Midscene AI 兜底（可选）：
 * 当普通 Playwright 定位/操作失败时，可用视觉模型理解页面并直接执行点击、输入或断言。
 * 默认关闭，开启：MIDSCENE_FALLBACK=1，并配置 MIDSCENE_MODEL_* 环境变量。
 */
import type { Page } from 'playwright';

export function isMidsceneFallbackEnabled(): boolean {
  const v = (process.env.MIDSCENE_FALLBACK || '').toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

async function createAgent(page: Page, timeoutMs: number) {
  const mod = await import('@midscene/web/playwright');
  return new mod.PlaywrightAgent(page, { waitForNetworkIdleTimeout: timeoutMs });
}

export async function midsceneTap(page: Page, description: string, timeoutMs = 15000): Promise<boolean> {
  try {
    const agent = await createAgent(page, timeoutMs);
    await agent.aiTap(description);
    return true;
  } catch (e) {
    console.warn(`[midscene] aiTap 失败: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
}

export async function midsceneInput(page: Page, value: string, description: string, timeoutMs = 15000): Promise<boolean> {
  try {
    const agent = await createAgent(page, timeoutMs);
    await agent.aiInput(description, { value });
    return true;
  } catch (e) {
    console.warn(`[midscene] aiInput 失败: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
}

export async function midsceneAssert(page: Page, assertion: string, timeoutMs = 15000): Promise<boolean> {
  try {
    const agent = await createAgent(page, timeoutMs);
    await agent.aiAssert(assertion);
    return true;
  } catch (e) {
    console.warn(`[midscene] aiAssert 失败: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
}

export async function midsceneAct(page: Page, task: string, timeoutMs = 30000): Promise<string | undefined> {
  try {
    const agent = await createAgent(page, timeoutMs);
    return await agent.aiAct(task);
  } catch (e) {
    console.warn(`[midscene] aiAct 失败: ${e instanceof Error ? e.message : String(e)}`);
    return undefined;
  }
}

export async function midsceneQuery<T = unknown>(page: Page, prompt: string, timeoutMs = 30000): Promise<T | null> {
  try {
    const agent = await createAgent(page, timeoutMs);
    return (await agent.aiQuery<T>(prompt)) ?? null;
  } catch (e) {
    console.warn(`[midscene] aiQuery 失败: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}
