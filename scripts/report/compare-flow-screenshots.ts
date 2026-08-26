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
import { discoverScriptScanTargets } from './compare-screenshots-scan.js';
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
import { applyTriageToReport } from './issue-triage.js';
import { isCompareCrossBrowserEnabled } from './compare-screenshots-engine.js';

dotenv.config({ path: path.join(process.cwd(), '.env') });

const FLOW_SCREENSHOTS_ROOT = path.join('screenshots', 'flows');
const DEFAULT_OUT = 'results/flow-screenshot-comparison.html';
const DEFAULT_ISSUES = 'results/flow-ui-issues.json';

function filterFlowTargets(targets: ReturnType<typeof discoverScriptScanTargets>) {
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
  const positional = args.filter((a) => !a.startsWith('--'));
  const outputPath = positional[0] || DEFAULT_OUT;
  const issuesOut = process.env.FLOW_UI_ISSUES_OUT || DEFAULT_ISSUES;

  const scanRoot = fs.existsSync(FLOW_SCREENSHOTS_ROOT) ? FLOW_SCREENSHOTS_ROOT : 'screenshots';
  if (!fs.existsSync(scanRoot)) {
    console.error(`流程截图目录不存在: ${FLOW_SCREENSHOTS_ROOT}`);
    process.exit(1);
  }

  const scanTargets = filterFlowTargets(discoverScriptScanTargets(scanRoot));
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
  writeUiIssuesReport(issuesReport, issuesOut);

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
    analysisHtml: '<p>本报告仅包含<strong>申请单流程</strong>与<strong>审批流程</strong>的步骤截图对比。</p>',
    issuesHtml: renderIssuesTabHtml(uiIssues, {
      isCompareCrossBrowserEnabled,
      renderInlineDiffThumb: diffRenderer.renderInlineDiffThumb,
    }),
  });

  const outAbs = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(outAbs), { recursive: true });
  fs.writeFileSync(outAbs, html, 'utf-8');

  const counts = countComparisonSeverities(testDirComparisons);
  console.log(`\n✅ 流程对比报告: ${outputPath}`);
  console.log(`   对比项 ${counts.total} · blocker ${counts.blocker} · warning ${counts.warning}`);
  console.log(`   并行 ${COMPARE_CONCURRENCY} · 增量 ${COMPARE_INCREMENTAL ? '开' : '关'}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
