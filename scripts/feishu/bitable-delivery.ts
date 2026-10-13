import { createHash } from 'node:crypto';
import type { BitableClient, BitableAttachment, BitableRecordFields } from './bitable-client.js';
import { DEFAULT_DELIVERY_ITERATION, DELIVERY_FIELDS, DELIVERY_FIELD_SPECS, DELIVERY_TABLE_NAME } from './bitable-schema.js';
import type { DeliveryPayload, DeliveryItem } from '../report/customer-delivery-payload.js';

/**
 * 内部键 → 外发键：item_key 落多维表前先哈希。
 * 原始 key 含本地目录路径 / by-account 测试账号 / 时间戳，直接外发会把内部信息泄漏给客户。
 * sha256 前 16 位 hex：稳定（同 key 同值，upsert 幂等保持）、不可逆、不含任何内部串。
 */
export function hashItemKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex').slice(0, 16);
}

/** 找到交付明细表，没有就新建；随后补齐缺失字段（已存在的字段不会重复创建） */
export async function ensureDeliveryTable(
  client: BitableClient,
  opts?: { tableId?: string },
): Promise<{
  tableId: string;
  created: boolean;
  addedFields: string[];
}> {
  const tables = await client.listTables();
  let table = opts?.tableId ? tables.find((t) => t.table_id === opts.tableId) : undefined;
  if (!table) table = tables.find((t) => t.name === DELIVERY_TABLE_NAME);
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
    // property 必须透传，否则单选列建不出选项/颜色
    await client.createField(table.table_id, { name: spec.name, type: spec.type, property: spec.property });
    addedFields.push(spec.name);
  }

  return { tableId: table.table_id, created, addedFields };
}

export type DeliveryRecordContext = {
  docUrl?: string;
  /** 图片绝对路径 → 飞书 file_token */
  tokens: Map<string, string>;
};

const COMPARE_IMAGE_ROLES = ['baseline', 'current', 'diff'] as const;

function attachmentFor(
  item: DeliveryItem,
  role: (typeof COMPARE_IMAGE_ROLES)[number],
  ctx: DeliveryRecordContext,
  resolvePath: (relPath: string) => string,
): BitableAttachment | undefined {
  const image = item.images.find((i) => i.role === role);
  if (!image) return undefined;
  const abs = resolvePath(image.relPath);
  const fileToken = ctx.tokens.get(abs);
  if (!fileToken) return undefined;
  const order = COMPARE_IMAGE_ROLES.indexOf(role) + 1;
  return { file_token: fileToken, name: `${order}-${image.label}.png` };
}

/** 从多维表附件字段取出可回写的 file_token；读接口会带 url/size，回写只留 token 和文件名 */
export function readAttachments(raw: unknown): BitableAttachment[] {
  if (!Array.isArray(raw)) return [];
  const out: BitableAttachment[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const token = (item as { file_token?: unknown }).file_token;
    if (typeof token !== 'string' || !token) continue;
    const name = (item as { name?: unknown }).name;
    out.push(typeof name === 'string' && name ? { file_token: token, name } : { file_token: token });
  }
  return out;
}

/** 差异文本 "1.00%" → 数值 1；解析失败返回 undefined（该列不写） */
export function parseDifferencePercent(label?: string | null): number | undefined {
  if (!label) return undefined;
  const n = Number.parseFloat(String(label).replace('%', '').trim());
  if (!Number.isFinite(n)) return undefined;
  return Number(n.toFixed(2));
}

