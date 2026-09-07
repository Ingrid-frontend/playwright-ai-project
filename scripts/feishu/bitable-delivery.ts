import type { BitableClient, BitableAttachment, BitableRecordFields } from './bitable-client.js';
import { DELIVERY_FIELDS, DELIVERY_FIELD_SPECS, DELIVERY_TABLE_NAME } from './bitable-schema.js';
import type { DeliveryPayload, DeliveryItem } from '../report/customer-delivery-payload.js';

/** 找到交付明细表，没有就新建；随后补齐缺失字段（已存在的字段不会重复创建） */
export async function ensureDeliveryTable(client: BitableClient): Promise<{
  tableId: string;
  created: boolean;
  addedFields: string[];
}> {
  const tables = await client.listTables();
  let table = tables.find((t) => t.name === DELIVERY_TABLE_NAME);
  let created = false;

  if (!table) {
    const res = await client.createTable(DELIVERY_TABLE_NAME, {
      defaultViewName: '全部明细',
      initialFields: [{ field_name: '页面', type: 1 }],
    });
    table = { table_id: res.table_id, name: DELIVERY_TABLE_NAME };
    created = true;
  }

  const existing = new Set((await client.listFields(table.table_id)).map((f) => f.field_name));
  const addedFields: string[] = [];
  for (const spec of DELIVERY_FIELD_SPECS) {
    if (existing.has(spec.name)) continue;
    await client.createField(table.table_id, { name: spec.name, type: spec.type });
    addedFields.push(spec.name);
  }

  return { tableId: table.table_id, created, addedFields };
}

export type DeliveryRecordContext = {
  docUrl?: string;
  /** 图片绝对路径 → 飞书 file_token */
  tokens: Map<string, string>;
};

function attachmentFor(
  item: DeliveryItem,
  role: 'baseline' | 'current' | 'diff',
  ctx: DeliveryRecordContext,
  resolvePath: (relPath: string) => string,
): BitableAttachment[] | undefined {
  const image = item.images.find((i) => i.role === role);
  if (!image) return undefined;
  const abs = resolvePath(image.relPath);
  const fileToken = ctx.tokens.get(abs);
  if (!fileToken) return undefined;
  return [{ file_token: fileToken, name: `${item.title}-${image.label}.png` }];
}

/** 把一条交付项转成多维表记录字段；图片未上传成功时该附件列留空，不影响文字结论 */
export function buildDeliveryRecord(
  item: DeliveryItem,
  payload: DeliveryPayload,
  ctx: DeliveryRecordContext,
  resolvePath: (relPath: string) => string,
): BitableRecordFields {
  const fields: BitableRecordFields = {
    页面: item.title,
    [DELIVERY_FIELDS.itemKey]: item.key,
    [DELIVERY_FIELDS.generatedAt]: payload.generatedAt,
    [DELIVERY_FIELDS.env]: payload.envLabel || '',
    [DELIVERY_FIELDS.releaseTag]: payload.releaseTag || '',
    [DELIVERY_FIELDS.verdict]: item.verdictLabel,
    [DELIVERY_FIELDS.flow]: item.scriptLabel,
    [DELIVERY_FIELDS.step]: item.stepLabel,
    [DELIVERY_FIELDS.stepNumber]: item.stepNumber,
    [DELIVERY_FIELDS.browser]: item.browserLabel,
    [DELIVERY_FIELDS.difference]: item.differenceLabel,
    [DELIVERY_FIELDS.affectedSteps]: item.affectedSteps,
    [DELIVERY_FIELDS.actionable]: item.actionable ? '是' : '否',
    [DELIVERY_FIELDS.reason]: item.plainText || item.reason,
  };

  const baseline = attachmentFor(item, 'baseline', ctx, resolvePath);
  const current = attachmentFor(item, 'current', ctx, resolvePath);
  const diff = attachmentFor(item, 'diff', ctx, resolvePath);
  if (baseline) fields[DELIVERY_FIELDS.baselineImage] = baseline;
  if (current) fields[DELIVERY_FIELDS.currentImage] = current;
  if (diff) fields[DELIVERY_FIELDS.diffImage] = diff;

  if (ctx.docUrl) fields[DELIVERY_FIELDS.docUrl] = { link: ctx.docUrl, text: '验收报告' };

  return fields;
}

export type WriteDeliveryResult = {
  created: number;
  updated: number;
  records: Array<{ recordId: string; key: string; created: boolean }>;
};

export async function writeDeliveryRecords(
  client: BitableClient,
  tableId: string,
  payload: DeliveryPayload,
  ctx: DeliveryRecordContext,
  opts?: { dedupe?: boolean; resolvePath?: (relPath: string) => string },
): Promise<WriteDeliveryResult> {
  const resolvePath = opts?.resolvePath ?? ((rel: string) => rel);
  const result: WriteDeliveryResult = { created: 0, updated: 0, records: [] };

  for (const item of payload.items) {
    const fields = buildDeliveryRecord(item, payload, ctx, resolvePath);
    // 去重模式下 item_key 存不含时间的 key，保证下次能命中同一条记录
    const uniqueValue = opts?.dedupe ? item.dedupeKey : item.key;
    fields[DELIVERY_FIELDS.itemKey] = uniqueValue;
    const res = await client.upsertRecord(tableId, DELIVERY_FIELDS.itemKey, uniqueValue, fields);
    result.records.push({ recordId: res.recordId, key: item.key, created: res.created });
    if (res.created) result.created += 1;
    else result.updated += 1;
  }

  return result;
}
