import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
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
import { applyTriageToReport } from './issue-triage.js';
import { appendHistorySnapshot } from './ui-regression-history.js';
import {
  generateOverviewPanel,
  generateSummaryTableHtml,
} from './compare-report-viz.js';
import {
  collectAllUiIssues,
  createDiffCardRenderer,
  generateIssuesTabHtml as renderIssuesTabHtml,
  getTotalExecutions,
  buildSummaryRows,
} from './compare-screenshots-render.js';
import { buildOverviewData, countComparisonSeverities } from './compare-screenshots-overview.js';
import {
  collectBrowserFilterList,
  buildBrowserFilterRow,
  getBrowserIcon,
  renderCompareReportHtml,
} from './compare-screenshots-report.js';
import { discoverScriptScanTargets } from './compare-screenshots-scan.js';
import { extractStepNameFromPath } from './compare-screenshots-utils.js';

dotenv.config({ path: path.join(process.cwd(), '.env') });

const POM_ENABLED = process.env.ENABLE_POM === '1';
const diffRenderer = createDiffCardRenderer({ getBrowserIcon });

function generateHTML(
  testDirComparisons: TestDirComparisons[],
  _pomDirName: string,
  _optDirName: string,
  _hasPomData: boolean,
  _hasOptimizedData: boolean,
  uiIssues: UiIssue[] = [],
  analysisHtml: string = '',
): string {
  const crossBrowserOn = isCompareCrossBrowserEnabled();
  const allComparisons = testDirComparisons.flatMap((tdc) => tdc.comparisons);
  const totalScreenshotCount = allComparisons.reduce(
    (sum, c) => sum + c.optimizedScreenshots.length,
    0,
  );
  const totalExecCount = getTotalExecutions(allComparisons, POM_ENABLED);

  const overviewData = buildOverviewData(testDirComparisons, {
    totalSteps: allComparisons.length,
    totalScreenshots: totalScreenshotCount,
    totalExecutions: totalExecCount,
  });
  const overviewHtml = generateOverviewPanel(overviewData);

  const summaryRows = buildSummaryRows(testDirComparisons, extractStepNameFromPath);
  const summaryHtml = generateSummaryTableHtml(summaryRows);

  const totalCrossBrowser = crossBrowserOn
    ? allComparisons.reduce((n, c) => n + (c.crossBrowserComparisons?.length || 0), 0)
    : 0;
  const browserList = collectBrowserFilterList(allComparisons, totalCrossBrowser > 0);

  return renderCompareReportHtml({
    overviewHtml,
    browserFilterRow: buildBrowserFilterRow(browserList),
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
  applyTriageToReport(issuesReport);

  const comparisonCounts = countComparisonSeverities(testDirComparisons);
  issuesReport.summary.comparisonTotal = comparisonCounts.total;
  issuesReport.summary.comparisonBlocker = comparisonCounts.blocker;
  issuesReport.summary.comparisonWarning = comparisonCounts.warning;
  issuesReport.summary.comparisonNoise = comparisonCounts.noise;

  issuesReport.plainLanguageAnalysis = buildPlainLanguageAnalysis(issuesReport);

  const firstScript = testDirComparisons[0]?.testDir;
  if (firstScript) {
    const metaPath = path.join(
      'screenshots-baseline',
      firstScript,
      'run-chromium-optimized',
      '.baseline-meta.json',
    );
    if (fs.existsSync(metaPath)) {
      try {
        const bm = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as { revision?: number };
        if (typeof bm.revision === 'number') issuesReport.baselineRevision = bm.revision;
      } catch {
        /* ignore */
      }
    }
  }

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
