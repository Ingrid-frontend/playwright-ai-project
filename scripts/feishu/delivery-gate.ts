import fs from 'fs';
import { assertDeliveryContentHash, resolveDeliveryImagePath, SNAPSHOT_VERSION } from '../report/customer-delivery-payload.js';
import type { DeliveryPayload } from '../report/customer-delivery-payload.js';
import { parseRunMetaFromScreenshotPath } from '../report/compare-screenshots-utils.js';
import { runTimestampSortKey } from '../report/baseline-comparisons.js';
import { extractEnvId } from '../report/customer-report-naming.js';
import { buildRetestSummary } from './retest-trace.js';

export type GateCheck = {
  name: string;
  passed: boolean;
  detail: string;
};

export type GateResult = {
  passed: boolean;
  checks: GateCheck[];
};

export function runDeliveryGate(payload: DeliveryPayload): GateResult {
  const checks: GateCheck[] = [];

  checks.push({
    name: 'deliveryReady',
    passed: payload.deliveryReady === true,
    detail: payload.deliveryReady ? '载荷标记为可交付' : 'deliveryReady 不为 true，请用 report:customer 重新生成',
  });

  checks.push({
    name: 'envId',
    passed: !!payload.envId,
    detail: payload.envId ? `环境: ${payload.envId}` : '缺少 envId，无法确认目标环境',
  });

  checks.push({
    name: 'snapshot-identity',
    passed: payload.version === 1 && payload.snapshotVersion === SNAPSHOT_VERSION &&
      Boolean(payload.runId?.trim()) && Number.isFinite(Date.parse(payload.generatedAt)) &&
      payload.deliveryId === [payload.envId, payload.runId, payload.releaseTag || ''].filter(Boolean).join('|'),
    detail: `snapshotVersion=${payload.snapshotVersion}，runId=${payload.runId || '(缺失)'}`,
  });

  const sources = Object.entries(payload.sourceRunIds ?? {});
  const validSources = sources.length > 0 && sources.every(([script, run]) =>
    Boolean(script && typeof run === 'string' && run.trim()) && extractEnvId(script) === payload.envId);
  const currentImages = payload.items.flatMap((item) => item.images.filter((image) => image.role === 'current'));
  const matchingEvidence = currentImages.length > 0 && payload.items.every((item) => {
    const prefix = `${payload.deliveryId}::`;
    const script = item.key.startsWith(prefix) ? item.key.slice(prefix.length).split('::')[0]! : '';
    const selectedRun = payload.sourceRunIds?.[script];
    const currents = item.images.filter((image) => image.role === 'current');
    return Boolean(selectedRun) && currents.length > 0 && currents.every((image) => {
      const normalized = resolveDeliveryImagePath(image.relPath).replace(/\\/g, '/');
      return normalized.includes(`/${script.replace(/\\/g, '/')}/run-`) &&
        parseRunMetaFromScreenshotPath(normalized).runTimestamp === selectedRun;
    });
  });
  checks.push({
    name: 'source-runs',
    passed: validSources && matchingEvidence,
    detail: validSources && matchingEvidence
      ? `${sources.length} 个源运行与当前截图身份匹配`
      : '缺少源运行/当前截图，或脚本、环境、运行与证据不匹配',
  });

  const now = Date.now();
  const freshSources = validSources && sources.every(([, run]) => {
    const startedAt = runTimestampSortKey(run);
    const age = now - startedAt;
    return startedAt > 0 && age >= 0 && age <= 24 * 3600_000;
  });
  checks.push({
    name: 'freshness',
    passed: freshSources,
    detail: freshSources ? '源执行均在过去 24 小时内' : '源执行时间缺失、无效、在未来或已超过 24 小时；重新生成报告不能刷新源证据',
  });

  const regressOrMinor = payload.items.filter(
    (item) => item.kind === 'regress' || item.kind === 'minor',
  );
  const allHaveEvidence = regressOrMinor.length === 0 || regressOrMinor.every((item) => item.images.length > 0);
  checks.push({
    name: 'evidence',
    passed: allHaveEvidence,
    detail: allHaveEvidence
      ? `${regressOrMinor.length} 个问题条目均有证据图`
      : `${regressOrMinor.filter((item) => !item.images.length).length} 个问题条目缺少证据图`,
  });
  checks.push({
    name: 'issue-completeness',
    passed: Number.isSafeInteger(payload.totalIssueCount) && payload.totalIssueCount === regressOrMinor.length,
    detail: `交付 ${regressOrMinor.length} / 共 ${payload.totalIssueCount} 个问题（根因组，不是步骤数）`,
  });

  const readableImages = payload.items
    .flatMap((item) => item.images.map((img) => img.relPath))
    .filter((relPath) => fs.existsSync(resolveDeliveryImagePath(relPath)));
  const totalImages = payload.items.flatMap((item) => item.images).length;
  checks.push({
    name: 'images-readable',
    passed: totalImages === 0 || readableImages.length === totalImages,
    detail: `${readableImages.length}/${totalImages} 张证据图可读`,
  });

  checks.push({
    name: 'has-comparisons',
    passed: payload.stats.comparedSteps > 0,
    detail: payload.stats.comparedSteps > 0
      ? `已对比 ${payload.stats.comparedSteps} 个步骤`
      : '无有效对比数据（comparedSteps=0），空样本不能判通过',
  });

  checks.push({
    name: 'coverage',
    passed: payload.stats.coveragePct > 0,
    detail: `覆盖率 ${payload.stats.coveragePct}%`,
  });

  try {
    const actualHash = assertDeliveryContentHash(payload);
    checks.push({ name: 'content-hash', passed: true, detail: `已校验内容及证据：${actualHash}` });
  } catch (error) {
    checks.push({
      name: 'content-hash', passed: false,
      detail: error instanceof Error ? error.message : String(error),
    });
  }

  const retestSummary = buildRetestSummary();
  checks.push({
    name: 'retest-trace',
    passed: true,
    detail: retestSummary.totalTracked > 0
      ? `复验追踪：${retestSummary.totalTracked} 项（已解决 ${retestSummary.resolved}，仍存在 ${retestSummary.stillPresent}，待复验 ${retestSummary.pending}）`
      : '无复验追踪记录',
  });

  return {
    passed: checks.every((c) => c.passed),
    checks,
  };
}

export function formatGateResult(result: GateResult): string {
  const lines: string[] = [];
  for (const check of result.checks) {
    const icon = check.passed ? '✅' : '❌';
    lines.push(`  ${icon} ${check.name}: ${check.detail}`);
  }
  return lines.join('\n');
}
