import fs from 'fs';
import path from 'path';
import {
  compareImagesWithDiff,
  ImageComparison,
  loadCachedDiffResult,
  runWithConcurrency,
} from './image-diff.js';
import { generateBaselineComparisons } from './baseline-comparisons.js';
import { resolveCompareCrossBrowser, resolveCompareRunDrift, resolveCrossBrowserPixelmatch, resolveSameBrowserPixelmatch } from './ui-regression-config.js';
import { calendarDayKeyForScreenshot, formatDateGroupTitle } from './compare-screenshots-render.js';
import { getAllScreenshots } from './compare-screenshots-scan.js';
import {
  sortScreenshotsByRunTime,
  type ScreenshotInfo,
} from './compare-screenshots-utils.js';

export { getAllScreenshots };

/**
 * 同浏览器对比 pixelmatch 参数。覆盖：PLAYWRIGHT_PIXELMATCH_THRESHOLD / PLAYWRIGHT_PIXELMATCH_INCLUDE_AA
 */
export const SAME_BROWSER_PIXELMATCH = resolveSameBrowserPixelmatch();

/** 跨浏览器对比 pixelmatch 参数。见 config/ui-regression.json → crossBrowser；覆盖：PLAYWRIGHT_CROSS_BROWSER_PIXELMATCH_* */
export const CROSS_BROWSER_PIXELMATCH = resolveCrossBrowserPixelmatch();

function pixelmatchForCompareKind(compareKind?: ImageComparison['compareKind']) {
  return compareKind === 'cross-browser' ? CROSS_BROWSER_PIXELMATCH : SAME_BROWSER_PIXELMATCH;
}

/** 并行对比任务数，默认 4。覆盖：PLAYWRIGHT_COMPARE_CONCURRENCY=8 */
export const COMPARE_CONCURRENCY = (() => {
  const v = process.env.PLAYWRIGHT_COMPARE_CONCURRENCY;
  if (v !== undefined && v !== '' && !Number.isNaN(Number.parseInt(v, 10))) {
    return Math.max(1, Number.parseInt(v, 10));
  }
  return 4;
})();

/** 源图未变时复用 results/diffs 下已有对比结果，默认开启。关闭：PLAYWRIGHT_COMPARE_INCREMENTAL=0 */
export const COMPARE_INCREMENTAL = (() => {
  const v = (process.env.PLAYWRIGHT_COMPARE_INCREMENTAL ?? '1').toLowerCase();
  return !(v === '0' || v === 'false' || v === 'no');
})();

/** 跨浏览器对比：Chrome(基线) vs WebKit。关闭：config compareCrossBrowser 或 PLAYWRIGHT_COMPARE_CROSS_BROWSER=0 */
export function isCompareCrossBrowserEnabled(): boolean {
  return resolveCompareCrossBrowser();
}

const CROSS_BROWSER_BASE = 'chrome';
const CROSS_BROWSER_TARGET = 'webkit';

export interface StepComparison {
  stepNumber: number;
  stepName?: string;
  pomScreenshots: ScreenshotInfo[];
  optimizedScreenshots: ScreenshotInfo[];
  pomComparisons: ImageComparison[];
  optimizedComparisons: ImageComparison[];
  baselineComparisons: ImageComparison[];
  crossBrowserComparisons: ImageComparison[];
  outputPath?: string;
  testDir?: string;
}

export interface TestDirComparisons {
  testDir: string;
  comparisons: StepComparison[];
}

interface ComparePairMeta {
  browser?: string;
  compareKind?: ImageComparison['compareKind'];
  browser1?: string;
  browser2?: string;
  pairLabel?: string;
  scriptKey?: string;
}

