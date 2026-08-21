import { countComparisonSeverities } from './ui-issues-index.js';
import type { OverviewData } from './compare-report-viz.js';
import { buildCoverageStats, type CoverageStats } from './coverage-stats.js';

export { countComparisonSeverities };
export type { CoverageStats };

const DIST_BUCKETS = [
  { range: '0-0.1%', max: 0.1 },
  { range: '0.1-0.5%', max: 0.5 },
  { range: '0.5-1%', max: 1 },
  { range: '>1%', max: Infinity },
] as const;

export function buildOverviewData(
  testDirComparisons: Array<{
    testDir: string;
    comparisons: Array<{
      stepNumber: number;
      optimizedScreenshots?: Array<{
        path: string;
        relativePath: string;
        timestamp: string;
        date: string;
        displayTimestamp: string;
        type: 'pom' | 'optimized';
        stepName: string;
        browser?: string;
        route?: string;
      }>;
      baselineComparisons?: Array<{
        difference?: number;
        compareKind?: string;
        image1Path?: string;
        image2Path?: string;
        browser?: string;
        overlayImagePath?: string;
        diffImagePath?: string;
        regions?: unknown;
        sizeMismatch?: boolean;
      }>;
      optimizedComparisons?: Array<{
        difference?: number;
        compareKind?: string;
        image1Path?: string;
        image2Path?: string;
      }>;
      crossBrowserComparisons?: Array<{
        difference?: number;
        compareKind?: string;
        image1Path?: string;
        image2Path?: string;
      }>;
    }>;
  }>,
  opts: {
    totalSteps: number;
    totalScreenshots: number;
    totalExecutions: number;
    generatedAt?: string;
  },
): OverviewData {
  const coverage = buildCoverageStats(testDirComparisons as Parameters<typeof buildCoverageStats>[0]);
  const counts = countComparisonSeverities(testDirComparisons);
  let maxDiffValue = -1;
  let maxDiff: OverviewData['maxDiff'] = null;

  for (const tdc of testDirComparisons) {
    for (const comp of tdc.comparisons) {
      for (const c of [...(comp.optimizedComparisons || []), ...(comp.crossBrowserComparisons || [])]) {
        const d = c.difference ?? 0;
        if (d > maxDiffValue) {
          maxDiffValue = d;
          maxDiff = {
            pct: (d * 100).toFixed(3) + '%',
            location: `${tdc.testDir}/步骤${comp.stepNumber}`,
          };
        }
      }
    }
  }

  const avgDiff =
    counts.total > 0
      ? ((counts.diffs.reduce((s, v) => s + v, 0) / counts.total) * 100).toFixed(3) + '%'
      : '0%';

  const bucketCounts = DIST_BUCKETS.map(() => 0);
  for (const d of counts.diffs) {
    const pct = d * 100;
    const idx = DIST_BUCKETS.findIndex((b) => pct < b.max);
    bucketCounts[idx < 0 ? bucketCounts.length - 1 : idx]!++;
  }
  const maxBucketCount = Math.max(...bucketCounts, 1);
  const distribution = DIST_BUCKETS.map((b, i) => ({
    range: b.range,
    count: bucketCounts[i]!,
    pct: (bucketCounts[i]! / maxBucketCount) * 100,
  }));

  return {
    total: coverage.expectedSteps,
    blocker: coverage.regressSteps,
    warning: 0,
    noise: coverage.passSteps,
    totalSteps: opts.totalSteps,
    totalScreenshots: opts.totalScreenshots,
    totalExecutions: opts.totalExecutions,
    maxDiff,
    avgDiff,
    distribution,
    generatedAt: opts.generatedAt ?? new Date().toLocaleString('zh-CN', { hour12: false }),
    coverage,
  };
}
