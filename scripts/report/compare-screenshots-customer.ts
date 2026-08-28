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
import { buildCoverageStats } from './coverage-stats.js';
import { buildCustomerReportModel } from './customer-report-model.js';
import { renderCustomerReportHtml } from './customer-report-render.js';
import { resolveScriptRunMeta } from './customer-report-run-meta.js';

dotenv.config({ path: path.join(process.cwd(), '.env') });

async function main() {
  const args = process.argv.slice(2);
  const positional = args.filter((a) => !a.startsWith('--'));
  const outputPath = positional[0] || 'results/ui-regression-customer.html';
  const screenshotsDir = 'screenshots';

  if (!fs.existsSync(screenshotsDir)) {
    console.error(`截图目录不存在: ${screenshotsDir}`);
    process.exit(1);
  }

  const scanTargets = discoverScriptScanTargets(screenshotsDir);
  if (scanTargets.length === 0) {
    console.error('未发现任何脚本截图，无法生成客户报告');
    process.exit(1);
  }

  console.log('正在生成客户版 UI 衰退检测报告...');
  console.log(`  脚本数: ${scanTargets.length}`);
  console.log(`  输出: ${outputPath}`);
  console.log(`  并行: ${COMPARE_CONCURRENCY}，增量缓存: ${COMPARE_INCREMENTAL ? '开' : '关'}`);

  const testDirComparisons: TestDirComparisons[] = [];
  let hasCurrentPng = false;

  for (let i = 0; i < scanTargets.length; i++) {
    const { testDir, scriptPath } = scanTargets[i]!;
    console.log(`\n[${i + 1}/${scanTargets.length}] ${testDir}`);
    const screenshots = getAllScreenshots(scriptPath, 'optimized', outputPath);
    if (screenshots.size === 0) continue;
    hasCurrentPng = true;
    const comparisons = await generateTestComparisons(testDir, screenshots, outputPath);
    testDirComparisons.push({ testDir, comparisons });
  }

  if (!hasCurrentPng || testDirComparisons.length === 0) {
    console.error('当前 screenshots 下没有可用步骤 PNG。请先跑用例截图后再生成客户报告。');
    process.exit(1);
  }

  const coverage = buildCoverageStats(testDirComparisons);
  const scriptKeys = [...new Set(coverage.slots.map((s) => s.scriptKey))];
  const scriptRuns = resolveScriptRunMeta(scriptKeys, scanTargets);
  const model = buildCustomerReportModel(coverage, undefined, scriptRuns);
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
