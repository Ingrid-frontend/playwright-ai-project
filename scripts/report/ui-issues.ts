import fs from 'fs';
import path from 'path';
import type { ImageComparison } from './image-diff.js';
import { loadUiRegressionConfig } from './ui-regression-config.js';
import type { PlainLanguageAnalysis } from './ui-issues-analysis.js';

export type UiIssueCompareKind = 'golden' | 'last-green' | 'cross-browser' | 'run-drift';
export type UiIssueSeverity = 'blocker' | 'warning' | 'noise';

const SEVERITY_ORDER: Record<UiIssueSeverity, number> = {
  blocker: 3,
  warning: 2,
  noise: 1,
};

function worstSeverity(a: UiIssueSeverity, b: UiIssueSeverity): UiIssueSeverity {
  return SEVERITY_ORDER[a] >= SEVERITY_ORDER[b] ? a : b;
}

export interface UiIssue {
  issueId: string;
  scriptKey: string;
  stepNumber: number;
  stepName: string;
  browser: string;
  compareKind: UiIssueCompareKind;
  difference: number;
  severity: UiIssueSeverity;
  baselinePath: string;
  currentPath: string;
  diffImagePath?: string;
  sizeMismatch?: boolean;
  route?: string;
  pairLabel?: string;
  isNewRegression?: boolean;
}

export interface UiIssuesReport {
  generatedAt: string;
  summary: {
    total: number;
    blocker: number;
    warning: number;
    noise: number;
    byCompareKind: Record<string, number>;
    byRoute?: Record<string, number>;
  };
  issues: UiIssue[];
  /** 规则化中文摘要（合并重复行） */
  plainLanguageAnalysis?: PlainLanguageAnalysis;
}

function severityForDifference(
  difference: number,
  compareKind: UiIssueCompareKind,
): UiIssueSeverity {
  const cfg = loadUiRegressionConfig();
  const ratios =
    compareKind === 'cross-browser'
      ? { blocker: cfg.crossBrowser.blockerRatio, warning: cfg.crossBrowser.warningRatio }
      : { blocker: cfg.blockerRatio, warning: cfg.warningRatio };

  let severity: UiIssueSeverity = 'noise';
  if (difference >= ratios.blocker) severity = 'blocker';
  else if (difference >= ratios.warning) severity = 'warning';
  else if (difference > 0) severity = 'noise';

  // 跨浏览器差异多为渲染/抗锯齿噪声，不参与 gate；展示上最高 warning
  if (compareKind === 'cross-browser' && severity === 'blocker') {
    severity = 'warning';
  }
  return severity;
}

/** 问题明细 Tab 合并行（同日多次运行等同一步骤时去重） */
export interface MergedDisplayIssue {
  scriptKey: string;
  stepNumber: number;
  stepName: string;
  browser: string;
  compareKind: UiIssueCompareKind;
  difference: number;
  severity: UiIssueSeverity;
  diffImagePath?: string;
  rawCount: number;
}

function displayMergeKey(issue: UiIssue): string {
  return `${issue.scriptKey}|${issue.stepNumber}|${issue.stepName}|${issue.compareKind}|${issue.browser}`;
}

export function mergeIssuesForDisplay(issues: UiIssue[]): MergedDisplayIssue[] {
  const groups = new Map<string, UiIssue[]>();
  for (const issue of issues) {
    const key = displayMergeKey(issue);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(issue);
  }

  const merged: MergedDisplayIssue[] = [];
  for (const group of groups.values()) {
    const first = group[0];
    let maxDifference = 0;
    let severity: UiIssueSeverity = 'noise';
    let diffImagePath: string | undefined;

    for (const i of group) {
      if (i.difference > maxDifference) {
        maxDifference = i.difference;
        diffImagePath = i.diffImagePath;
      }
      severity = worstSeverity(severity, i.severity);
    }

    merged.push({
      scriptKey: first.scriptKey,
      stepNumber: first.stepNumber,
      stepName: first.stepName,
      browser: first.browser,
      compareKind: first.compareKind,
      difference: maxDifference,
      severity,
      diffImagePath,
      rawCount: group.length,
    });
  }

  return merged.sort((a, b) => b.difference - a.difference);
}

function mapCompareKind(kind?: ImageComparison['compareKind']): UiIssueCompareKind {
  if (kind === 'golden') return 'golden';
  if (kind === 'last-green') return 'last-green';
  if (kind === 'cross-browser') return 'cross-browser';
  return 'run-drift';
}

export function comparisonToUiIssue(
  comp: ImageComparison,
  ctx: {
    scriptKey: string;
    stepNumber: number;
    stepName: string;
    browser: string;
    route?: string;
  },
): UiIssue | null {
  if (!(comp.difference > 0)) return null;

  const compareKind = mapCompareKind(comp.compareKind);
  const severity = severityForDifference(comp.difference, compareKind);

  const cfg = loadUiRegressionConfig();
  if (severity === 'noise' && comp.difference < cfg.diffOnlyTabMinRatio) {
    return null;
  }

  return {
    issueId: `${ctx.scriptKey}|${ctx.stepNumber}|${ctx.stepName}|${ctx.browser}|${compareKind}|${comp.image2Path}`,
    scriptKey: ctx.scriptKey,
    stepNumber: ctx.stepNumber,
    stepName: ctx.stepName,
    browser: ctx.browser,
    compareKind,
    difference: comp.difference,
    severity,
    baselinePath: comp.image1Path,
    currentPath: comp.image2Path,
    diffImagePath: comp.diffImagePath,
    sizeMismatch: comp.sizeMismatch,
    route: ctx.route,
    pairLabel: comp.pairLabel,
    isNewRegression: compareKind === 'golden' || compareKind === 'last-green',
  };
}

export function buildUiIssuesReport(issues: UiIssue[]): UiIssuesReport {
  const byCompareKind: Record<string, number> = {};
  const byRoute: Record<string, number> = {};
  let blocker = 0;
  let warning = 0;
  let noise = 0;

  for (const issue of issues) {
    byCompareKind[issue.compareKind] = (byCompareKind[issue.compareKind] || 0) + 1;
    if (issue.route) {
      byRoute[issue.route] = (byRoute[issue.route] || 0) + 1;
    }
    if (issue.severity === 'blocker') blocker++;
    else if (issue.severity === 'warning') warning++;
    else noise++;
  }

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      total: issues.length,
      blocker,
      warning,
      noise,
      byCompareKind,
      byRoute: Object.keys(byRoute).length > 0 ? byRoute : undefined,
    },
    issues: issues.sort((a, b) => b.difference - a.difference),
  };
}

export function writeUiIssuesReport(report: UiIssuesReport, outPath = 'results/ui-issues.json'): void {
  const dir = path.dirname(outPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf-8');
}

export function gateShouldFail(report: UiIssuesReport): boolean {
  const cfg = loadUiRegressionConfig();
  const goldenBlockers = report.issues.filter(
    (i) => i.severity === 'blocker' && (i.compareKind === 'golden' || i.compareKind === 'last-green'),
  ).length;
  const crossBlockers = report.issues.filter(
    (i) => i.severity === 'blocker' && i.compareKind === 'cross-browser',
  ).length;

  if (goldenBlockers > 0) return true;
  if (cfg.crossBrowser.countAsBlockerInGate && crossBlockers > 0) return true;
  return false;
}
