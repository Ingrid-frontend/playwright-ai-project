import { createHash } from 'node:crypto';
import type { BitableClient, BitableRecordFields } from './bitable-client.js';
import { FEEDBACK_FIELDS } from './bitable-schema.js';
import type { DeliveryPayload, DeliveryItem } from '../report/customer-delivery-payload.js';

/**
 * 从交付条目派生稳定问题身份：env + 流程 + 步骤 + 浏览器 + 页面。
 * 不含运行时间、差异值等浮动因素，保证同一问题多次检出命中同一条反馈记录。
 */
export function deriveStableIssueId(payload: DeliveryPayload, item: DeliveryItem): string {
  const parts = [
    payload.envId || payload.envLabel || '',
    item.scriptLabel || '',
    item.stepLabel || '',
    item.browserLabel || '',
    item.title || '',
  ];
  return createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 16);
}

export type SyncFeedbackResult = {
  created: number;
  updated: number;
};

/**
 * 将交付中发现的问题同步到反馈表（UI采集反馈）。
 * 只更新检测事实（最近发现、描述），不覆盖人工字段（状态、处理人、截止时间）。
 * 新问题初始状态为「待确认」，后续由人工分派和推进。
 */
export async function syncDeliveryFeedback(
  client: BitableClient,
  feedbackTableId: string,
  payload: DeliveryPayload,
): Promise<SyncFeedbackResult> {
  const issues = payload.items.filter((i) => i.kind === 'regress' || i.kind === 'minor');
  const result: SyncFeedbackResult = { created: 0, updated: 0 };
  if (!issues.length) return result;

  const now = Date.parse(new Date().toISOString());

  for (const item of issues) {
    const stableId = deriveStableIssueId(payload, item);

    const fields: BitableRecordFields = {
      [FEEDBACK_FIELDS.stableIssueId]: stableId,
      [FEEDBACK_FIELDS.feedbackId]: stableId,
      [FEEDBACK_FIELDS.lastFoundAt]: now,
      [FEEDBACK_FIELDS.description]: item.plainText || item.reason,
      [FEEDBACK_FIELDS.env]: payload.envId || payload.envLabel || '',
      [FEEDBACK_FIELDS.route]: item.title || '',
      [FEEDBACK_FIELDS.severity]: item.kind === 'regress' ? '阻断' : '警告',
    };

    const res = await client.upsertRecord(feedbackTableId, FEEDBACK_FIELDS.stableIssueId, stableId, fields);

    if (res.created) {
      await client.updateRecord(feedbackTableId, res.recordId, {
        [FEEDBACK_FIELDS.status]: '待确认',
        [FEEDBACK_FIELDS.firstFoundAt]: now,
        [FEEDBACK_FIELDS.createdAt]: now,
        [FEEDBACK_FIELDS.reporter]: '自动检测',
      });
      result.created += 1;
    } else {
      result.updated += 1;
    }
  }

  return result;
}