async function comparePair(
  baseline: ScreenshotInfo,
  compareScreenshot: ScreenshotInfo,
  diffOutputPath: string,
  relativeDiffPath: string,
  meta: ComparePairMeta = {},
): Promise<ImageComparison> {
  const pixelmatchOpts = pixelmatchForCompareKind(meta.compareKind);

  if (COMPARE_INCREMENTAL) {
    const cached = loadCachedDiffResult(baseline.path, compareScreenshot.path, diffOutputPath, pixelmatchOpts);
    if (cached) {
      return {
        image1Path: baseline.relativePath,
        image2Path: compareScreenshot.relativePath,
        difference: cached.difference,
        diffImagePath: cached.diffImagePath ? relativeDiffPath : undefined,
        overlayImagePath: cached.diffImagePath
          ? relativeDiffPath.replace(/\.png$/i, '-overlay.png')
          : undefined,
        browser: meta.browser ?? compareScreenshot.browser,
        sizeMismatch: cached.sizeMismatch,
        compareKind: meta.compareKind,
        browser1: meta.browser1,
        browser2: meta.browser2,
        pairLabel: meta.pairLabel,
        width: cached.width,
        height: cached.height,
        regions: cached.regions,
      };
    }
  }

  const result = await compareImagesWithDiff(
    baseline.path,
    compareScreenshot.path,
    diffOutputPath,
    pixelmatchOpts.threshold,
    { includeAA: pixelmatchOpts.includeAA, scriptKey: meta.scriptKey },
  );

  return {
    image1Path: baseline.relativePath,
    image2Path: compareScreenshot.relativePath,
    difference: result.difference,
    diffImagePath: result.diffImagePath ? relativeDiffPath : undefined,
    overlayImagePath: result.overlayImagePath
      ? relativeDiffPath.replace(/\.png$/i, '-overlay.png')
      : undefined,
    browser: meta.browser ?? compareScreenshot.browser,
    sizeMismatch: result.sizeMismatch,
    compareKind: meta.compareKind,
    browser1: meta.browser1,
    browser2: meta.browser2,
    pairLabel: meta.pairLabel,
    width: result.width,
    height: result.height,
    regions: result.regions,
  };
}

async function generateComparisons(
  screenshots: ScreenshotInfo[],
  diffOutputDir: string,
  outputPath: string,
  scriptKey?: string,
): Promise<ImageComparison[]> {
  const sorted = sortScreenshotsByRunTime(screenshots);
  if (sorted.length < 2) {
    return [];
  }

  const outputDir = path.dirname(outputPath);
  const relativeDiffDir = path.relative(outputDir, diffOutputDir);
  const baseline = sorted[sorted.length - 2]!;
  const compareScreenshot = sorted[sorted.length - 1]!;

  const diffFileName = `diff-${compareScreenshot.timestamp}.png`;
  const diffOutputPath = path.join(diffOutputDir, diffFileName);
  const relativeDiffPath = path.join(relativeDiffDir, diffFileName).replaceAll(path.sep, '/');

  const result = await comparePair(baseline, compareScreenshot, diffOutputPath, relativeDiffPath, {
    browser: compareScreenshot.browser,
    compareKind: 'run-drift',
    scriptKey,
  });

  return [result];
}

async function generateComparisonsByStepName(
  stepScreenshots: ScreenshotInfo[],
  stepNumber: number,
  diffOutputDir: string,
  outputPath: string,
  scriptKey?: string,
): Promise<ImageComparison[]> {
  const groupedByStepName = new Map<string, ScreenshotInfo[]>();
  
  stepScreenshots.forEach(screenshot => {
    const name = screenshot.stepName;
    if (!groupedByStepName.has(name)) {
      groupedByStepName.set(name, []);
    }
    groupedByStepName.get(name)!.push(screenshot);
  });
  
  const allComparisons: ImageComparison[] = [];
  
  for (const [stepName, stepScreenshots] of groupedByStepName) {
    if (stepScreenshots.length < 2) {
      continue;
    }
    
    const stepDiffDir = path.join(diffOutputDir, `step-${stepNumber}-${stepName.replace(/[<>:"|?*\\/]/g, '_')}`);
    if (!fs.existsSync(stepDiffDir)) {
      fs.mkdirSync(stepDiffDir, { recursive: true });
    }
    
    const groupedByBrowser = new Map<string, ScreenshotInfo[]>();
    stepScreenshots.forEach(screenshot => {
      const browser = screenshot.browser || 'unknown';
      if (!groupedByBrowser.has(browser)) {
        groupedByBrowser.set(browser, []);
      }
      groupedByBrowser.get(browser)!.push(screenshot);
    });
    
    for (const [, browserScreenshots] of groupedByBrowser) {
      if (browserScreenshots.length < 2) {
        continue;
      }
      
      const browserComparisons = await generateComparisons(
        sortScreenshotsByRunTime(browserScreenshots),
        stepDiffDir,
        outputPath,
        scriptKey,
      );
      allComparisons.push(...browserComparisons);
    }
  }
  
  return allComparisons;
}

