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
import { FLOW_CUSTOMER_SUMMARY_FILE, writeCustomerReportSummary } from './customer-report-summary.js';
import { resolveScriptRunMeta, resolveScriptRunHistory } from './customer-report-run-meta.js';
import { enrichRunHistoryComparisons, screenshotsForMainReport } from './customer-report-run-history.js';

dotenv.config({ path: path.join(process.cwd(), '.env') });

const FLOW_ROOT = path.join('screenshots', 'flows');
const DEFAULT_OUT = 'results/flow-customer-report.html';

async function main() {
  const args = process.argv.slice(2);
  const positional = args.filter((a) => !a.startsWith('--'));
  const outputPath = positional[0] || DEFAULT_OUT;

  const scanRoot = fs.existsSync(FLOW_ROOT) ? FLOW_ROOT : 'screenshots';
  if (!fs.existsSync(scanRoot)) {
    console.error(`流程截图目录不存在: ${FLOW_ROOT}`);
    process.exit(1);
  }

  const scanTargets = discoverFlowScriptScanTargets(scanRoot).filter((t) =>
    isGoldenRegressionTarget(t.testDir),
  );
  if (scanTargets.length === 0) {
    console.error('未发现 Golden 回归流程截图，请先运行 golden-regression 用例');
    process.exit(1);
  }

  console.log('正在生成流程客户报告…');
  console.log(`  范围: Golden 回归`);
  console.log(`  脚本数: ${scanTargets.length}`);
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
    const { filtered, runId } = screenshotsForMainReport(screenshots, rows);
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
  const scriptRuns = resolveScriptRunMeta(scriptKeys, scanTargets);
  for (const { testDir, scriptPath } of scanTargets) {
    const rows = runHistory.get(testDir);
    const shots = screenshotsByDir.get(testDir);
    if (!rows?.length) continue;
    const enriched = await enrichRunHistoryComparisons(testDir, shots || new Map(), rows, outputPath, {
      scriptPath,
    });
    runHistory.set(testDir, enriched);
  }
  const model = buildCustomerReportModel(coverage, undefined, scriptRuns, runHistory, {
    releaseTag: process.env.RELEASE_TAG || process.env.npm_package_version,
    reportScope: 'golden',
  }, usedRunIds);
  writeCustomerReportSummary(model, FLOW_CUSTOMER_SUMMARY_FILE);
  const html = renderCustomerReportHtml(model);

  const outAbs = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(outAbs), { recursive: true });
  fs.writeFileSync(outAbs, html, 'utf-8');

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
