import fs from 'fs';
import path from 'path';
import {
  getGoldenScreenshotPath,
  getLastGreenScreenshotPath,
  stepFileNameFromScreenshot,
} from './baseline-manager.js';
import {
  loadUiRegressionConfig,
  resolveBaselineStrategy,
  resolveStructureCheckItems,
  type StructureCheckItem,
} from './ui-regression-config.js';
import type { UiIssue, UiIssueCompareKind, UiIssueSeverity } from './ui-issues.js';

export interface StepMeta {
  capturedAt?: string;
  viewport?: { name: string; width: number; height: number };
  layout?: { horizontalOverflow?: boolean; scrollWidth?: number; innerWidth?: number };
  domHash?: string;
  selectors?: Record<
    string,
    { exists: boolean; bbox?: { x: number; y: number; width: number; height: number }; domHash?: string }
  >;
  consoleErrors?: string[];
  pageErrors?: string[];
}

export interface StructureFinding {
  type: 'missing-selector' | 'bbox-drift' | 'dom-drift' | 'horizontal-overflow' | 'page-error';
  key: string;
  severity: UiIssueSeverity;
  message: string;
  baselineKind?: 'golden' | 'last-green';
  driftPx?: number;
}

function metaPathForPng(pngPath: string): string {
  return pngPath.replace(/\.png$/i, '.meta.json');
}

function readMeta(filePath: string): StepMeta | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as StepMeta;
  } catch {
    return null;
  }
}

function bboxDrift(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): number {
  return Math.max(
    Math.abs(a.x - b.x),
    Math.abs(a.y - b.y),
    Math.abs(a.width - b.width),
    Math.abs(a.height - b.height),
  );
}

function resolveBaselineMetaPath(
  scriptKey: string,
  browser: string,
  stepFileName: string,
): { path: string; kind: 'golden' | 'last-green' } | null {
  const strategy = resolveBaselineStrategy();
  const tryGolden = () => {
    const p = getGoldenScreenshotPath(scriptKey, browser, stepFileName);
    return p ? { path: metaPathForPng(p), kind: 'golden' as const } : null;
  };
  const tryLastGreen = () => {
    const p = getLastGreenScreenshotPath('screenshots', scriptKey, browser, stepFileName);
    return p ? { path: metaPathForPng(p), kind: 'last-green' as const } : null;
  };

  const order =
    strategy === 'golden'
      ? ['golden']
      : strategy === 'last-green'
        ? ['last-green']
        : ['golden', 'last-green'];

  for (const k of order) {
    const hit = k === 'golden' ? tryGolden() : tryLastGreen();
    if (hit && fs.existsSync(hit.path)) return hit;
  }
  return null;
}

function checkSelectorItem(
  item: StructureCheckItem,
  current: StepMeta,
  baseline: StepMeta | null,
  tolerance: number,
): StructureFinding[] {
  const findings: StructureFinding[] = [];
  if (!current.selectors) return findings;
  const cur = current.selectors[item.key];
  // 旧 meta 未写入该 key（配置后尚未重跑截图）→ 跳过，避免误报 missing
  if (cur === undefined) return findings;
  const base = baseline?.selectors?.[item.key];

  if (!cur.exists) {
    if (item.required !== false) {
      findings.push({
        type: 'missing-selector',
        key: item.key,
        severity: 'blocker',
        message: `选择器缺失: ${item.selector}`,
        baselineKind: baseline ? undefined : undefined,
      });
    }
    return findings;
  }

  if (!base?.exists || !cur.bbox || !base.bbox) return findings;

  const cfg = loadUiRegressionConfig().structureChecks;
  if (cfg?.checkDomHash && cur.domHash && base.domHash && cur.domHash !== base.domHash) {
    findings.push({
      type: 'dom-drift',
      key: item.key,
      severity: 'warning',
      message: `DOM 结构变化 ${item.key}`,
    });
  }

  const drift = bboxDrift(cur.bbox, base.bbox);
  if (drift <= tolerance) return findings;

  findings.push({
    type: 'bbox-drift',
    key: item.key,
    severity: drift > tolerance * 3 ? 'blocker' : 'warning',
    message: `布局偏移 ${item.key}: ${drift}px（阈值 ${tolerance}px）`,
    driftPx: drift,
  });
  return findings;
}

