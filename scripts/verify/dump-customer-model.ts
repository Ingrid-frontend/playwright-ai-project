/**
 * 打印客户报告模型的判定明细，用于核对分级口径是否符合人的直觉。
 * 用法: npx tsx scripts/verify/dump-customer-model.ts
 */
import fs from 'fs';
import {
  getAllScreenshots,
  generateTestComparisons,
  type TestDirComparisons,
} from '../report/compare-screenshots-engine.js';
import { discoverScriptScanTargets } from '../report/compare-screenshots-scan.js';
import { buildCoverageStats } from '../report/coverage-stats.js';
import { buildCustomerReportModel } from '../report/customer-report-model.js';

async function main() {
  const screenshotsDir = 'screenshots';
  if (!fs.existsSync(screenshotsDir)) throw new Error('缺少 screenshots 目录');
  const targets = discoverScriptScanTargets(screenshotsDir);
  const testDirComparisons: TestDirComparisons[] = [];
  for (const { testDir, scriptPath } of targets) {
    const shots = getAllScreenshots(scriptPath, 'optimized', 'results/tmp.html');
    if (shots.size === 0) continue;
    testDirComparisons.push({
      testDir,
      comparisons: await generateTestComparisons(testDir, shots, 'results/tmp.html'),
    });
  }

  const coverage = buildCoverageStats(testDirComparisons);
  const model = buildCustomerReportModel(coverage);

  console.log('\n=== 判定汇总 ===');
  console.log(
    `需修复 ${coverage.regressSteps} · 影响体验 ${coverage.degradedSteps} · 可忽略 ${coverage.benignSteps} · 完全一致 ${coverage.passSteps} · 未判定 ${coverage.uncoveredSteps} · 已对比 ${coverage.comparedSteps}`,
  );
  console.log(`完全一致占比 ${(coverage.passRate * 100).toFixed(1)}%（${coverage.passSteps}/${coverage.comparedSteps}，不含可忽略）`);
  console.log(`verdict: ${coverage.verdictLabel}`);
  console.log(`shipAdvice: ${coverage.shipAdvice}`);

  console.log(`\n=== 需修复分组 (${model.regressionGroups.length}) ===`);
  for (const g of model.regressionGroups) {
    console.log(`- ${g.title} | 最大差异 ${g.maxDifferenceLabel} | 影响 ${g.affectedSteps} 步`);
    console.log(`  理由: ${g.reason}`);
    const b = g.representative.browsers[0];
    console.log(`  文案: ${b?.plainText}`);
    console.log(`  区域: ${b?.regions.map((r) => `${r.w}x${r.h}@${r.x},${r.y}`).join(' ') || '无'}`);
  }

  console.log(`\n=== 影响体验分组 (${model.degradedGroups.length}) ===`);
  for (const g of model.degradedGroups) {
    console.log(`- ${g.title} | ${g.maxDifferenceLabel} | ${g.affectedSteps} 步 | ${g.reason}`);
  }

  console.log(`\n=== 可忽略分组 (${model.benignGroups.length}) ===`);
  for (const g of model.benignGroups) {
    console.log(`- ${g.title} | ${g.maxDifferenceLabel} | ${g.affectedSteps} 步 | ${g.reason}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
