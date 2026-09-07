#!/usr/bin/env tsx
/**
 * 仅对比申请单 / 审批流程截图（screenshots/flows/ 下），与 optimized 回归隔离。
 */
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import {
  COMPARE_CONCURRENCY,
  COMPARE_INCREMENTAL,
  getAllScreenshots,
  generateTestComparisons,
  type TestDirComparisons,
} from './compare-screenshots-engine.js';
import { discoverFlowScriptScanTargets } from './compare-screenshots-scan.js';
import { renderCompareReportHtml } from './compare-screenshots-report.js';
import { buildOverviewData, countComparisonSeverities } from './compare-screenshots-overview.js';
import { generateOverviewPanel, generateSummaryTableHtml } from './compare-report-viz.js';
import {
  collectAllUiIssues,
  createDiffCardRenderer,
  generateIssuesTabHtml as renderIssuesTabHtml,
  getTotalExecutions,
  buildSummaryRows,
} from './compare-screenshots-render.js';
import {
  collectBrowserFilterList,
  buildBrowserFilterRow,
  getBrowserIcon,
} from './compare-screenshots-report.js';
import { extractStepNameFromPath } from './compare-screenshots-utils.js';
import {
  buildUiIssuesReport,
  writeUiIssuesReport,
  attachIssueReviews,
} from './ui-issues-index.js';
import { gateShouldFail } from './ui-issues.js';
import { applyTriageToReport } from './issue-triage.js';
import { isCompareCrossBrowserEnabled } from './compare-screenshots-engine.js';
import { appendHistorySnapshot } from './ui-regression-history.js';
import { writeUiCompareCache, FLOW_UI_COMPARE_CACHE_FILE } from './ui-compare-cache.js';
import { writeQualityDashboard } from './generate-quality-dashboard.js';

dotenv.config({ path: path.join(process.cwd(), '.env') });

const FLOW_SCREENSHOTS_ROOT = path.join('screenshots', 'flows');
const DEFAULT_OUT = 'results/flow-screenshot-comparison.html';
const DEFAULT_ISSUES = 'results/flow-ui-issues.json';

function filterFlowTargets(targets: ReturnType<typeof discoverFlowScriptScanTargets>) {
  return targets.filter(
    (t) =>
      t.testDir.startsWith('flows/request-flow') ||
      t.testDir.startsWith('flows/approval-flow') ||
      t.testDir.startsWith('request-flow') ||
      t.testDir.startsWith('approval-flow'),
  );
}

