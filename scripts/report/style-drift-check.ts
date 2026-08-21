import fs from 'fs';
import path from 'path';
import { compareStyleProps, type StyleFingerprint } from '../../src/utils/style-fingerprint.js';
import {
  getGoldenBySnapshot,
  getGoldenScreenshotPath,
  stepFileNameFromScreenshot,
} from './baseline-manager.js';
import {
  loadUiRegressionConfig,
  resolveStyleCheckItems,
  filterCheckItemsBySnapshot,
  resolveSnapshotContext,
  type StyleCheckItem,
} from './ui-regression-config.js';
import type { StepMeta } from './structure-check.js';
import type { UiIssue, UiIssueSeverity } from './ui-issues.js';

export interface StyleDriftFinding {
  key: string;
  label: string;
  prop: string;
  from: string;
  to: string;
  severity: UiIssueSeverity;
  message: string;
  missing?: boolean;
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

function itemLabel(item: StyleCheckItem): string {
  return item.label || item.key;
}

export function compareStyleFingerprints(
  current: StyleFingerprint,
  baseline: StyleFingerprint,
  items: StyleCheckItem[],
): StyleDriftFinding[] {
  const cfg = loadUiRegressionConfig().styleChecks;
  if (!cfg?.enabled) return [];
  const tolerance = cfg.tolerance || {};
  const findings: StyleDriftFinding[] = [];

  for (const item of items) {
    const cur = current[item.key];
    const base = baseline[item.key];
    const label = itemLabel(item);

    if (!cur || cur.__missing === '1') {
      // 基线同样缺失时不是衰退，只是检查项在页面上从未命中
      if (item.required === true && base && base.__missing !== '1') {
        findings.push({
          key: item.key,
          label,
          prop: '*',
          from: '存在',
          to: '缺失',
          severity: 'blocker',
          message: `${label} 选择器缺失: ${item.selector}`,
          missing: true,
        });
      }
      continue;
    }
    if (!base || base.__missing === '1') continue;

    const diffs = compareStyleProps(base, cur, tolerance);
    for (const d of diffs) {
      findings.push({
        key: item.key,
        label,
        prop: d.prop,
        from: d.from,
        to: d.to,
        severity: 'blocker',
        message: `${label} ${d.prop} ${d.from} → ${d.to}`,
      });
    }
  }
  return findings;
}

export function styleDriftFindingToUiIssue(
  finding: StyleDriftFinding,
  ctx: {
    scriptKey: string;
    stepNumber: number;
    stepName: string;
    browser: string;
    pngPath: string;
    snapshotName?: string;
    state?: string;
    hasGolden: boolean;
  },
): UiIssue {
  return {
    issueId: `${ctx.scriptKey}|${ctx.stepNumber}|${ctx.stepName}|${ctx.browser}|style-drift|${finding.key}|${finding.prop}`,
    scriptKey: ctx.scriptKey,
    stepNumber: ctx.stepNumber,
    stepName: ctx.stepName,
    browser: ctx.browser,
    compareKind: 'style-drift',
    difference: finding.missing ? 1 : 0.05,
    severity: finding.severity,
    baselinePath: '',
    currentPath: path.relative('results', ctx.pngPath).replaceAll(path.sep, '/'),
    isNewRegression: ctx.hasGolden,
    structureType: 'style-drift',
    detail: finding.message,
    snapshotName: ctx.snapshotName,
    state: ctx.state,
    stepFileName: stepFileNameFromScreenshot(ctx.pngPath),
  };
}

export interface StyleDriftScreenshotLite {
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

export function collectStyleDriftUiIssues(
  scriptKey: string,
  shots: StyleDriftScreenshotLite[],
): UiIssue[] {
  const cfg = loadUiRegressionConfig().styleChecks;
  if (!cfg?.enabled) return [];

  const items = resolveStyleCheckItems(scriptKey);
  if (!items.length) return [];

  const latestByStep = new Map<string, StyleDriftScreenshotLite>();
  for (const s of shots) {
    const groupKey = `${s.browser || 'chrome'}|${stepFileNameFromScreenshot(s.path)}`;
    const prev = latestByStep.get(groupKey);
    if (!prev || s.timestamp >= prev.timestamp) latestByStep.set(groupKey, s);
  }

  const issues: UiIssue[] = [];
  for (const s of latestByStep.values()) {
    const stepFileName = stepFileNameFromScreenshot(s.path);
    const parsed = parseStepFromFile(stepFileName);
    if (!parsed) continue;

    const currentMeta = readMeta(metaPathForPng(s.path));
    if (!currentMeta?.styleFingerprint) continue;

    const browser = s.browser || 'chrome';
    const snap = resolveSnapshotContext(currentMeta, parsed.stepName);
    const scopedItems = filterCheckItemsBySnapshot(items, snap);
    if (!scopedItems.length) continue;

    let baselineMeta: StepMeta | null = null;
    let hasGolden = false;

    if (snap.snapshotName) {
      const hit = getGoldenBySnapshot(scriptKey, browser, snap.snapshotName, snap.state || 'normal');
      if (hit) {
        baselineMeta = readMeta(hit.metaPath);
        hasGolden = true;
      }
    }
    if (!baselineMeta) {
      const legacyPng = getGoldenScreenshotPath(scriptKey, browser, stepFileName);
      if (legacyPng) {
        baselineMeta = readMeta(metaPathForPng(legacyPng));
        hasGolden = !!baselineMeta?.styleFingerprint;
      }
    }
    if (!baselineMeta?.styleFingerprint) continue;

    const findings = compareStyleFingerprints(
      currentMeta.styleFingerprint as StyleFingerprint,
      baselineMeta.styleFingerprint as StyleFingerprint,
      scopedItems,
    );

    for (const f of findings) {
      issues.push(
        styleDriftFindingToUiIssue(f, {
          scriptKey,
          stepNumber: parsed.stepNumber,
          stepName: parsed.stepName,
          browser,
          pngPath: s.path,
          snapshotName: snap.snapshotName,
          state: snap.state,
          hasGolden,
        }),
      );
    }
  }
  return issues;
}