export function analyzeStepMeta(opts: {
  scriptKey: string;
  browser: string;
  stepFileName: string;
  currentMeta: StepMeta;
  baselineMeta?: StepMeta | null;
  baselineKind?: 'golden' | 'last-green';
}): StructureFinding[] {
  const cfg = loadUiRegressionConfig().structureChecks;
  if (!cfg?.enabled) return [];

  const findings: StructureFinding[] = [];
  const items = resolveStructureCheckItems(opts.scriptKey);
  const tolerance = cfg.bboxTolerancePx ?? 4;

  if (cfg.failOnOverflow && opts.currentMeta.layout?.horizontalOverflow) {
    findings.push({
      type: 'horizontal-overflow',
      key: 'layout',
      severity: 'warning',
      message: `横向溢出: scrollWidth ${opts.currentMeta.layout.scrollWidth} > innerWidth ${opts.currentMeta.layout.innerWidth}`,
    });
  }

  if (cfg.failOnPageError) {
    const errs = [...(opts.currentMeta.pageErrors || []), ...(opts.currentMeta.consoleErrors || [])];
    if (errs.length) {
      findings.push({
        type: 'page-error',
        key: 'console',
        severity: 'warning',
        message: `页面错误 ${errs.length} 条: ${errs[0]?.slice(0, 120)}`,
      });
    }
  }

  for (const item of items) {
    findings.push(...checkSelectorItem(item, opts.currentMeta, opts.baselineMeta ?? null, tolerance));
  }

  if (
    cfg.checkDomHash &&
    opts.baselineMeta?.domHash &&
    opts.currentMeta.domHash &&
    opts.currentMeta.domHash !== opts.baselineMeta.domHash
  ) {
    findings.push({
      type: 'dom-drift',
      key: 'page',
      severity: 'warning',
      message: '页面 DOM 指纹与基线不一致',
      baselineKind: opts.baselineKind,
    });
  }

  for (const f of findings) {
    if (opts.baselineKind && f.type === 'bbox-drift') f.baselineKind = opts.baselineKind;
    if (opts.baselineKind && f.type === 'missing-selector' && opts.baselineMeta?.selectors?.[f.key]?.exists) {
      f.baselineKind = opts.baselineKind;
    }
  }

  return findings;
}

export function structureFindingToUiIssue(
  finding: StructureFinding,
  ctx: {
    scriptKey: string;
    stepNumber: number;
    stepName: string;
    browser: string;
    pngPath: string;
    route?: string;
  },
): UiIssue {
  const compareKind: UiIssueCompareKind =
    finding.baselineKind === 'golden'
      ? 'golden'
      : finding.baselineKind === 'last-green'
        ? 'last-green'
        : 'structure';

  const difference =
    finding.type === 'missing-selector'
      ? 1
      : finding.type === 'dom-drift'
        ? 0.02
        : finding.type === 'bbox-drift' && finding.driftPx
        ? Math.min(1, finding.driftPx / 100)
        : finding.type === 'horizontal-overflow'
          ? 0.01
          : 0.005;

  return {
    issueId: `${ctx.scriptKey}|${ctx.stepNumber}|${ctx.stepName}|${ctx.browser}|structure|${finding.type}|${finding.key}`,
    scriptKey: ctx.scriptKey,
    stepNumber: ctx.stepNumber,
    stepName: ctx.stepName,
    browser: ctx.browser,
    compareKind,
    difference,
    severity: finding.severity,
    baselinePath: '',
    currentPath: path.relative('results', ctx.pngPath).replaceAll(path.sep, '/'),
    route: ctx.route,
    isNewRegression: compareKind === 'golden' || compareKind === 'last-green',
    structureType: finding.type,
    detail: finding.message,
  };
}

export interface ScreenshotLite {
  path: string;
  stepNumber: number;
  stepName: string;
  browser?: string;
  route?: string;
  timestamp: string;
}

function parseStepFromFile(name: string): { stepNumber: number; stepName: string } | null {
  const m = name.match(/step-(\d+)-(.+)\.png$/i);
  if (!m) return null;
  return { stepNumber: Number.parseInt(m[1]!, 10), stepName: m[2]! };
}

export function collectStructureUiIssues(scriptKey: string, shots: ScreenshotLite[]): UiIssue[] {
  if (!loadUiRegressionConfig().structureChecks?.enabled) return [];

  const latestByStep = new Map<string, ScreenshotLite>();
  for (const s of shots) {
    const groupKey = `${s.browser || 'chrome'}|${s.stepNumber}|${stepFileNameFromScreenshot(s.path)}`;
    const prev = latestByStep.get(groupKey);
    if (!prev || s.timestamp >= prev.timestamp) latestByStep.set(groupKey, s);
  }

  const issues: UiIssue[] = [];
  for (const s of latestByStep.values()) {
    const stepFileName = stepFileNameFromScreenshot(s.path);
    const parsed = parseStepFromFile(stepFileName);
    if (!parsed) continue;

    const currentMeta = readMeta(metaPathForPng(s.path));
    if (!currentMeta) continue;

    const browser = s.browser || 'chrome';
    const baselineHit = resolveBaselineMetaPath(scriptKey, browser, stepFileName);
    const baselineMeta = baselineHit ? readMeta(baselineHit.path) : null;

    const findings = analyzeStepMeta({
      scriptKey,
      browser,
      stepFileName,
      currentMeta,
      baselineMeta,
      baselineKind: baselineHit?.kind,
    });

    for (const f of findings) {
      issues.push(
        structureFindingToUiIssue(f, {
          scriptKey,
          stepNumber: parsed.stepNumber,
          stepName: parsed.stepName,
          browser,
          pngPath: s.path,
          route: s.route,
        }),
      );
    }
  }

  return issues;
}
