#!/usr/bin/env tsx
/**
 * UI 验收明细/汇总表历史迁移：旧英文列名 → 中文列名 + 类型规范化 + 记录回填 + 汇总重建
 *
 *   npm run feishu:delivery-migrate                    # 全量 dry-run（值域扫描 + 改名预览 + 回填预览）
 *   npm run feishu:delivery-migrate -- --apply         # 全量执行（按内部顺序：改名 → 补列 → 回填）
 *   npm run feishu:delivery-migrate -- --apply --schema-only     # 仅列改名/类型迁移
 *   npm run feishu:delivery-migrate -- --apply --backfill-only   # 仅历史记录回填（要求 schema 已迁移）
 *   npm run feishu:delivery-migrate -- --apply --rebuild-summary # 从 results/history 重建历史批次汇总行
 *
 * 上线 runbook：停交付窗口内 dry-run 核对 → --apply → 恢复交付。
 * 若某列的类型转换被飞书拒绝（值域异常或 API 报错），回退方案为「新增列」：把该列
 * 从下面的 MIGRATION_PLAN 挪到 DELIVERY_FIELD_SPECS，旧列进 DELIVERY_DEPRECATED_FIELDS。
 */
import dotenv from 'dotenv';
import { BitableClient, type BitableFieldValue, type BitableRecordFields } from './bitable-client.js';
import {
  BITABLE_FIELD_TYPE,
  DELIVERY_FIELDS,
  DELIVERY_FIELD_SPECS,
  DELIVERY_SUMMARY_FIELDS,
  DELIVERY_SUMMARY_FIELD_SPECS,
  DELIVERY_SUMMARY_TABLE_NAME,
  DELIVERY_TABLE_NAME,
  explainMissingBitableConfig,
  loadBitableRuntimeConfig,
} from './bitable-schema.js';
import {
  DELIVERY_BROWSER_OPTIONS,
  DELIVERY_ENV_OPTIONS,
  DELIVERY_ITERATION_OPTIONS,
  DELIVERY_VERDICT_OPTIONS,
  formatShipAdviceLabel,
} from './bitable-display.js';
import { parseDifferencePercent } from './bitable-delivery.js';
import { ensureDeliveryTable } from './bitable-delivery.js';
import { ensureDeliverySummaryTable } from './bitable-delivery-summary.js';
import { readDeliveryHistory } from '../report/customer-delivery-history.js';
import { envLabelFromProfile } from '../../src/utils/env-profile.js';

dotenv.config();

type MigrateOptions = {
  apply: boolean;
  schemaOnly: boolean;
  backfillOnly: boolean;
  rebuildSummary: boolean;
};

function parseArgs(): MigrateOptions {
  const args = process.argv.slice(2);
  return {
    apply: args.includes('--apply'),
    schemaOnly: args.includes('--schema-only'),
    backfillOnly: args.includes('--backfill-only'),
    rebuildSummary: args.includes('--rebuild-summary'),
  };
}

/** 列迁移计划：from 旧列名 → to 新列名（含类型变更），值域受限列标 strictOptions */
type ColumnMigration = {
  from: string;
  to: string;
  type: number;
  property?: Record<string, unknown>;
  /** 单选转换的预期选项；历史值 ⊄ 选项时中止该列转换（人工决策） */
  strictOptions?: Array<{ name: string; color?: number }>;
};

const NUMBER_INT = { formatter: '0' };

