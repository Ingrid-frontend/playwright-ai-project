import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import type { ImageComparison } from './image-diff.js';
import {
  COMPARE_CONCURRENCY,
  COMPARE_INCREMENTAL,
  getAllScreenshots,
  generateTestComparisons,
  isCompareCrossBrowserEnabled,
  type TestDirComparisons,
} from './compare-screenshots-engine.js';
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
  generateVisualReviewTabHtml,
} from './compare-report-viz.js';
import {
  collectAllUiIssues,
  createCountHelpers,
  createDiffCardRenderer,
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
  getMenuNameByRoute,
  scriptDirTimestampMs,
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
    visualReviewHtml: generateVisualReviewTabHtml(uiIssues),
  });
}

async function maybeNotifyCompareResult(comparePassed: boolean): Promise<void> {
  if (process.env.FEISHU_NOTIFY_ON_COMPARE === '0') return;
  const hasApp =
    Boolean(process.env.FEISHU_CHAT_ID?.trim()) && Boolean(process.env.FEISHU_APP_ID?.trim());
  if (!hasApp && !process.env.FEISHU_WEBHOOK_URL?.trim()) return;

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
