import fs from 'fs';
import path from 'path';
import type { Browser, BrowserContext, FrameLocator, Page } from 'playwright';
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
import { visualTest } from '../utils/screenshot.js';
import { registerRuntimeStyleChecks, clearRuntimeStyleChecks } from '../../scripts/report/ui-regression-config.js';
import {
  collectFrameTextSamples,
  formatFrameTextSamples,
  verifyStorageStateForRun,
  waitForPwReady,
} from './pw-page-context.js';
import { framesFromStepScreenshots, savePlaywrightVideo, writeFlowReplay } from './flow-replay.js';

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
  screenshotDir?: string;
  videoRel?: string;
  replayRel?: string;
  startedAt: string;
  finishedAt: string;
  steps: AiTestStepResult[];
  error?: string;
}

type PageTarget = Page | FrameLocator;
type TargetRef = { kind: 'page' | 'iframe'; index: number; target: PageTarget; url: string };

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

function listTargets(page: Page, scope: SemanticScope = 'page'): TargetRef[] {
  const frames = page.frames().slice(1);
  const iframeTargets =
    frames.length === 0
      ? [{ kind: 'iframe', index: 0, target: page.frameLocator('iframe').first(), url: '' } satisfies TargetRef]
      : frames.map((frame, index) => ({
          kind: 'iframe' as const,
          index,
          target: page.frameLocator('iframe').nth(index),
          url: frame.url() || '',
        }));
  if (scope !== 'iframe') {
    return [{ kind: 'page', index: 0, target: page, url: page.url() }, ...iframeTargets];
  }
  return iframeTargets;
}

function extractQuotedText(input: string): string | undefined {
  const match = input.match(/[“「『"']([^”」』"']+)[”」』"']/);
  return match?.[1]?.trim() || undefined;
}

function shortActionText(action: { description: string; instruction?: string }): string {
  const source = extractQuotedText(action.description) || action.instruction?.trim() || action.description.trim();
  return source.length <= 24 ? source : '';
}

function normalizeLocatorHint(hint: unknown): string | undefined {
  if (typeof hint === 'string') {
    const trimmed = hint.trim();
    return trimmed || undefined;
  }
  return undefined;
}

function clickLabelCandidates(description: string): string[] {
  const raw = description.trim();
  const stripped = raw.replace(/\s*(菜单|按钮|链接|Tab|tab)$/u, '').trim();
  const quoted = extractQuotedText(raw);
  const out: string[] = [];
  const add = (value?: string) => {
    const v = value?.trim();
    if (v && !out.includes(v)) out.push(v);
  };
  add(quoted);
  add(stripped);
  add(raw);
  const short = shortActionText({ description: raw });
  add(short || undefined);
  return out;
}