function buildMigrationPlan(): ColumnMigration[] {
  const t = BITABLE_FIELD_TYPE;
  return [
    { from: 'env', to: DELIVERY_FIELDS.env, type: t.singleSelect, property: { options: DELIVERY_ENV_OPTIONS } },
    { from: 'release_tag', to: DELIVERY_FIELDS.releaseTag, type: t.text },
    // 同名改类型：text → 单选，选项 = 兜底迭代 + 扫描到的历史值（转换时补全选项）
    { from: DELIVERY_FIELDS.iteration, to: DELIVERY_FIELDS.iteration, type: t.singleSelect, property: { options: DELIVERY_ITERATION_OPTIONS } },
    { from: 'verdict', to: DELIVERY_FIELDS.verdict, type: t.singleSelect, property: { options: DELIVERY_VERDICT_OPTIONS }, strictOptions: DELIVERY_VERDICT_OPTIONS },
    { from: 'flow', to: DELIVERY_FIELDS.flow, type: t.text },
    { from: 'step', to: DELIVERY_FIELDS.step, type: t.text },
    { from: 'step_number', to: DELIVERY_FIELDS.stepNumber, type: t.number, property: NUMBER_INT },
    { from: 'browser', to: DELIVERY_FIELDS.browser, type: t.singleSelect, property: { options: DELIVERY_BROWSER_OPTIONS }, strictOptions: DELIVERY_BROWSER_OPTIONS },
    { from: 'difference', to: DELIVERY_FIELDS.difference, type: t.text },
    { from: 'affected_steps', to: DELIVERY_FIELDS.affectedSteps, type: t.number, property: NUMBER_INT },
    { from: 'reason', to: DELIVERY_FIELDS.reason, type: t.text },
    { from: 'baseline_image', to: DELIVERY_FIELDS.baselineImage, type: t.attachment },
    { from: 'current_image', to: DELIVERY_FIELDS.currentImage, type: t.attachment },
    { from: 'diff_image', to: DELIVERY_FIELDS.diffImage, type: t.attachment },
    { from: 'doc_url', to: DELIVERY_FIELDS.docUrl, type: t.url },
  ];
}

