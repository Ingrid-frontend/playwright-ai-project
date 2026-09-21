#!/usr/bin/env tsx
/**
 * 导出客户报告 Markdown 版本（供飞书文档消费）。
 * 用法: npm run report:customer:markdown
 * 前置: npm run report:customer
 */
import fs from 'fs';
import path from 'path';
import { readCustomerDeliveryPayload, type DeliveryPayload } from './customer-delivery-payload.js';
import { resolveDeliveryPayloadPath } from '../../src/utils/env-profile.js';

const DEFAULT_OUT = 'results/customer-report.md';

function formatStatsMarkdown(payload: DeliveryPayload): string {
  const s = payload.stats;
  const minorParts: string[] = [];
  if (s.degradedSteps > 0) minorParts.push(`需确认 ${s.degradedSteps} 步`);
  if (s.benignSteps > 0) minorParts.push(`可忽略 ${s.benignSteps} 步`);
  const minorLine = minorParts.length > 0 ? minorParts.join(' · ') : `无需处理 ${s.minorSteps} 步`;

  const lines: string[] = [
    `**${payload.headline}**`,
    '',
    `环境：${payload.envLabel || payload.envId || '未指定'}`,
    payload.releaseTag ? `版本：v${payload.releaseTag}` : '',
    `生成时间：${payload.generatedAt}`,
    '',
    `发版建议：${payload.shipAdviceLabel}`,
    '',
    `检测覆盖：${s.coveragePct}%（已对比 ${s.comparedSteps}/${s.expectedSteps} 步）`,
    '',
    `- 需要修复 ${s.regressSteps} 步`,
    `- ${minorLine}`,
    `- 完全一致 ${s.passSteps} 步`,
  ];
  if (s.uncoveredSteps > 0) {
    lines.push(`- 待建基线 ${s.uncoveredSteps} 步（未参与判定）`);
  }
  return lines.filter(Boolean).join('\n');
}

function formatIssuesMarkdown(payload: DeliveryPayload): string {
  const issues = payload.items.filter((i) => i.kind === 'regress' || i.kind === 'minor');
  if (issues.length === 0) {
    return '\n本次未发现需要修复的问题。\n';
  }

  const lines: string[] = ['\n**问题清单**：\n'];
  for (const [i, issue] of issues.slice(0, 10).entries()) {
    const kind = issue.kind === 'regress' ? '需修复' : '需确认';
    const images = issue.images.length > 0 ? `（附 ${issue.images.length} 张证据图）` : '';
    lines.push(`${i + 1}. [${kind}] ${issue.title}`);
    lines.push(`   - 脚本：${issue.scriptLabel}`);
    lines.push(`   - 步骤：${issue.stepLabel}`);
    lines.push(`   - 差异率：${issue.differenceLabel}`);
    if (issue.reason) lines.push(`   - 说明：${issue.reason}`);
    if (issue.plainText) lines.push(`   - 描述：${issue.plainText}`);
    if (images) lines.push(`   - ${images}`);
    lines.push('');
  }
  if (issues.length > 10) {
    lines.push(`… 另有 ${issues.length - 10} 个问题，见完整 HTML 报告。\n`);
  }
  return lines.join('\n');
}

function formatActionItemsMarkdown(payload: DeliveryPayload): string {
  if (payload.actionItems.length === 0) return '';
  const lines: string[] = ['\n**建议操作**：\n'];
  for (const [i, item] of payload.actionItems.entries()) {
    lines.push(`${i + 1}. ${item}`);
  }
  return lines.join('\n');
}

function formatUncoveredMarkdown(payload: DeliveryPayload): string {
  if (payload.uncoveredList.length === 0) return '';
  const lines: string[] = ['\n**待建基线**（未参与判定）：\n'];
  for (const [i, item] of payload.uncoveredList.slice(0, 5).entries()) {
    lines.push(`${i + 1}. ${item.scriptLabel} · ${item.stepLabel}`);
  }
  if (payload.uncoveredList.length > 5) {
    lines.push(`… 另有 ${payload.uncoveredList.length - 5} 项，见完整报告。\n`);
  }
  return lines.join('\n');
}

function formatTrendMarkdown(payload: DeliveryPayload): string {
  const trend = payload.trend;
  if (!trend || trend.entries.length < 2) return '';

  const arrow = (delta: number, invert = false): string => {
    if (delta === 0) return '→';
    const up = delta > 0;
    const good = invert ? !up : up;
    return good ? (up ? '↑' : '↓') : (up ? '↑' : '↓');
  };

  const lines: string[] = ['\n**近期待续**（最近 ' + trend.entries.length + ' 次交付）：\n'];
  lines.push('| 日期 | 覆盖率 | 通过率 | 衰退 | 需确认 |');
  lines.push('|---|---|---|---|---|');
  for (const entry of trend.entries.slice(-5)) {
    const date = entry.generatedAt.slice(0, 10);
    lines.push(`| ${date} | ${entry.stats.coveragePct}% | ${entry.stats.passRate}% | ${entry.stats.regressSteps} | ${entry.stats.degradedSteps + entry.stats.benignSteps} |`);
  }

  if (trend.previous) {
    lines.push('');
    lines.push(`较上次：覆盖率 ${arrow(trend.coverageDelta)}${trend.coverageDelta > 0 ? '+' : ''}${trend.coverageDelta}% · 通过率 ${arrow(trend.passRateDelta)}${trend.passRateDelta > 0 ? '+' : ''}${trend.passRateDelta}% · 衰退 ${arrow(trend.regressDelta, true)}${trend.regressDelta > 0 ? '+' : ''}${trend.regressDelta}`);
  }

  return lines.join('\n');
}

export function buildCustomerReportMarkdown(payload: DeliveryPayload): string {
  const sections = [
    formatStatsMarkdown(payload),
    formatTrendMarkdown(payload),
    formatIssuesMarkdown(payload),
    formatActionItemsMarkdown(payload),
    formatUncoveredMarkdown(payload),
  ];
  return sections.filter(Boolean).join('\n\n');
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const envFlag = args.find((a) => a.startsWith('--env='));
  const envId = envFlag ? envFlag.slice('--env='.length).trim() : '';
  const outFlag = args.find((a) => !a.startsWith('--'));
  const outPath = path.resolve(outFlag || DEFAULT_OUT);

  const payloadPath = envId ? resolveDeliveryPayloadPath(envId) : 'results/customer-delivery.json';
  const payload = readCustomerDeliveryPayload(payloadPath);
  if (!payload) {
    console.error(`缺少交付载荷 ${payloadPath}，请先执行 npm run report:customer`);
    process.exit(1);
  }

  const markdown = buildCustomerReportMarkdown(payload);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, markdown, 'utf-8');

  console.log(`Markdown 已导出: ${outPath}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
