import fs from 'fs';
import path from 'path';
import type { Browser, FrameLocator, Page } from 'playwright';
import { completeJson } from '../ai/llm-client.js';
import { buildHealStepPrompt, buildHealStepSystemPrompt } from '../ai/prompts/heal-step.js';
import {
  validateSemanticTestPlan,
  type SemanticAction,
  type SemanticScope,
  type SemanticStep,
  type SemanticTestPlan,
} from '../types/ai-test-plan.js';
import { getBaseEnvConfig, resolveStorageState } from '../utils/env-config.js';

export type StepErrorKind = 'AssertionError' | 'LocatorError' | 'Retryable';

export interface AiTestRunOptions {
  env?: string;
  profile?: string;
  headed?: boolean;
  outputDir?: string;
  heal?: boolean;
  constraints?: string[];
}

export interface AiTestStepResult {
  id: string;
  action: SemanticAction;
  passed: boolean;
  optional: boolean;
  skipped?: boolean;
  attempts: number;
  healed?: boolean;
  error?: string;
  screenshot?: string;
}

export interface AiTestRunResult {
  passed: boolean;
  outputDir: string;
  startedAt: string;
  finishedAt: string;
  steps: AiTestStepResult[];
  error?: string;
}

type PageTarget = Page | FrameLocator;

const DEFAULT_VIEWPORT = { width: 1280, height: 720 };

