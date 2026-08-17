import fs from 'fs';
import path from 'path';
import { completeJson } from '../ai/llm-client.js';
import {
  buildHealFromSnapshotPrompt,
  buildHealFromSnapshotSystemPrompt,
  buildResolveOpsPrompt,
  buildResolveOpsSystemPrompt,
  type EgoResolvedOp,
} from '../ai/prompts/resolve-ego-ops.js';
import type { SemanticAction, SemanticStep, SemanticTestPlan } from '../types/ai-test-plan.js';
import { getBaseEnvConfig } from '../utils/env-config.js';
import { EGO_RESULT_PREFIX, runEgoJson, EgoUnavailableError, EgoUserControllingError } from '../utils/ego-browser.js';
import {
  findCandidates,
  formatNodesForPrompt,
  parseSnapshotText,
  summarizeSnapshot,
} from './ego-snapshot.js';
import { evaluateStructuredAssert, normalizeAssertAction } from './assert-eval.js';
import type { AiTestRunOptions, AiTestRunResult, AiTestStepResult } from './execute-ai-test.js';

export type IntentEgoRunOptions = AiTestRunOptions & {
  keepTab?: boolean;
  spaceName?: string;
};

function sanitizeName(name: string): string {
  return (
    name
      .trim()
      .replace(/[^\w\u4e00-\u9fa5-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'intent'
  );
}

function resolveUrl(env: string, pathOrUrl?: string): string | undefined {
  if (!pathOrUrl) return undefined;
  if (/^https?:\/\//i.test(pathOrUrl) || pathOrUrl.startsWith('data:')) return pathOrUrl;
  const base = getBaseEnvConfig(env)?.baseURL;
  if (!base) throw new Error(`环境 ${env} 未配置 baseURL，无法解析路径 ${pathOrUrl}`);
  return new URL(pathOrUrl, base).toString();
}

function intentScreenshotDir(env: string, planName: string, stamp: string): string {
  return path.join('screenshots', 'intent', env, sanitizeName(planName), `run-chromium-${stamp}`);
}

function stepShotName(index: number, step: SemanticStep): string {
  const label =
    step.action.type === 'screenshot'
      ? step.action.label || step.id
      : step.id || `step-${index + 1}`;
  const safe = sanitizeName(label);
  return `step-${String(index + 1).padStart(2, '0')}-${safe}.png`;
}

function jsString(value: string): string {
  return JSON.stringify(value);
}

async function egoSession<T>(
  spaceName: string,
  bodyLines: string[],
  opts: { keep?: boolean; timeoutMs?: number } = {},
): Promise<T> {
  const keep = opts.keep === true;
  const script = [
    `const task = await useOrCreateTaskSpace(${jsString(spaceName)})`,
    ...bodyLines,
    keep ? `cliLog('keep space ' + task.id)` : '',
    `cliLog(${jsString(EGO_RESULT_PREFIX)} + JSON.stringify(typeof __result !== 'undefined' ? __result : { ok: true }))`,
  ]
    .filter(Boolean)
    .join('\n');

  try {
    const { data } = await runEgoJson<T>(script, { timeoutMs: opts.timeoutMs ?? 180_000 });
    return data;
  } catch (err) {
    if (err instanceof EgoUnavailableError || err instanceof EgoUserControllingError) throw err;
    throw err;
  }
}

async function openEntry(spaceName: string, url: string): Promise<{ url: string; title?: string }> {
  return egoSession(spaceName, [
    `await openOrReuseTab(${jsString(url)}, { wait: true, timeout: 45 })`,
    `await waitForNetworkIdle({ timeout: 15 }).catch(() => {})`,
    `await wait(1)`,
    `const info = await pageInfo()`,
    `const __result = { url: info.url, title: info.title }`,
  ]);
}

async function takeSnapshot(spaceName: string): Promise<{ snapshot: string; url: string }> {
  return egoSession(spaceName, [
    `const snap = await snapshotText()`,
    `const info = await pageInfo()`,
    `const __result = { snapshot: String(snap || ''), url: info.url || '' }`,
  ]);
}

async function captureShotBase64(spaceName: string): Promise<string | undefined> {
  const data = await egoSession<{ data?: string }>(spaceName, [
    `const shot = await cdp('Page.captureScreenshot', { format: 'png' })`,
    `const __result = { data: shot && shot.data }`,
  ]);
  return data.data;
}

function writePng(base64: string | undefined, filePath: string): string | undefined {
  if (!base64) return undefined;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));
  return filePath;
}

async function runOps(spaceName: string, ops: EgoResolvedOp[]): Promise<void> {
  if (ops.length === 0) return;
  const lines: string[] = [];
  for (const op of ops) {
    if (op.type === 'click') {
      lines.push(`await click('@${op.ref}', { label: ${jsString(op.label || 'click')} })`);
    } else if (op.type === 'fill') {
      lines.push(`await fillInput('@${op.ref}', ${jsString(op.value)})`);
    } else if (op.type === 'select') {
      lines.push(`await click('@${op.ref}', { label: ${jsString(op.label || 'select')} })`);
      lines.push(`await wait(0.5)`);
      lines.push(`await typeText(${jsString(op.value)})`);
      lines.push(`await pressKey('Enter').catch(() => {})`);
    } else if (op.type === 'wait') {
      lines.push(`await wait(${Math.max(0.1, op.seconds)})`);
    }
  }
  lines.push(`await wait(0.5)`);
  lines.push(`const __result = { ok: true }`);
  await egoSession(spaceName, lines);
}

async function gotoInEgo(spaceName: string, url: string): Promise<void> {
  await egoSession(spaceName, [
    `await openOrReuseTab(${jsString(url)}, { wait: true, timeout: 45 })`,
    `await waitForNetworkIdle({ timeout: 15 }).catch(() => {})`,
    `await wait(0.8)`,
    `const __result = { ok: true }`,
  ]);
}

async function waitInEgo(spaceName: string, timeoutMs: number): Promise<void> {
  const seconds = Math.max(0.1, timeoutMs / 1000);
  await egoSession(spaceName, [`await wait(${seconds})`, `const __result = { ok: true }`]);
}

function rolesForAction(action: SemanticAction): string[] | undefined {
  // 注意：ego lite 的 role 词表与 ARIA 不完全一致（链接是 anchor 而非 link，图片是 image）
  if (action.type === 'click') {
    return [
      'button', 'anchor', 'link', 'menuitem', 'menuitemcheckbox', 'menuitemradio',
      'tab', 'checkbox', 'radio', 'option', 'switch', 'list_item', 'listitem',
      'table_cell', 'cell', 'image', 'heading', 'container',
    ];
  }
  if (action.type === 'fill') return ['textbox', 'searchbox', 'input', 'text', 'combobox'];
  if (action.type === 'select') return ['combobox', 'listbox', 'select', 'option', 'button', 'textbox'];
  return undefined;
}

function descriptionOf(action: SemanticAction): string {
  if ('description' in action && action.description) return action.description;
  if (action.type === 'act') return action.instruction;
  if (action.type === 'screenshot') return action.label || 'screenshot';
  return action.type;
}

async function resolveOpsForAction(
  action: SemanticAction,
  snapshot: string,
  constraints?: string[],
): Promise<EgoResolvedOp[]> {
  if (action.type !== 'click' && action.type !== 'fill' && action.type !== 'select') {
    throw new Error(`无法解析动作: ${action.type}`);
  }

  const nodes = parseSnapshotText(snapshot);
  const desc = descriptionOf(action);
  const candidates = findCandidates(nodes, desc, { roles: rolesForAction(action) });

  if (candidates.length === 1) {
    const ref = candidates[0].ref;
    if (action.type === 'click') return [{ type: 'click', ref, label: desc }];
    if (action.type === 'fill') return [{ type: 'fill', ref, value: action.value, label: desc }];
    return [{ type: 'select', ref, value: action.value, label: desc }];
  }

  if (candidates.length > 1 && candidates[0].name.toLowerCase() === desc.toLowerCase()) {
    const exact = candidates.filter((c) => c.name.toLowerCase() === desc.toLowerCase());
    if (exact.length === 1) {
      const ref = exact[0].ref;
      if (action.type === 'click') return [{ type: 'click', ref, label: desc }];
      if (action.type === 'fill') return [{ type: 'fill', ref, value: action.value, label: desc }];
      return [{ type: 'select', ref, value: action.value, label: desc }];
    }
  }

  const resolved = await completeJson<{ ops?: EgoResolvedOp[] }>(
    buildResolveOpsPrompt({
      action,
      snapshotSummary: summarizeSnapshot(
        `${formatNodesForPrompt(nodes)}\n\n${snapshot}`,
      ),
      candidates,
      constraints,
    }),
    { system: buildResolveOpsSystemPrompt(), temperature: 0.1, maxTokens: 2000 },
  );

  const ops = Array.isArray(resolved.ops) ? resolved.ops : [];
  const validRefs = new Set(nodes.map((n) => n.ref));
  const filtered = ops.filter((op) => {
    if (op.type === 'wait') return typeof op.seconds === 'number';
    return typeof op.ref === 'number' && validRefs.has(op.ref);
  });
  if (filtered.length === 0) {
    throw new Error(`无法在 Snapshot 中定位: ${desc}`);
  }
  return filtered;
}

async function healDescription(
  step: SemanticStep,
  error: string,
  url: string,
  snapshot: string,
  constraints?: string[],
): Promise<{ shouldSkip?: boolean; correctedDescription?: string; correctedValue?: string } | null> {
  if (step.action.type === 'assert' || step.action.type === 'goto') return null;
  try {
    return await completeJson(
      buildHealFromSnapshotPrompt({
        stepId: step.id,
        action: step.action,
        error,
        url,
        snapshotSummary: summarizeSnapshot(snapshot),
        constraints,
      }),
      { system: buildHealFromSnapshotSystemPrompt(), temperature: 0.1, maxTokens: 1500 },
    );
  } catch {
    return null;
  }
}

export async function executeIntentEgo(
  plan: SemanticTestPlan,
  options: IntentEgoRunOptions = {},
): Promise<AiTestRunResult> {
  const env = options.env || plan.env || 'stage';
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const outputDir = options.outputDir
    ? path.resolve(options.outputDir)
    : path.resolve('results', 'intent-runs', `${stamp}-${sanitizeName(plan.name)}`);
  fs.mkdirSync(outputDir, { recursive: true });

  const shotDir = path.resolve(intentScreenshotDir(env, plan.name, stamp));
  fs.mkdirSync(shotDir, { recursive: true });

  const spaceName = options.spaceName || `intent:${sanitizeName(plan.name)}`;
  const startedAt = new Date().toISOString();
  const steps: AiTestStepResult[] = [];
  let passed = true;
  let fatal: string | undefined;

  const entry =
    resolveUrl(env, plan.entry) ||
    (plan.steps[0]?.action.type === 'goto'
      ? resolveUrl(env, plan.steps[0].action.url || plan.steps[0].action.path)
      : undefined);

  try {
    if (entry) {
      await openEntry(spaceName, entry);
    } else {
      await egoSession(spaceName, [
        `await ensureRealTab()`,
        `const info = await pageInfo()`,
        `const __result = { url: info && info.url }`,
      ]);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const finishedAt = new Date().toISOString();
    const result: AiTestRunResult = {
      passed: false,
      outputDir,
      startedAt,
      finishedAt,
      steps: [],
      error: message,
    };
    fs.writeFileSync(path.join(outputDir, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
    return result;
  }

  for (let index = 0; index < plan.steps.length; index++) {
    const step = plan.steps[index];
    const maxAttempts = 1 + Math.max(0, step.retries ?? 0) + (options.heal ? 1 : 0);
    let attempt = 0;
    let stepPassed = false;
    let healed = false;
    let errorMessage: string | undefined;
    let screenshotPath: string | undefined;
    let workingStep = step;

    while (attempt < maxAttempts && !stepPassed) {
      attempt += 1;
      try {
        const action = workingStep.action;

        if (action.type === 'goto') {
          const url = resolveUrl(env, action.url || action.path);
          if (url) await gotoInEgo(spaceName, url);
        } else if (action.type === 'wait') {
          await waitInEgo(spaceName, action.timeoutMs ?? 1000);
        } else if (action.type === 'screenshot') {
          /* evidence below */
        } else if (action.type === 'assert') {
          const { snapshot, url } = await takeSnapshot(spaceName);
          const spec = normalizeAssertAction(action);
          const result = evaluateStructuredAssert({ ...spec, snapshot, url });
          if (!result.ok) {
            throw new Error(`断言失败: ${result.detail}`);
          }
        } else if (action.type === 'act') {
          throw new Error(`act 动作已不支持，请改用 click/fill/select/assert: ${action.instruction}`);
        } else if (action.type === 'click' || action.type === 'fill' || action.type === 'select') {
          const { snapshot } = await takeSnapshot(spaceName);
          const ops = await resolveOpsForAction(action, snapshot, options.constraints);
          await runOps(spaceName, ops);
        } else {
          throw new Error(`未知动作: ${(action as { type: string }).type}`);
        }

        const needsShot =
          workingStep.evidence?.includes('screenshot') || workingStep.action.type === 'screenshot';
        if (needsShot) {
          const b64 = await captureShotBase64(spaceName);
          const dest = path.join(shotDir, stepShotName(index, workingStep));
          screenshotPath = writePng(b64, dest);
          if (screenshotPath) {
            const copy = path.join(outputDir, path.basename(dest));
            fs.copyFileSync(screenshotPath, copy);
          }
        }

        stepPassed = true;
      } catch (err) {
        errorMessage = err instanceof Error ? err.message : String(err);
        const canHeal =
          Boolean(options.heal) &&
          workingStep.action.type !== 'goto' &&
          workingStep.action.type !== 'assert' &&
          attempt < maxAttempts;

        if (canHeal) {
          try {
            const { snapshot, url } = await takeSnapshot(spaceName);
            const heal = await healDescription(
              workingStep,
              errorMessage,
              url,
              snapshot,
              options.constraints,
            );
            if (heal?.shouldSkip && workingStep.optional) {
              stepPassed = true;
              errorMessage = undefined;
              break;
            }
            if (heal?.correctedDescription && 'description' in workingStep.action) {
              const nextAction = { ...workingStep.action, description: heal.correctedDescription } as SemanticAction;
              if (
                (nextAction.type === 'fill' || nextAction.type === 'select') &&
                heal.correctedValue
              ) {
                (nextAction as { value: string }).value = heal.correctedValue;
              }
              workingStep = { ...workingStep, action: nextAction };
              healed = true;
              continue;
            }
          } catch {
            /* ignore heal errors */
          }
        }

        if (workingStep.optional && workingStep.action.type !== 'assert') {
          stepPassed = true;
          break;
        }
      }
    }

    if (!stepPassed) passed = false;

    steps.push({
      id: step.id,
      action: step.action,
      passed: stepPassed,
      optional: Boolean(step.optional),
      skipped: Boolean(step.optional && !stepPassed && errorMessage),
      attempts: attempt,
      healed,
      error: stepPassed ? undefined : errorMessage,
      screenshot: screenshotPath,
    });

    if (!stepPassed && !step.optional) {
      fatal = errorMessage;
      break;
    }
  }

  if (!options.keepTab) {
    try {
      await egoSession(spaceName, [
        `await completeTaskSpace(task.id, { keep: false })`,
        `const __result = { ok: true }`,
      ]);
    } catch {
      /* ignore cleanup */
    }
  }

  const finishedAt = new Date().toISOString();
  const result: AiTestRunResult = {
    passed,
    outputDir,
    startedAt,
    finishedAt,
    steps,
    error: fatal,
  };

  fs.writeFileSync(
    path.join(outputDir, 'result.json'),
    `${JSON.stringify({ ...result, engine: 'ego', screenshotDir: shotDir, spaceName }, null, 2)}\n`,
  );
  fs.writeFileSync(
    path.join(outputDir, 'screenshots-path.txt'),
    `${path.relative(process.cwd(), shotDir)}\n`,
  );

  return result;
}
