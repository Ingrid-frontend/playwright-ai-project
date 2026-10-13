import dotenv from 'dotenv';
import { BitableClient, type BitableRecordFields } from './bitable-client.js';
import {
  ARCHIVE_FIELD,
  BITABLE_FIELD_TYPE,
  DELIVERY_FIELDS,
  DELIVERY_TABLE_NAME,
  explainMissingBitableConfig,
  loadBitableRuntimeConfig,
} from './bitable-schema.js';
import { extractLoginAccount, friendlyScriptLabel } from '../report/customer-report-naming.js';
import { sanitizeScriptLabel } from '../report/customer-delivery-payload.js';

dotenv.config();

const ARCHIVE_VIEW_NAME = '归档';
const MAIN_VIEW_NAME = '全部明细';

export type BaselineDeliveryTarget = {
  account: string;
  flow: string;
};

export type ArchiveBaselineDeliveryResult = {
  skipped: boolean;
  archived: number;
  reason?: string;
};

function readText(raw: unknown): string {
  if (raw === null || raw === undefined) return '';
  if (typeof raw === 'string') return raw.trim();
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw);
  if (Array.isArray(raw)) {
    return raw
      .map((seg) =>
        seg && typeof seg === 'object' && 'text' in seg
          ? String((seg as { text?: unknown }).text ?? '')
          : String(seg ?? ''),
      )
      .join('')
      .trim();
  }
  return '';
}

/** 本次晋升的基线对应哪些验收明细：登录账号 + 流程名。 */
export function baselineDeliveryTarget(scriptKey: string): BaselineDeliveryTarget {
  return {
    account: extractLoginAccount(scriptKey),
    flow: sanitizeScriptLabel(friendlyScriptLabel(scriptKey)),
  };
}

/** 只命中这次基线的明细。别的账号、别的流程、已归档行都不动。 */
export function matchesBaselineDelivery(fields: Record<string, unknown>, target: BaselineDeliveryTarget): boolean {
  if (fields[ARCHIVE_FIELD] === true) return false;
  const rowAccount = readText(fields[DELIVERY_FIELDS.account]);
  const rowFlow = readText(fields[DELIVERY_FIELDS.flow]);
  if (target.account) {
    if (rowAccount !== target.account) return false;
    if (target.flow && rowFlow && rowFlow !== target.flow) return false;
    return true;
  }
  return Boolean(target.flow && rowFlow === target.flow);
}

function archiveFilter(fieldId: string, archived: boolean) {
  return {
    conjunction: 'and' as const,
    conditions: [{ field_id: fieldId, operator: 'is', value: archived ? '[true]' : '[false]' }],
  };
}

async function resolveDeliveryTableId(client: BitableClient, configured?: string): Promise<string | null> {
  const tables = await client.listTables();
  if (configured) {
    const hit = tables.find((t) => t.table_id === configured);
    if (hit) return hit.table_id;
  }
  return tables.find((t) => t.name === DELIVERY_TABLE_NAME)?.table_id ?? null;
}

async function ensureArchiveField(client: BitableClient, tableId: string): Promise<string> {
  let fields = await client.listFields(tableId);
  let archiveField = fields.find((field) => field.field_name === ARCHIVE_FIELD);
  if (!archiveField) {
    await client.createField(tableId, { name: ARCHIVE_FIELD, type: BITABLE_FIELD_TYPE.checkbox });
    fields = await client.listFields(tableId);
    archiveField = fields.find((field) => field.field_name === ARCHIVE_FIELD);
  }
  if (!archiveField) throw new Error(`UI 验收明细未创建「${ARCHIVE_FIELD}」字段`);
  return archiveField.field_id;
}

type ViewDetail = {
  property?: {
    hidden_fields?: string[];
    filter_info?: {
      conjunction?: string;
      conditions?: Array<{ field_id?: string; operator?: string; value?: string }>;
    };
  };
};

