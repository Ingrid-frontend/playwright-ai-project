#!/usr/bin/env tsx
/**
 * 申请单 / 审批流程客户版 UI 报告（数据源 screenshots/flows/）。
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
import { discoverFlowScriptScanTargets, isGoldenRegressionTarget } from './compare-screenshots-scan.js';
import { buildCoverageStats } from './coverage-stats.js';
import { buildCustomerReportModel } from './customer-report-model.js';
import { renderCustomerReportHtml } from './customer-report-render.js';
import { sanitizeCustomerReportHtml } from './customer-report-sanitize.js';
import { resolveScriptRunMeta, resolveScriptRunHistory } from './customer-report-run-meta.js';
import {
  readReportBatch,
  readReportBatchAudit,
  reportBatchDir,
} from './customer-report-batch.js';
import { readAuditInsights } from './customer-report-audit-inject.js';
import { envLabelFromId } from './customer-report-naming.js';
import { writeCustomerReportSummary } from './customer-report-summary.js';
import { generateVisualReviewReport } from './visual-review-report.js';
import {
  enrichRunHistoryComparisons,
  filterScreenshotsByRun,
  screenshotsForMainReport,
} from './customer-report-run-history.js';

dotenv.config({ path: path.join(process.cwd(), '.env') });

const FLOW_ROOT = path.join('screenshots', 'flows');
const DEFAULT_OUT = 'results/flow-customer-report.html';

async function main() {
  const args = process.argv.slice(2);
  const positional = args.filter((a) => !a.startsWith('--'));
  const batchId = args.find((a) => a.startsWith('--batch-id='))?.slice('--batch-id='.length);
  const batch = batchId ? readReportBatch(batchId) : null;
  const outputPath =
    positional[0] ||
    (batch ? path.join(reportBatchDir(batch.batchId), 'customer-report.html') : DEFAULT_OUT);
  const scriptKey = args
    .find((a) => a.startsWith('--script-key='))
    ?.slice('--script-key='.length)
    .replace(/^flows\//, '');
  const boundRunId = args.find((a) => a.startsWith('--run='))?.slice('--run='.length);
  const visualReview = args.includes('--visual-review');
  if (visualReview && (!scriptKey || !boundRunId || batch)) {
    throw new Error('--visual-review 需要 --script-key 和 --run 显式绑定申请单单账号运行，不能与 --batch-id 混用');
  }
  const batchRuns = new Map(
    (batch?.runs || [])
      .filter((run) => run.scriptKey && run.runId)
      .map((run) => [run.scriptKey.replace(/^flows\//, ''), run]),
  );

  const scanRoot = fs.existsSync(FLOW_ROOT) ? FLOW_ROOT : 'screenshots';
  if (!fs.existsSync(scanRoot)) {
    console.error(`流程截图目录不存在: ${FLOW_ROOT}`);
    process.exit(1);
  }

  const scanTargets = discoverFlowScriptScanTargets(scanRoot).filter(
    (t) =>
      isGoldenRegressionTarget(t.testDir) &&
      (!scriptKey || t.testDir === scriptKey) &&
      (!batch || batchRuns.has(t.testDir)),
  );
  if (scanTargets.length === 0) {
    console.error('未发现 Golden 回归流程截图，请先运行 golden-regression 用例');
    process.exit(1);
  }

  console.log('正在生成流程客户报告…');
  console.log(`  范围: Golden 回归`);
  console.log(`  脚本数: ${scanTargets.length}`);
  if (scriptKey) console.log(`  绑定脚本: ${scriptKey}`);
  if (boundRunId) console.log(`  绑定 run: ${boundRunId}`);
  if (batch) console.log(`  交付批次: ${batch.batchId}（${batch.runs.length} 个运行）`);
  console.log(`  输出: ${outputPath}`);

  const testDirComparisons: TestDirComparisons[] = [];
  const screenshotsByDir = new Map<string, ReturnType<typeof getAllScreenshots>>();
  const usedRunIds = new Map<string, string>();
  let hasPng = false;

  const runHistory = resolveScriptRunHistory(
    scanTargets.map((t) => t.testDir),
    scanTargets,
  );

  for (let i = 0; i < scanTargets.length; i++) {
    const { testDir, scriptPath } = scanTargets[i]!;
    console.log(`\n[${i + 1}/${scanTargets.length}] ${testDir}`);
    const screenshots = getAllScreenshots(scriptPath, 'optimized', outputPath);
    screenshotsByDir.set(testDir, screenshots);
    const rows = runHistory.get(testDir) || [];
    const runIdForTarget = batchRuns.get(testDir)?.runId || boundRunId;
    const { filtered, runId } = runIdForTarget
      ? {
          filtered: filterScreenshotsByRun(screenshots, runIdForTarget),
          runId: runIdForTarget,
        }
      : screenshotsForMainReport(screenshots, rows);
    if (runId) usedRunIds.set(testDir, runId);
    if (filtered.size === 0) continue;
    hasPng = true;
    const comparisons = await generateTestComparisons(testDir, filtered, outputPath);
    testDirComparisons.push({ testDir, comparisons });
  }

  if (!hasPng || testDirComparisons.length === 0) {
    console.error('无可用步骤 PNG');
    process.exit(1);
  }

  const coverage = buildCoverageStats(testDirComparisons);
  const scriptKeys = [...new Set(coverage.slots.map((s) => s.scriptKey))];
  const scriptRuns = resolveScriptRunMeta(scriptKeys, scanTargets, usedRunIds);
  for (const { testDir, scriptPath } of scanTargets) {
    const rows = runHistory.get(testDir);
    const shots = screenshotsByDir.get(testDir);
    if (!rows?.length) continue;
    const enriched = await enrichRunHistoryComparisons(testDir, shots || new Map(), rows, outputPath, {
      scriptPath,
    });
    runHistory.set(testDir, enriched);
  }
  const audit = batch ? readReportBatchAudit(batch) : null;
  const auditInsights = readAuditInsights();
  const reportBatch = batch
    ? {
        batchId: batch.batchId,
        expectedRunCount: batch.expectedRunCount,
        completedRunCount: batch.runs.filter((run) => run.ok && !run.skipped && Boolean(run.runId))
          .length,
        failedRunCount: batch.runs.filter((run) => !run.ok && !run.skipped).length,
        skippedRunCount: batch.runs.filter((run) => run.skipped).length,
        flowLabels: [
          ...new Set(
            batch.runs.map((run) =>
              run.flowId === 'approval-flow'
                ? '审批流程'
                : run.flowId === 'request-flow'
                  ? '申请单流程'
                  : run.flowId,
            ),
          ),
        ],
        envLabels: [...new Set(batch.runs.map((run) => envLabelFromId(run.env)))],
        audit: audit!,
      }
    : undefined;
  const model = buildCustomerReportModel(
    coverage,
    undefined,
    scriptRuns,
    runHistory,
    {
      releaseTag: process.env.RELEASE_TAG || process.env.npm_package_version,
      iteration: process.env.ITERATION || undefined,
      reportScope: 'golden',
      reportBatch,
    },
    usedRunIds,
    auditInsights,
  );
  const html = sanitizeCustomerReportHtml(renderCustomerReportHtml(model), outputPath).html;

  const outAbs = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(outAbs), { recursive: true });
  fs.writeFileSync(outAbs, html, 'utf-8');
  if (visualReview) {
    const reviewDir = args.find(a => a.startsWith('--review-out='))?.slice('--review-out='.length) ||
      path.join(path.dirname(outputPath), 'visual-review', boundRunId!);
    const manifest = await generateVisualReviewReport(coverage.slots, scriptKey!, boundRunId!, outputPath, reviewDir);
    console.log(`视觉复核预览: ${path.join(reviewDir, 'index.html')}\n发布载荷: ${manifest}`);
  }
  if (batch) {
    writeCustomerReportSummary(model, path.join(path.dirname(outputPath), 'summary.json'));
  }

  console.log(`\n✅ 客户报告: ${outputPath}`);
  console.log(
    `   ${coverage.verdictLabel} · 已检测 ${coverage.comparedSteps}/${coverage.expectedSteps} · 衰退 ${coverage.regressSteps}`,
  );
  console.log(`   并行 ${COMPARE_CONCURRENCY} · 增量 ${COMPARE_INCREMENTAL ? '开' : '关'}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
