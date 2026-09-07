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
import {
  discoverGoldenScriptScanTargets,
  discoverScriptScanTargets,
} from './compare-screenshots-scan.js';
import { buildCoverageStats } from './coverage-stats.js';
import { buildCustomerReportModel } from './customer-report-model.js';
import { renderCustomerReportHtml } from './customer-report-render.js';
import { writeCustomerReportSummary } from './customer-report-summary.js';
import { buildCustomerDeliveryPayload, writeCustomerDeliveryPayload } from './customer-delivery-payload.js';
import { resolveScriptRunMeta, resolveScriptRunHistory } from './customer-report-run-meta.js';
import { enrichRunHistoryComparisons, screenshotsForMainReport } from './customer-report-run-history.js';

dotenv.config({ path: path.join(process.cwd(), '.env') });

async function main() {
  const args = process.argv.slice(2);
  const positional = args.filter((a) => !a.startsWith('--'));
  const outputPath = positional[0] || 'results/ui-regression-customer.html';
  const screenshotsDir = 'screenshots';
  const allScripts = args.includes('--all-scripts');

  if (!fs.existsSync(screenshotsDir)) {
    console.error(`截图目录不存在: ${screenshotsDir}`);
    process.exit(1);
  }

  const scanTargets = allScripts
    ? discoverScriptScanTargets(screenshotsDir)
    : discoverGoldenScriptScanTargets(screenshotsDir);
  if (scanTargets.length === 0) {
    if (allScripts) {
      console.error('未发现任何脚本截图，无法生成客户报告');
    } else {
      console.error(
        '未发现 Golden 回归脚本截图。请先跑 golden-regression，或使用 --all-scripts 纳入全部流程调试截图。',
      );
    }
    process.exit(1);
  }

  console.log('正在生成客户版 UI 衰退检测报告...');
  console.log(`  范围: ${allScripts ? '全部脚本' : 'Golden 回归'}`);
  console.log(`  脚本数: ${scanTargets.length}`);
  console.log(`  输出: ${outputPath}`);
  console.log(`  并行: ${COMPARE_CONCURRENCY}，增量缓存: ${COMPARE_INCREMENTAL ? '开' : '关'}`);

  const testDirComparisons: TestDirComparisons[] = [];
  const screenshotsByDir = new Map<string, ReturnType<typeof getAllScreenshots>>();
  const usedRunIds = new Map<string, string>();
  let hasCurrentPng = false;

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
    hasCurrentPng = true;
    const comparisons = await generateTestComparisons(testDir, filtered, outputPath);
    testDirComparisons.push({ testDir, comparisons });
  }

  if (!hasCurrentPng || testDirComparisons.length === 0) {
    console.error('当前 screenshots 下没有可用步骤 PNG。请先跑用例截图后再生成客户报告。');
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
    reportScope: allScripts ? 'all' : 'golden',
  }, usedRunIds);
  const summary = writeCustomerReportSummary(model);
  // 交付载荷供飞书多维表 / 飞书文档链路消费，避免它们为了拿数据再跑一遍像素比对
  const maxItems = Number(process.env.DELIVERY_MAX_ITEMS || 20);
  writeCustomerDeliveryPayload(buildCustomerDeliveryPayload(model, { summary, maxItems }));
  const html = renderCustomerReportHtml(model);

  const outAbs = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(outAbs), { recursive: true });
  fs.writeFileSync(outAbs, html, 'utf-8');

  console.log(`\n客户报告已生成: ${outputPath}`);
  console.log(
    `  判定: ${coverage.verdictLabel} · 已检测 ${coverage.comparedSteps}/${coverage.expectedSteps} · 衰退 ${coverage.regressSteps} · 未检测 ${coverage.uncoveredSteps}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
