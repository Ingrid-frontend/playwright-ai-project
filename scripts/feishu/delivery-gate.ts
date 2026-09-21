import fs from 'fs';
import { resolveDeliveryImagePath } from '../report/customer-delivery-payload.js';
import type { DeliveryPayload } from '../report/customer-delivery-payload.js';
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

  const generatedAt = payload.generatedAt ? new Date(payload.generatedAt) : null;
  const hoursSinceGeneration = generatedAt ? (Date.now() - generatedAt.getTime()) / 3600_000 : Infinity;
  checks.push({
    name: 'freshness',
    passed: generatedAt !== null && hoursSinceGeneration <= 24,
    detail: generatedAt
      ? `生成于 ${payload.generatedAt}（${hoursSinceGeneration.toFixed(1)} 小时前）`
      : '缺少 generatedAt',
  });

  const itemsWithEvidence = payload.items.filter(
    (item) => item.images && item.images.length > 0,
  );
  const regressOrMinor = payload.items.filter(
    (item) => item.kind === 'regress' || item.kind === 'minor',
  );
  const allHaveEvidence = regressOrMinor.length === 0 || regressOrMinor.every((item) => item.images.length > 0);
  checks.push({
    name: 'evidence',
    passed: allHaveEvidence,
    detail: allHaveEvidence
      ? `${regressOrMinor.length} 个问题条目均有证据图`
      : `${regressOrMinor.length - itemsWithEvidence.length} 个问题条目缺少证据图`,
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

  checks.push({
    name: 'content-hash',
    passed: !!payload.contentHash,
    detail: payload.contentHash ? `内容哈希：${payload.contentHash}` : '缺少 contentHash，审核无法绑定内容',
  });

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