async function main() {
  const args = process.argv.slice(2);
  const gateMode = args.includes('--gate');
  const positional = args.filter((a) => !a.startsWith('--'));
  const outputPath = positional[0] || DEFAULT_OUT;
  const issuesOut = process.env.FLOW_UI_ISSUES_OUT || DEFAULT_ISSUES;

  const scanRoot = fs.existsSync(FLOW_SCREENSHOTS_ROOT) ? FLOW_SCREENSHOTS_ROOT : 'screenshots';
  if (!fs.existsSync(scanRoot)) {
    console.error(`流程截图目录不存在: ${FLOW_SCREENSHOTS_ROOT}`);
    process.exit(1);
  }

  const scanTargets = filterFlowTargets(discoverFlowScriptScanTargets(scanRoot));
  if (scanTargets.length === 0) {
    console.error('未发现申请单/审批流程截图，请先运行 request-flow 或 approval-flow 用例');
    process.exit(1);
  }

  console.log('📸 流程截图对比（仅申请单 + 审批）');
  console.log(`  脚本数: ${scanTargets.length}`);
  console.log(`  输出: ${outputPath}`);

  const testDirComparisons: TestDirComparisons[] = [];
  const diffRenderer = createDiffCardRenderer({ getBrowserIcon });

  for (let i = 0; i < scanTargets.length; i++) {
    const { testDir, scriptPath } = scanTargets[i]!;
    console.log(`\n[${i + 1}/${scanTargets.length}] ${testDir}`);
    const screenshots = getAllScreenshots(scriptPath, 'optimized', outputPath);
    if (screenshots.size === 0) continue;
    const comparisons = await generateTestComparisons(testDir, screenshots, outputPath);
    testDirComparisons.push({ testDir, comparisons });
  }

  if (testDirComparisons.length === 0) {
    console.error('无可用步骤 PNG');
    process.exit(1);
  }

  const uiIssues = collectAllUiIssues(testDirComparisons);
  const issuesReport = buildUiIssuesReport(uiIssues);
  await attachIssueReviews(issuesReport);
  applyTriageToReport(issuesReport);

  for (const tdc of testDirComparisons) {
    const metaPath = path.join('screenshots-baseline', tdc.testDir, 'run-chromium-optimized', '.baseline-meta.json');
    if (!fs.existsSync(metaPath)) continue;
    try {
      const bm = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as { revision?: number };
      if (typeof bm.revision === 'number') {
        issuesReport.baselineRevision = bm.revision;
        break;
      }
    } catch {
      /* ignore */
    }
  }

  const counts = countComparisonSeverities(testDirComparisons);
  issuesReport.summary.comparisonTotal = counts.total;
  issuesReport.summary.comparisonBlocker = counts.blocker;
  issuesReport.summary.comparisonWarning = counts.warning;
  issuesReport.summary.comparisonNoise = counts.noise;

  writeUiIssuesReport(issuesReport, issuesOut);

  try {
    const { writeFeedbackDocsFromReport } = await import('./ui-feedback-doc.js');
    const docIndex = writeFeedbackDocsFromReport(issuesReport, {
      env: process.env.PLAYWRIGHT_ENV,
    });
    writeUiIssuesReport(issuesReport, issuesOut);
    if (docIndex.docs.length) {
      console.log(`   AI 分析文档: ${docIndex.docs.length} 条 → results/ui-feedback-docs/latest.md（compact）`);
    }
  } catch (e) {
    console.log(`   ⚠️  AI 分析文档生成跳过: ${e instanceof Error ? e.message : String(e)}`);
  }

  const driftCount = issuesReport.issues.filter((i) => i.structureType === 'selector-drift').length;
  if (driftCount > 0) {
    try {
      const { buildSelectorDriftSuggest, writeSelectorDriftSuggest } = await import('./selector-drift-suggest.js');
      const driftReport = buildSelectorDriftSuggest(process.cwd(), issuesReport.issues);
      writeSelectorDriftSuggest(process.cwd(), driftReport, 'results/selector-drift-suggest.json');
      console.log(`   selector-drift 建议 ${driftReport.patches.length} 条 → results/selector-drift-suggest.json`);
      if (driftReport.patches.length) {
        console.log('   写回: npm run selector-drift:apply -- --dry-run  或  npm run selector-drift:apply');
      }
    } catch (e) {
      console.log(`   ⚠️  selector-drift 建议生成跳过: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const historyPath = appendHistorySnapshot(issuesReport, { source: 'flow' });
  console.log(`   日快照: ${historyPath}`);
  writeUiCompareCache({ generatedAt: issuesReport.generatedAt, testDirs: testDirComparisons }, FLOW_UI_COMPARE_CACHE_FILE);

  const allComparisons = testDirComparisons.flatMap((t) => t.comparisons);
  const overviewData = buildOverviewData(testDirComparisons, {
    totalSteps: allComparisons.length,
    totalScreenshots: allComparisons.reduce((s, c) => s + c.optimizedScreenshots.length, 0),
    totalExecutions: getTotalExecutions(allComparisons, false),
  });
  const overviewHtml = generateOverviewPanel(overviewData);
  const summaryHtml = generateSummaryTableHtml(buildSummaryRows(testDirComparisons, extractStepNameFromPath));
  const browserList = collectBrowserFilterList(allComparisons, false);

  const html = renderCompareReportHtml({
    overviewHtml,
    browserFilterRow: buildBrowserFilterRow(browserList),
    summaryHtml,
    analysisHtml: '<p>本报告仅包含<strong>申请单流程</strong>与<strong>审批流程</strong>的步骤截图对比；多角色时按 <code>by-account/&lt;slug&gt;</code> 拆分，同一角色与自身 Golden 对比，不同角色互不混比。</p>',
    issuesHtml: renderIssuesTabHtml(uiIssues, {
      isCompareCrossBrowserEnabled,
      renderInlineDiffThumb: diffRenderer.renderInlineDiffThumb,
    }),
  });

  const outAbs = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(outAbs), { recursive: true });
  fs.writeFileSync(outAbs, html, 'utf-8');

  console.log(`\n✅ 流程对比报告: ${outputPath}`);
  console.log(`   对比项 ${counts.total} · blocker ${counts.blocker} · warning ${counts.warning}`);
  if (typeof issuesReport.baselineRevision === 'number') {
    console.log(`   基线 revision: ${issuesReport.baselineRevision}`);
  }
  console.log(`   并行 ${COMPARE_CONCURRENCY} · 增量 ${COMPARE_INCREMENTAL ? '开' : '关'}`);

  if (process.env.AUTO_QUALITY_DASHBOARD !== '0') {
    try {
      const dash = writeQualityDashboard();
      console.log(`   质量看板: ${dash}`);
    } catch (err) {
      console.warn(`   质量看板生成跳过: ${(err as Error).message}`);
    }
  }

  if (gateMode && gateShouldFail(issuesReport)) {
    console.error(`\n❌ --gate：流程 UI 存在 blocker 级问题，退出码 1`);
    process.exit(1);
  }

  if (gateMode && !gateShouldFail(issuesReport) && testDirComparisons.length) {
    const keys = [...new Set(testDirComparisons.map((t) => t.testDir.replace(/\\/g, '/')))].slice(0, 3);
    console.log(`\n💡 compare gate 通过 · 可 promote 基线：`);
    for (const key of keys) {
      console.log(`   npm run promote-baseline -- --script=${key} --latest --browser=chrome`);
    }
    console.log(`   Job 自动：test-jobs.json steps.promoteBaselineIfClean=true`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
