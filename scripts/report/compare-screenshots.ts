import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import {
  compareImagesWithDiff,
  ImageComparison,
  loadCachedDiffResult,
  runWithConcurrency,
} from './image-diff.js';
import { generateBaselineComparisons } from './baseline-comparisons.js';
import { loadUiRegressionConfig, isDisabledViewportScreenshot, resolveCompareCrossBrowser, resolveCrossBrowserPixelmatch, resolveSameBrowserPixelmatch } from './ui-regression-config.js';
import { readUiIssuesSummaryLine, sendJobFeishuNotification } from '../jobs/job-notify.js';
import type { FeishuMode } from '../jobs/test-jobs-config.js';
import {
  buildUiIssuesReport,
  gateShouldFail,
  writeUiIssuesReport,
  type UiIssue,
} from './ui-issues.js';
import { appendHistorySnapshot, loadStepTrends, type StepTrendPoint } from './ui-regression-history.js';
import { buildPlainLanguageAnalysis } from './ui-issues-analysis.js';
import { attachIssueReviews } from './ui-issue-review.js';
import {
  compareReportVizCss,
  compareReportVizJs,
  generateHeatmapTabHtml,
  generateOverviewPanel,
  generateSummaryTableHtml,
  type OverviewData,
  type SummaryRow,
} from './compare-report-viz.js';
import {
  collectAllUiIssues,
  createCountHelpers,
  createDiffCardRenderer,
  calendarDayKeyForScreenshot,
  formatDateGroupTitle,
  groupImageComparisonsByCalendarDay,
  compareScreenshotSubsectionNames,
  createScreenshotSectionRenderer,
  createDiffStepRenderer,
  generateIssuesTabHtml as renderIssuesTabHtml,
  getBrowserFilterLabel,
  getTotalExecutions,
  stripScriptTimestamp,
  scriptTabDisambiguatorSuffix,
  formatScriptTabDisambiguatorSuffix,
} from './compare-screenshots-render.js';
import {
  extractStepNameFromPath,
  formatDisplayTimestampFromRunDir,
  getMenuNameByRoute,
  isLoginScreenshotCandidate,
  scriptDirTimestampMs,
  sortScreenshotsByRunTime,
  type ScreenshotInfo,
} from './compare-screenshots-utils.js';

let currentStepTrends: Record<string, StepTrendPoint[]> = {};

dotenv.config({ path: path.join(process.cwd(), '.env') });

const POM_ENABLED = process.env.ENABLE_POM === '1';

/**
 * 「有差异」Tab：默认仅展示差异比例 ≥ 0.3%（difference ≥ 0.003）的对比。
 * 低于约 0.3% 的像素差在整页截图上通常可忽略，故不收录；更严/更松可用 PLAYWRIGHT_DIFF_ONLY_TAB_MIN_RATIO。
 * 设为 0 则任意 difference>0 都进该 Tab。
 */
const DIFF_ONLY_TAB_MIN_RATIO = (() => {
  const v = process.env.PLAYWRIGHT_DIFF_ONLY_TAB_MIN_RATIO;
  if (v !== undefined && v !== '' && !Number.isNaN(Number.parseFloat(v))) {
    return Number.parseFloat(v);
  }
  return 0.003;
})();

function passesDiffOnlyTabFilter(difference: number): boolean {
  if (!(difference > 0)) return false;
  if (DIFF_ONLY_TAB_MIN_RATIO <= 0) return true;
  return difference >= DIFF_ONLY_TAB_MIN_RATIO;
}

function runDriftComparisons(comparisons: ImageComparison[] | undefined): ImageComparison[] {
  return (comparisons || []).filter((c) => c.compareKind === 'run-drift');
}
const countHelpers = createCountHelpers({ runDriftComparisons, passesDiffOnlyTabFilter });
const screenshotRenderer = createScreenshotSectionRenderer({ getMenuNameByRoute });

/**
 * 同浏览器对比 pixelmatch 参数。覆盖：PLAYWRIGHT_PIXELMATCH_THRESHOLD / PLAYWRIGHT_PIXELMATCH_INCLUDE_AA
 */
const SAME_BROWSER_PIXELMATCH = resolveSameBrowserPixelmatch();

/** 跨浏览器对比 pixelmatch 参数。见 config/ui-regression.json → crossBrowser；覆盖：PLAYWRIGHT_CROSS_BROWSER_PIXELMATCH_* */
const CROSS_BROWSER_PIXELMATCH = resolveCrossBrowserPixelmatch();

function pixelmatchForCompareKind(compareKind?: ImageComparison['compareKind']) {
  return compareKind === 'cross-browser' ? CROSS_BROWSER_PIXELMATCH : SAME_BROWSER_PIXELMATCH;
}

/** 并行对比任务数，默认 4。覆盖：PLAYWRIGHT_COMPARE_CONCURRENCY=8 */
const COMPARE_CONCURRENCY = (() => {
  const v = process.env.PLAYWRIGHT_COMPARE_CONCURRENCY;
  if (v !== undefined && v !== '' && !Number.isNaN(Number.parseInt(v, 10))) {
    return Math.max(1, Number.parseInt(v, 10));
  }
  return 4;
})();

/** 源图未变时复用 results/diffs 下已有对比结果，默认开启。关闭：PLAYWRIGHT_COMPARE_INCREMENTAL=0 */
const COMPARE_INCREMENTAL = (() => {
  const v = (process.env.PLAYWRIGHT_COMPARE_INCREMENTAL ?? '1').toLowerCase();
  return !(v === '0' || v === 'false' || v === 'no');
})();

const RUN_SEGMENT_DIR = /^run-(chromium|webkit|firefox|safari|edge)-/i;

/** 跨浏览器对比：Chrome(基线) vs WebKit。关闭：config compareCrossBrowser 或 PLAYWRIGHT_COMPARE_CROSS_BROWSER=0 */
function isCompareCrossBrowserEnabled(): boolean {
  return resolveCompareCrossBrowser();
}

const CROSS_BROWSER_BASE = 'chrome';
const CROSS_BROWSER_TARGET = 'webkit';

interface ScriptScanTarget {
  testDir: string;
  scriptPath: string;
}

interface StepComparison {
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

interface TestDirComparisons {
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
    
