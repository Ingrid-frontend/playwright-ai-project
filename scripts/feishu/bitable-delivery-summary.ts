import type { BitableClient, BitableRecordFields } from './bitable-client.js';
import {
  DEFAULT_DELIVERY_ITERATION,
  DELIVERY_SUMMARY_FIELDS,
  DELIVERY_SUMMARY_FIELD_SPECS,
  DELIVERY_SUMMARY_TABLE_NAME,
} from './bitable-schema.js';
import { formatShipAdviceLabel } from './bitable-display.js';
import type { DeliveryPayload } from '../report/customer-delivery-payload.js';

/**
 * 交付批次汇总：一行一个 deliveryId（upsert 键），把 DeliveryPayload.stats
 * 压平成一行，供跨迭代对比通过率/覆盖率/问题数。数据全部来自现有 payload
 * 字段，不改变载荷结构与 contentHash。
 */

/** 找到「UI 验收汇总」表，没有就新建；随后补齐缺失字段（含单选选项） */
export async function ensureDeliverySummaryTable(
  client: BitableClient,
  opts?: { tableId?: string },
): Promise<{
  tableId: string;
  created: boolean;
  addedFields: string[];
}> {
  const tables = await client.listTables();
  let table = opts?.tableId ? tables.find((t) => t.table_id === opts.tableId) : undefined;
  if (!table) table = tables.find((t) => t.name === DELIVERY_SUMMARY_TABLE_NAME);
  let created = false;

  if (!table) {
    const res = await client.createTable(DELIVERY_SUMMARY_TABLE_NAME, {
      defaultViewName: '全部批次',
      initialFields: [{ field_name: DELIVERY_SUMMARY_FIELDS.deliveryId, type: 1 }],
    });
    table = { table_id: res.table_id, name: DELIVERY_SUMMARY_TABLE_NAME };
    created = true;
  }

  const existing = new Set((await client.listFields(table.table_id)).map((f) => f.field_name));
  const addedFields: string[] = [];
  for (const spec of DELIVERY_SUMMARY_FIELD_SPECS) {
    if (existing.has(spec.name)) continue;
    await client.createField(table.table_id, { name: spec.name, type: spec.type, property: spec.property });
    addedFields.push(spec.name);
  }

  return { tableId: table.table_id, created, addedFields };
}

export type DeliverySummaryRecordOptions = {
  /** 交付文档链接，doc 创建后回填 */
  docUrl?: string;
  /** 备注（如「历史重建」） */
  remark?: string;
};

/** 把一个交付载荷压平成汇总表记录；通过率 0-1 换算为 0-100 */
export function buildDeliverySummaryRecord(
  payload: DeliveryPayload,
  opts?: DeliverySummaryRecordOptions,
): BitableRecordFields {
  const s = payload.stats;
  const deliveredAt = Date.parse(payload.generatedAt);
  const passRatePct =
    typeof s.passRate === 'number' && Number.isFinite(s.passRate)
      ? Number((s.passRate * 100).toFixed(1))
      : undefined;
  const fields: BitableRecordFields = {
    [DELIVERY_SUMMARY_FIELDS.deliveryId]: payload.deliveryId,
    [DELIVERY_SUMMARY_FIELDS.iteration]: payload.iteration || DEFAULT_DELIVERY_ITERATION,
    [DELIVERY_SUMMARY_FIELDS.env]: payload.envLabel || '',
    [DELIVERY_SUMMARY_FIELDS.releaseTag]: payload.releaseTag || '',
    [DELIVERY_SUMMARY_FIELDS.deliveredAt]: Number.isFinite(deliveredAt) ? deliveredAt : undefined,
    [DELIVERY_SUMMARY_FIELDS.expectedSteps]: s.expectedSteps,
    [DELIVERY_SUMMARY_FIELDS.comparedSteps]: s.comparedSteps,
    [DELIVERY_SUMMARY_FIELDS.passSteps]: s.passSteps,
    [DELIVERY_SUMMARY_FIELDS.minorSteps]: s.minorSteps,
    [DELIVERY_SUMMARY_FIELDS.regressSteps]: s.regressSteps,
    [DELIVERY_SUMMARY_FIELDS.uncoveredSteps]: s.uncoveredSteps,
    [DELIVERY_SUMMARY_FIELDS.passRate]: passRatePct,
    [DELIVERY_SUMMARY_FIELDS.coveragePct]: typeof s.coveragePct === 'number' ? Number(s.coveragePct.toFixed(1)) : undefined,
    [DELIVERY_SUMMARY_FIELDS.totalIssueCount]: payload.totalIssueCount,
    [DELIVERY_SUMMARY_FIELDS.shipAdvice]: formatShipAdviceLabel(payload.shipAdvice) || undefined,
  };
  if (opts?.remark) fields[DELIVERY_SUMMARY_FIELDS.remark] = opts.remark;
  if (opts?.docUrl) fields[DELIVERY_SUMMARY_FIELDS.docUrl] = { link: opts.docUrl, text: '验收报告' };
  return fields;
}

export type WriteDeliverySummaryResult = {
  recordId: string;
  created: boolean;
};

/** 幂等写入：同一 deliveryId 重试时更新同一行，不产生重复批次 */
export async function writeDeliverySummaryRecord(
  client: BitableClient,
  tableId: string,
  payload: DeliveryPayload,
  opts?: DeliverySummaryRecordOptions,
): Promise<WriteDeliverySummaryResult> {
  const fields = buildDeliverySummaryRecord(payload, opts);
  const res = await client.upsertRecord(
    tableId,
    DELIVERY_SUMMARY_FIELDS.deliveryId,
    payload.deliveryId,
    fields,
  );
  return { recordId: res.recordId, created: res.created };
}
