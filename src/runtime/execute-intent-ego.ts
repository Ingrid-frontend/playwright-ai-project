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
import {
  resolveScreenshotViewport,
  resolveMaskSelectors,
  registerRuntimeStyleChecks,
  clearRuntimeStyleChecks,
} from '../../scripts/report/ui-regression-config.js';
import {
  resolveDiagnosticsPlan,
  planIsEmpty,
  buildDiagnosticsExpression,
  parseDiagnostics,
  type EgoUiDiagnostics,
} from './ego-ui-diagnostics.js';
import { EGO_RESULT_PREFIX, runEgoJson, EgoUnavailableError, EgoUserControllingError } from '../utils/ego-browser.js';
import {
  extractVisibleTexts,
  findCandidates,
  formatNodesForPrompt,
  isListActionProbe,
  parseSnapshotText,
  pickVisibleListAction,
  summarizeSnapshot,
} from './ego-snapshot.js';
import { framesFromStepScreenshots, writeFlowReplay } from './flow-replay.js';
import { writeFailureBundle, type HealLogEntry } from './failure-bundle.js';
import { writeHealSuggestArtifacts } from './heal-suggest.js';
import {
  isApprovalFlowAdminPage,
  isEArchiveModulePage,
  isHomePath,
  isHuilianyiEnv,
  isApplicantSearchFill,
  isListFilterSearchClick,
  isMenuSearchFill,
  isMenuSearchResultClick,
  navClickKind,
  normalizeHuilianyiEntryPath,
  assertWrongPageForListOps,
  extractMenuSearchLabel,
  pickApplicantSearchInput,
  pickListFilterSearch,
  pickMenuSearchResult,
  pickWorkbenchTopNav,
  resolveNavClickOps,
  verifyNavClickOutcome,
  WORKBENCH_HOME_PATH,
} from './ego-nav-guard.js';
import { evaluateStructuredAssert, formatMissingAssertDetail, normalizeAssertAction, shouldSkipUnobservedAssert } from './assert-eval.js';
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
  return path.join('screenshots', 'intent', env, sanitizeName(planName), 'run-chromium-optimized', stamp);
}

/** 与 scriptKeyFromScreenshotPath 解析出的键保持一致，用于查 mask/ignoreRegions 配置 */
function intentScriptKey(env: string, planName: string): string {
  return `intent/${env}/${sanitizeName(planName)}`;
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
    ...buildForceGotoLines(url),
    `const info = await pageInfo()`,
    `const __result = { url: info.url, title: info.title }`,
  ]);
}

function buildForceGotoLines(url: string): string[] {
  return [
    `await openOrReuseTab(${jsString(url)}, { wait: true, timeout: 45 })`,
    `await gotoAndWait(${jsString(url)}, { timeout: 45 }).catch(() => {})`,
    `await waitForNetworkIdle({ timeout: 15 }).catch(() => {})`,
    `await wait(1)`,
  ];
}

async function takeSnapshot(
  spaceName: string,
): Promise<{ snapshot: string; url: string; frameTexts: string[] }> {
  return egoSession(spaceName, [
    `const snap = await snapshotText()`,
    `const info = await pageInfo()`,
    `const frameTexts = []`,
    `try {`,
    `  const tree = await cdp('Page.getFrameTree')`,
    `  const frameIds = []`,
    `  const walk = (node) => { if (!node || !node.frame) return; frameIds.push(node.frame.id); (node.childFrames || []).forEach(walk) }`,
    `  if (tree && tree.frameTree) walk(tree.frameTree)`,
    `  for (const frameId of frameIds) {`,
    `    try {`,
    `      const world = await cdp('Page.createIsolatedWorld', { frameId, worldName: 'ego-assert-text' })`,
    `      const evaluated = await cdp('Runtime.evaluate', {`,
    `        expression: "(() => (document.body && document.body.innerText || '').replace(/\\\\s+/g, ' ').trim().slice(0, 8000))()",`,
    `        contextId: world.executionContextId,`,
    `        returnByValue: true,`,
    `        awaitPromise: false,`,
    `      })`,
    `      const text = evaluated && evaluated.result && evaluated.result.value`,
    `      if (text) frameTexts.push(String(text))`,
    `    } catch {}`,
    `  }`,
    `} catch {}`,
    `const __result = { snapshot: String(snap || ''), url: info.url || '', frameTexts }`,
  ]);
}

