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
import { isDisabledViewportScreenshot, resolveCompareCrossBrowser, resolveCrossBrowserPixelmatch, resolveSameBrowserPixelmatch } from './ui-regression-config.js';
import { readUiIssuesSummaryLine, sendJobFeishuNotification } from '../jobs/job-notify.js';
import type { FeishuMode } from '../jobs/test-jobs-config.js';
import {
  buildUiIssuesReport,
  gateShouldFail,
  writeUiIssuesReport,
  type UiIssue,
  buildPlainLanguageAnalysis,
  attachIssueReviews,
} from './ui-issues-index.js';
import { appendHistorySnapshot, loadStepTrends, type StepTrendPoint } from './ui-regression-history.js';
import {
  generateHeatmapTabHtml,
  generateOverviewPanel,
  generateSummaryTableHtml,
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
  getTotalExecutions,
  buildScriptContents,
  buildIterationMap,
  sortIterationScripts,
  buildSummaryRows,
} from './compare-screenshots-render.js';
import { buildOverviewData, countComparisonSeverities } from './compare-screenshots-overview.js';
import {
  buildIterationTabs,
  buildIterationPanes,
  buildScriptTabRows,
  collectBrowserFilterList,
  buildBrowserFilterRow,
  getBrowserIcon,
  renderCompareReportHtml,
} from './compare-screenshots-report.js';
import { discoverScriptScanTargets } from './compare-screenshots-scan.js';
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

/** 跨浏览器对比：Chrome(基线) vs WebKit。关闭：config compareCrossBrowser 或 PLAYWRIGHT_COMPARE_CROSS_BROWSER=0 */
function isCompareCrossBrowserEnabled(): boolean {
  return resolveCompareCrossBrowser();
}

const CROSS_BROWSER_BASE = 'chrome';
const CROSS_BROWSER_TARGET = 'webkit';

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
  _pomDirName: string,
  optDirName: string,
  _hasPomData: boolean,
  _hasOptimizedData: boolean,
  uiIssues: UiIssue[] = [],
  analysisHtml: string = '',
): string {
  currentStepTrends = loadStepTrends();
  const crossBrowserOn = isCompareCrossBrowserEnabled();
  const heatmapHtml = generateHeatmapTabHtml(uiIssues);

  const allComparisons = testDirComparisons.flatMap(tdc => tdc.comparisons);
  const totalScreenshotCount = allComparisons.reduce((sum, c) => sum + c.optimizedScreenshots.length, 0);
  const totalExecCount = getTotalExecutions(allComparisons, POM_ENABLED);

  const overviewData = buildOverviewData(testDirComparisons, {
    totalSteps: allComparisons.length,
    totalScreenshots: totalScreenshotCount,
    totalExecutions: totalExecCount,
  });
  const overviewHtml = generateOverviewPanel(overviewData);

  const summaryRows = buildSummaryRows(testDirComparisons, extractStepNameFromPath);
  const summaryHtml = generateSummaryTableHtml(summaryRows);

  const iterationMap = buildIterationMap(testDirComparisons);
  sortIterationScripts(iterationMap, scriptDirTimestampMs);
  const iterations = Array.from(iterationMap.keys());
  const firstIteration = iterations[0];

  const totalCrossBrowser = crossBrowserOn ? countHelpers.getTotalCrossBrowserComparisons(testDirComparisons) : 0;
  const hasCrossBrowserData = totalCrossBrowser > 0;
  const browserList = collectBrowserFilterList(allComparisons, hasCrossBrowserData);

  const optimizedByIteration = buildIterationPanes(iterations, (iter) =>
    buildScriptContents(iter, (tdc) => tdc.comparisons.map((comp) => screenshotRenderer.generateOptimizedStep(comp, optDirName)).join(''), undefined, iterationMap),
  );

  const optimizedDiffByIteration = buildIterationPanes(iterations, (iter) =>
    buildScriptContents(
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
      iterationMap,
    ),
  );

  const diffOnlyByIteration = buildIterationPanes(iterations, (iter) =>
    buildScriptContents(
      iter,
      (tdc) =>
        tdc.comparisons
          .map((comp) => diffStepRenderer.generateDiffStep(comp, 'all', true) + diffStepRenderer.generateCrossBrowserDiffStep(comp, true))
          .join(''),
      (tdc) => {
        const c = countHelpers.getDiffOnlyTabCountsForScript(tdc);
        return `data-diff-all="${c.all}" data-diff-only="${c.only}"`;
      },
      iterationMap,
    ),
  );

  return renderCompareReportHtml({
    overviewHtml,
    iterationTabs: buildIterationTabs(iterations),
    scriptTabRows: buildScriptTabRows(iterations, firstIteration, iterationMap),
    browserFilterRow: buildBrowserFilterRow(browserList),
    crossBrowserOn,
    optimizedByIteration,
    optimizedDiffByIteration,
    diffOnlyByIteration,
    heatmapHtml,
    summaryHtml,
    analysisHtml,
    issuesHtml: renderIssuesTabHtml(uiIssues, {
      isCompareCrossBrowserEnabled,
      renderInlineDiffThumb: diffRenderer.renderInlineDiffThumb,
    }),
  });
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

  const comparisonCounts = countComparisonSeverities(testDirComparisons);
  issuesReport.summary.comparisonTotal = comparisonCounts.total;
  issuesReport.summary.comparisonBlocker = comparisonCounts.blocker;
  issuesReport.summary.comparisonWarning = comparisonCounts.warning;
  issuesReport.summary.comparisonNoise = comparisonCounts.noise;

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
