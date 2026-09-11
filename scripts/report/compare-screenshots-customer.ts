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
import { resolveScriptRunMeta, resolveScriptRunHistory } from './customer-report-run-meta.js';
import { enrichRunHistoryComparisons } from './customer-report-run-history.js';
import { friendlyEnvLabel } from './customer-report-naming.js';
import {
  assertSafeEnvId,
  customerReportHelpText,
  customerReportHtmlRel,
  filterScanTargetsByEnv,
  formatListEnvsText,
  knownCustomerEnvIds,
  listAvailableCustomerEnvs,
  missingCustomerEnvError,
  parseCustomerEnvArgs,
  writeCustomerDeliveryJson,
} from './customer-report-env.js';

dotenv.config({ path: path.join(process.cwd(), '.env') });

async function main() {
  const args = parseCustomerEnvArgs(process.argv.slice(2));

  if (args.help) {
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
  const outputPath = args.positional[0] || customerReportHtmlRel(envId);
  const screenshotsDir = 'screenshots';
  const envLabel = friendlyEnvLabel(envId);

  if (!fs.existsSync(screenshotsDir)) {
    console.error(`截图目录不存在: ${screenshotsDir}`);
    process.exit(1);
  }

  const knownEnvs = knownCustomerEnvIds();
  const scanTargets = filterScanTargetsByEnv(
    discoverScriptScanTargets(screenshotsDir),
    envId,
    knownEnvs,
  );
  if (scanTargets.length === 0) {
    console.error(
      [
        `未找到环境「${envId}」（${envLabel}）的脚本截图，无法生成客户报告。`,
        missingCustomerEnvError(discovered),
      ].join('\n'),
    );
    process.exit(1);
  }

  console.log(`正在生成客户版 UI 衰退检测报告（仅 ${envLabel} / ${envId}）...`);
  console.log(`  脚本数: ${scanTargets.length}`);
  console.log(`  输出: ${outputPath}`);
  console.log(`  并行: ${COMPARE_CONCURRENCY}，增量缓存: ${COMPARE_INCREMENTAL ? '开' : '关'}`);

  const testDirComparisons: TestDirComparisons[] = [];
  const screenshotsByDir = new Map<string, ReturnType<typeof getAllScreenshots>>();
  let hasCurrentPng = false;

  for (let i = 0; i < scanTargets.length; i++) {
    const { testDir, scriptPath } = scanTargets[i]!;
    console.log(`\n[${i + 1}/${scanTargets.length}] ${testDir}`);
    const screenshots = getAllScreenshots(scriptPath, 'optimized', outputPath);
    screenshotsByDir.set(testDir, screenshots);
    if (screenshots.size === 0) continue;
    hasCurrentPng = true;
    const comparisons = await generateTestComparisons(testDir, screenshots, outputPath);
    testDirComparisons.push({ testDir, comparisons });
  }

  if (!hasCurrentPng || testDirComparisons.length === 0) {
    console.error(
      `环境「${envId}」的 screenshots 下没有可用步骤 PNG。请先跑该环境用例截图后再生成客户报告。`,
    );
    process.exit(1);
  }

  const coverage = buildCoverageStats(testDirComparisons);
  const scriptKeys = [...new Set(coverage.slots.map((s) => s.scriptKey))];
  const scriptRuns = resolveScriptRunMeta(scriptKeys, scanTargets);
  const runHistory = resolveScriptRunHistory(scriptKeys, scanTargets);
  for (const { testDir } of scanTargets) {
    const rows = runHistory.get(testDir);
    const shots = screenshotsByDir.get(testDir);
    if (!rows?.length || !shots?.size) continue;
    const enriched = await enrichRunHistoryComparisons(testDir, shots, rows, outputPath);
    runHistory.set(testDir, enriched);
  }
  const model = buildCustomerReportModel(coverage, undefined, scriptRuns, runHistory);
  model.envId = envId;
  model.envLabel = envLabel;
  const html = renderCustomerReportHtml(model);

  const outAbs = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(outAbs), { recursive: true });
  fs.writeFileSync(outAbs, html, 'utf-8');
  const htmlRel = path.relative(process.cwd(), outAbs).replaceAll(path.sep, '/') || outputPath;
  const deliveryRel = writeCustomerDeliveryJson({
    envId,
    htmlRel,
    generatedAt: model.generatedAt,
  });

  console.log(`\n客户报告已生成: ${htmlRel}`);
  console.log(`  投递清单: ${deliveryRel.replaceAll(path.sep, '/')}`);
  console.log(
    `  环境: ${envLabel}（${envId}）· 判定: ${coverage.verdictLabel} · 已检测 ${coverage.comparedSteps}/${coverage.expectedSteps} · 衰退 ${coverage.regressSteps} · 未检测 ${coverage.uncoveredSteps}`,
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
