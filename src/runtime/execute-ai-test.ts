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
import {
  midsceneAct,
  midsceneAssert,
  midsceneInput,
  midsceneTap,
} from '../utils/midscene.js';

export interface AiTestRunOptions {
  env?: string;
  profile?: string;
  headed?: boolean;
  outputDir?: string;
  heal?: boolean;
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

  const ok = await midsceneTap(page, action.description);
  if (!ok) throw new Error(`视觉定位点击失败: ${action.description}`);
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

  const ok = await midsceneInput(page, action.value, action.description);
  if (!ok) throw new Error(`视觉定位输入失败: ${action.description}`);
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

  const result = await midsceneAct(page, `在“${action.description}”中选择“${action.value}”`);
  if (!result) throw new Error(`视觉选择失败: ${action.description}`);
}

async function assertTarget(page: Page, action: Extract<SemanticAction, { type: 'assert' }>): Promise<void> {
  const ok = await midsceneAssert(page, action.description);
  if (!ok) throw new Error(`断言失败: ${action.description}`);
}

async function actTarget(page: Page, action: Extract<SemanticAction, { type: 'act' }>): Promise<void> {
  const result = await midsceneAct(page, action.instruction);
  if (!result) throw new Error(`AI 操作未返回结果: ${action.instruction}`);
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

async function healStep(
  page: Page,
  plan: SemanticTestPlan,
  stepIndex: number,
  error: string,
  outputDir: string,
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
      const attempts = Math.max(1, (step.retries ?? 0) + 1 + (options.heal ? 1 : 0));
      let passed = false;
      let healed = false;
      let errorMessage: string | undefined;

      for (let attempt = 0; attempt < attempts; attempt++) {
        try {
          await executeAction(page, step.action);
          passed = true;
          break;
        } catch (error) {
          errorMessage = error instanceof Error ? error.message : String(error);
          console.log(`❌ ${step.id} 第 ${attempt + 1}/${attempts} 次失败: ${errorMessage}`);

          if (options.heal && attempt === attempts - 1 && step.action.type !== 'goto') {
            try {
              const heal = await healStep(page, plan, index, errorMessage, outputDir);
              if (heal.shouldSkip && step.optional) {
                break;
              }
              if (heal.correctedStep) {
                step = { ...step, ...heal.correctedStep, id: step.id };
                healed = true;
                continue;
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
          attempts,
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
        attempts,
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
