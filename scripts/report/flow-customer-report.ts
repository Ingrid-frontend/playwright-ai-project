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
import { discoverFlowScriptScanTargets } from './compare-screenshots-scan.js';
import { buildCoverageStats } from './coverage-stats.js';
import { buildCustomerReportModel } from './customer-report-model.js';
import { renderCustomerReportHtml } from './customer-report-render.js';
import { resolveScriptRunMeta } from './customer-report-run-meta.js';

dotenv.config({ path: path.join(process.cwd(), '.env') });

const FLOW_ROOT = path.join('screenshots', 'flows');
const DEFAULT_OUT = 'results/flow-customer-report.html';

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
  const positional = args.filter((a) => !a.startsWith('--'));
  const outputPath = positional[0] || DEFAULT_OUT;

  const scanRoot = fs.existsSync(FLOW_ROOT) ? FLOW_ROOT : 'screenshots';
  if (!fs.existsSync(scanRoot)) {
    console.error(`流程截图目录不存在: ${FLOW_ROOT}`);
    process.exit(1);
  }

  const scanTargets = filterFlowTargets(discoverFlowScriptScanTargets(scanRoot));
  if (scanTargets.length === 0) {
    console.error('未发现流程截图，请先运行申请单/审批用例');
    process.exit(1);
  }

  console.log('正在生成流程客户报告…');
  console.log(`  脚本数: ${scanTargets.length}`);
  console.log(`  输出: ${outputPath}`);

  const testDirComparisons: TestDirComparisons[] = [];
  let hasPng = false;

  for (let i = 0; i < scanTargets.length; i++) {
    const { testDir, scriptPath } = scanTargets[i]!;
    console.log(`\n[${i + 1}/${scanTargets.length}] ${testDir}`);
    const screenshots = getAllScreenshots(scriptPath, 'optimized', outputPath);
    if (screenshots.size === 0) continue;
    hasPng = true;
    const comparisons = await generateTestComparisons(testDir, screenshots, outputPath);
    testDirComparisons.push({ testDir, comparisons });
  }

  if (!hasPng || testDirComparisons.length === 0) {
    console.error('无可用步骤 PNG');
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