async function hideArchivedInViews(client: BitableClient, tableId: string, archiveFieldId: string): Promise<void> {
  const views = await client.listViews(tableId);
  const main = views.find((view) => view.view_name === MAIN_VIEW_NAME);
  let hidden: string[] = [];
  if (main) {
    const detail = (await client.getView(tableId, main.view_id)) as { view?: ViewDetail } & ViewDetail;
    const current = detail.view ?? detail;
    hidden = [...(current.property?.hidden_fields ?? [])];
  }
  if (!hidden.includes(archiveFieldId)) hidden.push(archiveFieldId);

  let archiveViewId = views.find((view) => view.view_name === ARCHIVE_VIEW_NAME)?.view_id;
  if (!archiveViewId) archiveViewId = await client.createView(tableId, ARCHIVE_VIEW_NAME);

  const propertyBase = { hidden_fields: hidden, hierarchy_config: null };
  await client.patchView(tableId, archiveViewId, {
    ...propertyBase,
    filter_info: archiveFilter(archiveFieldId, true),
  });

  if (main) {
    const detail = (await client.getView(tableId, main.view_id)) as { view?: ViewDetail } & ViewDetail;
    const current = detail.view ?? detail;
    const kept = (current.property?.filter_info?.conditions ?? []).filter(
      (cond) => cond.field_id && cond.field_id !== archiveFieldId,
    );
    await client.patchView(tableId, main.view_id, {
      ...propertyBase,
      filter_info: {
        conjunction: 'and',
        conditions: [...kept, ...archiveFilter(archiveFieldId, false).conditions],
      },
    });
  }

  for (const view of views.filter((item) => item.view_name.includes('dashboard_view'))) {
    const detail = (await client.getView(tableId, view.view_id)) as { view?: ViewDetail } & ViewDetail;
    const current = detail.view ?? detail;
    const prev = current.property ?? {};
    const kept = (prev.filter_info?.conditions ?? []).filter((cond) => cond.field_id && cond.field_id !== archiveFieldId);
    const viewHidden = [...(prev.hidden_fields ?? [])];
    if (!viewHidden.includes(archiveFieldId)) viewHidden.push(archiveFieldId);
    await client.patchView(tableId, view.view_id, {
      hidden_fields: viewHidden,
      hierarchy_config: null,
      filter_info: {
        conjunction: 'and',
        conditions: [...kept, ...archiveFilter(archiveFieldId, false).conditions],
      },
    });
  }
}

/**
 * 晋升基线后，把「UI 验收明细」里对应该基线的未归档行勾上归档。
 * 不处理汇总、执行记录、问题明细。
 */
export async function archiveBaselineDelivery(scriptKey: string): Promise<ArchiveBaselineDeliveryResult> {
  const config = loadBitableRuntimeConfig();
  if (!config) {
    return { skipped: true, archived: 0, reason: explainMissingBitableConfig() };
  }

  const target = baselineDeliveryTarget(scriptKey);
  if (!target.account && !target.flow) {
    return { skipped: true, archived: 0, reason: '无法从脚本键识别账号或流程' };
  }

  const client = new BitableClient(config);
  const tableId = await resolveDeliveryTableId(client, config.deliveryTableId);
  if (!tableId) {
    return { skipped: true, archived: 0, reason: '未找到 UI 验收明细表' };
  }

  const records = await client.listRecords(tableId);
  const toArchive: Array<{ recordId: string; fields: BitableRecordFields }> = [];
  const toKeep: Array<{ recordId: string; fields: BitableRecordFields }> = [];
  for (const row of records) {
    if (!row.record_id) continue;
    const fields = row.fields ?? {};
    if (fields[ARCHIVE_FIELD] === true) continue;
    if (matchesBaselineDelivery(fields, target)) {
      toArchive.push({ recordId: row.record_id, fields: { [ARCHIVE_FIELD]: true } });
    } else if (fields[ARCHIVE_FIELD] !== false) {
      toKeep.push({ recordId: row.record_id, fields: { [ARCHIVE_FIELD]: false } });
    }
  }

  if (!toArchive.length) {
    return { skipped: false, archived: 0 };
  }

  const archiveFieldId = await ensureArchiveField(client, tableId);
  await client.batchUpdateRecords(tableId, [...toArchive, ...toKeep]);
  await hideArchivedInViews(client, tableId, archiveFieldId);
  return { skipped: false, archived: toArchive.length };
}
