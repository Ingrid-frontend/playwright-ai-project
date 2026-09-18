import type { DeliveryPayload, DeliveryItem } from '../report/customer-delivery-payload.js';
import type { FeishuNotifyPayload } from './feishu-app.js';

export type DeliveryCardOptions = {
  docUrl?: string;
  bitableUrl?: string;
  internal?: boolean;
  reviewer?: string;
};

type CardTemplate = 'green' | 'red' | 'orange' | 'blue';

function templateForAdvice(advice: string): CardTemplate {
  switch (advice) {
    case 'fix':
      return 'red';
    case 'confirm':
      return 'orange';
    case 'baseline':
      return 'blue';
    default:
      return 'green';
  }
}

function shorten(text: string, max = 60): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length > max ? `${collapsed.slice(0, max)}…` : collapsed;
}

function issueLine(item: DeliveryItem, index: number): string {
  const impact = item.affectedSteps > 1 ? `，影响 ${item.affectedSteps} 步` : '';
  const diff = item.differenceLabel ? `（${item.differenceLabel}${impact}）` : '';
  const lines = [`${index + 1}. [${item.verdictLabel}] **${item.title}**${diff}`];
  if (item.reason) lines.push(`   ${shorten(item.reason)}`);
  return lines.join('\n');
}

export function buildDeliveryCard(payload: DeliveryPayload, opts: DeliveryCardOptions = {}): FeishuNotifyPayload {
  const { docUrl, bitableUrl, internal = false, reviewer } = opts;
  const s = payload.stats;
  const ctx = [payload.envLabel, payload.releaseTag ? `v${payload.releaseTag}` : ''].filter(Boolean).join(' · ');

  const lines: string[] = [`**${payload.headline}**`];
  if (ctx) lines.push(`环境：${ctx}`);
  lines.push(`发版建议：${payload.shipAdviceLabel}`);
  lines.push(
    `检测覆盖：${s.coveragePct}%（已对比 ${s.comparedSteps}/${s.expectedSteps} 步）· 通过率 ${(s.passRate * 100).toFixed(1)}%`,
  );
  lines.push(
    `需要修复 ${s.regressSteps} 步 · 可接受差异 ${s.minorSteps} 步（${s.degradedSteps} 步内容变化 / ${s.benignSteps} 步无需处理）`,
  );
  if (s.uncoveredSteps > 0) lines.push(`待建基线 ${s.uncoveredSteps} 步（未参与判定）`);

  const issues = payload.items.filter((i) => i.kind === 'regress' || i.kind === 'minor').slice(0, 5);
  if (issues.length > 0) {
    lines.push('', '**需关注问题**：');
    issues.forEach((item, idx) => lines.push(issueLine(item, idx)));
    if (payload.totalIssueCount > issues.length) {
      lines.push(`…其余 ${payload.totalIssueCount - issues.length} 项见完整报告`);
    }
  }

  const elements: unknown[] = [{ tag: 'div', text: { tag: 'lark_md', content: lines.join('\n') } }];

  const actions: Array<Record<string, unknown>> = [];
  if (docUrl) {
    actions.push({
      tag: 'button',
      text: { tag: 'plain_text', content: '打开验收文档' },
      type: 'primary',
      url: docUrl,
    });
  }
  // 多维表明细含内部 trace，仅内部留档卡暴露
  if (internal && bitableUrl) {
    actions.push({
      tag: 'button',
      text: { tag: 'plain_text', content: '查看多维表明细' },
      type: 'default',
      url: bitableUrl,
    });
  }
  if (actions.length > 0) elements.push({ tag: 'action', actions });

  const noteParts = internal ? ['UI 验收交付留档（内部）', `deliveryId=${payload.deliveryId}`] : ['UI 验收检测报告'];
  if (internal && reviewer) noteParts.push(`审核人 ${reviewer}`);
  elements.push({ tag: 'note', elements: [{ tag: 'plain_text', content: noteParts.join(' · ') }] });

  const title = `UI 验收检测报告 · ${ctx || payload.envId || ''}`.replace(/ · $/, '');
  return {
    msg_type: 'interactive',
    card: {
      header: { title: { tag: 'plain_text', content: title }, template: templateForAdvice(payload.shipAdvice) },
      elements,
    },
  };
}