    for (const [browser, browserScreenshots] of groupedByBrowser) {
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

function getAllScreenshots(dir: string, type: 'pom' | 'optimized', outputPath: string): Map<number, ScreenshotInfo[]> {
  const result = new Map<number, ScreenshotInfo[]>();
  
  if (!fs.existsSync(dir)) {
    console.log(`⚠️  目录不存在: ${dir}`);
    return result;
  }
  
  const outputDir = path.dirname(outputPath);
  const relativeDir = path.relative(outputDir, dir);
  
  function scanDirectory(currentDir: string, currentRelativePath: string) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    
    entries.forEach(entry => {
      const fullPath = path.join(currentDir, entry.name);
      const relativePath = path.join(currentRelativePath, entry.name);
      
      if (entry.isDirectory()) {
        scanDirectory(fullPath, relativePath);
      } else if (entry.isFile() && entry.name.endsWith('.png')) {
        if (isDisabledViewportScreenshot(entry.name)) return;
        const match = entry.name.match(/step-(\d+)-(.+)\.png/);
        if (match) {
          const stepNumber = parseInt(match[1]);
          const stepName = match[2];
          
          let route = '';
          const routeMatch = stepName.match(/^(.+)__(.+)$/);
          if (routeMatch) {
            route = routeMatch[2];
          }
          
          if (isLoginScreenshotCandidate(entry.name, route)) {
            console.log(`    ⚠️  跳过登录页截图，避免污染对比数据: ${entry.name}`);
            return;
          }
          
          if (!result.has(stepNumber)) {
            result.set(stepNumber, []);
          }
          
          const browserMatch =
            fullPath.match(/run-(chromium|webkit|firefox|safari|edge)-/i) ||
            fullPath.match(/-(chrome|firefox|safari|edge|webkit|chromium)-/i);
          let browser = browserMatch ? browserMatch[1].toLowerCase() : 'unknown';

          if (browser === 'chromium') {
            browser = 'chrome';
          }
          if (browser === 'unknown' && type === 'optimized') {
            browser = 'chrome';
          }
          
          const dateMatch = currentDir.match(/^(\d{4}-\d{2}-\d{2})_/);
          const date = dateMatch ? dateMatch[1] : path.basename(currentDir);
          
          const displayTimestamp = formatDisplayTimestampFromRunDir(path.basename(currentDir));
          
          result.get(stepNumber)!.push({
            path: fullPath,
            // 输出 HTML 位于 results/ 下，直接基于 fullPath 计算相对路径，避免重复拼接导致路径错误
            relativePath: path.relative(outputDir, fullPath).replaceAll(path.sep, '/'),
            timestamp: path.basename(currentDir),
            date,
            displayTimestamp,
            type,
            stepName: routeMatch ? routeMatch[1] : stepName,
            browser,
            route
          } as ScreenshotInfo);
        } else {
          console.log(`    ⚠️  文件名不匹配: ${entry.name}`);
        }
      }
    });
  }
  
  console.log(`📁 开始递归扫描目录: ${dir}`);
  scanDirectory(dir, relativeDir);
  
  console.log(`✅ ${type} 目录扫描完成: ${result.size} 个步骤`);
  return result;
}

async function generateTestComparisons(testDir: string, screenshots: Map<number, ScreenshotInfo[]>, outputPath: string): Promise<StepComparison[]> {
  const allSteps = Array.from(screenshots.keys()).sort((a, b) => a - b);
  
  const diffOutputDir = path.join(path.dirname(outputPath), 'diffs', testDir);
  if (!fs.existsSync(diffOutputDir)) {
    fs.mkdirSync(diffOutputDir, { recursive: true });
  }

  const comparisons: StepComparison[] = [];
  
  for (const stepNumber of allSteps) {
    const stepScreenshots = screenshots.get(stepNumber) || [];

    const stepComparisons = await generateComparisonsByStepName(
      stepScreenshots,
      stepNumber,
      diffOutputDir,
      outputPath,
      testDir,
    );
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

function getBrowserIcon(browser: string): string {
  const icons: Record<string, string> = {
    'chrome': '🌐',
    'firefox': '🦊',
    'webkit': '🍎',
    'safari': '🍎',
    'edge': '📦',
    'cross': '⇄',
  };
  return icons[browser] || '🌍';
}
const diffRenderer = createDiffCardRenderer({ getBrowserIcon });

const diffStepRenderer = createDiffStepRenderer({
  runDriftComparisons,
  passesDiffOnlyTabFilter,
  extractStepNameFromPath,
  compareScreenshotSubsectionNames,
  groupImageComparisonsByCalendarDay,
  formatDateGroupTitle,
  generateDiffCard: diffRenderer.generateDiffCard,
  getCurrentStepTrends: (key) => currentStepTrends[key],
});

function generateHTML(
  testDirComparisons: TestDirComparisons[],
  pomDirName: string,
  optDirName: string,
  hasPomData: boolean,
  hasOptimizedData: boolean,
  uiIssues: UiIssue[] = [],
  analysisHtml: string = '',
): string {
  currentStepTrends = loadStepTrends();
  const crossBrowserOn = isCompareCrossBrowserEnabled();
  const heatmapHtml = generateHeatmapTabHtml(uiIssues);

  const allComparisons = testDirComparisons.flatMap(tdc => tdc.comparisons);
  const totalScreenshotCount = allComparisons.reduce((sum, c) => sum + c.optimizedScreenshots.length, 0);
  const totalExecCount = getTotalExecutions(allComparisons, POM_ENABLED);

  // 通过率分母：全部像素对比项（含无差异），而非仅 ui-issues
  const cfg = loadUiRegressionConfig();
  const allDiffs: number[] = [];
  let ovBlocker = 0;
  let ovWarning = 0;
  let ovNoise = 0;
  let maxDiff: { pct: string; location: string } | null = null;
  let maxDiffValue = -1;

  for (const tdc of testDirComparisons) {
    for (const comp of tdc.comparisons) {
      for (const c of [...comp.optimizedComparisons, ...comp.crossBrowserComparisons]) {
        const d = c.difference ?? 0;
        allDiffs.push(d);
        const isCross = c.compareKind === 'cross-browser';
        const blockerR = isCross ? cfg.crossBrowser.blockerRatio : cfg.blockerRatio;
        const warningR = isCross ? cfg.crossBrowser.warningRatio : cfg.warningRatio;
        let severity: 'blocker' | 'warning' | 'noise' | 'pass' = 'pass';
        if (d >= blockerR) severity = isCross ? 'warning' : 'blocker';
        else if (d >= warningR) severity = 'warning';
        else if (d > 0) severity = 'noise';

        if (severity === 'blocker') ovBlocker++;
        else if (severity === 'warning') ovWarning++;
        else if (severity === 'noise') ovNoise++;

        if (d > maxDiffValue) {
          maxDiffValue = d;
          const shotPath = c.image2Path || c.image1Path || '';
          maxDiff = {
            pct: (d * 100).toFixed(3) + '%',
            location: `${tdc.testDir}/步骤${comp.stepNumber}`,
          };
          void shotPath;
        }
      }
    }
  }

  const comparisonTotal = allDiffs.length;
  const avgDiff =
    comparisonTotal > 0
      ? ((allDiffs.reduce((s, v) => s + v, 0) / comparisonTotal) * 100).toFixed(3) + '%'
      : '0%';
  const distBuckets = [
    { range: '0-0.1%', count: 0 },
    { range: '0.1-0.5%', count: 0 },
    { range: '0.5-1%', count: 0 },
    { range: '>1%', count: 0 },
  ];
  for (const d of allDiffs) {
    const pct = d * 100;
    if (pct < 0.1) distBuckets[0]!.count++;
    else if (pct < 0.5) distBuckets[1]!.count++;
    else if (pct < 1) distBuckets[2]!.count++;
    else distBuckets[3]!.count++;
  }
  const maxBucketCount = Math.max(...distBuckets.map(b => b.count), 1);
  const distribution = distBuckets.map(b => ({ range: b.range, count: b.count, pct: (b.count / maxBucketCount) * 100 }));

  const overviewData: OverviewData = {
    total: comparisonTotal,
    blocker: ovBlocker,
    warning: ovWarning,
    noise: ovNoise,
    totalSteps: allComparisons.length,
    totalScreenshots: totalScreenshotCount,
    totalExecutions: totalExecCount,
    maxDiff,
    avgDiff,
    distribution,
    generatedAt: new Date().toLocaleString('zh-CN', { hour12: false }),
  };
  const overviewHtml = generateOverviewPanel(overviewData);

  // Build SummaryRow[] for summary tab (Plan 5)
  const summaryRows: SummaryRow[] = [];
  for (const tdc of testDirComparisons) {
    for (const comp of tdc.comparisons) {
      for (const c of [...comp.optimizedComparisons, ...comp.crossBrowserComparisons]) {
        const shotPath = c.image2Path || c.image1Path;
        const stepName = extractStepNameFromPath(shotPath);
        const diff = c.difference;
        const severity = diff >= 0.005 ? 'blocker' : diff >= 0.001 ? 'warning' : 'noise';
        summaryRows.push({
          script: tdc.testDir,
          step: comp.stepNumber,
          stepName,
          browser: c.browser || c.browser2 || 'chrome',
          compareKind: c.compareKind || 'same-browser',
          difference: diff,
          severity,
        });
      }
    }
  }
  const summaryHtml = generateSummaryTableHtml(summaryRows);
  
  // 约定：testDir = "<iteration>/<script>"
  const iterationMap = new Map<string, TestDirComparisons[]>();
  for (const tdc of testDirComparisons) {
    const [iteration, ...rest] = String(tdc.testDir).split('/');
    const iter = iteration || 'unknown-iteration';
    const script = rest.join('/') || tdc.testDir;
    if (!iterationMap.has(iter)) iterationMap.set(iter, []);
    iterationMap.get(iter)!.push({ ...tdc, testDir: script });
  }
  // 同一迭代下脚本 Tab：按目录名时间戳升序（日期早的在前）；解析不到时间戳的排最后
  for (const scripts of iterationMap.values()) {
    scripts.sort((a, b) => {
      const ta = scriptDirTimestampMs(String(a.testDir));
      const tb = scriptDirTimestampMs(String(b.testDir));
      const ka = ta > 0 ? ta : Number.POSITIVE_INFINITY;
      const kb = tb > 0 ? tb : Number.POSITIVE_INFINITY;
      if (ka !== kb) return ka - kb;
      return String(a.testDir).localeCompare(String(b.testDir), 'zh-CN');
    });
  }
  const iterations = Array.from(iterationMap.keys());
  const firstIteration = iterations[0];

  const allBrowsers = new Set<string>();
  allComparisons.forEach(comp => {
    comp.optimizedScreenshots.forEach(s => {
      if (s.browser && s.browser !== 'firefox') {
        allBrowsers.add(s.browser);
      }
    });
  });
  const browserListRaw = Array.from(allBrowsers).sort();
  const totalCrossBrowser = isCompareCrossBrowserEnabled() ? countHelpers.getTotalCrossBrowserComparisons(testDirComparisons) : 0;
  const hasCrossBrowserData = totalCrossBrowser > 0;
  const browserFilterOrder = ['chrome', 'webkit', 'cross'];
  const browserList = browserFilterOrder.filter(
    (b) => (b === 'cross' ? hasCrossBrowserData : browserListRaw.includes(b)),
  );
  const showBrowserFilter = browserList.length > 0;
  
  const iterationTabs = iterations
    .map((iter, index) => `
    <button class="iteration-tab ${index === 0 ? 'active' : ''}" data-iteration="${iter}" onclick="switchIteration('${iter}')">
      <span>${iter}</span>
    </button>
  `)
    .join('');

  function buildScriptTabs(iter: string): string {
    const scripts = iterationMap.get(iter) || [];
    const baseCount = new Map<string, number>();
    for (const tdc of scripts) {
      const rawName = String(tdc.testDir);
      const base = stripScriptTimestamp(rawName);
      baseCount.set(base, (baseCount.get(base) || 0) + 1);
    }
    return scripts
      .map((tdc, index) => {
        const rawName = String(tdc.testDir);
        const base = stripScriptTimestamp(rawName);
        const collide = (baseCount.get(base) || 0) > 1;
        const rawSuffix = scriptTabDisambiguatorSuffix(rawName, base);
        const compactSuffix = formatScriptTabDisambiguatorSuffix(rawSuffix);
        const hasDateTimeSuffix = /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}/.test(rawSuffix);
        const display =
          collide || hasDateTimeSuffix ? `${base} · ${compactSuffix}` : base;
        return `
      <button class="script-tab ${index === 0 ? 'active' : ''}" data-iteration="${iter}" data-script="${rawName}" onclick="switchScript('${iter}', '${rawName}')" title="${iter}/${rawName}">
        <span>${display}</span>
      </button>
    `;
      })
      .join('');
  }

  function buildScriptContents(
    iter: string,
    render: (tdc: TestDirComparisons) => string,
    extraAttrs?: (tdc: TestDirComparisons) => string
  ): string {
    const scripts = iterationMap.get(iter) || [];
    const firstScript = scripts[0]?.testDir;
    return scripts
      .map((tdc) => `
      <div class="script-content" data-iteration="${iter}" data-script="${tdc.testDir}" ${tdc.testDir === firstScript ? '' : 'style="display: none;"'} ${extraAttrs ? extraAttrs(tdc) : ''}>
        ${render(tdc)}
      </div>
    `)
      .join('');
  }

  const optimizedByIteration = iterations
    .map((iter, index) => `
    <div class="iteration-content" data-iteration="${iter}" ${index === 0 ? '' : 'style="display: none;"'}>
      ${buildScriptContents(iter, (tdc) => tdc.comparisons.map((comp) => screenshotRenderer.generateOptimizedStep(comp, optDirName)).join(''))}
    </div>
  `)
    .join('');

  const optimizedDiffByIteration = iterations
    .map((iter, index) => `
    <div class="iteration-content" data-iteration="${iter}" ${index === 0 ? '' : 'style="display: none;"'}>
      ${buildScriptContents(
        iter,
        (tdc) =>
          tdc.comparisons
            .map((comp) => diffStepRenderer.generateDiffStep(comp, 'optimized') + diffStepRenderer.generateCrossBrowserDiffStep(comp))
            .join(''),
        (tdc) => {
          const c = countHelpers.getRunDriftDiffCountsForScript(tdc);
          const x = countHelpers.getCrossBrowserDiffCountsForScript(tdc);
          return `data-diff-all="${c.all + x.all}" data-diff-only="${c.only + x.only}"`;
        },
      )}
    </div>
  `)
    .join('');

  const diffOnlyByIteration = iterations
    .map((iter, index) => `
    <div class="iteration-content" data-iteration="${iter}" ${index === 0 ? '' : 'style="display: none;"'}>
      ${buildScriptContents(
        iter,
        (tdc) =>
          tdc.comparisons
            .map((comp) => diffStepRenderer.generateDiffStep(comp, 'all', true) + diffStepRenderer.generateCrossBrowserDiffStep(comp, true))
            .join(''),
        (tdc) => {
          const c = countHelpers.getDiffOnlyTabCountsForScript(tdc);
          return `data-diff-all="${c.all}" data-diff-only="${c.only}"`;
        },
      )}
    </div>
  `)
    .join('');

  // hasCrossBrowserData / totalCrossBrowser 已在 browserList 构建处计算

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>截图对比报告</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
      background: #f5f7fa;
      padding: 24px;
      color: #1d2129;
    }
    
    .header {
      background: white;
      color: #1d2129;
      padding: 24px 32px;
      border-radius: 8px;
      margin-bottom: 24px;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
      border-bottom: 3px solid #1677ff;
    }
    
    .header h1 {
      font-size: 24px;
      font-weight: 600;
      margin: 0;
      display: flex;
      align-items: center;
      gap: 12px;
    }
    
    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
      margin-bottom: 24px;
    }
    
