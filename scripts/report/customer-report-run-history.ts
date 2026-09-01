import type { ScreenshotInfo } from './compare-screenshots-utils.js';
import { generateTestComparisons } from './compare-screenshots-engine.js';
import { buildCoverageStats } from './coverage-stats.js';
import type { CustomerPageCard } from './customer-report-model.js';
import { buildPageCardsFromCoverage, isDiffPage } from './customer-report-model.js';
import type { ScriptRunHistoryEntry, ScriptRunHistoryPreview } from './customer-report-run-meta.js';
import { friendlyStepLabel } from './customer-report-naming.js';
import { readGoldenMatchVerdictForScriptRun, type GoldenMatchVerdict } from './prune-flow-golden-runs.js';

const DEFAULT_MAX_RUNS = 30;

function filterScreenshotsByRun(
  screenshots: Map<number, ScreenshotInfo[]>,
  runId: string,
): Map<number, ScreenshotInfo[]> {
  const out = new Map<number, ScreenshotInfo[]>();
  for (const [step, list] of screenshots) {
    const hits = list.filter((s) => s.timestamp === runId);
    if (hits.length) out.set(step, hits);
  }
  return out;
}

function verdictFromCoverage(c: ReturnType<typeof buildCoverageStats>): {
  verdict: ScriptRunHistoryEntry['verdict'];
  verdictLabel: string;
  maxDifference: number;
} {
  if (c.comparedSteps === 0) {
    return { verdict: 'uncovered', verdictLabel: '无基线对比', maxDifference: 0 };
  }
  if (c.regressSteps > 0) {
    const maxDifference = Math.max(
      0,
      ...c.slots.filter((s) => s.status === 'regress').map((s) => s.difference ?? 0),
    );
    return { verdict: 'regress', verdictLabel: '明显衰退', maxDifference };
  }
  if (c.minorSteps > 0) {
    const maxDifference = Math.max(
      0,
      ...c.slots.filter((s) => s.status === 'minor').map((s) => s.difference ?? 0),
    );
    return { verdict: 'minor', verdictLabel: '轻微变化', maxDifference };
  }
  return { verdict: 'pass', verdictLabel: '完全一致', maxDifference: 0 };
}

function previewsFromCoverage(coverage: ReturnType<typeof buildCoverageStats>): ScriptRunHistoryPreview[] {
  return coverage.slots
    .filter((s) => s.currentPath && !s.processOnly && (s.difference ?? 0) > 0)
    .map((s) => ({
      stepLabel: s.pageTitle,
      currentPath: s.currentPath,
      baselinePath: s.baselinePath,
      status: s.status,
    }));
}

function previewsFromScreenshots(filtered: Map<number, ScreenshotInfo[]>): ScriptRunHistoryPreview[] {
  const out: ScriptRunHistoryPreview[] = [];
  for (const list of filtered.values()) {
    for (const shot of list) {
      if (!shot.relativePath) continue;
      out.push({
        stepLabel: friendlyStepLabel(shot.stepName),
        currentPath: shot.relativePath,
        status: 'uncovered',
      });
    }
  }
  return out;
}

function rowFromGoldenVerdict(
  row: ScriptRunHistoryEntry,
  verdict: GoldenMatchVerdict,
): ScriptRunHistoryEntry {
  if (!verdict.steps) {
    return {
      ...row,
      comparedSteps: 0,
      passSteps: 0,
      minorSteps: 0,
      regressSteps: 0,
      maxDifference: 0,
      verdict: 'empty',
      verdictLabel: '未判定',
    };
  }
  if (verdict.match) {
    return {
      ...row,
      comparedSteps: verdict.steps,
      passSteps: verdict.steps,
      minorSteps: 0,
      regressSteps: 0,
      maxDifference: verdict.maxDifference,
      verdict: 'pass',
      verdictLabel: '完全一致',
    };
  }
  const regress = verdict.maxDifference > 0;
  return {
    ...row,
    comparedSteps: verdict.steps,
    passSteps: 0,
    minorSteps: regress ? 0 : verdict.steps,
    regressSteps: regress ? verdict.steps : 0,
    maxDifference: verdict.maxDifference,
    verdict: regress ? 'regress' : 'minor',
    verdictLabel: regress ? '明显衰退' : '轻微变化',
  };
}

export async function enrichRunHistoryComparisons(
  testDir: string,
  screenshots: Map<number, ScreenshotInfo[]>,
  rows: ScriptRunHistoryEntry[],
  outputPath: string,
  opts?: { maxRuns?: number; scriptPath?: string },
): Promise<ScriptRunHistoryEntry[]> {
  if (!rows.length) return rows;
  const maxRuns = opts?.maxRuns ?? DEFAULT_MAX_RUNS;
  const targets = rows.length > maxRuns ? rows.slice(-maxRuns) : rows;
  const out: ScriptRunHistoryEntry[] = [];

  for (const row of targets) {
    const filtered = filterScreenshotsByRun(screenshots, row.runId);
    if (filtered.size === 0) {
      const saved = opts?.scriptPath
        ? readGoldenMatchVerdictForScriptRun(opts.scriptPath, row.runId)
        : null;
      if (saved) {
        out.push(rowFromGoldenVerdict(row, saved));
        continue;
      }
      out.push({ ...row, verdict: 'empty', verdictLabel: '无截图' });
      continue;
    }
    const comparisons = await generateTestComparisons(testDir, filtered, outputPath);
    const coverage = buildCoverageStats([{ testDir, comparisons }]);
    const v = verdictFromCoverage(coverage);
    const pages = buildPageCardsFromCoverage(coverage);
    const comparePages = pages.filter(isDiffPage);
    const previews =
      coverage.comparedSteps > 0
        ? previewsFromCoverage(coverage)
        : previewsFromScreenshots(filtered);
    out.push({
      ...row,
      comparedSteps: coverage.comparedSteps,
      passSteps: coverage.passSteps,
      minorSteps: coverage.minorSteps,
      regressSteps: coverage.regressSteps,
      maxDifference: v.maxDifference,
      verdict: v.verdict,
      verdictLabel: v.verdictLabel,
      previews: previews.length ? previews : undefined,
      comparePages: comparePages.length ? comparePages : undefined,
    });
  }

  return out;
}

export function totalRunCount(runHistory: Map<string, ScriptRunHistoryEntry[]>): number {
  let n = 0;
  for (const rows of runHistory.values()) n += rows.length;
  return n;
}
