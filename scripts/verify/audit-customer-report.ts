#!/usr/bin/env tsx
import { discoverFlowScriptScanTargets } from '../report/compare-screenshots-scan.js';
import { getAllScreenshots, generateTestComparisons } from '../report/compare-screenshots-engine.js';
import { buildCoverageStats, type CoverageStatus } from '../report/coverage-stats.js';
import { buildCustomerReportModel } from '../report/customer-report-model.js';
import { resolveScriptRunMeta, resolveScriptRunHistory } from '../report/customer-report-run-meta.js';
import { enrichRunHistoryComparisons } from '../report/customer-report-run-history.js';
import { extractEnvId } from '../report/customer-report-naming.js';

const OUT = 'results/flow-customer-report.html';
const FLOW_ROOT = 'screenshots/flows';

function worstStatus(slots: { status: CoverageStatus; processOnly: boolean }[]): CoverageStatus {
  let w: CoverageStatus = 'uncovered';
  for (const s of slots.filter((x) => !x.processOnly)) {
    if (s.status === 'regress') return 'regress';
    if (s.status === 'minor') w = 'minor';
    else if (s.status === 'pass' && w === 'uncovered') w = 'pass';
  }
  return w;
}

async function main() {
  const scanTargets = discoverFlowScriptScanTargets(FLOW_ROOT).filter(
    (t) => t.testDir.includes('request-flow') || t.testDir.includes('approval-flow'),
  );
  const issues: string[] = [];
  const testDirComparisons = [];
  const screenshotsByDir = new Map<string, ReturnType<typeof getAllScreenshots>>();

  for (const { testDir, scriptPath } of scanTargets) {
    const shots = getAllScreenshots(scriptPath, 'optimized', OUT);
    screenshotsByDir.set(testDir, shots);
    if (shots.size === 0) continue;
    const comparisons = await generateTestComparisons(testDir, shots, OUT);
    testDirComparisons.push({ testDir, comparisons });
  }

  const coverage = buildCoverageStats(testDirComparisons);
  const scriptKeys = [...new Set(coverage.slots.map((s) => s.scriptKey))];
  const scriptRuns = resolveScriptRunMeta(scriptKeys, scanTargets);
  const runHistory = resolveScriptRunHistory(scriptKeys, scanTargets);

  for (const { testDir, scriptPath } of scanTargets) {
    const rows = runHistory.get(testDir);
    const shots = screenshotsByDir.get(testDir);
    if (!rows?.length) continue;
    const enriched = await enrichRunHistoryComparisons(testDir, shots || new Map(), rows, OUT, { scriptPath });
    runHistory.set(testDir, enriched);
  }

  const model = buildCustomerReportModel(coverage, undefined, scriptRuns, runHistory, { reportScope: 'golden' });

  console.log('\n=== 报告总览 ===');
  console.log(`脚本数 ${scanTargets.length} · 已对比 ${coverage.comparedSteps}/${coverage.expectedSteps}`);
  console.log(
    `衰退 ${coverage.regressSteps} · 轻微 ${coverage.minorSteps} · 通过 ${coverage.passSteps} · 未检测 ${coverage.uncoveredSteps}`,
  );
  console.log(`总判定: ${coverage.verdictLabel}`);
  console.log(`报告头环境: ${model.envLabel || '—'}`);

  const envs = [...new Set([...runHistory.keys()].map((k) => extractEnvId(k)).filter(Boolean))].sort();
  console.log(`环境: ${envs.join(', ')}`);

  for (const [sk, rows] of runHistory) {
    for (const r of rows) {
      if (r.screenshotCount === 0 && r.comparedSteps > 0) {
        issues.push(`[P1] 截图=0 但已对比=${r.comparedSteps}: ${sk} · ${r.runId}`);
      }
      if (r.screenshotCount === 0 && r.verdictLabel === '完全一致') {
        issues.push(`[P2] 截图=0 判定仍为「完全一致」(应标注已清理): ${sk} · 第${r.runIndex}次`);
      }
      if (r.screenshotCount > 0 && r.comparedSteps === 0 && !['empty', 'uncovered'].includes(r.verdict)) {
        issues.push(`[P2] 有截图但未对比: ${sk} · 第${r.runIndex}次 · ${r.verdictLabel}`);
      }
      if (r.isLatest && r.screenshotCount === 0) {
        issues.push(`[P1] 最新一轮无截图: ${sk} · ${r.runId}`);
      }
    }

    const latest = rows.find((r) => r.isLatest);
    if (!latest || latest.screenshotCount === 0) continue;
    const slots = coverage.slots.filter((s) => s.scriptKey === sk);
    const covWorst = worstStatus(slots);
    const hist = latest.verdict;
    if (covWorst !== hist && !(covWorst === 'uncovered' && hist === 'empty')) {
      issues.push(
        `[P1] 最新run与技术附录不一致: ${sk} · 检测覆盖=${covWorst} · 历史表=${hist}(${latest.verdictLabel})`,
      );
    }
  }

  for (const { testDir } of scanTargets) {
    const shots = screenshotsByDir.get(testDir);
    const rows = runHistory.get(testDir);
    if ((!shots || shots.size === 0) && rows?.length) {
      issues.push(`[P2] 有 ${rows.length} 次 run 记录但无截图进入主报告: ${testDir}`);
    }
  }

  const fullFlow = scanTargets.filter((t) => t.testDir.includes('/full-flow/'));
  if (fullFlow.length) {
    issues.push(`[P2] 混入 full-flow 调试脚本: ${fullFlow.map((t) => t.testDir).join(', ')}`);
  }

  const envScriptCount = new Map<string, number>();
  for (const k of runHistory.keys()) {
    const e = extractEnvId(k) || 'other';
    envScriptCount.set(e, (envScriptCount.get(e) || 0) + 1);
  }
  if (envs.length > 1) {
    issues.push(
      `[P2] 多环境混在同一报告头判定(${model.envLabel})，共 ${envs.length} 个环境: ${envs.map((e) => `${e}×${envScriptCount.get(e)}`).join(', ')}`,
    );
  }

  console.log('\n=== 衰退步骤 ===');
  for (const s of coverage.slots.filter((x) => x.status === 'regress')) {
    console.log(` - ${s.scriptKey} · ${s.stepName} · ${((s.difference ?? 0) * 100).toFixed(2)}%`);
  }

  console.log('\n=== menma_comic_com dev 最近 5 次 ===');
  const menma = [...runHistory.entries()].find(([k]) => k.includes('menma_comic_com') && k.includes('/dev/'));
  if (menma) {
    for (const r of menma[1].slice(-5)) {
      console.log(
        `  #${r.runIndex} shots=${r.screenshotCount} cmp=${r.comparedSteps} ${r.verdictLabel} latest=${r.isLatest}`,
      );
    }
  }

  console.log(`\n=== 问题清单 (${issues.length}) ===`);
  for (const i of issues) console.log(i);
  if (!issues.length) console.log('未发现明显数据异常');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