    .stat-card {
      background: white;
      padding: 20px 24px;
      border-radius: 8px;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
      transition: all 0.2s ease;
      border: 1px solid #e8e8e8;
    }
    
    .stat-card:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    }
    
    .stat-card h3 {
      font-size: 14px;
      color: #86909c;
      margin-bottom: 12px;
      font-weight: 400;
    }
    
    .stat-card .value {
      font-size: 32px;
      font-weight: 700;
      color: #1677ff;
    }
    
    .comparison {
      background: white;
      border-radius: 8px;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
      margin-bottom: 16px;
      overflow: hidden;
      border: 1px solid #e8e8e8;
    }
    
    .comparison-header {
      background: #fafafa;
      padding: 12px 20px;
      border-bottom: 1px solid #e8e8e8;
      display: flex;
      align-items: center;
      justify-content: space-between;
      cursor: pointer;
      transition: background-color 0.2s ease;
    }
    
    .comparison-header:hover {
      background: #f5f5f5;
    }
    
    .comparison-header h2 {
      font-size: 15px;
      color: #1d2129;
      margin-bottom: 0;
      display: flex;
      align-items: center;
      gap: 10px;
      font-weight: 600;
    }

    .controls-row {
      display: flex;
      flex-direction: column;
      align-items: stretch;
      gap: 16px;
      margin-bottom: 24px;
    }