/** 把一条交付项转成多维表记录字段；图片未上传成功时该附件列留空，不影响文字结论 */
export function buildDeliveryRecord(
  item: DeliveryItem,
  payload: DeliveryPayload,
  ctx: DeliveryRecordContext,
  resolvePath: (relPath: string) => string,
): BitableRecordFields {
  const deliveredAt = Date.parse(payload.generatedAt);
  const fields: BitableRecordFields = {
    [DELIVERY_FIELDS.page]: item.title,
    [DELIVERY_FIELDS.itemKey]: hashItemKey(item.key),
    [DELIVERY_FIELDS.deliveryId]: payload.deliveryId,
    [DELIVERY_FIELDS.runId]: payload.runId || '',
    [DELIVERY_FIELDS.generatedAt]: payload.generatedAt,
    [DELIVERY_FIELDS.deliveredAt]: Number.isFinite(deliveredAt) ? deliveredAt : undefined,
    [DELIVERY_FIELDS.env]: payload.envLabel || '',
    [DELIVERY_FIELDS.releaseTag]: payload.releaseTag || '',
    [DELIVERY_FIELDS.iteration]: payload.iteration || DEFAULT_DELIVERY_ITERATION,
    [DELIVERY_FIELDS.verdict]: item.verdictLabel,
    [DELIVERY_FIELDS.flow]: item.scriptLabel,
    [DELIVERY_FIELDS.account]: item.account || '',
    [DELIVERY_FIELDS.step]: item.stepLabel,
    [DELIVERY_FIELDS.stepNumber]: item.stepNumber,
    [DELIVERY_FIELDS.browser]: item.browserLabel,
    [DELIVERY_FIELDS.difference]: item.differenceLabel,
    [DELIVERY_FIELDS.differencePct]: parseDifferencePercent(item.differenceLabel),
    [DELIVERY_FIELDS.affectedSteps]: item.affectedSteps,
    [DELIVERY_FIELDS.actionable]: Boolean(item.actionable),
    [DELIVERY_FIELDS.reason]: item.plainText || item.reason,
  };

  const images = COMPARE_IMAGE_ROLES
    .map((role) => attachmentFor(item, role, ctx, resolvePath))
    .filter((img): img is BitableAttachment => Boolean(img));
  if (images.length) fields[DELIVERY_FIELDS.compareImages] = images;

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
    // 去重模式下 item_key 存不含时间的 key 哈希，保证下次能命中同一条记录；
    // 非去重用含时间 key 的哈希，每次生成新行。
    const uniqueValue = hashItemKey(opts?.dedupe ? item.dedupeKey : item.key);
    fields[DELIVERY_FIELDS.itemKey] = uniqueValue;
    const res = await client.upsertRecord(tableId, DELIVERY_FIELDS.itemKey, uniqueValue, fields);
    result.records.push({ recordId: res.recordId, key: item.key, created: res.created });
    if (res.created) result.created += 1;
    else result.updated += 1;
  }

  return result;
}

const COMPARE_IMAGE_SOURCES = [
  { field: DELIVERY_FIELDS.baselineImage, name: '1-验收基线.png' },
  { field: DELIVERY_FIELDS.currentImage, name: '2-本次截图.png' },
  { field: DELIVERY_FIELDS.diffImage, name: '3-差异标注.png' },
] as const;

/** 把旧的三列附件收进「对比图」。已有对比图的行不覆盖。 */
export async function mergeDeliveryImageColumns(
  client: BitableClient,
  tableId: string,
): Promise<{ merged: number; skipped: number }> {
  const records = await client.listRecords(tableId);
  let merged = 0;
  let skipped = 0;
  for (const rec of records) {
    const fields = rec.fields || {};
    if (readAttachments(fields[DELIVERY_FIELDS.compareImages]).length > 0) {
      skipped += 1;
      continue;
    }
    const images: BitableAttachment[] = [];
    for (const src of COMPARE_IMAGE_SOURCES) {
      const hit = readAttachments(fields[src.field])[0];
      if (hit) images.push({ file_token: hit.file_token, name: src.name });
    }
    if (!images.length || !rec.record_id) {
      skipped += 1;
      continue;
    }
    await client.updateRecord(tableId, rec.record_id, {
      [DELIVERY_FIELDS.compareImages]: images,
    });
    merged += 1;
  }
  return { merged, skipped };
}