async function assertInEgo(
  spaceName: string,
  action: Extract<SemanticAction, { type: 'assert' }>,
  nextAction?: SemanticAction,
): Promise<'ok' | 'skipped'> {
  const spec = normalizeAssertAction(action);
  if (spec.kind === 'url') {
    const { url } = await takeSnapshot(spaceName);
    const result = evaluateStructuredAssert({ ...spec, url });
    if (!result.ok) throw new Error(`断言失败: ${result.detail}`);
    return 'ok';
  }

  const first = await takeSnapshot(spaceName);
  const firstResult = evaluateStructuredAssert({ ...spec, ...first });
  if (firstResult.ok) return 'ok';
  if (shouldSkipUnobservedAssert(spec.expect, nextAction)) {
    const hint = formatMissingAssertDetail(spec.expect, first.snapshot);
    console.log(
      `⚠️ 页面未见「${spec.expect}」，已跳过臆造断言（后续 click 将按 Snapshot 定位真实按钮）。${hint}`,
    );
    return 'skipped';
  }

  const deadline = Date.now() + 8_000;
  let lastDetail = firstResult.detail;
  while (Date.now() <= deadline) {
    await waitInEgo(spaceName, 700);
    const { snapshot, url, frameTexts } = await takeSnapshot(spaceName);
    const result = evaluateStructuredAssert({ ...spec, snapshot, url, frameTexts });
    if (result.ok) return 'ok';
    lastDetail = result.detail;
  }
  throw new Error(`断言失败: ${lastDetail}`);
}

async function captureShotWithPage(
  spaceName: string,
  scriptKey?: string,
  snapshot?: { snapshotName?: string; state?: string },
): Promise<{
  data?: string;
  url: string;
  title?: string;
  snapshot: string;
  masked?: number;
  diagnostics?: EgoUiDiagnostics;
}> {
  const vp = resolveScreenshotViewport();
  const maskSelectors = scriptKey ? resolveMaskSelectors(scriptKey) : [];
  const plan = resolveDiagnosticsPlan(scriptKey, snapshot);
  const collectDiag = !planIsEmpty(plan);
  const raw = await egoSession<{
    data?: string;
    url: string;
    title?: string;
    snapshot: string;
    masked?: number;
    diag?: string;
  }>(spaceName, [
    // ego lite 截的是真实窗口，尺寸会随显示器/窗口变化。
    // 像素比对要求与基线尺寸严格一致，故先把设备指标钉死再截图。
    `try { await cdp('Emulation.setDeviceMetricsOverride', { width: ${vp.width}, height: ${vp.height}, deviceScaleFactor: ${vp.deviceScaleFactor}, mobile: false }) } catch {}`,
    // 视口生效后先让布局稳定，再采样式/结构指纹
    `await wait(0.4)`,
    // 结构与样式指纹必须在涂黑之前采集，否则读到的颜色全是遮罩的纯黑
    `let diag = ''`,
    ...(collectDiag
      ? [
          `try { const dev = await cdp('Runtime.evaluate', { expression: ${jsString(buildDiagnosticsExpression(plan))}, returnByValue: true }); diag = (dev && dev.result && dev.result.value) || '' } catch {}`,
        ]
      : []),
    // 与 Playwright 引擎共用同一份 maskSelectors，把业务动态区域涂黑，避免数据变化被判成 UI 衰退
    `let masked = -1`,
    ...(maskSelectors.length
      ? [
          `try { const mev = await cdp('Runtime.evaluate', { expression: ${jsString(buildMaskExpression(maskSelectors))}, returnByValue: true }); masked = mev && mev.result ? mev.result.value : -2 } catch (e) { masked = -3 }`,
          // 让涂黑样式完成一帧渲染后再截图
          `await wait(0.4)`,
        ]
      : []),
    `const shot = await cdp('Page.captureScreenshot', { format: 'png' })`,
    `try { await cdp('Emulation.clearDeviceMetricsOverride') } catch {}`,
    `let snap = ''`,
    `try { snap = await snapshotText() } catch {}`,
    `const info = await pageInfo()`,
    `const __result = { data: shot && shot.data, snapshot: String(snap || ''), url: info.url || '', title: info.title || '', masked: masked, diag: diag, viewport: { width: ${vp.width}, height: ${vp.height}, deviceScaleFactor: ${vp.deviceScaleFactor} } }`,
  ]);
  return { ...raw, diagnostics: parseDiagnostics(raw.diag) };
}