    .filter-panel {
      flex: 1 1 auto;
      min-width: 0;
      width: 100%;
      background: white;
      border: 1px solid #e8e8e8;
      border-radius: 10px;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
      padding: 16px 20px;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .filter-row {
      display: flex;
      align-items: center;
      gap: 16px;
      flex-wrap: wrap;
    }

    /* 脚本 Tab 多行换行时与「脚本：」标签顶部对齐，避免行与行贴太紧 */
    .filter-row-scripts {
      align-items: flex-start;
    }

    .filter-row-scripts .filter-label {
      padding-top: 6px;
    }

    .filter-label {
      font-size: 14px;
      font-weight: 500;
      color: #4e5969;
      white-space: nowrap;
      flex-shrink: 0;
    }

    .global-browser-buttons {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
      flex: 1;
      min-width: 0;
    }

    .controls-right {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 8px;
      width: 100%;
    }

    .controls-right-tools {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      align-items: center;
      justify-content: flex-end;
      width: 100%;
    }

    .script-search-feedback {
      font-size: 13px;
      color: #d46b08;
      width: 100%;
      text-align: right;
      line-height: 1.4;
    }

    .script-search-feedback:empty {
      display: none;
    }

    .control-input.control-input-warn {
      border-color: #faad14;
      box-shadow: 0 0 0 2px rgba(250, 173, 20, 0.12);
    }

    .control-button {
      padding: 8px 16px;
      background: white;
      border: 1px solid #d9d9d9;
      border-radius: 6px;
      cursor: pointer;
      font-size: 14px;
      font-weight: 400;
      color: #1d2129;
      transition: all 0.2s ease;
    }

    .control-button:hover {
      color: #1677ff;
      border-color: #1677ff;
      background: #e6f4ff;
    }

    .control-input {
      height: 36px;
      padding: 0 12px;
      border: 1px solid #d9d9d9;
      border-radius: 6px;
      background: white;
      font-size: 14px;
      min-width: 240px;
      transition: all 0.2s ease;
      outline: none;
    }

    .control-input:hover {
      border-color: #1677ff;
    }

    .control-input:focus {
      border-color: #1677ff;
      box-shadow: 0 0 0 2px rgba(22, 119, 255, 0.1);
    }
    
    .screenshot-badge {
      display: inline-block;
      background: #1677ff;
      color: white;
      font-size: 12px;
      font-weight: 500;
      padding: 2px 8px;
      border-radius: 4px;
      white-space: nowrap;
    }
    
    .comparison-body {
      padding: 16px;
    }
    
    .step-subsection {
      margin-bottom: 16px;
      background: white;
      border-radius: 6px;
      overflow: hidden;
      border: 1px solid #e8e8e8;
    }
    
    .step-subsection:last-child {
      margin-bottom: 0;
    }
    
    .step-subsection-header {
      background: #fafafa;
      padding: 10px 16px;
      display: flex;
      align-items: center;
      gap: 12px;
      border-bottom: 1px solid #e8e8e8;
    }
    
    .step-subsection-header h3 {
      font-size: 14px;
      font-weight: 600;
      color: #1d2129;
      margin: 0;
    }
    
    .route-info {
      font-size: 12px;
      font-weight: 400;
      color: #1677ff;
      background: #e6f4ff;
      padding: 4px 10px;
      border-radius: 4px;
      white-space: nowrap;
    }
    
    .section {
      margin-bottom: 15px;
    }
    
    .section:last-child {
      margin-bottom: 0;
    }
    
    .browser-group {
      margin-bottom: 20px;
      border: 1px solid #dee2e6;
      border-radius: 8px;
      overflow: hidden;
    }
    
    .browser-group:last-child {
      margin-bottom: 0;
    }
    
    .test-dir-tabs {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 24px;
      padding: 16px 20px;
      background: white;
      border-radius: 10px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
    }

    .iteration-tabs-container {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
      flex: 1;
      min-width: 0;
    }
    
    .iteration-tab {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 16px;
      background: #f7f8fa;
      border: 1px solid transparent;
      border-radius: 4px;
      cursor: pointer;
      font-size: 14px;
      font-weight: 400;
      color: #4e5969;
      transition: all 0.2s ease;
    }
    
    .iteration-tab:hover {
      background: #e6f4ff;
      color: #1677ff;
    }
    
    .iteration-tab.active {
      background: #1677ff;
      color: white;
      font-weight: 500;
    }

    .script-tabs-container {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: flex-start;
      flex: 1;
      min-width: 0;
    }

    .script-tabs-iteration {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-start;
      flex: 1 1 0;
      min-width: 0;
      width: 100%;
      row-gap: 12px;
      column-gap: 10px;
    }
    
    .script-tab {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 0;
      padding: 6px 16px;
      background: #f7f8fa;
      border: 1px solid transparent;
      border-radius: 4px;
      cursor: pointer;
      font-size: 14px;
      font-weight: 400;
      font-family: inherit;
      color: #4e5969;
      transition: all 0.2s ease;
      max-width: 100%;
      line-height: 1.35;
      flex-shrink: 0;
      box-sizing: border-box;
    }
    
    .script-tab:hover {
      background: #e6f4ff;
      color: #1677ff;
    }
    
    .script-tab.active {
      background: #1677ff;
      color: white;
      font-weight: 500;
    }
    
    .test-dir-tabs-label {
      font-size: 15px;
      font-weight: 600;
      color: #495057;
      white-space: nowrap;
    }
    
    .test-dir-tab {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 12px 20px;
      background: #f8f9fa;
      border: 2px solid transparent;
      border-radius: 8px;
      cursor: pointer;
      font-size: 14px;
      font-weight: 500;
      color: #495057;
      transition: all 0.2s ease;
    }
    
    .test-dir-tab:hover {
      background: #e9ecef;
      color: #212529;
      border-color: #dee2e6;
    }
    
    .test-dir-tab.active {
      background: #667eea;
      color: white;
      font-weight: 600;
      border-color: #667eea;
      box-shadow: 0 2px 6px rgba(102, 126, 234, 0.2);
    }
    
    .global-browser-tab {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 16px;
      background: #f7f8fa;
      border: 1px solid transparent;
      border-radius: 4px;
      cursor: pointer;
      font-size: 14px;
      font-weight: 400;
      color: #4e5969;
      transition: all 0.2s ease;
    }
    
    .global-browser-tab:hover {
      background: #e6f4ff;
      color: #1677ff;
    }
    
    .global-browser-tab.active {
      background: #1677ff;
      color: white;
      font-weight: 500;
    }
    
    .browser-content-section {
      display: none;
    }
    
    .browser-content-section.active {
      display: block;
    }

    .optimized-browser-empty-state {
      margin-top: 4px;
    }

    .optimized-browser-empty-state .optimized-browser-empty-inner {
      text-align: center;
      line-height: 1.6;
    }

    .optimized-browser-empty-state .optimized-browser-empty-inner strong {
      color: #1677ff;
      font-weight: 600;
    }
    
    .browser-content-inner {
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    
    .date-group {
      min-width: 0;
      width: 100%;
      overflow-x: auto;
      background: white;
      border-radius: 8px;
      padding: 16px;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
      border: 1px solid #e8e8e8;
    }
    
    .date-title {
      font-size: 14px;
      font-weight: 600;
      color: #1d2129;
      margin-bottom: 16px;
      padding: 8px 12px;
      background: #f7f8fa;
      border-left: 3px solid #1677ff;
      border-radius: 4px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    
    .date-title::before {
      content: '📅';
      font-size: 16px;
    }
    
    .screenshot-time {
      background: #f7f8fa;
      color: #86909c;
      font-size: 12px;
      font-weight: 500;
      padding: 6px 8px;
      text-align: center;
      white-space: nowrap;
      border-bottom: 1px solid #e8e8e8;
    }
    
    .screenshot-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(520px, 1fr));
      gap: 24px;
      width: 100%;
    }
    
    .screenshot-card {
      min-width: 0;
      background: white;
      border-radius: 6px;
      overflow: hidden;
      border: 1px solid #e8e8e8;
      display: flex;
      flex-direction: column;
      transition: box-shadow 0.2s ease, border-color 0.2s ease;
    }
    
    .screenshot-card:hover {
      border-color: #e8e8e8;
      box-shadow: 0 4px 16px rgba(22, 119, 255, 0.12), 0 2px 6px rgba(0, 0, 0, 0.06);
    }
    
    .screenshot-image {
      display: block;
      width: 100%;
      max-width: 100%;
      min-width: 0;
      height: auto;
      background: white;
      cursor: pointer;
    }
    
    .no-screenshots {
      text-align: center;
      padding: 32px 16px;
      color: #86909c;
      font-size: 14px;
      background: #f7f8fa;
      border-radius: 6px;
    }
    
    .diff-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(520px, 1fr));
      gap: 24px;
      width: 100%;
    }
    
    .diff-step-group {
      margin-bottom: 20px;
    }
    
    .diff-step-group:last-child {
      margin-bottom: 0;
    }
    
    .diff-step-name {
      font-size: 14px;
      font-weight: 600;
      color: #1d2129;
      margin-bottom: 12px;
      padding: 8px 12px;
      background: #f7f8fa;
      border-left: 3px solid #1677ff;
      border-radius: 4px;
    }
    
    .diff-card {
      background: white;
      border-radius: 8px;
      overflow: hidden;
      border: 1px solid #e8e8e8;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
      transition: box-shadow 0.2s ease, border-color 0.2s ease;
    }
    
    .diff-card:hover {
      border-color: #e8e8e8;
      box-shadow: 0 4px 16px rgba(22, 119, 255, 0.1), 0 2px 6px rgba(0, 0, 0, 0.05);
    }
    
    .diff-card.diff-browser-content {
      display: none;
    }
    
    .diff-card.diff-browser-content.active {
      display: block;
    }
    
    .diff-header {
      background: #f7f8fa;
      padding: 10px 15px;
      display: flex;
      align-items: center;
      gap: 10px;
      border-bottom: 1px solid #e8e8e8;
    }
    
    .diff-badge {
      font-size: 11px;
      font-weight: bold;
      color: white;
      padding: 4px 8px;
      border-radius: 4px;
    }
    
    .diff-percentage {
      font-size: 13px;
      font-weight: 600;
      color: #1d2129;
      margin-left: auto;
    }

    .diff-size-hint {
      font-size: 11px;
      color: #d46b08;
      background: #fff7e6;
      border: 1px solid #ffd591;
      padding: 2px 6px;
      border-radius: 4px;
      margin-left: 8px;
      white-space: nowrap;
    }

    .diff-no-visual {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 120px;
      background: #f7f8fa;
      border: 1px dashed #d9d9d9;
      border-radius: 6px;
      color: #86909c;
      font-size: 13px;
    }

    .diff-browser-pair {
      font-size: 12px;
      color: #1677ff;
      background: #e6f4ff;
      border: 1px solid #91caff;
      padding: 2px 8px;
      border-radius: 4px;
      white-space: nowrap;
    }

    .diff-pair-row {
      padding: 0 12px 8px;
      border-bottom: 1px solid #f0f0f0;
    }

    .diff-pair-label {
      font-size: 12px;
      color: #86909c;
      line-height: 1.4;
    }
    
    .diff-images {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
      padding: 12px;
      align-items: start;
    }
    
    @media (max-width: 640px) {
      .diff-images {
        grid-template-columns: 1fr;
      }
    }
    
    .diff-image-container {
      display: flex;
      flex-direction: column;
      gap: 6px;
      min-width: 0;
      overflow: hidden;
      border-radius: 6px;
    }
    
    .diff-image-label {
      font-size: 12px;
      color: #86909c;
      text-align: center;
      font-weight: 500;
    }
    
    .diff-image-container img {
      display: block;
      box-sizing: border-box;
      width: 100%;
      max-width: 100%;
      min-width: 0;
      height: auto;
      background: white;
      border: 1px solid #e8e8e8;
      border-radius: 6px;
      cursor: pointer;
      transition: border-color 0.2s ease, box-shadow 0.2s ease;
      box-shadow: none;
    }
    
    .diff-image-container img:hover {
      border-color: #1677ff;
      box-shadow: 0 4px 14px rgba(22, 119, 255, 0.1);
    }
    
    .modal {
      display: none;
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.75);
      z-index: 1000;
      justify-content: center;
      align-items: center;
    }
    
    .modal.active {
      display: flex;
    }
    
    .modal-content {
      max-width: 90%;
      max-height: 90%;
      background: white;
      border-radius: 8px;
      overflow: auto;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
    }
    
    .modal-image {
      width: auto;
      height: auto;
      max-width: min(100%, 100vw);
      max-height: 90vh;
      display: block;
    }
    
    .modal-close {
      position: absolute;
      top: 24px;
      right: 24px;
      background: white;
      border: 1px solid #e8e8e8;
      width: 36px;
      height: 36px;
      border-radius: 50%;
      font-size: 20px;
      cursor: pointer;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
      z-index: 1001;
      color: #1d2129;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s ease;
    }
    
    .modal-close:hover {
      background: #f7f8fa;
      border-color: #1677ff;
      color: #1677ff;
    }
    
    .tabs {
      display: flex;
      gap: 8px;
      margin-bottom: 20px;
      padding: 4px;
      background: #f7f8fa;
      border-radius: 8px;
    }
    
    .tab {
      padding: 10px 20px;
      background: transparent;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-size: 14px;
      font-weight: 500;
      color: #86909c;
      transition: all 0.2s ease;
    }
    
    .tab:hover {
      color: #1677ff;
      background: rgba(22, 119, 255, 0.05);
    }
    
    .tab.active {
      background: #1677ff;
      color: white;
      font-weight: 600;
    }
    
    .issues-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
      margin-top: 12px;
    }
    .issues-table th,
    .issues-table td {
      border: 1px solid #e5e7eb;
      padding: 8px 10px;
      text-align: left;
    }
    .issues-table th {
      background: #f9fafb;
    }
    .severity-badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
    }
    .severity-blocker { background: #fee2e2; color: #b91c1c; }
    .severity-warning { background: #fef3c7; color: #b45309; }
    .severity-noise { background: #f3f4f6; color: #6b7280; }
    .issues-summary { margin: 16px 0 8px; color: #374151; }
    .issues-hint { font-size: 12px; color: #6b7280; }
    .issues-raw-count {
      display: inline-block;
      min-width: 1.25rem;
      padding: 0 6px;
      font-size: 12px;
      font-weight: 600;
      color: #4b5563;
      background: #f3f4f6;
      border-radius: 10px;
      text-align: center;
    }
    .issues-diff-thumb {
      display: block;
      max-width: 200px;
      max-height: 120px;
      width: auto;
      height: auto;
      object-fit: contain;
      border: 1px solid #e5e7eb;
      border-radius: 4px;
      cursor: pointer;
      background: #f9fafb;
    }
    .issues-diff-thumb:hover {
      border-color: #1677ff;
      box-shadow: 0 0 0 2px rgba(22, 119, 255, 0.12);
    }
    .issues-table th[data-sort] { cursor: pointer; user-select: none; }
    .issues-table th[data-sort]:hover { background: #e6f4ff; }
    .issues-table th[data-sort] .sort-arrow { font-size: 10px; margin-left: 3px; color: #adb5bd; }
    .issues-table th[data-sort] .sort-arrow.active { color: #1677ff; }
    .issues-table .issues-filter-row { transition: background 0.15s ease; }
    .issues-table .issues-filter-row:hover { background: #f0f7ff; }
    .analysis-wrap { padding: 16px 20px 24px; max-width: 1200px; }
    .analysis-heading { margin: 20px 0 10px; font-size: 16px; color: #111827; }
    .analysis-heading:first-child { margin-top: 0; }
    .analysis-hint { font-size: 13px; color: #6b7280; margin: 8px 0 16px; line-height: 1.5; }
    .analysis-flow { font-size: 13px; color: #374151; margin: 0 0 8px; }
    .analysis-meta { font-size: 12px; color: #6b7280; margin: 0 0 8px; }
    .analysis-script-title { margin: 16px 0 6px; font-size: 14px; color: #1f2937; }
    .analysis-table { margin-bottom: 8px; }
    .analysis-overview-table th { width: 100px; background: #f3f4f6; font-weight: 600; }
    .analysis-suggestions { margin: 8px 0 20px 18px; font-size: 13px; color: #4b5563; line-height: 1.5; }

    .tab-content {
      display: none;
    }
    
    .tab-content.active {
      display: block;
      animation: fadeIn 0.3s ease;
    }
    
    @keyframes fadeIn {
      from {
        opacity: 0;
        transform: translateY(10px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }
    
    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 60px 20px;
      text-align: center;
      background: white;
      border-radius: 8px;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
      border: 1px solid #e8e8e8;
    }
    
    .empty-state-icon {
      font-size: 48px;
      margin-bottom: 16px;
    }
    
    .empty-state-title {
      font-size: 16px;
      font-weight: 600;
      color: #1d2129;
      margin-bottom: 8px;
    }
    
    .empty-state-description {
      font-size: 14px;
      color: #86909c;
      line-height: 1.55;
      text-align: left;
      max-width: 520px;
      margin: 0 auto;
      width: 100%;
    }
    
    .empty-state-description .empty-state-hint {
      margin: 0;
      padding-left: 1.25em;
      list-style: disc;
    }
    
    .empty-state-description .empty-state-hint li + li {
      margin-top: 0.45em;
    }
    ${compareReportVizCss()}
  </style>
</head>
<body>
  <div class="header">
    <h1>📸 截图对比报告</h1>
  </div>

  ${overviewHtml}

  <div class="controls-row">
    <div class="controls-right">
      <div class="controls-right-tools">
        <input class="control-input" id="scriptSearch" placeholder="搜索脚本：展示名、完整路径（如 260515/我的审批_… 或关键词）" oninput="filterScripts(this.value)" />
        <button class="control-button" onclick="collapseAll(true)">折叠全部</button>
        <button class="control-button" onclick="collapseAll(false)">展开全部</button>
      </div>
      <span class="script-search-feedback" id="scriptSearchFeedback" role="status" aria-live="polite"></span>
    </div>

    <div class="filter-panel" role="region" aria-label="筛选">
      <div class="filter-row filter-row-tools">
        <span class="filter-label">Diff 筛选：</span>
        <select id="vizFilterSeverity" style="padding:5px 10px;border:1px solid #d6d8db;border-radius:4px;font-size:13px"><option value="all">全部级别</option><option value="blocker">Blocker</option><option value="warning">Warning</option><option value="noise">Noise</option></select>
        <select id="vizFilterKind" style="padding:5px 10px;border:1px solid #d6d8db;border-radius:4px;font-size:13px"><option value="all">全部类型</option><option value="same-browser">同浏览器</option>${crossBrowserOn ? '<option value="cross-browser">跨浏览器</option>' : ''}</select>
        <input type="search" id="vizFilterSearch" placeholder="步骤名…" style="padding:5px 10px;border:1px solid #d6d8db;border-radius:4px;font-size:13px;min-width:160px" />
        <span style="font-size:12px;color:#86909c">方向键切换 diff 卡片 · 卡片默认滑块对比</span>
      </div>
      <div class="filter-row">
        <span class="filter-label">迭代：</span>
        <div class="iteration-tabs-container">
          ${iterationTabs}
        </div>
      </div>
      <div class="filter-row filter-row-scripts">
        <span class="filter-label">脚本：</span>
        <div class="script-tabs-container">
          ${iterations
            .map((iter) => `<div class="script-tabs-iteration" data-iteration="${iter}" ${
              iter === firstIteration ? '' : 'style="display: none;"'
            }>${buildScriptTabs(iter)}</div>`)
            .join('')}
        </div>
      </div>
      ${showBrowserFilter ? `
      <div class="filter-row">
        <span class="filter-label">浏览器：</span>
        <div class="global-browser-buttons">
          ${browserList.map((browser, index) => `
          <button class="global-browser-tab ${index === 0 ? 'active' : ''}" data-browser="${browser}" onclick="switchGlobalBrowser('${browser}')" title="${browser === 'cross' ? 'Chrome 基线 vs WebKit 同步骤对比' : ''}">
            ${getBrowserIcon(browser)}
            <span>${getBrowserFilterLabel(browser)}</span>
          </button>
          `).join('')}
        </div>
      </div>` : ''}
    </div>
  </div>
  
  <div class="tabs">
    <button class="tab active" data-report-tab="optimized" onclick="switchTab('optimized')">Optimized 版本</button>
    <button class="tab" data-report-tab="optimized-diff" onclick="switchTab('optimized-diff')">Optimized 差异</button>
    <button class="tab" data-report-tab="diff-only" onclick="switchTab('diff-only')">有差异</button>
    <button class="tab" data-report-tab="heatmap" onclick="switchTab('heatmap')">热力图</button>
    <button class="tab" data-report-tab="summary" onclick="switchTab('summary')">对比一览</button>
    <button class="tab" data-report-tab="analysis" onclick="switchTab('analysis')">分析摘要</button>
    <button class="tab" data-report-tab="issues" onclick="switchTab('issues')">问题明细</button>
  </div>
  
  <div id="optimized-content" class="tab-content active">
    ${optimizedByIteration}
  </div>
  
  <div id="optimized-diff-content" class="tab-content">
    <div class="empty-state" id="optimized-diff-empty" style="display: none;">
      <div class="empty-state-icon">📋</div>
      <div class="empty-state-title">暂无可展示的对比</div>
      <div class="empty-state-description">
        <ul class="empty-state-hint">
          <li>本 Tab 展示<strong>同浏览器两次运行</strong>的差异${crossBrowserOn ? '，以及<strong>Chrome ↔ WebKit 跨浏览器</strong>对比' : ''}；不含 Golden 基线对比（见「问题明细」）。</li>
          <li>同一浏览器若只有一次运行，不会出现运行间对比。</li>
          ${crossBrowserOn ? '<li>跨浏览器需同时存在 run-chromium-optimized 与 run-webkit-optimized 下的同步骤截图。</li>' : ''}
        </ul>
      </div>
    </div>
    ${optimizedDiffByIteration}
  </div>

  <div id="diff-only-content" class="tab-content">
    <div class="empty-state" id="diff-only-empty" style="display: none;">
      <div class="empty-state-icon">📋</div>
      <div class="empty-state-title">暂无需要单独关注的差异</div>
      <div class="empty-state-description">
        <ul class="empty-state-hint">
          <li>本 Tab 展示 Golden / 运行间${crossBrowserOn ? ' / 跨浏览器' : ''}中<strong>超过阈值</strong>的差异；Golden 明细见「问题明细」。</li>
          <li>若预期应有项却为空，可切换「浏览器」${crossBrowserOn ? '（含跨浏览器）' : ''}，或确认是否只有单次运行。</li>
          <li>需要在本 Tab 看到更多项时，可调低生成报告时的「有差异」收录比例。</li>
        </ul>
      </div>
    </div>
    ${diffOnlyByIteration}
  </div>

  <div id="heatmap-content" class="tab-content">
    ${heatmapHtml}
  </div>

  <div id="summary-content" class="tab-content">
    ${summaryHtml}
  </div>

  <div id="analysis-content" class="tab-content">
    ${analysisHtml || '<div class="empty-state"><div class="empty-state-title">暂无分析</div></div>'}
  </div>

  <div id="issues-content" class="tab-content">
    ${renderIssuesTabHtml(uiIssues, {
      isCompareCrossBrowserEnabled,
      renderInlineDiffThumb: diffRenderer.renderInlineDiffThumb,
    })}
  </div>
  
  <div class="modal" id="modal" onclick="if (event.target === this) closeModal()">
    <button class="modal-close" onclick="closeModal()">&times;</button>
    <div class="modal-content">
      <img class="modal-image" id="modalImage" src="" alt="截图预览">
    </div>
  </div>

  <div class="compare-modal" id="compareModal">
    <div class="compare-modal-bar">
      <span>完整对比（同步滚动）</span>
      <button type="button" class="control-button" onclick="closeCompareModal()">关闭 Esc</button>
    </div>
    <div class="compare-modal-body">
      <div class="compare-modal-pane" onscroll="syncModalScroll(this)"><div class="diff-image-label">基线</div><img class="cm-before" src="" alt="基线"></div>
      <div class="compare-modal-pane" onscroll="syncModalScroll(this)"><div class="diff-image-label">当前</div><img class="cm-after" src="" alt="当前"></div>
    </div>
  </div>
  
  <script>
    function openModal(src) {
      const modal = document.getElementById('modal');
      const modalImage = document.getElementById('modalImage');
      modalImage.src = src;
      modal.classList.add('active');
    }
    
    function closeModal() {
      const modal = document.getElementById('modal');
      modal.classList.remove('active');
    }
    
    function switchTab(tabName) {
      const tabs = document.querySelectorAll('.tab');
      const contents = document.querySelectorAll('.tab-content');
      
      tabs.forEach(function(tab) {
        tab.classList.remove('active');
      });
      contents.forEach(function(content) {
        content.classList.remove('active');
      });
      
      const targetTab = Array.from(tabs).find(function(tab) {
        return tab.getAttribute('onclick').includes(tabName);
      });
      if (targetTab) targetTab.classList.add('active');
      const targetContent = document.getElementById(tabName + '-content');
      if (targetContent) targetContent.classList.add('active');
      
      initDiffCards(targetContent || document);
      
      const activeBrowserTab = document.querySelector('.global-browser-tab.active');
      const gbTabs = document.querySelectorAll('.global-browser-tab');
      const browser = gbTabs.length
        ? (activeBrowserTab ? activeBrowserTab.getAttribute('data-browser') : gbTabs[0].getAttribute('data-browser'))
        : null;
      switchGlobalBrowser(browser);
    }
    
    function switchIteration(iteration) {
      const iterTabs = document.querySelectorAll('.iteration-tab');
      const iterContents = document.querySelectorAll('.iteration-content');
      
      iterTabs.forEach(function(tab) {
        tab.classList.remove('active');
      });
      iterContents.forEach(function(content) {
        content.style.display = 'none';
      });
      
      const targetTab = document.querySelector('.iteration-tab[data-iteration=\"' + iteration + '\"]');
      // 每个主 Tab 内各有一份 .iteration-content；只打开第一份会导致差异 Tab 整段仍为 display:none。
      document.querySelectorAll('.iteration-content[data-iteration=\"' + iteration + '\"]').forEach(function(content) {
        content.style.display = 'block';
      });
      if (targetTab) targetTab.classList.add('active');

      const allScriptRows = document.querySelectorAll('.script-tabs-iteration');
      allScriptRows.forEach(function(row) {
        row.style.display = 'none';
      });
      const scriptRow = document.querySelector('.script-tabs-iteration[data-iteration=\"' + iteration + '\"]');
      // 必须用 flex（与 .script-tabs-iteration 样式一致）。设成 block 会取消 gap/换行间距，按钮会挤叠。
      if (scriptRow) scriptRow.style.display = 'flex';
      
      // 激活该迭代下第一个脚本
      const firstScriptTab = scriptRow ? scriptRow.querySelector('.script-tab') : null;
      if (firstScriptTab) {
        const script = firstScriptTab.getAttribute('data-script');
        if (script) switchScript(iteration, script);
      }

      const searchInput = document.getElementById('scriptSearch');
      if (searchInput && String(searchInput.value || '').trim()) {
        filterScripts(searchInput.value);
      }
      
      const activeBrowserTab = document.querySelector('.global-browser-tab.active');
      const gbTabs = document.querySelectorAll('.global-browser-tab');
      const browser = gbTabs.length
        ? (activeBrowserTab ? activeBrowserTab.getAttribute('data-browser') : gbTabs[0].getAttribute('data-browser'))
        : null;
      switchGlobalBrowser(browser);
    }

    function switchScript(iteration, script) {
      const scriptTabs = document.querySelectorAll('.script-tab[data-iteration=\"' + iteration + '\"]');
      const scriptContents = document.querySelectorAll('.script-content[data-iteration=\"' + iteration + '\"]');

      scriptTabs.forEach(function(tab) {
        tab.classList.remove('active');
      });
      scriptContents.forEach(function(content) {
        content.style.display = 'none';
      });

      const targetTab = document.querySelector('.script-tab[data-iteration=\"' + iteration + '\"][data-script=\"' + script + '\"]');
      // 三个主 Tab 各有一份同名 .script-content；querySelector 只会打开 Optimized 里的第一份，差异 Tab 内面板会一直是 display:none。
      document.querySelectorAll('.script-content[data-iteration=\"' + iteration + '\"][data-script=\"' + script + '\"]').forEach(function(panel) {
        panel.style.display = 'block';
      });
      if (targetTab) targetTab.classList.add('active');

      const activeBrowserTab = document.querySelector('.global-browser-tab.active');
      const gbTabs = document.querySelectorAll('.global-browser-tab');
      const browser = gbTabs.length
        ? (activeBrowserTab ? activeBrowserTab.getAttribute('data-browser') : gbTabs[0].getAttribute('data-browser'))
        : null;
      switchGlobalBrowser(browser);
    }

    function setScriptSearchFeedback(message) {
      const fb = document.getElementById('scriptSearchFeedback');
      const input = document.getElementById('scriptSearch');
      if (fb) fb.textContent = message || '';
      if (input) {
        if (message) input.classList.add('control-input-warn');
        else input.classList.remove('control-input-warn');
      }
    }

    function filterScripts(query) {
      const activeIterTab = document.querySelector('.iteration-tab.active');
      const iteration = activeIterTab ? activeIterTab.getAttribute('data-iteration') : null;
      if (!iteration) return;

      const q = String(query || '').trim().toLowerCase();
      const tabs = document.querySelectorAll('.script-tab[data-iteration=\"' + iteration + '\"]');
      const tabArr = Array.prototype.slice.call(tabs);

      tabArr.forEach(function(tab) {
        const label = (tab.textContent || '').trim().toLowerCase();
        const title = (tab.getAttribute('title') || '').toLowerCase();
        const scriptKey = (tab.getAttribute('data-script') || '').toLowerCase();
        const hit = q.length === 0 || label.includes(q) || title.includes(q) || scriptKey.includes(q);
        tab.style.display = hit ? 'flex' : 'none';
      });

      if (q.length === 0) {
        setScriptSearchFeedback('');
        return;
      }

      const visible = tabArr.filter(function(t) { return t.style.display !== 'none'; });
      if (visible.length === 0) {
        setScriptSearchFeedback('当前迭代下无匹配脚本，已恢复显示全部');
        tabArr.forEach(function(t) { t.style.display = 'inline-flex'; });
        return;
      }

      setScriptSearchFeedback('');

      const active = document.querySelector('.script-tab.active[data-iteration=\"' + iteration + '\"]');
      if (!active || active.style.display === 'none') {
        const script = visible[0].getAttribute('data-script');
        if (script) switchScript(iteration, script);
      }
    }

    function toggleStep(stepNumber) {
      const body = document.getElementById('step-body-' + stepNumber);
      if (!body) return;
      const isHidden = body.style.display === 'none';
      body.style.display = isHidden ? 'block' : 'none';
    }

    function collapseAll(collapse) {
      const bodies = document.querySelectorAll('.comparison-body');
      bodies.forEach(function(body) {
        body.style.display = collapse ? 'none' : 'block';
      });
    }

    function scriptDiffPanelHasVisibleDiff(panel) {
      if (!panel) return false;
      if (window.getComputedStyle(panel).display === 'none') return false;
      let found = false;
      panel.querySelectorAll('.comparison').forEach(function(comp) {
        if (comp.querySelector('.diff-card.diff-browser-content.active')) {
          found = true;
        }
      });
      return found;
    }

    /** 当前「浏览器」下无对比卡片时隐藏步骤骨架；有则按步骤显示（仅含当前浏览器有卡片的步骤）。 */
    function updateDiffPanelComparisonVisibility(panel) {
      if (!panel || window.getComputedStyle(panel).display === 'none') return;
      panel.querySelectorAll('.comparison').forEach(function(comp) {
        var hasActive = !!comp.querySelector('.diff-card.diff-browser-content.active');
        comp.style.display = hasActive ? 'block' : 'none';
      });
    }
    
    function updateDiffEmptyStates() {
      const activeIterTab = document.querySelector('.iteration-tab.active');
      const iteration = activeIterTab ? activeIterTab.getAttribute('data-iteration') : null;
      const activeScriptTab = iteration
        ? document.querySelector('.script-tab.active[data-iteration=\"' + iteration + '\"]')
        : null;
      const script = activeScriptTab ? activeScriptTab.getAttribute('data-script') : null;
      const activeTab = document.querySelector('.tab-content.active');

      if (!iteration || !script || !activeTab) return;

      if (activeTab.id === 'optimized-diff-content') {
        const target = document.querySelector(
          '#optimized-diff-content .script-content[data-iteration=\"' + iteration + '\"][data-script=\"' + script + '\"]'
        );
        const empty = document.getElementById('optimized-diff-empty');
        if (empty && target) {
          var visible = scriptDiffPanelHasVisibleDiff(target);
          empty.style.display = visible ? 'none' : 'flex';
          updateDiffPanelComparisonVisibility(target);
        }
      }

      if (activeTab.id === 'diff-only-content') {
        const target = document.querySelector(
          '#diff-only-content .script-content[data-iteration=\"' + iteration + '\"][data-script=\"' + script + '\"]'
        );
        const empty = document.getElementById('diff-only-empty');
        if (empty && target) {
          var visible2 = scriptDiffPanelHasVisibleDiff(target);
          empty.style.display = visible2 ? 'none' : 'flex';
          updateDiffPanelComparisonVisibility(target);
        }
      }
    }
    
    function updateOptimizedBrowserEmptyStates(effectiveBrowser) {
      const root = document.getElementById('optimized-content');
      if (!root) return;
      root.querySelectorAll('.optimized-browser-empty-state').forEach(function(placeholder) {
        if (!effectiveBrowser) {
          placeholder.style.display = 'none';
          return;
        }
        const section = placeholder.closest('.section');
        if (!section) return;
        const hasBrowserBlock = section.querySelector('.browser-content-section[data-browser="' + effectiveBrowser + '"]');
        const inner = placeholder.querySelector('.optimized-browser-empty-inner');
        if (hasBrowserBlock) {
          placeholder.style.display = 'none';
          if (inner) inner.innerHTML = '';
        } else {
          placeholder.style.display = 'block';
          const availStr = section.getAttribute('data-available-browsers') || '';
          const avail = availStr.split(',').map(function(s) { return s.trim(); }).filter(Boolean);
          const names = avail.length ? avail.join('、') : '无（可检查是否仅 Firefox 等被排除的浏览器）';
          if (inner) {
            inner.innerHTML =
              '当前选中的浏览器下暂无截图。本小节数据仅在 <strong>' +
              names +
              '</strong> 下存在，请切换上方「浏览器」筛选。';
          }
        }
      });
    }

    function updateReportTabsForBrowser(effectiveBrowser) {
      const optimizedTab = document.querySelector('.tab[data-report-tab="optimized"]');
      if (optimizedTab) {
        optimizedTab.style.display = effectiveBrowser === 'cross' ? 'none' : '';
      }
      if (effectiveBrowser === 'cross') {
        const activeContent = document.querySelector('.tab-content.active');
        if (activeContent && activeContent.id === 'optimized-content') {
          switchTab('optimized-diff');
        }
      }
    }

    function issueRowMatchesGlobalBrowser(row, effectiveBrowser) {
      if (!effectiveBrowser) return true;
      var kind = row.getAttribute('data-kind') || '';
      var browser = row.getAttribute('data-browser') || '';
      if (effectiveBrowser === 'cross') {
        return kind === 'cross-browser';
      }
      if (kind === 'cross-browser') return false;
      return browser === effectiveBrowser;
    }

    function analysisRowMatchesGlobalBrowser(row, effectiveBrowser) {
      if (!effectiveBrowser) return true;
      var kinds = (row.getAttribute('data-compare-kinds') || '').split(',').filter(Boolean);
      var browsers = (row.getAttribute('data-browsers') || '').split(',').filter(Boolean);
      if (effectiveBrowser === 'cross') {
        return kinds.indexOf('cross-browser') >= 0;
      }
      if (kinds.length === 1 && kinds[0] === 'cross-browser') return false;
      if (browsers.indexOf(effectiveBrowser) < 0) return false;
      return kinds.some(function(k) { return k !== 'cross-browser'; });
    }

    function updateIssuesAnalysisBrowserFilter(effectiveBrowser) {
      var hasBrowserTabs = document.querySelectorAll('.global-browser-tab').length > 0;
      var filterBrowser = hasBrowserTabs ? effectiveBrowser : '';

      var issueRows = document.querySelectorAll('#issues-content .issues-filter-row');
      var visibleIssues = 0;
      var issueBlockers = 0;
      var issueWarnings = 0;
      issueRows.forEach(function(row) {
        var show = issueRowMatchesGlobalBrowser(row, filterBrowser);
        row.style.display = show ? '' : 'none';
        if (show) {
          visibleIssues++;
          var sev = row.getAttribute('data-severity') || '';
          if (sev === 'blocker') issueBlockers++;
          else if (sev === 'warning') issueWarnings++;
        }
      });

      var issuesTable = document.getElementById('issues-table');
      var issuesEmpty = document.getElementById('issues-browser-empty');
      if (issuesTable) {
        issuesTable.style.display = visibleIssues === 0 && issueRows.length > 0 ? 'none' : '';
      }
      if (issuesEmpty) {
        issuesEmpty.style.display = visibleIssues === 0 && issueRows.length > 0 ? 'flex' : 'none';
      }
      var issueCountEl = document.getElementById('issues-visible-count');
      var issueBlockerEl = document.getElementById('issues-blocker-count');
      var issueWarningEl = document.getElementById('issues-warning-count');
      var issueFilterNote = document.getElementById('issues-filter-note');
      if (issueCountEl && hasBrowserTabs && filterBrowser) {
        issueCountEl.textContent = String(visibleIssues);
        if (issueBlockerEl) issueBlockerEl.textContent = String(issueBlockers);
        if (issueWarningEl) issueWarningEl.textContent = String(issueWarnings);
        if (issueFilterNote) {
          var browserLabel = filterBrowser === 'cross' ? '跨浏览器' : filterBrowser;
          issueFilterNote.textContent = ' · 当前「' + browserLabel + '」筛选';
        }
      } else if (issueFilterNote) {
        issueFilterNote.textContent = '';
      }

      var analysisRows = document.querySelectorAll('#analysis-content .analysis-filter-row');
      var visibleAnalysis = 0;
      var analysisBlockers = 0;
      var analysisWarnings = 0;
      analysisRows.forEach(function(row) {
        var show = analysisRowMatchesGlobalBrowser(row, filterBrowser);
        row.style.display = show ? '' : 'none';
        if (show) {
          visibleAnalysis++;
          var sev = row.getAttribute('data-severity') || '';
          if (sev === 'blocker') analysisBlockers++;
          else if (sev === 'warning') analysisWarnings++;
        }
      });

      document.querySelectorAll('#analysis-content .analysis-script-block').forEach(function(block) {
        var rows = block.querySelectorAll('.analysis-filter-row');
        var hasVisible = false;
        Array.prototype.forEach.call(rows, function(r) {
          if (r.style.display !== 'none') hasVisible = true;
        });
        block.style.display = hasVisible ? '' : 'none';
      });

      var analysisEmpty = document.getElementById('analysis-browser-empty');
      var analysisScriptsHeading = document.querySelector('#analysis-content .analysis-scripts-heading');
      if (analysisEmpty) {
        analysisEmpty.style.display = visibleAnalysis === 0 && analysisRows.length > 0 ? 'flex' : 'none';
      }
      if (analysisScriptsHeading) {
        analysisScriptsHeading.style.display = visibleAnalysis === 0 && analysisRows.length > 0 ? 'none' : '';
      }

      var analysisFilterSummary = document.getElementById('analysis-filter-summary');
      if (analysisFilterSummary) {
        if (hasBrowserTabs && filterBrowser && analysisRows.length > 0) {
          var browserLabel = filterBrowser === 'cross' ? '跨浏览器' : filterBrowser;
          analysisFilterSummary.style.display = '';
          analysisFilterSummary.textContent =
            '当前浏览器「' + browserLabel + '」筛选：' + visibleAnalysis + ' 项 · blocker ' + analysisBlockers + ' · warning ' + analysisWarnings + '（上方总览为全量）';
        } else {
          analysisFilterSummary.style.display = 'none';
          analysisFilterSummary.textContent = '';
        }
      }
    }

    function switchGlobalBrowser(browser) {
      const tabs = document.querySelectorAll('.global-browser-tab');
      const sections = document.querySelectorAll('.browser-content-section');
      const diffCards = document.querySelectorAll('.diff-card.diff-browser-content');
      let browserForEmptyState = '';
      let effectiveBrowser = '';
      
      tabs.forEach(function(tab) {
        tab.classList.remove('active');
      });
      sections.forEach(function(section) {
        section.classList.remove('active');
      });
      diffCards.forEach(function(card) {
        card.classList.remove('active');
      });
      
      if (tabs.length === 0) {
        sections.forEach(function(section) {
          section.classList.add('active');
        });
        diffCards.forEach(function(card) {
          card.classList.add('active');
        });
      } else {
        let targetTab = browser
          ? document.querySelector('.global-browser-tab[data-browser="' + browser + '"]')
          : null;
        if (!targetTab) {
          targetTab = tabs[0];
        }
        targetTab.classList.add('active');
        effectiveBrowser = targetTab.getAttribute('data-browser') || '';
        browserForEmptyState = effectiveBrowser === 'cross' ? '' : effectiveBrowser;

        if (effectiveBrowser !== 'cross') {
          const targetSections = document.querySelectorAll('.browser-content-section[data-browser="' + effectiveBrowser + '"]');
          targetSections.forEach(function(section) {
            section.classList.add('active');
          });
        }
        const targetDiffCards = document.querySelectorAll('.diff-card.diff-browser-content[data-browser="' + effectiveBrowser + '"]');
        targetDiffCards.forEach(function(card) {
          card.classList.add('active');
        });
      }
      
      const allSubsections = document.querySelectorAll('.step-subsection');
      allSubsections.forEach(function(subsection) {
        const hasActiveSection = subsection.querySelector('.browser-content-section.active');
        const subsectionCount = subsection.querySelector('.subsection-count');
        if (subsectionCount) {
          // 有全局浏览器 Tab 时：徽章表示「当前选中浏览器」下的张数；无匹配浏览器时为 0，不能回退到 data-screenshot-total（那是全浏览器合计，会造成「显示有图但下方为空」的错觉）。
          if (!hasActiveSection) {
            subsectionCount.textContent = '0张';
          } else if (tabs.length === 0) {
            const total = subsection.getAttribute('data-screenshot-total');
            subsectionCount.textContent = (total != null && total !== '' ? total : '0') + '张';
          } else {
            const activeSection = subsection.querySelector('.browser-content-section.active');
            const count = activeSection ? activeSection.getAttribute('data-count') : null;
            subsectionCount.textContent = (count != null && count !== '' ? count : '0') + '张';
          }
        }
      });

      const optRoot = document.getElementById('optimized-content');
      if (optRoot && tabs.length > 0) {
        optRoot.querySelectorAll('.comparison').forEach(function(comparison) {
          const badge = comparison.querySelector('.comparison-header .screenshot-badge');
          if (!badge) return;
          var sum = 0;
          comparison.querySelectorAll('.browser-content-section.active').forEach(function(section) {
            var c = parseInt(section.getAttribute('data-count') || '0', 10);
            if (!isNaN(c)) sum += c;
          });
          badge.textContent = sum + '张';
        });
      }
      
      const activeTab = document.querySelector('.tab-content.active');
      if (
        activeTab &&
        (activeTab.id === 'diff-only-content' || activeTab.id === 'optimized-diff-content')
      ) {
        /* 差异类 Tab 由 updateDiffEmptyStates 控制步骤可见性 */
      } else if (activeTab && activeTab.id === 'optimized-content') {
        activeTab.querySelectorAll('.comparison').forEach(function(comparison) {
          comparison.style.display = 'block';
        });
      } else if (activeTab) {
        activeTab.querySelectorAll('.comparison').forEach(function(comparison) {
          comparison.style.display = 'block';
        });
      }

      updateOptimizedBrowserEmptyStates(browserForEmptyState);
      updateReportTabsForBrowser(effectiveBrowser);
      updateDiffEmptyStates();
      updateIssuesAnalysisBrowserFilter(effectiveBrowser);
    }
    
    document.addEventListener('DOMContentLoaded', function() {
      const activeGb = document.querySelector('.global-browser-tab.active');
      const gbTabs = document.querySelectorAll('.global-browser-tab');
      const browser = gbTabs.length
        ? (activeGb ? activeGb.getAttribute('data-browser') : gbTabs[0].getAttribute('data-browser'))
        : null;
      switchGlobalBrowser(browser);

      const activeIterTab = document.querySelector('.iteration-tab.active');
      if (activeIterTab) {
        const iteration = activeIterTab.getAttribute('data-iteration');
        if (iteration) {
          switchIteration(iteration);
        }
      }

      updateDiffEmptyStates();
    });
    
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') {
        closeModal();
        closeCompareModal();
      }
    });
    ${compareReportVizJs()}
  </script>
</body>
</html>`;
}

function hasDirectRunSegment(dir: string): boolean {
  if (!fs.existsSync(dir)) return false;
  return fs
    .readdirSync(dir)
    .filter((f) => !f.startsWith('.'))
    .some((f) => fs.statSync(path.join(dir, f)).isDirectory() && RUN_SEGMENT_DIR.test(f));
}

function discoverScriptScanTargets(screenshotsDir: string): ScriptScanTarget[] {
  const skipTop = new Set(['results', 'diffs', 'pom']);
  const targets: ScriptScanTarget[] = [];

  function walk(relativeDir: string, absDir: string): void {
    if (hasDirectRunSegment(absDir)) {
      targets.push({
        testDir: relativeDir.replaceAll(path.sep, '/'),
        scriptPath: absDir,
      });
      return;
    }

    for (const entry of fs.readdirSync(absDir).filter((f) => !f.startsWith('.'))) {
      const childAbs = path.join(absDir, entry);
      if (!fs.statSync(childAbs).isDirectory() || RUN_SEGMENT_DIR.test(entry)) continue;
      const childRel = relativeDir ? path.join(relativeDir, entry) : entry;
      walk(childRel, childAbs);
    }
  }

  for (const top of fs
    .readdirSync(screenshotsDir)
    .filter((f) => !f.startsWith('.') && !skipTop.has(f))
    .filter((f) => fs.statSync(path.join(screenshotsDir, f)).isDirectory())) {
    walk(top, path.join(screenshotsDir, top));
  }

  return targets.sort((a, b) => a.testDir.localeCompare(b.testDir, 'zh-CN'));
}

async function maybeNotifyCompareResult(comparePassed: boolean): Promise<void> {
  if (process.env.FEISHU_NOTIFY_ON_COMPARE === '0') return;
  if (!process.env.FEISHU_WEBHOOK_URL?.trim()) return;

  let testPassed = true;
  const lastRunPath = path.join(process.cwd(), 'results', 'last-test-run.json');
  if (fs.existsSync(lastRunPath)) {
    try {
      const last = JSON.parse(fs.readFileSync(lastRunPath, 'utf-8')) as { passed?: boolean };
      if (typeof last.passed === 'boolean') testPassed = last.passed;
    } catch {
      /* ignore */
    }
  }

  const mode = (process.env.FEISHU_MODE || 'interactive') as FeishuMode;
  await sendJobFeishuNotification(mode, {
    trigger: 'cli',
    testPassed,
    comparePassed,
    feishuDocAttempted: false,
    feishuDocPassed: true,
    uiIssuesSummary: readUiIssuesSummaryLine(),
  });
}

async function main() {
  const args = process.argv.slice(2);
  const gateMode = args.includes('--gate');
  const positional = args.filter((a) => !a.startsWith('--'));
  let outputPath = positional[0] || 'results/screenshot-comparison.html';
  const issuesOut = process.env.UI_ISSUES_OUT || 'results/ui-issues.json';

  const screenshotsDir = 'screenshots';

  if (!fs.existsSync(screenshotsDir)) {
    console.log(`⚠️  截图目录不存在: ${screenshotsDir}`);
    return;
  }

  const scanTargets = discoverScriptScanTargets(screenshotsDir);

  console.log('📸 正在扫描截图目录...');
  console.log(`  截图根目录: ${screenshotsDir}`);
  console.log(`  脚本数: ${scanTargets.length}`);
  console.log(`  输出文件: ${outputPath}`);
  console.log(`  并行对比: ${COMPARE_CONCURRENCY}，增量缓存: ${COMPARE_INCREMENTAL ? '开启' : '关闭'}，跨浏览器: ${isCompareCrossBrowserEnabled() ? '开启' : '关闭'}`);

  const testDirComparisons: TestDirComparisons[] = [];
  const startedAt = Date.now();
  let compareTaskCount = 0;

  for (let scriptIdx = 0; scriptIdx < scanTargets.length; scriptIdx++) {
    const { testDir, scriptPath } = scanTargets[scriptIdx]!;
    console.log(`\n🔍 [${scriptIdx + 1}/${scanTargets.length}] 处理脚本: ${testDir}`);

    const screenshots = getAllScreenshots(scriptPath, 'optimized', outputPath);

    if (screenshots.size > 0) {
      const comparisons = await generateTestComparisons(testDir, screenshots, outputPath);
      comparisons.forEach((c) => {
        compareTaskCount += (c.optimizedComparisons?.length || 0) + (c.crossBrowserComparisons?.length || 0);
      });
      testDirComparisons.push({
        testDir,
        comparisons,
      });
    }
  }

  if (testDirComparisons.length === 0) {
    console.log('\n⚠️  没有找到任何截图');
    return;
  }

  const uiIssues = collectAllUiIssues(testDirComparisons);
  const issuesReport = buildUiIssuesReport(uiIssues);
  const reviewSummary = await attachIssueReviews(issuesReport);

  const cfg = loadUiRegressionConfig();
  let comparisonTotal = 0;
  let comparisonBlocker = 0;
  let comparisonWarning = 0;
  let comparisonNoise = 0;
  for (const tdc of testDirComparisons) {
    for (const comp of tdc.comparisons) {
      for (const c of [...(comp.optimizedComparisons || []), ...(comp.crossBrowserComparisons || [])]) {
        comparisonTotal++;
        const d = c.difference ?? 0;
        const isCross = c.compareKind === 'cross-browser';
        const blockerR = isCross ? cfg.crossBrowser.blockerRatio : cfg.blockerRatio;
        const warningR = isCross ? cfg.crossBrowser.warningRatio : cfg.warningRatio;
        if (d >= blockerR) {
          if (isCross) comparisonWarning++;
          else comparisonBlocker++;
        } else if (d >= warningR) comparisonWarning++;
        else if (d > 0) comparisonNoise++;
      }
    }
  }
  issuesReport.summary.comparisonTotal = comparisonTotal;
  issuesReport.summary.comparisonBlocker = comparisonBlocker;
  issuesReport.summary.comparisonWarning = comparisonWarning;
  issuesReport.summary.comparisonNoise = comparisonNoise;

  issuesReport.plainLanguageAnalysis = buildPlainLanguageAnalysis(issuesReport);
  writeUiIssuesReport(issuesReport, issuesOut);

  const analysisMdPath = path.join(path.dirname(issuesOut), 'ui-issues-analysis.md');
  fs.writeFileSync(analysisMdPath, issuesReport.plainLanguageAnalysis.markdown, 'utf-8');

  const historyPath = appendHistorySnapshot(issuesReport);

  const html = generateHTML(
    testDirComparisons,
    '',
    '',
    false,
    true,
    uiIssues,
    issuesReport.plainLanguageAnalysis.html,
  );

  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  fs.writeFileSync(outputPath, html, 'utf-8');
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(2);
  console.log(`\n✅ 对比报告已生成: ${outputPath}`);
  const pla = issuesReport.plainLanguageAnalysis;
  console.log(`   UI 问题: ${issuesOut}（blocker ${issuesReport.summary.blocker} / warning ${issuesReport.summary.warning}）`);
  if (reviewSummary.reviewed > 0) {
    console.log(
      `   复审判定: 疑似UI ${reviewSummary.uiBug} · 需人工 ${reviewSummary.needsHuman} · 不稳定 ${reviewSummary.unstable} · 噪声 ${reviewSummary.likelyNoise}` +
        (reviewSummary.aiUpdated ? `（Vision ${reviewSummary.aiUpdated}）` : ''),
    );
  }
  if (pla) {
    console.log(
      `   分析摘要: ${analysisMdPath}（合并后 ${pla.overview.mergedRowCount} 行，原始 ${pla.overview.rawIssueCount} 条）`,
    );
  }
  console.log(`   历史快照: ${historyPath}`);
  console.log(`   对比任务: ${compareTaskCount} 项，耗时 ${elapsed}s`);

  const comparePassed = !gateShouldFail(issuesReport);
  await maybeNotifyCompareResult(comparePassed);

  if (gateMode && !comparePassed) {
    console.error(`\n❌ --gate：存在 blocker 级 UI 问题，退出码 1`);
    process.exit(1);
  }
}

main();