function sanitizeName(name: string): string {
  return (
    name
      .trim()
      .replace(/[^\w\u4e00-\u9fa5-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'ai-test'
  );
}

function resolveTarget(page: Page, scope: SemanticScope = 'page'): PageTarget {
  if (scope === 'iframe') {
    return page.frameLocator('iframe').first();
  }
  return page;
}

function waitForPageReady(page: Page): Promise<void> {
  return page
    .locator('.ant-spin-spinning, .ant-loading')
    .waitFor({ state: 'hidden', timeout: 4_000 })
    .catch(() => {});
}

function extractQuotedText(input: string): string | undefined {
  const match = input.match(/[“「『"']([^”」』"']+)[”」』"']/);
  return match?.[1]?.trim() || undefined;
}

function shortActionText(action: { description: string; instruction?: string }): string {
  const source = extractQuotedText(action.description) || action.instruction?.trim() || action.description.trim();
  return source.length <= 24 ? source : '';
}

async function clickTarget(page: Page, action: Extract<SemanticAction, { type: 'click' }>): Promise<void> {
  const target = resolveTarget(page, action.scope);
  if (action.locatorHint) {
    try {
      await target.locator(action.locatorHint).first().click({ timeout: 10_000 });
      return;
    } catch (error) {
      console.log(`⚠️ 使用 locatorHint 点击失败，尝试语义定位: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const text = shortActionText(action);
  if (text) {
    const candidates = [
      target.getByText(text, { exact: true }).first(),
      target.getByRole('button', { name: text }).first(),
      target.getByRole('link', { name: text }).first(),
      target.getByLabel(text).first(),
    ];
    for (const locator of candidates) {
      try {
        await locator.click({ timeout: 5_000 });
        return;
      } catch {
        /* try next */
      }
    }
  }

  const ordinal = action.description.match(/第\s*(\d+)\s*[条行项个]/);
  if (ordinal) {
    const index = Math.max(0, Number(ordinal[1]) - 1);
    const rowSelectors = ['tr', '.ant-table-row', '[class*="table-row"]'];
    for (const selector of rowSelectors) {
      try {
        await target.locator(selector).nth(index).click({ timeout: 5_000 });
        return;
      } catch {
        /* try next */
      }
    }
  }

  throw new Error(`无法定位点击目标: ${action.description}`);
}

async function fillTarget(page: Page, action: Extract<SemanticAction, { type: 'fill' }>): Promise<void> {
  const target = resolveTarget(page, action.scope);
  if (action.locatorHint) {
    try {
      await target.locator(action.locatorHint).first().fill(action.value, { timeout: 10_000 });
      return;
    } catch (error) {
      console.log(`⚠️ 使用 locatorHint 填充失败，尝试语义定位: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const text = shortActionText(action);
  if (text) {
    const candidates = [
      target.getByLabel(text).first(),
      target.getByPlaceholder(text).first(),
      target.getByRole('textbox', { name: text }).first(),
    ];
    for (const locator of candidates) {
      try {
        await locator.fill(action.value, { timeout: 5_000 });
        return;
      } catch {
        /* try next */
      }
    }
  }

  throw new Error(`无法定位输入目标: ${action.description}`);
}

async function selectTarget(page: Page, action: Extract<SemanticAction, { type: 'select' }>): Promise<void> {
  const target = resolveTarget(page, action.scope);
  if (action.locatorHint) {
    try {
      await target.locator(action.locatorHint).first().selectOption(action.value, { timeout: 10_000 });
      return;
    } catch (error) {
      console.log(`⚠️ 使用 locatorHint 选择失败，尝试语义操作: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const text = shortActionText(action);
  if (text) {
    const candidates = [
      target.getByLabel(text).first(),
      target.getByRole('combobox', { name: text }).first(),
    ];
    for (const locator of candidates) {
      try {
        await locator.selectOption(action.value, { timeout: 5_000 });
        return;
      } catch {
        /* try next */
      }
    }
  }

  throw new Error(`无法定位选择目标: ${action.description}`);
}

async function assertTarget(page: Page, action: Extract<SemanticAction, { type: 'assert' }>): Promise<void> {
  const kind = action.kind || 'text';
  const expectText = (action.expect || action.description || '').trim();
  if (!expectText) throw new Error('断言失败: expect 为空');

  if (kind === 'url') {
    const url = page.url();
    if (!url.toLowerCase().includes(expectText.toLowerCase())) {
      throw new Error(`断言失败: url 不含 ${expectText}（当前 ${url}）`);
    }
    return;
  }

  if (kind === 'count') {
    const n = Number(expectText);
    const target = resolveTarget(page, action.scope);
    const needle = action.target?.trim();
    const loc = needle
      ? target.getByText(needle, { exact: false })
      : target.locator('body');
    const count = needle ? await loc.count() : 1;
    if (count < n) {
      throw new Error(`断言失败: count=${count} < ${n}${needle ? ` target=${needle}` : ''}`);
    }
    return;
  }

  const target = resolveTarget(page, action.scope);
  try {
    await target.getByText(expectText, { exact: false }).first().waitFor({ state: 'visible', timeout: 6_000 });
    return;
  } catch {
    throw new Error(`断言失败: 未找到可见文案 ${expectText}`);
  }
}

async function actTarget(_page: Page, action: Extract<SemanticAction, { type: 'act' }>): Promise<void> {
  throw new Error(`act 动作已不支持，请改用 click/fill/select/assert: ${action.instruction}`);
}

async function gotoTarget(page: Page, action: Extract<SemanticAction, { type: 'goto' }>): Promise<void> {
  if (!action.path && !action.url) return;
  await page.goto(action.url || action.path || '/', { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
  await waitForPageReady(page);
}

async function executeAction(page: Page, action: SemanticAction): Promise<void> {
  switch (action.type) {
    case 'goto':
      await gotoTarget(page, action);
      break;
    case 'act':
      await actTarget(page, action);
      break;
    case 'click':
      await clickTarget(page, action);
      break;
    case 'fill':
      await fillTarget(page, action);
      break;
    case 'select':
      await selectTarget(page, action);
      break;
    case 'assert':
      await assertTarget(page, action);
      break;
    case 'wait':
      await page.waitForTimeout(action.timeoutMs ?? 1_000);
      break;
    case 'screenshot':
      break;
  }

  if (action.type !== 'goto' && action.type !== 'wait') {
    await page.waitForTimeout(500);
    await waitForPageReady(page);
  }
}

async function captureEvidence(
  page: Page,
  stepIndex: number,
  step: SemanticStep,
  outputDir: string,
  consoleLogs: string[],
): Promise<string | undefined> {
  const needsScreenshot = step.evidence?.includes('screenshot') || step.action.type === 'screenshot';
  let screenshotPath: string | undefined;

  if (needsScreenshot) {
    screenshotPath = path.join(outputDir, `step-${String(stepIndex + 1).padStart(2, '0')}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: false }).catch(() => {
      screenshotPath = undefined;
    });
  }

  if (step.evidence?.includes('dom')) {
    const dom = await page.locator('body').innerHTML().catch(() => '');
    fs.writeFileSync(path.join(outputDir, `step-${String(stepIndex + 1).padStart(2, '0')}-dom.html`), dom, 'utf-8');
  }

  if (step.evidence?.includes('console')) {
    fs.writeFileSync(
      path.join(outputDir, `step-${String(stepIndex + 1).padStart(2, '0')}-console.log`),
      consoleLogs.join('\n'),
      'utf-8',
    );
  }

  return screenshotPath;
}

interface HealResult {
  correctedStep?: SemanticStep;
  reason?: string;
  shouldSkip?: boolean;
}

export function classifyStepError(error: string, step: SemanticStep): StepErrorKind {
  if (step.action.type === 'assert') return 'AssertionError';

  const text = error.toLowerCase();
  if (
    text.includes('断言失败') ||
    text.includes('assertion') ||
    text.includes('ai assert')
  ) {
    return 'AssertionError';
  }

  if (
    text.includes('无法定位') ||
    text.includes('locator') ||
    text.includes('timeout') ||
    text.includes('waiting for') ||
    text.includes('not found') ||
    text.includes('no element') ||
    text.includes('strict mode violation')
  ) {
    return 'LocatorError';
  }

  return 'Retryable';
}

function acceptHealedStep(original: SemanticStep, corrected: SemanticStep): SemanticStep | null {
  if (original.action.type === 'assert') {
    if (corrected.action.type !== 'assert') return null;
    if (corrected.action.description !== original.action.description) return null;
  }

  return {
    ...original,
    ...corrected,
    id: original.id,
    action: corrected.action,
    optional: original.optional,
  };
}

async function healStep(
  page: Page,
  plan: SemanticTestPlan,
  stepIndex: number,
  error: string,
  outputDir: string,
  constraints?: string[],
): Promise<HealResult> {
  const screenshotPath = path.join(outputDir, `heal-step-${String(stepIndex + 1).padStart(2, '0')}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: false }).catch(() => {});
  const dom = await page.locator('body').innerHTML().catch(() => '');
  const currentUrl = page.url();
  const prompt = buildHealStepPrompt({
    plan,
    stepIndex,
    error,
    currentUrl,
    dom: dom.slice(0, 20_000),
    constraints,
  });
  return completeJson<HealResult>(prompt, {
    system: buildHealStepSystemPrompt(),
    temperature: 0,
    maxTokens: 6_000,
  });
}

export async function executeAiTest(planInput: unknown, options: AiTestRunOptions = {}): Promise<AiTestRunResult> {
  const plan = validateSemanticTestPlan(planInput);
  const env = options.env || plan.env || process.env.PLAYWRIGHT_ENV || 'stage';
  const profile = options.profile || plan.profile || process.env.PLAYWRIGHT_ACCOUNT;
  const baseConfig = getBaseEnvConfig(env);
  const startedAt = new Date().toISOString();
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const outputDir = path.resolve(
    options.outputDir || path.join('results', 'ai-native', `${stamp}-${sanitizeName(plan.name)}`),
  );
  fs.mkdirSync(outputDir, { recursive: true });

  let storageStatePath: string | undefined;
  try {
    storageStatePath = path.resolve(process.cwd(), resolveStorageState(env, profile));
  } catch {
    storageStatePath = undefined;
  }

  const { chromium } = await import('playwright');
  const browser: Browser = await chromium.launch({ headless: !options.headed });
  const consoleLogs: string[] = [];
  const stepResults: AiTestStepResult[] = [];

  try {
    const context = await browser.newContext({
      viewport: DEFAULT_VIEWPORT,
      baseURL: baseConfig?.baseURL || process.env.BASE_URL,
      ...(storageStatePath && fs.existsSync(storageStatePath) ? { storageState: storageStatePath } : {}),
    });
    const page = await context.newPage();
    page.on('console', (msg) => consoleLogs.push(`[${msg.type()}] ${msg.text()}`));

    if (!storageStatePath || !fs.existsSync(storageStatePath)) {
      console.log('⚠️ 未找到 storageState，将按未登录状态执行');
    }

    if (plan.entry && !plan.steps.some((step) => step.action.type === 'goto')) {
      await page.goto(plan.entry, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
    }

    let allPassed = true;

    for (let index = 0; index < plan.steps.length; index++) {
      let step = plan.steps[index];
      const canHeal = Boolean(options.heal) && step.action.type !== 'goto' && step.action.type !== 'assert';
      const maxAttempts = Math.max(1, (step.retries ?? 0) + 1 + (canHeal ? 1 : 0));
      let attemptsUsed = 0;
      let passed = false;
      let healed = false;
      let errorMessage: string | undefined;

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        attemptsUsed = attempt + 1;
        try {
          await executeAction(page, step.action);
          passed = true;
          break;
        } catch (error) {
          errorMessage = error instanceof Error ? error.message : String(error);
          console.log(`❌ ${step.id} 第 ${attempt + 1}/${maxAttempts} 次失败: ${errorMessage}`);

          const kind = classifyStepError(errorMessage, step);
          if (kind === 'AssertionError') {
            console.log(`🛑 ${step.id} 断言失败，禁止自愈`);
            break;
          }

          if (canHeal && attempt === maxAttempts - 1) {
            try {
              const heal = await healStep(page, plan, index, errorMessage, outputDir, options.constraints);
              if (heal.shouldSkip) {
                if (step.optional && step.action.type !== 'assert') {
                  break;
                }
                console.log(`⚠️ ${step.id} 模型建议跳过，但步骤不可跳过，已忽略`);
              }
              if (heal.correctedStep) {
                const accepted = acceptHealedStep(step, heal.correctedStep);
                if (!accepted) {
                  console.log(`⚠️ ${step.id} 自愈结果被拒绝（禁止弱化断言或改写断言）`);
                } else {
                  step = accepted;
                  healed = true;
                  try {
                    await executeAction(page, step.action);
                    passed = true;
                    errorMessage = undefined;
                    break;
                  } catch (healExecError) {
                    errorMessage =
                      healExecError instanceof Error ? healExecError.message : String(healExecError);
                    console.log(`❌ ${step.id} 自愈后仍失败: ${errorMessage}`);
                  }
                }
              }
            } catch (healError) {
              console.log(`⚠️ 自愈失败: ${healError instanceof Error ? healError.message : String(healError)}`);
            }
          }
        }
      }

      if (!passed && step.optional) {
        stepResults.push({
          id: step.id,
          action: step.action,
          passed: false,
          optional: true,
          skipped: true,
          attempts: attemptsUsed,
          healed,
          error: errorMessage,
        });
        continue;
      }

      if (!passed) {
        allPassed = false;
      }

      const screenshotPath = await captureEvidence(page, index, step, outputDir, consoleLogs);
      stepResults.push({
        id: step.id,
        action: step.action,
        passed,
        optional: step.optional ?? false,
        attempts: attemptsUsed,
        healed,
        error: passed ? undefined : errorMessage,
        screenshot: screenshotPath,
      });
    }

    await context.close();
    fs.writeFileSync(
      path.join(outputDir, 'result.json'),
      `${JSON.stringify({ passed: allPassed, steps: stepResults }, null, 2)}\n`,
      'utf-8',
    );

    return {
      passed: allPassed,
      outputDir,
      startedAt,
      finishedAt: new Date().toISOString(),
      steps: stepResults,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fs.writeFileSync(path.join(outputDir, 'result.json'), `${JSON.stringify({ passed: false, error: message }, null, 2)}\n`, 'utf-8');
    return {
      passed: false,
      outputDir,
      startedAt,
      finishedAt: new Date().toISOString(),
      steps: stepResults,
      error: message,
    };
  } finally {
    await browser.close();
  }
}
