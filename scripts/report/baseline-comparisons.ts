import fs from 'fs';
import path from 'path';
import {
  getGoldenScreenshotPath,
  getLastGreenScreenshotPath,
  stepFileNameFromScreenshot,
  type ResolvedBaselineKind,
} from './baseline-manager.js';
import { resolveBaselineStrategy, resolveCompareRunDrift } from './ui-regression-config.js';
import {
  compareImagesWithDiff,
  type ImageComparison,
  loadCachedDiffResult,
  runWithConcurrency,
} from './image-diff.js';

export interface ScreenshotInfoLite {
  path: string;
  relativePath: string;
  timestamp: string;
  stepName: string;
  browser?: string;
  route?: string;
}

export function runTimestampSortKey(timestamp: string): number {
  const iso = timestamp.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})/);
  if (iso) {
    const t = Date.parse(`${iso[1]}-${iso[2]}-${iso[3]}T${iso[4]}:${iso[5]}:${iso[6]}Z`);
    if (!Number.isNaN(t)) return t;
  }
  const legacy = timestamp.match(/(\d{4}-\d{2}-\d{2})_(\d{2})-(\d{2})-(\d{2})/);
  if (legacy) {
    const t = Date.parse(`${legacy[1]}T${legacy[2]}:${legacy[3]}:${legacy[4]}`);
    if (!Number.isNaN(t)) return t;
  }
  // intent: run-chromium-2026-08-19-06-13-41
  const intent = timestamp.match(/(\d{4}-\d{2}-\d{2})-(\d{2})-(\d{2})-(\d{2})/);
  if (intent) {
    const t = Date.parse(`${intent[1]}T${intent[2]}:${intent[3]}:${intent[4]}`);
    if (!Number.isNaN(t)) return t;
  }
  return 0;
}

function sortByRunTime(screenshots: ScreenshotInfoLite[]): ScreenshotInfoLite[] {
  return [...screenshots].sort((a, b) => {
    const ta = runTimestampSortKey(a.timestamp);
    const tb = runTimestampSortKey(b.timestamp);
    if (ta !== tb) return ta - tb;
    return a.path.localeCompare(b.path);
  });
}

function pickLatest(sorted: ScreenshotInfoLite[]): ScreenshotInfoLite | null {
  if (sorted.length === 0) return null;
  return sorted[sorted.length - 1];
}

function resolveBaselinePath(
  scriptKey: string,
  browser: string,
  stepFileName: string,
  sortedRuns: ScreenshotInfoLite[],
  latest: ScreenshotInfoLite,
  strategy: ReturnType<typeof resolveBaselineStrategy>,
): { baselinePath: string; kind: ResolvedBaselineKind } | null {
  const tryGolden = () => getGoldenScreenshotPath(scriptKey, browser, stepFileName);
  const tryLastGreen = () => getLastGreenScreenshotPath('screenshots', scriptKey, browser, stepFileName);
  const tryOldest = () => {
    if (sortedRuns.length < 2) return null;
    const oldest = sortedRuns[0];
    if (oldest.path === latest.path) return null;
    return oldest.path;
  };

  const allowOldest = strategy === 'oldest' || resolveCompareRunDrift();
  const order: ResolvedBaselineKind[] =
    strategy === 'golden'
      ? ['golden']
      : strategy === 'last-green'
        ? ['last-green']
        : strategy === 'oldest'
          ? allowOldest
            ? ['oldest']
            : []
          : allowOldest
            ? ['golden', 'last-green', 'oldest']
            : ['golden', 'last-green'];

  for (const kind of order) {
    if (kind === 'golden') {
      const p = tryGolden();
      if (p) return { baselinePath: p, kind: 'golden' };
    } else if (kind === 'last-green') {
      const p = tryLastGreen();
      if (p && p !== latest.path) return { baselinePath: p, kind: 'last-green' };
    } else if (kind === 'oldest') {
      const p = tryOldest();
      if (p) return { baselinePath: p, kind: 'oldest' };
    }
  }
  return null;
}