/** 生成在页面内涂黑遮罩元素的表达式，与 screenshot-capture.ts 的实现保持一致 */
function buildMaskExpression(selectors: string[]): string {
  return `(() => {
  const sels = ${JSON.stringify(selectors)};
  const styleId = 'ui-regression-mask-style';
  if (!document.getElementById(styleId)) {
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = '[data-ui-regression-mask]{background:#000!important;color:#000!important;border-color:#000!important;box-shadow:none!important}';
    document.head.appendChild(style);
  }
  let n = 0;
  for (const sel of sels) {
    try {
      document.querySelectorAll(sel).forEach((el) => { el.setAttribute('data-ui-regression-mask', '1'); n++; });
    } catch (e) {}
  }
  return n;
})()`;
}

function egoDomHash(snapshot: string): string {
  const nodes = parseSnapshotText(snapshot);
  const src =
    nodes
      .slice(0, 48)
      .map((n) => `${n.role}:${n.name}`)
      .join('|') ||
    snapshot.slice(0, 64) ||
    'intent-shot';
  let payload = Buffer.from(src).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  if (payload.length < 8) payload = `${payload}xxxxxxxx`.slice(0, 8);
  return `EGO|${Math.max(nodes.length, 1)}|${payload.slice(0, 32)}`;
}

