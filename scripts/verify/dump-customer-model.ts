/**
 * 打印客户报告模型的判定明细，用于核对分级口径是否符合人的直觉。
 * 用法: npx tsx scripts/verify/dump-customer-model.ts --env=<环境>
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
import {
  assertSafeEnvId,
  customerReportHelpText,
  filterScanTargetsByEnv,
  formatListEnvsText,
  knownCustomerEnvIds,
  listAvailableCustomerEnvs,
  missingCustomerEnvError,
  parseCustomerEnvArgs,
} from '../report/customer-report-env.js';

async function main() {
  const args = parseCustomerEnvArgs(process.argv.slice(2));
  if (args.help) {
    console.log('用法: npx tsx scripts/verify/dump-customer-model.ts --env=<环境>\n');
    console.log(customerReportHelpText());
    return;
  }
  const discovered = listAvailableCustomerEnvs();
  if (args.listEnvs) {
    console.log(formatListEnvsText(discovered, knownCustomerEnvIds()));
    return;
  }
  if (!args.env) {
    console.error(missingCustomerEnvError(discovered));
    process.exit(1);
  }
  const envId = assertSafeEnvId(args.env);

  const screenshotsDir = 'screenshots';
  if (!fs.existsSync(screenshotsDir)) throw new Error('缺少 screenshots 目录');
  const targets = filterScanTargetsByEnv(
    discoverScriptScanTargets(screenshotsDir),
    envId,
    knownCustomerEnvIds(),
  );
  if (targets.length === 0) {
    console.error(`未找到环境「${envId}」的脚本截图`);
    process.exit(1);
  }
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
  model.envId = envId;

  console.log('\n=== 判定汇总 ===');
  console.log(`环境: ${envId}`);
  console.log(
    `明显衰退 ${coverage.regressSteps} · 轻微变化 ${coverage.minorSteps} · 一致 ${coverage.passSteps} · 未检测 ${coverage.uncoveredSteps} · 已对比 ${coverage.comparedSteps}`,
  );
  console.log(`verdict: ${coverage.verdictLabel}`);

  console.log(`\n=== 明显衰退分组 (${model.regressionGroups.length}) ===`);
  for (const g of model.regressionGroups) {
    console.log(`- ${g.title} | 最大差异 ${g.maxDifferenceLabel} | 影响 ${g.affectedSteps} 步`);
    console.log(`  理由: ${g.reason}`);
    const b = g.representative.browsers[0];
    console.log(`  文案: ${b?.plainText}`);
    console.log(`  区域: ${b?.regions.map((r) => `${r.w}x${r.h}@${r.x},${r.y}`).join(' ') || '无'}`);
  }

  console.log(`\n=== 轻微变化分组 (${model.minorGroups.length}) ===`);
  for (const g of model.minorGroups) {
    console.log(`- ${g.title} | ${g.maxDifferenceLabel} | ${g.affectedSteps} 步 | ${g.reason}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