function groupScreenshotsByCalendarDayForPairing(screenshots: ScreenshotInfo[]): Map<string, ScreenshotInfo[]> {
  const grouped = new Map<string, ScreenshotInfo[]>();
  screenshots.forEach((s) => {
    const key = calendarDayKeyForScreenshot(s);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(s);
  });
  return grouped;
}

/**
 * 同日对齐：优先相同运行目录名（timestamp），否则按时间序第 N 次运行配对。
 */
function pairCrossBrowserByDay(
  chromeList: ScreenshotInfo[],
  webkitList: ScreenshotInfo[],
): Array<{ chrome: ScreenshotInfo; webkit: ScreenshotInfo; pairLabel: string }> {
  const pairs: Array<{ chrome: ScreenshotInfo; webkit: ScreenshotInfo; pairLabel: string }> = [];
  const chromeByDay = groupScreenshotsByCalendarDayForPairing(chromeList);
  const webkitByDay = groupScreenshotsByCalendarDayForPairing(webkitList);
  const days = new Set([...chromeByDay.keys(), ...webkitByDay.keys()]);

  for (const day of Array.from(days).sort()) {
    const chromeRuns = sortScreenshotsByRunTime(chromeByDay.get(day) || []);
    const webkitRuns = sortScreenshotsByRunTime(webkitByDay.get(day) || []);
    if (chromeRuns.length === 0 || webkitRuns.length === 0) continue;

    const webkitByTimestamp = new Map(webkitRuns.map((s) => [s.timestamp, s]));
    const usedWebkitTs = new Set<string>();
    const usedChromeTs = new Set<string>();
    const dayTitle = formatDateGroupTitle(day);

    for (const chrome of chromeRuns) {
      const matched = webkitByTimestamp.get(chrome.timestamp);
      if (matched) {
        pairs.push({
          chrome,
          webkit: matched,
          pairLabel: `${dayTitle} · 同次运行 (${chrome.displayTimestamp})`,
        });
        usedWebkitTs.add(chrome.timestamp);
        usedChromeTs.add(chrome.timestamp);
      }
    }

    const chromeRemain = chromeRuns.filter((c) => !usedChromeTs.has(c.timestamp));
    const webkitRemain = webkitRuns.filter((w) => !usedWebkitTs.has(w.timestamp));
    const alignCount = Math.min(chromeRemain.length, webkitRemain.length);

    for (let i = 0; i < alignCount; i++) {
      const chrome = chromeRemain[i];
      const webkit = webkitRemain[i];
      pairs.push({
        chrome,
        webkit,
        pairLabel: `${dayTitle} · 第 ${i + 1} 组 (${chrome.displayTimestamp} ↔ ${webkit.displayTimestamp})`,
      });
    }
  }

  return pairs;
}

