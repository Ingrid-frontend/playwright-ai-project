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
  filterCheckItemsBySnapshot,
  resolveSnapshotContext,
  type StructureCheckItem,
} from './ui-regression-config.js';
import { scaleBbox } from '../../src/utils/dom-fingerprint.js';
import type { UiIssue, UiIssueCompareKind, UiIssueSeverity } from './ui-issues.js';

export interface SectionMeta {
  key: string;
  structureHash: string;
  textHash: string;
  nodeCount: number;
  childTags: string;
}

export interface TextSectionMeta {
  key: string;
  text: string;
  textHash: string;
  charCount: number;
}

export interface StepMeta {
  capturedAt?: string;
  /** 截图时的页面地址（sidecar 实际已写入，供 AI 审计等下游消费） */
  url?: string;
  /** 截图时的页面标题 */
  title?: string;
  viewport?: { name: string; width: number; height: number };
  /** 实际截图像素尺寸，viewport 缺失时用于换算基线 bbox */
  imageWidth?: number;
  imageHeight?: number;
  layout?: { horizontalOverflow?: boolean; scrollWidth?: number; innerWidth?: number };
  domHash?: string;
  sections?: SectionMeta[];
  textSections?: TextSectionMeta[];
  snapshotName?: string;
  state?: string;
  styleFingerprint?: Record<string, Record<string, string>>;
  selectors?: Record<
    string,
    {
      exists: boolean;
      bbox?: { x: number; y: number; width: number; height: number };
      domHash?: string;
      structureHash?: string;
      textHash?: string;
      resolvedBy?: string;
      fingerprint?: StructureCheckItem['fingerprint'];
    }
  >;
  consoleErrors?: string[];
  pageErrors?: string[];
}

export interface StructureFinding {
  type:
    | 'missing-selector'
    | 'bbox-drift'
    | 'dom-drift'
    | 'selector-drift'
    | 'content-update'
    | 'horizontal-overflow'
    | 'page-error';
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

function scaledBaseBbox(
  item: StructureCheckItem,
  base: { bbox: { x: number; y: number; width: number; height: number }; fingerprint?: StructureCheckItem['fingerprint'] },
  current: StepMeta,
  baseline: StepMeta | null,
): { x: number; y: number; width: number; height: number } {
  const fp = base.fingerprint || item.fingerprint;
  if (!fp?.baselinePageWidth || !fp.baselinePageHeight) return base.bbox;
  const curW = current.viewport?.width || current.imageWidth || fp.baselinePageWidth;
  const curH = current.viewport?.height || current.imageHeight || fp.baselinePageHeight;
  return scaleBbox(fp.baselineRect, fp.baselinePageWidth, fp.baselinePageHeight, curW, curH);
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
  if (cur === undefined) return findings;
  const base = baseline?.selectors?.[item.key];

  if (!cur.exists) {
    if (item.required === true) {
      findings.push({
        type: 'missing-selector',
        key: item.key,
        severity: 'blocker',
        message: `选择器缺失: ${item.selector}`,
      });
    } else {
      findings.push({
        type: 'missing-selector',
        key: item.key,
        severity: 'warning',
        message: `可选选择器缺失: ${item.selector}`,
      });
    }
    return findings;
  }

  if (cur.resolvedBy && cur.resolvedBy !== 'selector') {
    findings.push({
      type: 'selector-drift',
      key: item.key,
      severity: 'warning',
      message: `主选择器失效，已由 ${cur.resolvedBy} 兜底定位: ${item.key}`,
    });
  }

  if (!base?.exists || !cur.bbox || !base.bbox) return findings;

  const cfg = loadUiRegressionConfig().structureChecks;
  const curHash = cur.structureHash || cur.domHash;
  const baseHash = base.structureHash || base.domHash;
  if (cfg?.checkDomHash && curHash && baseHash && curHash !== baseHash) {
    findings.push({
      type: 'dom-drift',
      key: item.key,
      severity: 'warning',
      message: `DOM 结构变化 ${item.key}`,
    });
  }

  const baseBbox = scaledBaseBbox(
    item,
    { bbox: base.bbox, fingerprint: base.fingerprint },
    current,
    baseline,
  );
  const drift = bboxDrift(cur.bbox, baseBbox);
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

function checkSections(current: StepMeta, baseline: StepMeta | null): StructureFinding[] {
  const findings: StructureFinding[] = [];
  if (!current.sections?.length || !baseline?.sections?.length) return findings;
  const cfg = loadUiRegressionConfig().changeDetection;
  if (!cfg?.enabled) return findings;

  const watchByKey = new Map(
    (cfg.sections || []).map((s) => [s.key, s.watch?.length ? s.watch : (['structure', 'text'] as Array<'structure' | 'text' | 'style'>)]),
  );
  const onlyConfigured = Boolean(cfg.sections?.length);
  const baseMap = new Map(baseline.sections.map((s) => [s.key, s]));
  for (const cur of current.sections) {
    if (onlyConfigured && !watchByKey.has(cur.key)) continue;
    const base = baseMap.get(cur.key);
    if (!base) continue;
    const watch = watchByKey.get(cur.key) || (['structure', 'text'] as Array<'structure' | 'text' | 'style'>);
    const watchStructure = watch.includes('structure');
    const watchText = watch.includes('text');
    const structureSame = cur.structureHash === base.structureHash;
    const textSame = cur.textHash === base.textHash;
    if (watchText && structureSame && !textSame) {
      findings.push({
        type: 'content-update',
        key: cur.key,
        severity:
          cfg.severity.contentOnly === 'blocker'
            ? 'blocker'
            : cfg.severity.contentOnly === 'warning'
              ? 'warning'
              : 'info',
        message: `内容更新 ${cur.key}（结构未变）`,
      });
    } else if (watchStructure && !structureSame) {
      findings.push({
        type: 'dom-drift',
        key: cur.key,
        severity: cfg.severity.structureOnly === 'blocker' ? 'blocker' : 'warning',
        message: `分区结构变化 ${cur.key}`,
      });
    }
  }
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
  const stepName = opts.stepFileName.replace(/\.png$/i, '').replace(/^step-\d+-/, '');
  const snap = resolveSnapshotContext(opts.currentMeta, stepName);
  const items = filterCheckItemsBySnapshot(resolveStructureCheckItems(opts.scriptKey), snap);
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

  findings.push(...checkSections(opts.currentMeta, opts.baselineMeta ?? null));

  if (
    cfg.checkDomHash &&
    opts.baselineMeta?.domHash &&
    opts.currentMeta.domHash &&
    opts.currentMeta.domHash !== opts.baselineMeta.domHash &&
    !opts.currentMeta.sections?.length
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
        : finding.type === 'content-update'
          ? 0.005
          : finding.type === 'selector-drift'
            ? 0.015
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