/** 飞书文本字段可能返回分段数组（[{type:'text', text:'…'}]），统一取纯文本 */
function readTextValue(raw: unknown): string {
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

function isEmptyValue(raw: unknown): boolean {
  if (raw === null || raw === undefined) return true;
  if (typeof raw === 'string') return raw.trim() === '';
  if (Array.isArray(raw)) return raw.length === 0;
  return false;
}

async function resolveDeliveryTableId(client: BitableClient, configured?: string): Promise<string | null> {
  const tables = await client.listTables();
  if (configured) {
    const hit = tables.find((t) => t.table_id === configured);
    if (hit) return hit.table_id;
  }
  const byName = tables.find((t) => t.name === DELIVERY_TABLE_NAME);
  return byName?.table_id ?? null;
}

/** 只读查找汇总表：优先配置的 tableId，其次按表名 */
async function resolveSummaryTableId(
  client: BitableClient,
  configured?: string,
): Promise<string | null> {
  const tables = await client.listTables();
  if (configured) {
    const hit = tables.find((t) => t.table_id === configured);
    if (hit) return hit.table_id;
  }
  const byName = tables.find((t) => t.name === DELIVERY_SUMMARY_TABLE_NAME);
  return byName?.table_id ?? null;
}

/** dry-run 专用只读预览：盘点「将补建字段 / 将创建汇总表」，不做任何远端写操作 */
async function previewPendingFields(
  client: BitableClient,
  tableId: string,
  configuredSummaryTableId?: string,
): Promise<{ missingDeliveryFields: string[]; summaryTableId: string | null; missingSummaryFields: string[] }> {
  const existingNames = new Set((await client.listFields(tableId)).map((f) => f.field_name));
  const missingDeliveryFields = DELIVERY_FIELD_SPECS
    .filter((spec) => !existingNames.has(spec.name))
    .map((spec) => spec.name);

  const summaryTableId = await resolveSummaryTableId(client, configuredSummaryTableId);
  let missingSummaryFields: string[] = [];
  if (summaryTableId) {
    const summaryNames = new Set((await client.listFields(summaryTableId)).map((f) => f.field_name));
    missingSummaryFields = DELIVERY_SUMMARY_FIELD_SPECS
      .filter((spec) => !summaryNames.has(spec.name))
      .map((spec) => spec.name);
  }
  return { missingDeliveryFields, summaryTableId, missingSummaryFields };
}

type MigrationReport = {
  renamed: number;
  skippedColumns: string[];
  abortedColumns: string[];
  createdFields: string[];
  summaryTableId: string | null;
  backfilled: number;
  pendingBackfill: number;
  rebuiltSummary: number;
  skippedExistingSummary: number;
};

/** 列改名/改类型：带值域扫描与「目标列已被误建为空列」清理 */
async function migrateSchema(
  client: BitableClient,
  tableId: string,
  records: Array<{ record_id: string; fields?: Record<string, unknown> }>,
  apply: boolean,
): Promise<{ renamed: number; skipped: string[]; aborted: string[] }> {
  const fields = await client.listFields(tableId);
  const byName = new Map(fields.map((f) => [f.field_name, f]));
  const plan = buildMigrationPlan();
  const skipped: string[] = [];
  const aborted: string[] = [];
  let renamed = 0;

  console.log(`\n🏷️  列名中文化 + 类型规范化（${plan.length} 列计划）`);
  for (const entry of plan) {
    const fromField = byName.get(entry.from);
    const toField = entry.from === entry.to ? fromField : byName.get(entry.to);

    if (!fromField && !toField) {
      skipped.push(entry.from);
      continue;
    }
    const alreadyDone =
      (!fromField && toField) || (fromField && entry.from === entry.to && fromField.type === entry.type);
    if (alreadyDone) {
      skipped.push(entry.from);
      continue;
    }
    // from 与 to 并存（to 多半被 fix-fields 提前误建）：to 列全空才删后改名，否则人工决策
    if (fromField && toField && entry.from !== entry.to) {
      const toHasValue = records.some((r) => !isEmptyValue(r.fields?.[entry.to]));
      if (toHasValue) {
        console.log(`   ⛔ ${entry.from} → ${entry.to}：目标列已存在且含数据，跳过转换（人工核对）`);
        aborted.push(entry.from);
        continue;
      }
      console.log(`   · 目标列 ${entry.to} 为提前误建的空列，先删除再改名`);
      if (apply) await client.deleteField(tableId, toField.field_id);
    }

    // 值域扫描：历史 distinct 值 ⊄ 预期选项时中止该列（不自动映射）
    if (entry.strictOptions) {
      const expected = new Set(entry.strictOptions.map((o) => o.name));
      const values = new Set<string>();
      for (const r of records) {
        const v = readTextValue(r.fields?.[entry.from]);
        if (v) values.add(v);
      }
      const unknown = [...values].filter((v) => !expected.has(v));
      if (unknown.length > 0) {
        console.log(`   ⛔ ${entry.from} → ${entry.to}：发现未知值 ${unknown.join('、')}，中止转换（人工决策）`);
        aborted.push(entry.from);
        continue;
      }
    }
    // 单选转换：把历史 distinct 值并入选项，保证既有数据全部有选项可挂
    const property = { ...(entry.property ?? {}) };
    if (entry.type === BITABLE_FIELD_TYPE.singleSelect) {
      const optionNames = new Set<string>(
        ((property.options as Array<{ name: string }>) ?? []).map((o) => o.name),
      );
      for (const r of records) {
        const v = readTextValue(r.fields?.[entry.from]);
        if (v) optionNames.add(v);
      }
      property.options = [...optionNames].map((name) => {
        const preset = (DELIVERY_VERDICT_OPTIONS.find((o) => o.name === name) ??
          DELIVERY_BROWSER_OPTIONS.find((o) => o.name === name)) as { name: string; color?: number } | undefined;
        return preset?.color != null ? { name, color: preset.color } : { name };
      });
    }

    const label = entry.from === entry.to ? `${entry.from}（类型 text→单选）` : `${entry.from} → ${entry.to}`;
    console.log(`   · ${label}`);
    if (apply) {
      await client.updateField(tableId, fromField!.field_id, { name: entry.to, type: entry.type, property });
      renamed += 1;
    }
  }
  if (!apply) console.log('   预览：加 --apply 执行');
  else console.log(`   ✅ 已迁移 ${renamed} 列`);
  return { renamed, skipped, aborted };
}

/** 逐条回填历史记录：交付时间 / 差异% / 需处理；仅 patch 缺失字段，幂等可重跑 */
async function backfillRecords(
  client: BitableClient,
  tableId: string,
  apply: boolean,
): Promise<{ pending: number; backfilled: number; missingDeliveryId: number }> {
  const records = await client.listRecords(tableId);
  let pending = 0;
  let backfilled = 0;
  let missingDeliveryId = 0;

  console.log(`\n🩹 历史记录回填（${records.length} 条）`);
  for (const record of records) {
    const fields = record.fields ?? {};
    const patch: Record<string, BitableFieldValue> = {};

    const deliveredAtRaw = fields[DELIVERY_FIELDS.deliveredAt];
    if (isEmptyValue(deliveredAtRaw)) {
      const ts = Date.parse(readTextValue(fields[DELIVERY_FIELDS.generatedAt]));
      if (Number.isFinite(ts)) patch[DELIVERY_FIELDS.deliveredAt] = ts;
    }
    if (isEmptyValue(fields[DELIVERY_FIELDS.differencePct])) {
      const n = parseDifferencePercent(readTextValue(fields[DELIVERY_FIELDS.difference]));
      if (n !== undefined) patch[DELIVERY_FIELDS.differencePct] = n;
    }
    const needActionRaw = fields[DELIVERY_FIELDS.actionable];
    if (needActionRaw === undefined || needActionRaw === null) {
      const oldActionable = readTextValue(fields['actionable']);
      if (oldActionable === '是' || oldActionable === '否') {
        patch[DELIVERY_FIELDS.actionable] = oldActionable === '是';
      }
    }
    if (isEmptyValue(fields[DELIVERY_FIELDS.deliveryId])) missingDeliveryId += 1;

    if (Object.keys(patch).length === 0) continue;
    pending += 1;
    console.log(`   · ${record.record_id}: ${Object.keys(patch).join('、')}`);
    if (apply) {
      await client.updateRecord(tableId, record.record_id, patch);
      backfilled += 1;
    }
  }

  if (missingDeliveryId > 0) {
    console.log(`   ℹ️  ${missingDeliveryId} 条旧记录无法回填 delivery_id（从未写入且哈希不可逆），保持留空`);
  }
  if (pending === 0) {
    console.log('   无需回填');
  } else if (!apply) {
    console.log(`   预览：${pending} 条待回填，加 --apply 执行`);
  } else {
    console.log(`   ✅ 已回填 ${backfilled} 条`);
  }
  return { pending, backfilled, missingDeliveryId };
}

/** 从本地 delivery-history 重建历史批次汇总行；已存在的 delivery_id 不覆盖（防稀疏数据冲掉完整行） */
async function rebuildSummaryFromHistory(
  client: BitableClient,
  summaryTableId: string,
  apply: boolean,
): Promise<{ rebuilt: number; skippedExisting: number }> {
  const entries = readDeliveryHistory();
  let rebuilt = 0;
  let skippedExisting = 0;

  console.log(`\n📦 汇总历史重建（本地历史 ${entries.length} 条）`);
  for (const entry of entries) {
    if (!entry.deliveryId) continue;
    const existing = await client.findRecord(summaryTableId, DELIVERY_SUMMARY_FIELDS.deliveryId, entry.deliveryId);
    if (existing) {
      skippedExisting += 1;
      continue;
    }
    const deliveredAt = Date.parse(entry.generatedAt);
    const passRatePct =
      typeof entry.stats.passRate === 'number' && Number.isFinite(entry.stats.passRate)
        ? Number((entry.stats.passRate * 100).toFixed(1))
        : undefined;
    // 历史摘要没有 iteration/releaseTag/uncoveredSteps：留空，不伪造
    const fields: BitableRecordFields = {
      [DELIVERY_SUMMARY_FIELDS.deliveryId]: entry.deliveryId,
      [DELIVERY_SUMMARY_FIELDS.env]: entry.envId ? envLabelFromProfile(entry.envId) || entry.envId : '',
      [DELIVERY_SUMMARY_FIELDS.deliveredAt]: Number.isFinite(deliveredAt) ? deliveredAt : undefined,
      [DELIVERY_SUMMARY_FIELDS.expectedSteps]: entry.stats.expectedSteps,
      [DELIVERY_SUMMARY_FIELDS.comparedSteps]: entry.stats.comparedSteps,
      [DELIVERY_SUMMARY_FIELDS.passSteps]: entry.stats.passSteps,
      [DELIVERY_SUMMARY_FIELDS.minorSteps]: entry.stats.minorSteps,
      [DELIVERY_SUMMARY_FIELDS.regressSteps]: entry.stats.regressSteps,
      [DELIVERY_SUMMARY_FIELDS.passRate]: passRatePct,
      [DELIVERY_SUMMARY_FIELDS.coveragePct]: entry.stats.coveragePct,
      [DELIVERY_SUMMARY_FIELDS.shipAdvice]: formatShipAdviceLabel(entry.shipAdvice) || undefined,
      [DELIVERY_SUMMARY_FIELDS.shipAdviceLabel]: entry.verdict || '',
      [DELIVERY_SUMMARY_FIELDS.remark]: '历史重建',
    };
    console.log(`   · ${entry.deliveryId}（${entry.generatedAt.slice(0, 10)}）`);
    if (apply) {
      await client.upsertRecord(summaryTableId, DELIVERY_SUMMARY_FIELDS.deliveryId, entry.deliveryId, fields);
      rebuilt += 1;
    }
  }

  if (rebuilt + skippedExisting === 0) {
    console.log('   本地无历史交付记录，跳过');
  } else if (!apply) {
    console.log(`   预览：待重建 ${entries.length - skippedExisting} 条 · 已存在跳过 ${skippedExisting} 条，加 --apply 执行`);
  } else {
    console.log(`   ✅ 已重建 ${rebuilt} 条 · 跳过已存在 ${skippedExisting} 条`);
  }
  return { rebuilt, skippedExisting };
}

async function main(): Promise<void> {
  const opts = parseArgs();
  const config = loadBitableRuntimeConfig();
  if (!config) {
    console.log(`❌ ${explainMissingBitableConfig()}`);
    process.exit(1);
  }

  const client = new BitableClient(config);
  const tableId = await resolveDeliveryTableId(client, config.deliveryTableId || undefined);
  if (!tableId) {
    console.log(`❌ 未找到「${DELIVERY_TABLE_NAME}」表（未配置 deliveryTableId 且按表名未命中），请先跑一次交付或手动建表`);
    process.exit(1);
  }

  const runSchema = opts.schemaOnly || (!opts.backfillOnly && !opts.rebuildSummary);
  const runBackfill = opts.backfillOnly || (!opts.schemaOnly && !opts.rebuildSummary);
  const runRebuild = opts.rebuildSummary;

  console.log('\n🔧 UI 验收多维表迁移');
  console.log(`   明细表: ${tableId}`);
  console.log(`   模式: ${opts.apply ? '执行' : '预览（dry-run）'}`);

  const report: MigrationReport = {
    renamed: 0,
    skippedColumns: [],
    abortedColumns: [],
    createdFields: [],
    summaryTableId: null,
    backfilled: 0,
    pendingBackfill: 0,
    rebuiltSummary: 0,
    skippedExistingSummary: 0,
  };

  if (runSchema) {
    // 值域扫描 + 改名（records 供扫描与空列判定）
    const records = await client.listRecords(tableId);
    const schema = await migrateSchema(client, tableId, records, opts.apply);
    report.renamed = schema.renamed;
    report.abortedColumns = schema.aborted;

    // 补建缺失新列（交付时间/差异%/需处理 等）+ 建/补「UI 验收汇总」表——仅 --apply 执行；dry-run 只读预览
    if (opts.apply) {
      const ensured = await ensureDeliveryTable(client, { tableId });
      report.createdFields = ensured.addedFields;
      if (ensured.addedFields.length) {
        console.log(`   ➕ 明细表补建字段: ${ensured.addedFields.join('、')}`);
      } else {
        console.log('   明细表字段完整，无需补建');
      }
      const summaryTable = await ensureDeliverySummaryTable(client, {
        tableId: config.deliverySummaryTableId || undefined,
      });
      report.summaryTableId = summaryTable.tableId;
      console.log(`   📊 汇总表 ${summaryTable.created ? '已创建' : `已存在${summaryTable.addedFields.length ? `，补建字段 ${summaryTable.addedFields.length} 个` : ''}`}: ${summaryTable.tableId}`);
      if (summaryTable.created) {
        console.log(`      建议写入 .env: FEISHU_BITABLE_DELIVERY_SUMMARY_TABLE_ID=${summaryTable.tableId}`);
      }
    } else {
      const preview = await previewPendingFields(client, tableId, config.deliverySummaryTableId || undefined);
      report.createdFields = preview.missingDeliveryFields;
      if (preview.missingDeliveryFields.length) {
        console.log(`   · 将补建明细字段: ${preview.missingDeliveryFields.join('、')}`);
      } else {
        console.log('   · 明细表字段完整，无需补建');
      }
      if (preview.summaryTableId) {
        console.log(`   · 汇总表已存在${preview.missingSummaryFields.length ? `，将补建字段 ${preview.missingSummaryFields.join('、')}` : '且字段完整'}: ${preview.summaryTableId}`);
      } else {
        console.log('   · 将创建汇总表「UI 验收汇总」（--apply 时执行）');
      }
    }
  }

  if (runBackfill) {
    const backfill = await backfillRecords(client, tableId, opts.apply);
    report.backfilled = backfill.backfilled;
    report.pendingBackfill = backfill.pending;
  }

  if (runRebuild) {
    let summaryResolved = await resolveSummaryTableId(client, config.deliverySummaryTableId || undefined);
    if (!summaryResolved && !opts.apply) {
      const entries = readDeliveryHistory();
      console.log('\n📦 汇总历史重建（预览）');
      console.log('   汇总表尚不存在：--apply 时会先创建「UI 验收汇总」再重建');
      console.log(`   预览：本地历史 ${entries.length} 条将全部重建`);
    } else {
      // 仅 --apply 且表不存在时才建表；dry-run 走上面的只读分支
      if (!summaryResolved) summaryResolved = (await ensureDeliverySummaryTable(client)).tableId;
      const rebuild = await rebuildSummaryFromHistory(client, summaryResolved, opts.apply);
      report.rebuiltSummary = rebuild.rebuilt;
      report.skippedExistingSummary = rebuild.skippedExisting;
    }
  }

  console.log('\n── 迁移摘要 ──');
  console.log(`   列迁移: ${report.renamed} 完成${report.abortedColumns.length ? ` · ${report.abortedColumns.length} 列中止（${report.abortedColumns.join('、')}）` : ''}`);
  console.log(`   补建字段: ${report.createdFields.length} 个`);
  console.log(`   记录回填: ${report.backfilled} 条`);
  if (report.rebuiltSummary + report.skippedExistingSummary > 0) {
    console.log(`   汇总重建: ${report.rebuiltSummary} 条 · 跳过已存在 ${report.skippedExistingSummary} 条`);
  }
  if (report.abortedColumns.length) {
    console.log('\n⚠️  存在中止列：请在飞书 UI 人工核对这些列的历史值后重跑，或改用「新增列」回退方案（见文件头注释）');
  }
  if (!opts.apply) {
    console.log('\n💡 确认无误后执行: npm run feishu:delivery-migrate -- --apply');
  }
}

main().catch((error: unknown) => {
  console.error('❌ 迁移失败:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
