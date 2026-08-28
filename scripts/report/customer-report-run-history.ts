import type { ScreenshotInfo } from './compare-screenshots-utils.js';
import { generateTestComparisons } from './compare-screenshots-engine.js';
import { buildCoverageStats } from './coverage-stats.js';
import type { ScriptRunHistoryEntry } from './customer-report-run-meta.js';

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

export async function enrichRunHistoryComparisons(
  testDir: string,
  screenshots: Map<number, ScreenshotInfo[]>,
  rows: ScriptRunHistoryEntry[],
  outputPath: string,
  opts?: { maxRuns?: number },
): Promise<ScriptRunHistoryEntry[]> {
  if (!rows.length) return rows;
  const maxRuns = opts?.maxRuns ?? DEFAULT_MAX_RUNS;
  const targets = rows.length > maxRuns ? rows.slice(-maxRuns) : rows;
  const out: ScriptRunHistoryEntry[] = [];

  for (const row of targets) {
    const filtered = filterScreenshotsByRun(screenshots, row.runId);
    if (filtered.size === 0) {
      out.push({ ...row, verdict: 'empty', verdictLabel: '无截图' });
      continue;
    }
    const comparisons = await generateTestComparisons(testDir, filtered, outputPath);
    const coverage = buildCoverageStats([{ testDir, comparisons }]);
    const v = verdictFromCoverage(coverage);
    out.push({
      ...row,
      comparedSteps: coverage.comparedSteps,
      passSteps: coverage.passSteps,
      minorSteps: coverage.minorSteps,
      regressSteps: coverage.regressSteps,
      maxDifference: v.maxDifference,
      verdict: v.verdict,
      verdictLabel: v.verdictLabel,
    });
  }

  return out;
}

export function totalRunCount(runHistory: Map<string, ScriptRunHistoryEntry[]>): number {
  let n = 0;
  for (const rows of runHistory.values()) n += rows.length;
  return n;
}