export async function generateBaselineComparisons(
  testDir: string,
  stepScreenshots: ScreenshotInfoLite[],
  stepNumber: number,
  diffOutputDir: string,
  outputPath: string,
  pixelThreshold: number,
  includeAA: boolean,
  concurrency: number,
  incremental: boolean,
): Promise<ImageComparison[]> {
  const strategy = resolveBaselineStrategy();
  const groupedByStepName = new Map<string, ScreenshotInfoLite[]>();
  stepScreenshots.forEach((s) => {
    if (!groupedByStepName.has(s.stepName)) groupedByStepName.set(s.stepName, []);
    groupedByStepName.get(s.stepName)!.push(s);
  });

  const outputDir = path.dirname(outputPath);
  const comparisons: ImageComparison[] = [];
  const tasks: Array<() => Promise<ImageComparison>> = [];

  for (const [stepName, nameScreenshots] of groupedByStepName) {
    const byBrowser = new Map<string, ScreenshotInfoLite[]>();
    nameScreenshots.forEach((s) => {
      const browser = s.browser || 'chrome';
      if (!byBrowser.has(browser)) byBrowser.set(browser, []);
      byBrowser.get(browser)!.push(s);
    });

    for (const [browser, browserScreenshots] of byBrowser) {
      const sorted = sortByRunTime(browserScreenshots);
      const latest = pickLatest(sorted);
      if (!latest) continue;

      const stepFileName = stepFileNameFromScreenshot(latest.path);
      const resolved = resolveBaselinePath(testDir, browser, stepFileName, sorted, latest, strategy);
      if (!resolved) continue;

      const compareKind =
        resolved.kind === 'oldest' ? ('run-drift' as const) : resolved.kind;

      const stepDiffDir = path.join(
        diffOutputDir,
        `step-${stepNumber}-${stepName.replace(/[<>:"|?*\\/]/g, '_')}`,
        'baseline',
        browser,
      );
      if (!fs.existsSync(stepDiffDir)) fs.mkdirSync(stepDiffDir, { recursive: true });

      const diffFileName = `diff-${compareKind}-${latest.timestamp}.png`;
      const diffOutputPath = path.join(stepDiffDir, diffFileName);
      const relativeDiffDir = path.relative(outputDir, stepDiffDir).replaceAll(path.sep, '/');
      const relativeDiffPath = `${relativeDiffDir}/${diffFileName}`;

      const baselineRelative = path.relative(outputDir, resolved.baselinePath).replaceAll(path.sep, '/');

      tasks.push(async () => {
        if (incremental) {
          const cached = loadCachedDiffResult(resolved.baselinePath, latest.path, diffOutputPath, {
            threshold: pixelThreshold,
            includeAA,
          });
          if (cached) {
            return {
              image1Path: baselineRelative,
              image2Path: latest.relativePath,
              difference: cached.difference,
              diffImagePath: cached.diffImagePath ? relativeDiffPath : undefined,
              overlayImagePath: cached.diffImagePath
                ? relativeDiffPath.replace(/\.png$/i, '-overlay.png')
                : undefined,
              browser,
              sizeMismatch: cached.sizeMismatch,
              compareKind,
              width: cached.width,
              height: cached.height,
              regions: cached.regions,
            };
          }
        }

        const result = await compareImagesWithDiff(
          resolved.baselinePath,
          latest.path,
          diffOutputPath,
          pixelThreshold,
          { includeAA, scriptKey: testDir },
        );

        return {
          image1Path: baselineRelative,
          image2Path: latest.relativePath,
          difference: result.difference,
          diffImagePath: result.diffImagePath ? relativeDiffPath : undefined,
          overlayImagePath: result.overlayImagePath
            ? relativeDiffPath.replace(/\.png$/i, '-overlay.png')
            : undefined,
          browser,
          sizeMismatch: result.sizeMismatch,
          compareKind,
          width: result.width,
          height: result.height,
          regions: result.regions,
        };
      });
    }
  }

  if (tasks.length === 0) return [];
  return runWithConcurrency(tasks, concurrency);
}