async function generateCrossBrowserComparisonsByStepName(
  stepScreenshots: ScreenshotInfo[],
  stepNumber: number,
  diffOutputDir: string,
  outputPath: string,
  scriptKey?: string,
): Promise<ImageComparison[]> {
  if (!isCompareCrossBrowserEnabled()) return [];

  const groupedByStepName = new Map<string, ScreenshotInfo[]>();
  stepScreenshots.forEach((screenshot) => {
    const name = screenshot.stepName;
    if (!groupedByStepName.has(name)) groupedByStepName.set(name, []);
    groupedByStepName.get(name)!.push(screenshot);
  });

  const outputDir = path.dirname(outputPath);
  const allComparisons: ImageComparison[] = [];

  for (const [stepName, nameScreenshots] of groupedByStepName) {
    const chromeList = nameScreenshots.filter((s) => s.browser === CROSS_BROWSER_BASE);
    const webkitList = nameScreenshots.filter((s) => s.browser === CROSS_BROWSER_TARGET);
    if (chromeList.length === 0 || webkitList.length === 0) continue;

    const stepDiffDir = path.join(
      diffOutputDir,
      `step-${stepNumber}-${stepName.replace(/[<>:"|?*\\/]/g, '_')}`,
      'cross-browser',
    );
    if (!fs.existsSync(stepDiffDir)) {
      fs.mkdirSync(stepDiffDir, { recursive: true });
    }
    const relativeDiffDir = path.relative(outputDir, stepDiffDir).replaceAll(path.sep, '/');

    const pairs = pairCrossBrowserByDay(chromeList, webkitList);
    const tasks = pairs.map(({ chrome, webkit, pairLabel }) => {
      const safeTs = webkit.timestamp.replace(/[<>:"|?*\\/]/g, '_');
      const diffFileName = `diff-chrome-vs-webkit-${safeTs}.png`;
      const diffOutputPath = path.join(stepDiffDir, diffFileName);
      const relativeDiffPath = `${relativeDiffDir}/${diffFileName}`;
      return () =>
        comparePair(chrome, webkit, diffOutputPath, relativeDiffPath, {
          browser: CROSS_BROWSER_TARGET,
          compareKind: 'cross-browser',
          browser1: CROSS_BROWSER_BASE,
          browser2: CROSS_BROWSER_TARGET,
          pairLabel,
          scriptKey,
        });
    });

    const comparisons = await runWithConcurrency(tasks, COMPARE_CONCURRENCY);
    allComparisons.push(...comparisons);
  }

  return allComparisons;
}

export async function generateTestComparisons(testDir: string, screenshots: Map<number, ScreenshotInfo[]>, outputPath: string): Promise<StepComparison[]> {
  const allSteps = Array.from(screenshots.keys()).sort((a, b) => a - b);
  
  const diffOutputDir = path.join(path.dirname(outputPath), 'diffs', testDir);
  if (!fs.existsSync(diffOutputDir)) {
    fs.mkdirSync(diffOutputDir, { recursive: true });
  }

  const comparisons: StepComparison[] = [];
  
  for (const stepNumber of allSteps) {
    const stepScreenshots = screenshots.get(stepNumber) || [];

    const stepComparisons = resolveCompareRunDrift()
      ? await generateComparisonsByStepName(
          stepScreenshots,
          stepNumber,
          diffOutputDir,
          outputPath,
          testDir,
        )
      : [];
    const baselineComparisons = await generateBaselineComparisons(
      testDir,
      stepScreenshots,
      stepNumber,
      diffOutputDir,
      outputPath,
      SAME_BROWSER_PIXELMATCH.threshold,
      SAME_BROWSER_PIXELMATCH.includeAA,
      COMPARE_CONCURRENCY,
      COMPARE_INCREMENTAL,
    );
    const crossBrowserComparisons = await generateCrossBrowserComparisonsByStepName(
      stepScreenshots,
      stepNumber,
      diffOutputDir,
      outputPath,
      testDir,
    );

    comparisons.push({
      stepNumber,
      pomScreenshots: [],
      optimizedScreenshots: stepScreenshots,
      pomComparisons: [],
      optimizedComparisons: [...baselineComparisons, ...stepComparisons],
      baselineComparisons,
      crossBrowserComparisons,
      outputPath,
      testDir,
    });
  }
  
  return comparisons;
}