function buildLocatorCandidates(action: SemanticAction): string[] {
  if (action.type === 'click') {
    return clickLabelCandidates(action.description).map((item) => `click text/role: ${item}`);
  }
  if (action.type === 'fill' || action.type === 'select') {
    const text = shortActionText(action);
    const out = [action.description.trim()];
    if (text && !out.includes(text)) out.push(text);
    return out.map((item) => `${action.type} label: ${item}`);
  }
  if (action.type === 'assert') {
    return [(action.expect || action.description).trim()].filter(Boolean).map((item) => `assert text: ${item}`);
  }
  return [];
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function tryClickLocators(target: PageTarget, label: string): Promise<boolean> {
  const pattern = new RegExp(escapeRegExp(label));
  const locators = [
    target.getByRole('menuitem', { name: pattern }).filter({ visible: true }).first(),
    target.getByText(label, { exact: true }).filter({ visible: true }).first(),
    target.getByRole('button', { name: pattern }).filter({ visible: true }).first(),
    target.getByRole('link', { name: pattern }).filter({ visible: true }).first(),
    target.getByLabel(label).filter({ visible: true }).first(),
  ];
  for (const locator of locators) {
    try {
      await locator.click({ timeout: 5_000 });
      return true;
    } catch {
      /* try next */
    }
  }
  return false;
}

async function clickBySemanticLabel(page: Page, label: string, scope: SemanticScope = 'page'): Promise<boolean> {
  for (const item of listTargets(page, scope)) {
    if (await tryClickLocators(item.target, label)) return true;
  }
  return false;
}

async function clickTarget(page: Page, action: Extract<SemanticAction, { type: 'click' }>): Promise<void> {
  const locatorHint = normalizeLocatorHint(action.locatorHint);
  if (locatorHint) {
    for (const item of listTargets(page, action.scope)) {
      try {
        await item.target.locator(locatorHint).first().click({ timeout: 10_000 });
        return;
      } catch (error) {
        console.log(`⚠️ 使用 locatorHint 点击失败，尝试语义定位: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  for (const label of clickLabelCandidates(action.description)) {
    if (await clickBySemanticLabel(page, label, action.scope)) return;
  }

  const ordinal = action.description.match(/第\s*(\d+)\s*[条行项个]/);
  if (ordinal) {
    const index = Math.max(0, Number(ordinal[1]) - 1);
    const rowSelectors = ['tr', '.ant-table-row', '[class*="table-row"]'];
    for (const item of listTargets(page, action.scope)) {
      for (const selector of rowSelectors) {
        try {
          await item.target.locator(selector).nth(index).click({ timeout: 5_000 });
          return;
        } catch {
          /* try next */
        }
      }
    }
  }

  throw new Error(`无法定位点击目标: ${action.description}`);
}

async function fillTarget(page: Page, action: Extract<SemanticAction, { type: 'fill' }>): Promise<void> {
  const locatorHint = normalizeLocatorHint(action.locatorHint);
  if (locatorHint) {
    for (const item of listTargets(page, action.scope)) {
      try {
        await item.target.locator(locatorHint).first().fill(action.value, { timeout: 10_000 });
        return;
      } catch (error) {
        console.log(`⚠️ 使用 locatorHint 填充失败，尝试语义定位: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  const text = shortActionText(action);
  if (text) {
    for (const item of listTargets(page, action.scope)) {
      const candidates = [
        item.target.getByLabel(text).first(),
        item.target.getByPlaceholder(text).first(),
        item.target.getByRole('textbox', { name: text }).first(),
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
  }

  throw new Error(`无法定位输入目标: ${action.description}`);
}

async function selectTarget(page: Page, action: Extract<SemanticAction, { type: 'select' }>): Promise<void> {
  const locatorHint = normalizeLocatorHint(action.locatorHint);
  if (locatorHint) {
    for (const item of listTargets(page, action.scope)) {
      try {
        await item.target.locator(locatorHint).first().selectOption(action.value, { timeout: 10_000 });
        return;
      } catch (error) {
        console.log(`⚠️ 使用 locatorHint 选择失败，尝试语义操作: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  const text = shortActionText(action);
  if (text) {
    for (const item of listTargets(page, action.scope)) {
      const candidates = [
        item.target.getByLabel(text).first(),
        item.target.getByRole('combobox', { name: text }).first(),
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
    const needle = action.target?.trim();
    let count = 0;
    for (const item of listTargets(page, action.scope)) {
      const loc = needle
        ? item.target.getByText(needle, { exact: false })
        : item.target.locator('body');
      count += needle ? await loc.count() : 1;
      if (!needle) break;
      if (count >= n) break;
    }
    if (count < n) {
      throw new Error(`断言失败: count=${count} < ${n}${needle ? ` target=${needle}` : ''}`);
    }
    return;
  }

  for (const item of listTargets(page, action.scope)) {
    try {
      await item.target.getByText(expectText, { exact: false }).first().waitFor({ state: 'visible', timeout: 6_000 });
      return;
    } catch {
      /* try next */
    }
  }
  throw new Error(`断言失败: 未找到可见文案 ${expectText}`);
}

async function actTarget(_page: Page, action: Extract<SemanticAction, { type: 'act' }>): Promise<void> {
  throw new Error(`act 动作已不支持，请改用 click/fill/select/assert: ${action.instruction}`);
}

function expandIntentPath(value: string): string {
  return value.replace(/\{repoRoot\}/g, process.cwd());
}

async function gotoTarget(page: Page, action: Extract<SemanticAction, { type: 'goto' }>): Promise<void> {
  if (!action.path && !action.url) return;
  const target = action.url ? expandIntentPath(action.url) : action.path || '/';
  await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await waitForPwReady(page, { afterNav: true });
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
    await waitForPwReady(page);
    await page.waitForTimeout(150);
  }
}

async function captureEvidence(
  page: Page,
  stepIndex: number,
  step: SemanticStep,
  outputDir: string,
  consoleLogs: string[],
  screenshotRunDir?: string,
): Promise<string | undefined> {
  const needsScreenshot = step.evidence?.includes('screenshot') || step.action.type === 'screenshot';
  let screenshotPath: string | undefined;

  if (needsScreenshot && step.action.type === 'screenshot' && step.action.snapshotName && screenshotRunDir) {
    const shot = await visualTest(page, {
      dir: screenshotRunDir,
      name: step.action.snapshotName,
      state: step.action.state || 'normal',
      step: stepIndex + 1,
    });
    screenshotPath = shot.path;
  } else if (needsScreenshot) {
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

function sanitizeSemanticAction(action: SemanticAction): SemanticAction {
  if (action.type === 'click' || action.type === 'fill' || action.type === 'select') {
    const locatorHint = normalizeLocatorHint(action.locatorHint);
    if (locatorHint) return { ...action, locatorHint };
    const { locatorHint: _drop, ...rest } = action;
    return rest as SemanticAction;
  }
  return action;
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
    action: sanitizeSemanticAction(corrected.action),
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
  const frameTexts = formatFrameTextSamples(await collectFrameTextSamples(page));
  const failedStep: SemanticStep | undefined = plan.steps[stepIndex];
  const prompt = buildHealStepPrompt({
    plan,
    stepIndex,
    error,
    currentUrl,
    dom: dom.slice(0, 20_000),
    frameTexts,
    locatorCandidates: failedStep ? buildLocatorCandidates(failedStep.action) : [],
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

  const scriptKey = plan.scriptKey || `intent/${sanitizeName(plan.name)}`;
  if (plan.styleChecks?.length) {
    registerRuntimeStyleChecks(scriptKey, plan.styleChecks);
  }
  const screenshotRunDir = path.join('screenshots', env, scriptKey, 'run-chromium-optimized', stamp);
  fs.mkdirSync(screenshotRunDir, { recursive: true });

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
  let context: BrowserContext | undefined;
  let page: Page | undefined;

  const finishFlow = async () => {
    const videoAbs = path.join(outputDir, 'flow.webm');
    let saved: string | undefined;
    try {
      const video = page?.video();
      if (context) await context.close();
      context = undefined;
      saved = await savePlaywrightVideo(video, videoAbs);
    } catch {
      /* ignore */
    }
    return writeFlowReplay({
      outputDir,
      title: plan.name,
      videoAbs: saved,
      frames: framesFromStepScreenshots(stepResults),
    });
  };

  try {
    const storageCheck = await verifyStorageStateForRun(browser, storageStatePath, {
      baseURL: baseConfig?.baseURL || process.env.BASE_URL,
      entry: plan.entry || '/',
      allowMissing: !storageStatePath,
    });
    if (!storageCheck.valid) {
      throw new Error(storageCheck.reason || 'storageState 不可用，请先执行 npm run login');
    }
    context = await browser.newContext({
      viewport: DEFAULT_VIEWPORT,
      baseURL: baseConfig?.baseURL || process.env.BASE_URL,
      recordVideo: { dir: path.join(outputDir, '_pw-video'), size: DEFAULT_VIEWPORT },
      ...(storageStatePath && fs.existsSync(storageStatePath) ? { storageState: storageStatePath } : {}),
    });
    page = await context.newPage();
    const pwPage = page;
    pwPage.on('console', (msg) => consoleLogs.push(`[${msg.type()}] ${msg.text()}`));

    if (!storageStatePath || !fs.existsSync(storageStatePath)) {
      console.log('⚠️ 未找到 storageState，将按未登录状态执行');
    }

    if (plan.entry && !plan.steps.some((step) => step.action.type === 'goto')) {
      const entry = /^https?:\/\//i.test(plan.entry) || plan.entry.startsWith('file:')
        ? expandIntentPath(plan.entry)
        : plan.entry;
      await pwPage.goto(entry, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await waitForPwReady(pwPage, { afterNav: true });
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
          await executeAction(pwPage, step.action);
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
              const heal = await healStep(pwPage, plan, index, errorMessage, outputDir, options.constraints);
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
                    await executeAction(pwPage, step.action);
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

      const screenshotPath = await captureEvidence(pwPage, index, step, outputDir, consoleLogs, screenshotRunDir);
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

    const flow = await finishFlow();
    clearRuntimeStyleChecks();
    fs.writeFileSync(
      path.join(outputDir, 'result.json'),
      `${JSON.stringify({ passed: allPassed, steps: stepResults, screenshotDir: screenshotRunDir, ...flow }, null, 2)}\n`,
      'utf-8',
    );

    return {
      passed: allPassed,
      outputDir,
      screenshotDir: screenshotRunDir,
      videoRel: flow.videoRel,
      replayRel: flow.replayRel,
      startedAt,
      finishedAt: new Date().toISOString(),
      steps: stepResults,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const flow = await finishFlow();
    fs.writeFileSync(
      path.join(outputDir, 'result.json'),
      `${JSON.stringify({ passed: false, error: message, steps: stepResults, ...flow }, null, 2)}\n`,
      'utf-8',
    );
    return {
      passed: false,
      outputDir,
      videoRel: flow.videoRel,
      replayRel: flow.replayRel,
      startedAt,
      finishedAt: new Date().toISOString(),
      steps: stepResults,
      error: message,
    };
  } finally {
    await browser.close();
  }
}