function writeShotMeta(
  pngPath: string,
  info: {
    url?: string;
    title?: string;
    snapshot?: string;
    masked?: number;
    viewport?: { width: number; height: number; deviceScaleFactor: number };
    diagnostics?: EgoUiDiagnostics;
  },
  snapshotCtx?: { snapshotName?: string; state?: string },
): string {
  const snapshot = info.snapshot || '';
  const size = readPngSize(pngPath);
  const diag = info.diagnostics;
  const meta = {
    capturedAt: new Date().toISOString(),
    url: info.url || '',
    title: info.title || '',
    pageText: extractVisibleTexts(snapshot).join(' ').slice(0, 800),
    // 真实 DOM 指纹比可访问性树摘要更贴近结构变化，采不到时回退到 a11y 摘要
    domHash: diag?.domHash || egoDomHash(snapshot),
    viewport: info.viewport,
    imageWidth: size?.width,
    imageHeight: size?.height,
    maskedElements: info.masked,
    layout: diag?.layout,
    selectors: diag?.selectors,
    styleFingerprint: diag?.styleFingerprint,
    // 快照作用域：比对侧据此挑选适用的 structure/style 检查项
    ...(snapshotCtx?.snapshotName ? { snapshotName: snapshotCtx.snapshotName } : {}),
    ...(snapshotCtx?.state ? { state: snapshotCtx.state } : {}),
  };
  const metaPath = pngPath.replace(/\.png$/i, '.meta.json');
  fs.writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`, 'utf-8');
  return metaPath;
}

/** 直接读 PNG IHDR 取宽高，避免为一次尺寸校验引入解码依赖 */
function readPngSize(pngPath: string): { width: number; height: number } | undefined {
  try {
    const fd = fs.openSync(pngPath, 'r');
    const head = Buffer.alloc(24);
    fs.readSync(fd, head, 0, 24, 0);
    fs.closeSync(fd);
    if (head.toString('ascii', 1, 4) !== 'PNG') return undefined;
    return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) };
  } catch {
    return undefined;
  }
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
  await egoSession(spaceName, [...buildForceGotoLines(url), `const __result = { ok: true }`]);
}

async function recoverFromWrongHuilianyiPage(spaceName: string, env: string): Promise<void> {
  if (!isHuilianyiEnv(env)) return;

  let { snapshot } = await takeSnapshot(spaceName);

  for (let round = 0; round < 3; round++) {
    if (!isApprovalFlowAdminPage(snapshot) && !isEArchiveModulePage(snapshot)) return;

    const home = resolveUrl(env, WORKBENCH_HOME_PATH);
    if (home) {
      await gotoInEgo(spaceName, home);
      await waitInEgo(spaceName, 1500);
      snapshot = (await takeSnapshot(spaceName)).snapshot;
      if (!isApprovalFlowAdminPage(snapshot) && !isEArchiveModulePage(snapshot)) return;
    }

    const nav = pickWorkbenchTopNav(parseSnapshotText(snapshot));
    if (nav) {
      await runOps(spaceName, [{ type: 'click', ref: nav.ref, label: '工作台' }]);
      await waitInEgo(spaceName, 1500);
      snapshot = (await takeSnapshot(spaceName)).snapshot;
      if (!isApprovalFlowAdminPage(snapshot) && !isEArchiveModulePage(snapshot)) return;
    }
  }

  if (isEArchiveModulePage(snapshot)) {
    throw new Error(
      '入口仍在 e档案 模块，未能切回工作台。请关闭 ego Tab 或手动点顶栏「工作台」后重试',
    );
  }
  if (isApprovalFlowAdminPage(snapshot)) {
    throw new Error(
      '入口仍在系统管理审批流配置页，未能切回工作台。请关闭 ego Tab 或手动点顶栏「工作台」后重试',
    );
  }
}

async function waitInEgo(spaceName: string, timeoutMs: number): Promise<void> {
  const seconds = Math.max(0.1, timeoutMs / 1000);
  await egoSession(spaceName, [`await wait(${seconds})`, `const __result = { ok: true }`]);
}

function rolesForAction(action: SemanticAction): string[] | undefined {
  // 注意：ego lite 的 role 词表与 ARIA 不完全一致（链接是 anchor 而非 link，图片是 image）
  if (action.type === 'click') {
    return [
      'button', 'anchor', 'link', 'menu', 'menuitem', 'menuitemcheckbox', 'menuitemradio',
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
  ctx?: { menuSearchValue?: string },
): Promise<EgoResolvedOp[]> {
  if (action.type !== 'click' && action.type !== 'fill' && action.type !== 'select') {
    throw new Error(`无法解析动作: ${action.type}`);
  }

  const nodes = parseSnapshotText(snapshot);
  const desc = descriptionOf(action);
  const roles = rolesForAction(action);

  if (action.type === 'fill' && isApplicantSearchFill(desc)) {
    const wrong = assertWrongPageForListOps(snapshot);
    if (wrong) throw new Error(wrong);
    const picked = pickApplicantSearchInput(nodes);
    if (picked) {
      return [{ type: 'fill', ref: picked.ref, value: action.value, label: picked.name }];
    }
  }

  if (action.type === 'click' && isListFilterSearchClick(desc)) {
    const wrong = assertWrongPageForListOps(snapshot);
    if (wrong) throw new Error(wrong);
    const picked = pickListFilterSearch(nodes);
    if (picked) return [{ type: 'click', ref: picked.ref, label: '搜索' }];
  }

  if (action.type === 'click') {
    const searchLabel = ctx?.menuSearchValue?.trim() || extractMenuSearchLabel(desc);
    if (searchLabel) {
      const picked = pickMenuSearchResult(nodes, searchLabel);
      if (picked) {
        return [{ type: 'click', ref: picked.ref, label: picked.name || searchLabel }];
      }
    }
    if (isMenuSearchResultClick(desc) && !searchLabel) {
      const picked = pickMenuSearchResult(nodes);
      if (picked) {
        return [{ type: 'click', ref: picked.ref, label: picked.name || '我的审批' }];
      }
    }
    const kind = navClickKind(desc);
    if (kind) {
      const navOps = resolveNavClickOps(nodes, desc, kind);
      if (navOps) return navOps;
    }
  }

  if (action.type === 'click' && isListActionProbe(desc)) {
    const picked = pickVisibleListAction(nodes, desc, { roles });
    if (picked) {
      if (picked.name.trim() !== desc.trim()) {
        console.log(`页面未见「${desc}」原文，改点可见操作「${picked.name}」`);
      }
      return [{ type: 'click', ref: picked.ref, label: picked.name }];
    }
  }

  const candidates = findCandidates(nodes, desc, { roles });

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
  // 用截图路径推导出的 key，与 compare-screenshots 侧 scriptKeyFromScreenshotPath 的结果一致
  const scriptKey = intentScriptKey(env, plan.name);
  // Intent YAML 里声明的 styleChecks 需要注册到运行时，否则只有 config 里按 script 匹配的项会生效
  clearRuntimeStyleChecks();
  if (plan.styleChecks?.length) {
    registerRuntimeStyleChecks(scriptKey, plan.styleChecks);
  }

  const spaceName = options.spaceName || `intent:${sanitizeName(plan.name)}`;
  const startedAt = new Date().toISOString();
  const steps: AiTestStepResult[] = [];
  const healLogs: HealLogEntry[] = [];
  let passed = true;
  let fatal: string | undefined;

  const persistResult = (payload: Record<string, unknown>, result: AiTestRunResult): AiTestRunResult => {
    if (healLogs.length) {
      writeHealSuggestArtifacts(outputDir, healLogs, { intentPath: options.intentPath });
    }
    const failure = writeFailureBundle({
      kind: 'intent',
      outputDir,
      env,
      profile: options.profile,
      healLogs,
      intentPath: options.intentPath,
      result: {
        ...result,
        engine: 'ego',
        planName: plan.name,
        intentPath: options.intentPath,
      },
    });
    const out = {
      ...payload,
      engine: 'ego',
      screenshotDir: shotDir,
      spaceName,
      ...(failure
        ? {
            failureBundleRel: failure.bundleRel,
            failureSummaryRel: failure.summaryRel,
          }
        : {}),
      ...(healLogs.length ? { healSuggest: true } : {}),
    };
    fs.writeFileSync(path.join(outputDir, 'result.json'), `${JSON.stringify(out, null, 2)}\n`);
    fs.writeFileSync(
      path.join(outputDir, 'screenshots-path.txt'),
      `${path.relative(process.cwd(), shotDir)}\n`,
    );
    return failure
      ? { ...result, failureBundleRel: failure.bundleRel, failureSummaryRel: failure.summaryRel }
      : result;
  };

  const entryPath =
    normalizeHuilianyiEntryPath(env, plan.entry) ||
    (plan.steps[0]?.action.type === 'goto'
      ? normalizeHuilianyiEntryPath(env, plan.steps[0].action.url || plan.steps[0].action.path)
      : undefined) ||
    plan.entry;
  const entry = resolveUrl(env, entryPath);

  try {
    if (entry) {
      await openEntry(spaceName, entry);
      if (isHomePath(plan.entry)) {
        await recoverFromWrongHuilianyiPage(spaceName, env);
      }
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
    return persistResult({ ...result }, result);
  }

  let pendingMenuSearchValue: string | undefined;
  let pendingMenuSearchClick = false;

  for (let index = 0; index < plan.steps.length; index++) {
    const step = plan.steps[index];
    const maxAttempts = 1 + Math.max(0, step.retries ?? 0) + (options.heal ? 1 : 0);
    let attempt = 0;
    let stepPassed = false;
    let healed = false;
    let skipped = false;
    let errorMessage: string | undefined;
    let screenshotPath: string | undefined;
    let workingStep = step;

    while (attempt < maxAttempts && !stepPassed) {
      attempt += 1;
      try {
        const action = workingStep.action;

        if (action.type === 'goto') {
          const pathOrUrl = action.url || action.path;
          const url = resolveUrl(env, normalizeHuilianyiEntryPath(env, pathOrUrl) || pathOrUrl);
          if (url) {
            await gotoInEgo(spaceName, url);
            if (isHomePath(pathOrUrl)) {
              await recoverFromWrongHuilianyiPage(spaceName, env);
            }
          }
        } else if (action.type === 'wait') {
          await waitInEgo(spaceName, action.timeoutMs ?? 1000);
        } else if (action.type === 'screenshot') {
          /* evidence below */
        } else if (action.type === 'assert') {
          const outcome = await assertInEgo(spaceName, action, plan.steps[index + 1]?.action);
          if (outcome === 'skipped') {
            skipped = true;
            healed = true;
          }
        } else if (action.type === 'act') {
          throw new Error(`act 动作已不支持，请改用 click/fill/select/assert: ${action.instruction}`);
        } else if (action.type === 'click' || action.type === 'fill' || action.type === 'select') {
          const desc = descriptionOf(action);
          if (action.type === 'click' && (pendingMenuSearchValue || isMenuSearchResultClick(desc))) {
            await waitInEgo(spaceName, 500);
          }
          const { snapshot } = await takeSnapshot(spaceName);
          const ops = await resolveOpsForAction(action, snapshot, options.constraints, {
            menuSearchValue: pendingMenuSearchClick ? pendingMenuSearchValue : undefined,
          });
          await runOps(spaceName, ops);
          if (action.type === 'fill' && isMenuSearchFill(desc) && action.value?.trim()) {
            pendingMenuSearchValue = action.value.trim();
            pendingMenuSearchClick = true;
          }
          if (action.type === 'click') {
            const kind = navClickKind(desc);
            const menuNav = pendingMenuSearchClick || isMenuSearchResultClick(desc) || extractMenuSearchLabel(desc);
            if (kind || menuNav) {
              await waitInEgo(spaceName, 600);
              const after = await takeSnapshot(spaceName);
              const navErr = verifyNavClickOutcome(kind || 'my-approval', after.snapshot);
              if (navErr) throw new Error(navErr);
            }
            if (pendingMenuSearchClick) {
              pendingMenuSearchClick = false;
              pendingMenuSearchValue = undefined;
            }
          }
        } else {
          throw new Error(`未知动作: ${(action as { type: string }).type}`);
        }

        const needsShot =
          workingStep.evidence?.includes('screenshot') || workingStep.action.type === 'screenshot';
        if (needsShot) {
          const snapshotCtx =
            workingStep.action.type === 'screenshot'
              ? { snapshotName: workingStep.action.snapshotName, state: workingStep.action.state }
              : undefined;
          const shot = await captureShotWithPage(spaceName, scriptKey, snapshotCtx);
          const dest = path.join(shotDir, stepShotName(index, workingStep));
          screenshotPath = writePng(shot.data, dest);
          if (screenshotPath) {
            const metaPath = writeShotMeta(screenshotPath, shot, snapshotCtx);
            const copy = path.join(outputDir, path.basename(dest));
            fs.copyFileSync(screenshotPath, copy);
            fs.copyFileSync(metaPath, path.join(outputDir, path.basename(metaPath)));
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
            healLogs.push({
              stepId: step.id,
              attempt,
              engine: 'ego',
              at: new Date().toISOString(),
              error: errorMessage,
              output: heal || undefined,
            });
            if (heal?.shouldSkip && workingStep.optional) {
              healLogs[healLogs.length - 1].accepted = true;
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
              healLogs[healLogs.length - 1].accepted = true;
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
      skipped: skipped || Boolean(step.optional && !stepPassed && errorMessage),
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
  const flow = writeFlowReplay({
    outputDir,
    title: plan.name,
    frames: framesFromStepScreenshots(steps),
  });
  const result: AiTestRunResult = {
    passed,
    outputDir,
    startedAt,
    finishedAt,
    steps,
    error: fatal,
    videoRel: flow.videoRel,
    replayRel: flow.replayRel,
  };

  return persistResult(
    {
      ...result,
      engine: 'ego',
      screenshotDir: shotDir,
      spaceName,
    },
    result,
  );
}
