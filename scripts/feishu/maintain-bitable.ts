#!/usr/bin/env tsx
/**
 * 飞书多维表维护：列名中文化、pass_rate 迁移、删除 issue/明细废弃列、清理 issue 噪声行
 *
 *   npm run feishu:bitable-maintain                      # 预览
 *   npm run feishu:bitable-maintain -- --apply           # 全部执行
 *   npm run feishu:bitable-maintain -- --apply --clean-daily-only
 *   npm run feishu:bitable-maintain -- --apply --prune-issue-noise-only   # 仅删 issue 表噪声行
 *   npm run feishu:bitable-maintain -- --apply --drop-delivery-fields-only # 仅删明细表废弃列
 *   npm run feishu:bitable-maintain -- --apply --tidy-only                 # 删空表 + 收窄日常视图 + 废弃列/噪声
 *   npm run feishu:bitable-maintain -- --apply --dashboard-views           # 只改仪表盘明细视图的可见列
 *   npm run feishu:bitable-maintain -- --apply --promote-index             # 把索引列从空的「多行文本」换成业务键
 *   npm run feishu:bitable-maintain -- --apply --archive-current           # 现有行进「归档」视图，当前视图只接新写入
 */
import dotenv from 'dotenv';
import {
  BitableClient,
  ARCHIVE_FIELD,
  BITABLE_FIELD_TYPE,
  DAILY_FIELDS,
  DAILY_FIELD_RENAMES,
  DELIVERY_FIELDS,
  DELIVERY_SUMMARY_FIELDS,
  FEEDBACK_FIELDS,
  FEEDBACK_FIELD_RENAMES,
  ISSUE_DEPRECATED_FIELDS,
  ISSUE_FIELDS,
  ISSUE_FIELD_RENAMES,
  RUN_FIELDS,
  RUN_FIELD_RENAMES,
  DELIVERY_DEPRECATED_FIELDS,
  calcUiPassRate,
  explainMissingBitableConfig,
  loadBitableRuntimeConfig,
} from './index.js';
import { buildDailySummaryKey } from './write-bitable-report.js';
import type { SearchRecordItem, BitableFieldValue } from './bitable-client.js';

dotenv.config();

type MaintainOptions = {
  apply: boolean;
  renameFieldsOnly: boolean;
  passRateOnly: boolean;
  dropIssueFieldsOnly: boolean;
  cleanDailyOnly: boolean;
  pruneIssueNoiseOnly: boolean;
  dropDeliveryFieldsOnly: boolean;
  tidyOnly: boolean;
  promoteIndex: boolean;
  archiveCurrent: boolean;
  dashboardViews: boolean;
};

function parseArgs(): MaintainOptions {
  const args = process.argv.slice(2);
  return {
    apply: args.includes('--apply'),
    renameFieldsOnly: args.includes('--rename-fields-only'),
    passRateOnly: args.includes('--pass-rate-only'),
    dropIssueFieldsOnly: args.includes('--drop-issue-fields-only'),
    cleanDailyOnly: args.includes('--clean-daily-only'),
    pruneIssueNoiseOnly: args.includes('--prune-issue-noise-only'),
    dropDeliveryFieldsOnly: args.includes('--drop-delivery-fields-only'),
    tidyOnly: args.includes('--tidy-only'),
    promoteIndex: args.includes('--promote-index'),
    archiveCurrent: args.includes('--archive-current'),
    dashboardViews: args.includes('--dashboard-views'),
  };
}

const ARCHIVE_VIEW_NAME = '归档';

const EMPTY_TABLE_NAME = '数据表';
const EMPTY_TABLE_FIELDS = new Set(['文本', '单选', '日期', '附件']);

type SlimView = {
  label: string;
  viewName: string;
  visible: readonly string[];
};

const SLIM_VIEWS: Record<string, SlimView> = {
  delivery: {
    label: 'UI 验收明细',
    viewName: '全部明细',
    visible: [
      DELIVERY_FIELDS.page,
      DELIVERY_FIELDS.verdict,
      DELIVERY_FIELDS.flow,
      DELIVERY_FIELDS.account,
      DELIVERY_FIELDS.step,
      DELIVERY_FIELDS.browser,
      DELIVERY_FIELDS.difference,
      DELIVERY_FIELDS.differencePct,
      DELIVERY_FIELDS.affectedSteps,
      DELIVERY_FIELDS.actionable,
      DELIVERY_FIELDS.reason,
      DELIVERY_FIELDS.compareImages,
      DELIVERY_FIELDS.docUrl,
    ],
  },
  summary: {
    label: 'UI 验收汇总',
    viewName: '全部批次',
    visible: [
      DELIVERY_SUMMARY_FIELDS.deliveredAt,
      DELIVERY_SUMMARY_FIELDS.iteration,
      DELIVERY_SUMMARY_FIELDS.env,
      DELIVERY_SUMMARY_FIELDS.releaseTag,
      DELIVERY_SUMMARY_FIELDS.passRate,
      DELIVERY_SUMMARY_FIELDS.coveragePct,
      DELIVERY_SUMMARY_FIELDS.shipAdvice,
      DELIVERY_SUMMARY_FIELDS.shipAdviceLabel,
      DELIVERY_SUMMARY_FIELDS.docUrl,
    ],
  },
  run: {
    label: '执行记录',
    viewName: '表格视图 1',
    visible: [
      RUN_FIELDS.executedAt,
      RUN_FIELDS.status,
      RUN_FIELDS.blockerCount,
      RUN_FIELDS.warningCount,
      RUN_FIELDS.reportUrl,
    ],
  },
  issue: {
    label: '问题明细',
    viewName: '表格视图 1',
    visible: [
      ISSUE_FIELDS.severity,
      ISSUE_FIELDS.scriptShort,
      ISSUE_FIELDS.stepName,
      ISSUE_FIELDS.compareKind,
      ISSUE_FIELDS.differencePercent,
      ISSUE_FIELDS.runRecordLink,
      ISSUE_FIELDS.aiDocUrl,
    ],
  },
  daily: {
    label: '日汇总',
    viewName: '表格视图 1',
    visible: [
      DAILY_FIELDS.dateText,
      DAILY_FIELDS.passRate,
      DAILY_FIELDS.blockerCount,
      DAILY_FIELDS.warningCount,
      DAILY_FIELDS.coveragePct,
    ],
  },
  feedback: {
    label: 'UI采集反馈',
    viewName: '全部反馈',
    visible: [
      FEEDBACK_FIELDS.description,
      FEEDBACK_FIELDS.severity,
      FEEDBACK_FIELDS.status,
      FEEDBACK_FIELDS.assignees,
      FEEDBACK_FIELDS.deadline,
    ],
  },
};

const DASHBOARD_VIEWS: Record<string, SlimView> = {
  run: {
    label: '最近运行状态明细',
    viewName: 'dashboard_view',
    visible: [
      RUN_FIELDS.env,
      RUN_FIELDS.executedAt,
      RUN_FIELDS.status,
      RUN_FIELDS.blockerCount,
      RUN_FIELDS.warningCount,
      RUN_FIELDS.topScripts,
      RUN_FIELDS.failureReasons,
    ],
  },
  issue: {
    label: '待处理问题（明细）',
    viewName: 'dashboard_view',
    visible: [
      ISSUE_FIELDS.stepName,
      ISSUE_FIELDS.compareKind,
      ISSUE_FIELDS.severity,
      ISSUE_FIELDS.differencePercent,
      ISSUE_FIELDS.description,
      ISSUE_FIELDS.scriptShort,
    ],
  },
};

function fieldIsEmpty(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value as object).length === 0;
  return false;
}

function readNumberField(fields: Record<string, unknown>, ...keys: string[]): number | null {
  for (const key of keys) {
    const raw = fields[key];
    if (raw === null || raw === undefined) continue;
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
    if (typeof raw === 'string') {
      const n = Number(raw);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

function isLegacyPassRate(value: number): boolean {
  return value === 0 || value === 1;
}

function normalizeLegacyPassRate(value: number): number {
  return value * 100;
}

function readTextField(fields: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const raw = fields[key];
    if (raw === null || raw === undefined) continue;
    if (typeof raw === 'string' && raw.trim()) return raw.trim();
    if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw);
  }
  return '';
}

function readDateText(fields: Record<string, unknown>): string {
  const text = readTextField(fields, DAILY_FIELDS.dateText, 'date_text', '日期文本');
  if (text) return text.slice(0, 10);
  const rawDate = fields[DAILY_FIELDS.date] ?? fields.date ?? fields['日期'];
  if (typeof rawDate === 'number' && Number.isFinite(rawDate)) {
    return new Date(rawDate).toISOString().slice(0, 10);
  }
  const summaryKey = readTextField(fields, DAILY_FIELDS.summaryKey, 'summary_key', '汇总键');
  if (summaryKey) return summaryKey.split('|')[0]?.slice(0, 10) ?? '';
  return '';
}

function readDailyGroupKey(fields: Record<string, unknown>): string {
  const date = readDateText(fields);
  const env = readTextField(fields, DAILY_FIELDS.env, 'env', '环境');
  if (date && env) return buildDailySummaryKey(date, env);
  const summaryKey = readTextField(fields, DAILY_FIELDS.summaryKey, 'summary_key', '汇总键');
  const parts = summaryKey.split('|');
  if (parts.length >= 2) return buildDailySummaryKey(parts[0], parts[1]);
  return summaryKey || '';
}

function recalcPassRateFromDailyFields(fields: Record<string, unknown>): number {
  const total = readNumberField(fields, DAILY_FIELDS.totalIssues, 'total_issues', '问题总数') ?? 0;
  const blocker = readNumberField(fields, DAILY_FIELDS.blockerCount, 'blocker_count', '阻断问题') ?? 0;
  const warning = readNumberField(fields, DAILY_FIELDS.warningCount, 'warning_count', '警告问题') ?? 0;
  return calcUiPassRate({
    comparisonTotal: total,
    comparisonBlocker: blocker,
    comparisonWarning: warning,
  }) ?? 0;
}

function dailyKeeperScore(fields: Record<string, unknown>): number {
  const jobId = readTextField(fields, DAILY_FIELDS.jobId, 'job_id', '任务');
  const total = readNumberField(fields, DAILY_FIELDS.totalIssues, 'total_issues', '问题总数') ?? 0;
  const summaryKey = readTextField(fields, DAILY_FIELDS.summaryKey, 'summary_key', '汇总键');
  let score = 0;
  if (jobId !== 'history-backfill') score += 100;
  if (summaryKey.split('|').length === 2) score += 20;
  if (total > 0) score += 10;
  score += readNumberField(fields, DAILY_FIELDS.blockerCount, 'blocker_count', '阻断问题') ?? 0;
  return score;
}

function pickDailyKeeper(records: SearchRecordItem[]): SearchRecordItem {
  return [...records].sort((a, b) => dailyKeeperScore(b.fields ?? {}) - dailyKeeperScore(a.fields ?? {}))[0];
}

function buildFieldUpdateSpec(item: {
  type: number;
  property?: Record<string, unknown>;
}, nextName: string): { name: string; type: number; property?: Record<string, unknown> } {
  const spec: { name: string; type: number; property?: Record<string, unknown> } = {
    name: nextName,
    type: item.type,
  };
  const prop = item.property ?? {};
  if (item.type === 18 || item.type === 21) {
    if (prop.table_id) {
      spec.property = { multiple: Boolean(prop.multiple), table_id: prop.table_id };
    }
    return spec;
  }
  if (Object.keys(prop).length > 0) {
    spec.property = prop;
  }
  return spec;
}

async function renameTableFields(
  client: BitableClient,
  label: string,
  tableId: string,
  renames: Record<string, string>,
  apply: boolean,
): Promise<number> {
  const fields = await client.listFields(tableId);
  const names = new Set(fields.map((item) => item.field_name));
  const pending = fields.filter((item) => {
    const next = renames[item.field_name];
    return next && next !== item.field_name && !names.has(next);
  });

  console.log(`\n🏷️  ${label} 列名中文化（${pending.length} 列待改）`);
  if (!pending.length) {
    console.log('   已是中文列名或目标列已存在');
    return 0;
  }

  let done = 0;
  for (const item of pending) {
    const next = renames[item.field_name]!;
    console.log(`   · ${item.field_name} → ${next}`);
    if (apply) {
      await client.updateField(tableId, item.field_id, buildFieldUpdateSpec(item, next));
      done += 1;
    }
  }

  if (!apply) {
    console.log(`   预览：加 --apply 执行`);
  } else {
    console.log(`   ✅ 已重命名 ${done} 列`);
  }
  return done;
}

async function migratePassRate(
  client: BitableClient,
  tableId: string,
  apply: boolean,
): Promise<{ scanned: number; legacy: number; updated: number }> {
  const records = await client.listRecords(tableId);
  let legacy = 0;
  let updated = 0;

  console.log(`\n📊 日汇总 UI通过率 0/1 迁移（${records.length} 条）`);
  for (const record of records) {
    const fields = record.fields ?? {};
    const current = readNumberField(fields, DAILY_FIELDS.passRate, 'pass_rate', 'UI通过率');
    if (current === null || !isLegacyPassRate(current)) continue;
    legacy += 1;
    const next = normalizeLegacyPassRate(current);
    const summaryKey = String(fields[DAILY_FIELDS.summaryKey] ?? fields.summary_key ?? fields['汇总键'] ?? record.record_id);
    const date = fields[DAILY_FIELDS.date] ?? fields.date ?? fields['日期'];
    console.log(`   · ${summaryKey} | date=${JSON.stringify(date)} | ${current} → ${next}`);
    if (apply) {
      await client.updateRecord(tableId, record.record_id, { [DAILY_FIELDS.passRate]: next });
      updated += 1;
    }
  }

  if (!legacy) {
    console.log('   未发现 0/1 旧口径，无需迁移');
  } else if (!apply) {
    console.log(`   预览：${legacy} 条待迁移，加 --apply 执行`);
  } else {
    console.log(`   ✅ 已更新 ${updated} 条`);
  }

  return { scanned: records.length, legacy, updated };
}

async function cleanDailySummaryData(
  client: BitableClient,
  tableId: string,
  apply: boolean,
): Promise<{ scanned: number; deduped: number; fixedPassRate: number; keyUpdated: number }> {
  const records = await client.listRecords(tableId);
  const groups = new Map<string, SearchRecordItem[]>();

  for (const record of records) {
    const fields = record.fields ?? {};
    const groupKey = readDailyGroupKey(fields);
    if (!groupKey) continue;
    const list = groups.get(groupKey) ?? [];
    list.push(record);
    groups.set(groupKey, list);
  }

  const toDelete: string[] = [];
  const toUpdate: Array<{ recordId: string; fields: Record<string, BitableFieldValue> }> = [];
  let deduped = 0;
  let fixedPassRate = 0;
  let keyUpdated = 0;

  console.log(`\n🧹 日汇总数据清理（${records.length} 条 · ${groups.size} 组）`);

  for (const [groupKey, items] of groups) {
    const keeper = pickDailyKeeper(items);
    const keeperFields = keeper.fields ?? {};
    const losers = items.filter((item) => item.record_id !== keeper.record_id);

    if (losers.length) {
      console.log(`   · ${groupKey} 重复 ${items.length} 条，保留 ${readTextField(keeperFields, DAILY_FIELDS.jobId, 'job_id', '任务') || keeper.record_id}`);
      for (const loser of losers) {
        const loserKey = readTextField(loser.fields ?? {}, DAILY_FIELDS.summaryKey, 'summary_key', '汇总键') || loser.record_id;
        console.log(`     删除 ${loserKey}`);
        toDelete.push(loser.record_id);
        deduped += 1;
      }
    }

    const nextKey = groupKey;
    const currentKey = readTextField(keeperFields, DAILY_FIELDS.summaryKey, 'summary_key', '汇总键');
    const currentPassRate = readNumberField(keeperFields, DAILY_FIELDS.passRate, 'pass_rate', 'UI通过率');
    const recalcPassRate = recalcPassRateFromDailyFields(keeperFields);
    const patch: Record<string, BitableFieldValue> = {};

    if (currentKey !== nextKey) {
      patch[DAILY_FIELDS.summaryKey] = nextKey;
      keyUpdated += 1;
      console.log(`   · ${groupKey} 汇总键 ${currentKey || '(空)'} → ${nextKey}`);
    }

    let nextPassRate = recalcPassRate;
    if (currentPassRate !== null && isLegacyPassRate(currentPassRate) && Math.abs(recalcPassRate - currentPassRate) > 1) {
      nextPassRate = normalizeLegacyPassRate(currentPassRate);
    }
    if (currentPassRate === null || Math.abs(nextPassRate - currentPassRate) >= 0.05) {
      patch[DAILY_FIELDS.passRate] = nextPassRate;
      fixedPassRate += 1;
      console.log(`   · ${groupKey} UI通过率 ${currentPassRate ?? '(空)'} → ${nextPassRate}`);
    }

    if (Object.keys(patch).length) {
      toUpdate.push({ recordId: keeper.record_id, fields: patch });
    }
  }

  if (!deduped && !fixedPassRate && !keyUpdated) {
    console.log('   无需清理');
  } else if (!apply) {
    console.log(`   预览：删除 ${deduped} 条 · 修正通过率 ${fixedPassRate} 条 · 更新汇总键 ${keyUpdated} 条，加 --apply 执行`);
  } else {
    for (const item of toUpdate) {
      await client.updateRecord(tableId, item.recordId, item.fields);
    }
    if (toDelete.length) {
      await client.deleteRecords(tableId, toDelete);
    }
    console.log(`   ✅ 已删除 ${deduped} 条重复 · 修正通过率 ${fixedPassRate} 条 · 更新汇总键 ${keyUpdated} 条`);
  }

  return { scanned: records.length, deduped, fixedPassRate, keyUpdated };
}

async function dropDeprecatedFields(
  client: BitableClient,
  label: string,
  tableId: string,
  deprecatedNames: readonly string[],
  apply: boolean,
): Promise<{ found: string[]; deleted: number }> {
  const fields = await client.listFields(tableId);
  const deprecated = new Set<string>(deprecatedNames);
  const hits = fields.filter((item) => deprecated.has(item.field_name));

  console.log(`\n🧹 ${label}废弃列`);
  if (!hits.length) {
    console.log('   未发现废弃列，无需删除');
    return { found: [], deleted: 0 };
  }

  for (const item of hits) {
    console.log(`   · ${item.field_name} (${item.field_id})`);
    if (apply) {
      await client.deleteField(tableId, item.field_id);
      console.log(`     已删除`);
    }
  }

  if (!apply) {
    console.log(`   预览：${hits.length} 列待删除，加 --apply 执行`);
  } else {
    console.log(`   ✅ 已删除 ${hits.length} 列`);
  }

  return { found: hits.map((item) => item.field_name), deleted: apply ? hits.length : 0 };
}

/** 删除 issue 表已入库的噪声行（severity='噪声'）。写入侧已默认过滤，这里是存量清理 */
async function pruneIssueNoiseRecords(
  client: BitableClient,
  tableId: string,
  apply: boolean,
): Promise<{ scanned: number; noise: number; deleted: number }> {
  const records = await client.listRecords(tableId);
  // 列名中文化前后兼容：迁移前 severity，迁移后 严重度
  const readSeverity = (fields: Record<string, unknown> | undefined): unknown =>
    fields?.[ISSUE_FIELDS.severity] ?? fields?.['severity'];

  const isNoise = (raw: unknown): boolean => {
    if (raw === null || raw === undefined) return false;
    if (typeof raw === 'string') return raw.trim() === '噪声';
    if (Array.isArray(raw)) {
      return raw.some(
        (seg) => seg && typeof seg === 'object' && 'text' in seg && String((seg as { text?: unknown }).text ?? '') === '噪声',
      );
    }
    return false;
  };

  const noiseRecords = records.filter((item) => isNoise(readSeverity(item.fields)));

  console.log(`\n🧹 问题明细噪声行清理（扫描 ${records.length} 条）`);
  if (!noiseRecords.length) {
    console.log('   未发现噪声行，无需删除');
    return { scanned: records.length, noise: 0, deleted: 0 };
  }

  for (const item of noiseRecords) {
    const recordKey = item.fields?.[ISSUE_FIELDS.issueRecordId] ?? item.fields?.['issue_record_id'] ?? item.record_id;
    console.log(`   · ${typeof recordKey === 'string' ? recordKey : item.record_id}`);
  }
  if (!apply) {
    console.log(`   预览：${noiseRecords.length} 条噪声行待删除，加 --apply 执行`);
  } else {
    await client.deleteRecords(tableId, noiseRecords.map((item) => item.record_id));
    console.log(`   ✅ 已删除 ${noiseRecords.length} 条噪声行（run 表「噪声问题」计数保留运行事实）`);
  }

  return { scanned: records.length, noise: noiseRecords.length, deleted: apply ? noiseRecords.length : 0 };
}

async function dropEmptyDefaultTable(
  client: BitableClient,
  keepIds: ReadonlySet<string>,
  apply: boolean,
): Promise<void> {
  const tables = await client.listTables();
  const hits = tables.filter((table) => table.name === EMPTY_TABLE_NAME && !keepIds.has(table.table_id));

  console.log('\n🧹 空数据表');
  if (!hits.length) {
    console.log('   未发现未接入的「数据表」');
    return;
  }

  for (const table of hits) {
    const fields = await client.listFields(table.table_id);
    const names = fields.map((field) => field.field_name);
    const onlyDefaults = names.length > 0 && names.every((name) => EMPTY_TABLE_FIELDS.has(name));
    const records = await client.listRecords(table.table_id);
    const nonempty = records.filter((row) => Object.values(row.fields ?? {}).some((value) => !fieldIsEmpty(value)));
    console.log(`   · ${table.name} (${table.table_id}) 字段 ${names.join('、') || '无'} · ${records.length} 行 · 有内容 ${nonempty.length}`);
    if (!onlyDefaults || nonempty.length) {
      console.log('     跳过：不是飞书默认空表');
      continue;
    }
    if (!apply) {
      console.log('     预览：将删除整张表，加 --apply 执行');
      continue;
    }
    try {
      await client.deleteTable(table.table_id);
      console.log('     ✅ 已删除');
    } catch (error) {
      console.log(`     ❌ 删除失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

async function slimTableView(
  client: BitableClient,
  tableId: string,
  spec: SlimView,
  apply: boolean,
): Promise<void> {
  const views = await client.listViews(tableId);
  const view = views.find((item) => item.view_name === spec.viewName && !item.view_name.includes('dashboard_view'));
  console.log(`\n👁  ${spec.label} / ${spec.viewName}`);
  if (!view) {
    console.log('   未找到该视图，跳过');
    return;
  }

  const fields = await client.listFields(tableId);
  const visible = new Set(spec.visible);
  const hidden = fields.filter((field) => !field.is_primary && !visible.has(field.field_name));
  const keptPrimary = fields.filter((field) => field.is_primary).map((field) => field.field_name);
  console.log(`   保留 ${[...keptPrimary, ...spec.visible].filter((name, idx, list) => list.indexOf(name) === idx).join('、')}`);
  console.log(`   隐藏 ${hidden.map((field) => field.field_name).join('、') || '无'}`);
  if (!hidden.length) {
    console.log('   无需调整');
    return;
  }
  if (!apply) {
    console.log(`   预览：隐藏 ${hidden.length} 列，加 --apply 执行`);
    return;
  }

  const detail = await client.getView(tableId, view.view_id);
  const current = (detail.view ?? detail) as { property?: { filter_info?: unknown; hidden_fields?: string[]; hierarchy_config?: unknown } };
  const prev = current.property ?? {};
  try {
    await client.patchView(tableId, view.view_id, {
      filter_info: prev.filter_info ?? null,
      hierarchy_config: prev.hierarchy_config ?? null,
      hidden_fields: hidden.map((field) => field.field_id),
    });
    console.log(`   ✅ 已隐藏 ${hidden.length} 列`);
  } catch (error) {
    console.log(`   ❌ 隐藏失败: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function slimDashboardViews(
  client: BitableClient,
  tableId: string,
  spec: SlimView,
  apply: boolean,
): Promise<void> {
  const views = (await client.listViews(tableId)).filter((item) => item.view_name.includes(spec.viewName));
  console.log(`\n👁  ${spec.label}`);
  if (!views.length) {
    console.log('   未找到仪表盘视图，跳过');
    return;
  }

  const fields = await client.listFields(tableId);
  const visible = new Set<string>(spec.visible);
  const hidden = fields.filter((field) => !field.is_primary && !visible.has(field.field_name));
  const shown = fields
    .filter((field) => field.is_primary || visible.has(field.field_name))
    .map((field) => field.field_name);

  for (const view of views) {
    console.log(`   ${view.view_name} 保留 ${shown.join('、')}`);
    if (!apply) {
      console.log(`   预览：隐藏 ${hidden.length} 列，加 --apply 执行`);
      continue;
    }

    const detail = await client.getView(tableId, view.view_id);
    const current = (detail.view ?? detail) as {
      property?: { filter_info?: unknown; hidden_fields?: string[]; hierarchy_config?: unknown };
    };
    const prev = current.property ?? {};
    try {
      await client.patchView(tableId, view.view_id, {
        filter_info: prev.filter_info ?? null,
        hierarchy_config: prev.hierarchy_config ?? null,
        hidden_fields: hidden.map((field) => field.field_id),
      });
      console.log(`   ✅ 已更新 ${view.view_name}`);
    } catch (error) {
      console.log(`   ❌ 更新失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

function readCellText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (!Array.isArray(value)) return '';
  return value
    .map((seg) => {
      if (typeof seg === 'string') return seg;
      if (seg && typeof seg === 'object' && 'text' in seg) return String((seg as { text?: unknown }).text ?? '');
      return '';
    })
    .join('')
    .trim();
}

async function dropHiddenFieldId(client: BitableClient, tableId: string, fieldId: string): Promise<void> {
  const views = await client.listViews(tableId);
  for (const view of views) {
    if (view.view_name.includes('dashboard_view')) continue;
    const detail = await client.getView(tableId, view.view_id);
    const current = (detail.view ?? detail) as {
      property?: { filter_info?: unknown; hidden_fields?: string[]; hierarchy_config?: unknown };
    };
    const prev = current.property ?? {};
    const hidden = prev.hidden_fields ?? [];
    if (!hidden.includes(fieldId)) continue;
    await client.patchView(tableId, view.view_id, {
      filter_info: prev.filter_info ?? null,
      hierarchy_config: prev.hierarchy_config ?? null,
      hidden_fields: hidden.filter((id) => id !== fieldId),
    });
  }
}

async function promoteIndexColumn(
  client: BitableClient,
  label: string,
  tableId: string,
  keyName: string,
  apply: boolean,
): Promise<void> {
  const fields = await client.listFields(tableId);
  const primary = fields.find((field) => field.is_primary);
  const source = fields.find((field) => field.field_name === keyName);
  console.log(`\n🔑 ${label} 索引列`);
  if (!primary) {
    console.log('   未找到索引列，跳过');
    return;
  }
  if (primary.field_name === keyName) {
    console.log(`   索引列已是「${keyName}」`);
    return;
  }
  if (primary.field_name !== '多行文本' || !source || primary.type !== 1 || source.type !== 1) {
    console.log(`   当前索引「${primary.field_name}」，目标「${keyName}」不满足替换条件，跳过`);
    return;
  }

  const records = await client.listRecords(tableId);
  const patches: Array<{ recordId: string; fields: { [key: string]: string } }> = [];
  let emptyKey = 0;
  for (const row of records) {
    const key = readCellText(row.fields?.[keyName]);
    const current = readCellText(row.fields?.['多行文本']);
    if (!key) {
      emptyKey += 1;
      continue;
    }
    if (current !== key) patches.push({ recordId: row.record_id, fields: { 多行文本: key } });
  }
  console.log(`   ${records.length} 行 · 待写入 ${patches.length} · 键为空 ${emptyKey}`);
  if (emptyKey) {
    console.log('   有空键，不改索引列');
    return;
  }
  if (!apply) {
    console.log(`   预览：索引列改为「${keyName}」，并删除重复列`);
    return;
  }

  if (patches.length) await client.batchUpdateRecords(tableId, patches);
  const oldName = `${keyName}__old`;
  await client.updateField(tableId, source.field_id, { name: oldName, type: source.type });
  try {
    await client.updateField(tableId, primary.field_id, { name: keyName, type: primary.type });
  } catch (error) {
    await client.updateField(tableId, source.field_id, { name: keyName, type: source.type });
    throw error;
  }
  await client.deleteField(tableId, source.field_id);
  await dropHiddenFieldId(client, tableId, source.field_id);
  console.log(`   ✅ 索引列已改为「${keyName}」`);
}

function viewFilter(fieldId: string, archived: boolean): {
  conjunction: 'and' | 'or';
  conditions: Array<{ field_id: string; operator: string; value?: string }>;
} {
  if (archived) {
    return {
      conjunction: 'and',
      conditions: [{ field_id: fieldId, operator: 'is', value: '[true]' }],
    };
  }
  return {
    conjunction: 'and',
    conditions: [{ field_id: fieldId, operator: 'is', value: '[false]' }],
  };
}

async function archiveTable(
  client: BitableClient,
  tableId: string,
  label: string,
  mainViewName: string,
  apply: boolean,
): Promise<void> {
  const records = await client.listRecords(tableId);
  const pending = records.filter((row) => row.fields?.[ARCHIVE_FIELD] !== true);
  console.log(`\n📦 ${label}`);
  console.log(`   ${records.length} 行 · 待归档 ${pending.length}`);
  if (!apply) {
    console.log(`   预览：写入「${ARCHIVE_VIEW_NAME}」视图，当前「${mainViewName}」只留新数据`);
    return;
  }

  let fields = await client.listFields(tableId);
  let archiveField = fields.find((field) => field.field_name === ARCHIVE_FIELD);
  if (!archiveField) {
    await client.createField(tableId, { name: ARCHIVE_FIELD, type: BITABLE_FIELD_TYPE.checkbox });
    fields = await client.listFields(tableId);
    archiveField = fields.find((field) => field.field_name === ARCHIVE_FIELD);
  }
  if (!archiveField) throw new Error(`${label} 未创建「${ARCHIVE_FIELD}」字段`);

  if (pending.length) {
    await client.batchUpdateRecords(
      tableId,
      pending.map((row) => ({ recordId: row.record_id, fields: { [ARCHIVE_FIELD]: true } })),
    );
    console.log(`   ✅ 已标记 ${pending.length} 行`);
  }

  const views = await client.listViews(tableId);
  const main = views.find((view) => view.view_name === mainViewName);
  let hidden: string[] = [];
  if (main) {
    const detail = await client.getView(tableId, main.view_id);
    const current = (detail.view ?? detail) as { property?: { hidden_fields?: string[] } };
    hidden = [...(current.property?.hidden_fields ?? [])];
  }
  if (!hidden.includes(archiveField.field_id)) hidden.push(archiveField.field_id);

  let archiveViewId = views.find((view) => view.view_name === ARCHIVE_VIEW_NAME)?.view_id;
  if (!archiveViewId) {
    archiveViewId = await client.createView(tableId, ARCHIVE_VIEW_NAME);
    console.log(`   ✅ 已新建「${ARCHIVE_VIEW_NAME}」`);
  }

  const propertyBase = { hidden_fields: hidden, hierarchy_config: null };
  await client.patchView(tableId, archiveViewId, {
    ...propertyBase,
    filter_info: viewFilter(archiveField.field_id, true),
  });
  if (!main) {
    console.log(`   ⚠️  未找到「${mainViewName}」，当前视图未改筛选`);
    return;
  }
  await client.patchView(tableId, main.view_id, {
    ...propertyBase,
    filter_info: viewFilter(archiveField.field_id, false),
  });
  console.log(`   ✅ 「${mainViewName}」只显示未归档`);

  const dashboardViews = views.filter((view) => view.view_name.includes('dashboard_view'));
  for (const view of dashboardViews) {
    const detail = await client.getView(tableId, view.view_id);
    const current = (detail.view ?? detail) as {
      property?: { filter_info?: { conjunction?: string; conditions?: Array<{ field_id?: string; operator?: string; value?: string }> }; hidden_fields?: string[] };
    };
    const prev = current.property ?? {};
    const kept = (prev.filter_info?.conditions ?? []).filter((cond) => cond.field_id && cond.field_id !== archiveField.field_id);
    const hidden = [...(prev.hidden_fields ?? [])];
    if (!hidden.includes(archiveField.field_id)) hidden.push(archiveField.field_id);
    await client.patchView(tableId, view.view_id, {
      hidden_fields: hidden,
      hierarchy_config: null,
      filter_info: {
        conjunction: 'and',
        conditions: [...kept, ...viewFilter(archiveField.field_id, false).conditions],
      },
    });
    console.log(`   ✅ 仪表盘「${view.view_name}」不含归档`);
  }
}

async function main(): Promise<void> {
  const opts = parseArgs();
  const config = loadBitableRuntimeConfig();
  if (!config) {
    console.log(`❌ ${explainMissingBitableConfig()}`);
    process.exit(1);
  }

  const anyOnly =
    opts.renameFieldsOnly ||
    opts.passRateOnly ||
    opts.dropIssueFieldsOnly ||
    opts.cleanDailyOnly ||
    opts.pruneIssueNoiseOnly ||
    opts.dropDeliveryFieldsOnly ||
    opts.tidyOnly ||
    opts.promoteIndex ||
    opts.archiveCurrent ||
    opts.dashboardViews;
  const runRename = opts.renameFieldsOnly || !anyOnly;
  const runPassRate = opts.passRateOnly || !anyOnly;
  const runDropFields = opts.dropIssueFieldsOnly || opts.tidyOnly || !anyOnly;
  const runCleanDaily = opts.cleanDailyOnly || !anyOnly;
  const runPruneNoise = opts.pruneIssueNoiseOnly || opts.tidyOnly || !anyOnly;
  const runDropDeliveryFields = opts.dropDeliveryFieldsOnly || opts.tidyOnly || !anyOnly;
  const runTidy = opts.tidyOnly || !anyOnly;
  const runDashboardViews = opts.dashboardViews || opts.tidyOnly || !anyOnly;
  const runPromote = opts.promoteIndex || opts.tidyOnly || !anyOnly;
  const runArchive = opts.archiveCurrent;

  console.log('\n🔧 飞书多维表维护');
  console.log(`   模式: ${opts.apply ? '执行' : '预览（dry-run）'}`);

  const client = new BitableClient(config);

  if (runRename) {
    await renameTableFields(client, '执行记录', config.runTableId, RUN_FIELD_RENAMES, opts.apply);
    if (config.issueTableId) {
      await renameTableFields(client, '问题明细', config.issueTableId, ISSUE_FIELD_RENAMES, opts.apply);
    }
    if (config.dailySummaryTableId) {
      await renameTableFields(client, '日汇总', config.dailySummaryTableId, DAILY_FIELD_RENAMES, opts.apply);
    }
    if (config.feedbackTableId) {
      await renameTableFields(client, 'UI采集反馈', config.feedbackTableId, FEEDBACK_FIELD_RENAMES, opts.apply);
    }
  }

  if (runPassRate) {
    if (!config.dailySummaryTableId) {
      console.log('⚠️  未配置日汇总表，跳过通过率迁移');
    } else {
      await migratePassRate(client, config.dailySummaryTableId, opts.apply);
    }
  }

  if (runCleanDaily) {
    if (!config.dailySummaryTableId) {
      console.log('⚠️  未配置日汇总表，跳过日汇总清理');
    } else {
      await cleanDailySummaryData(client, config.dailySummaryTableId, opts.apply);
    }
  }

  if (runDropFields) {
    if (!config.issueTableId) {
      console.log('⚠️  未配置问题明细表，跳过废弃列删除');
    } else {
      await dropDeprecatedFields(client, '问题明细', config.issueTableId, ISSUE_DEPRECATED_FIELDS, opts.apply);
    }
  }

  if (runPruneNoise) {
    if (!config.issueTableId) {
      console.log('⚠️  未配置问题明细表，跳过噪声行清理');
    } else {
      await pruneIssueNoiseRecords(client, config.issueTableId, opts.apply);
    }
  }

  if (runDropDeliveryFields) {
    if (!config.deliveryTableId) {
      console.log('⚠️  未配置 UI 验收明细表，跳过废弃列删除');
    } else {
      await dropDeprecatedFields(client, 'UI 验收明细', config.deliveryTableId, DELIVERY_DEPRECATED_FIELDS, opts.apply);
    }
  }

  if (runTidy) {
    const keepIds = new Set(
      [
        config.runTableId,
        config.issueTableId,
        config.dailySummaryTableId,
        config.feedbackTableId,
        config.deliveryTableId,
        config.deliverySummaryTableId,
      ].filter((id): id is string => Boolean(id)),
    );
    await dropEmptyDefaultTable(client, keepIds, opts.apply);
    const slimTargets: Array<[string | undefined, SlimView]> = [
      [config.deliveryTableId, SLIM_VIEWS.delivery],
      [config.deliverySummaryTableId, SLIM_VIEWS.summary],
      [config.runTableId, SLIM_VIEWS.run],
      [config.issueTableId, SLIM_VIEWS.issue],
      [config.dailySummaryTableId, SLIM_VIEWS.daily],
      [config.feedbackTableId, SLIM_VIEWS.feedback],
    ];
    for (const [tableId, spec] of slimTargets) {
      if (!tableId) {
        console.log(`⚠️  未配置${spec.label}，跳过视图收窄`);
        continue;
      }
      await slimTableView(client, tableId, spec, opts.apply);
    }
  }

  if (runDashboardViews) {
    const dashboardTargets: Array<[string | undefined, SlimView]> = [
      [config.runTableId, DASHBOARD_VIEWS.run],
      [config.issueTableId, DASHBOARD_VIEWS.issue],
    ];
    for (const [tableId, spec] of dashboardTargets) {
      if (!tableId) {
        console.log(`⚠️  未配置${spec.label}，跳过仪表盘视图`);
        continue;
      }
      await slimDashboardViews(client, tableId, spec, opts.apply);
    }
  }

  if (runPromote) {
    const swaps: Array<[string | undefined, string, string]> = [
      [config.runTableId, '执行记录', RUN_FIELDS.executionId],
      [config.issueTableId, '问题明细', ISSUE_FIELDS.issueRecordId],
      [config.dailySummaryTableId, '日汇总', DAILY_FIELDS.summaryKey],
    ];
    for (const [tableId, label, keyName] of swaps) {
      if (!tableId) {
        console.log(`⚠️  未配置${label}，跳过索引列替换`);
        continue;
      }
      await promoteIndexColumn(client, label, tableId, keyName, opts.apply);
    }
  }

  if (runArchive) {
    const targets: Array<[string | undefined, string, string]> = [
      [config.deliveryTableId, SLIM_VIEWS.delivery.label, SLIM_VIEWS.delivery.viewName],
      [config.deliverySummaryTableId, SLIM_VIEWS.summary.label, SLIM_VIEWS.summary.viewName],
      [config.runTableId, SLIM_VIEWS.run.label, SLIM_VIEWS.run.viewName],
      [config.issueTableId, SLIM_VIEWS.issue.label, SLIM_VIEWS.issue.viewName],
      [config.dailySummaryTableId, SLIM_VIEWS.daily.label, SLIM_VIEWS.daily.viewName],
      [config.feedbackTableId, SLIM_VIEWS.feedback.label, SLIM_VIEWS.feedback.viewName],
    ];
    for (const [tableId, label, viewName] of targets) {
      if (!tableId) {
        console.log(`⚠️  未配置${label}，跳过归档`);
        continue;
      }
      try {
        await archiveTable(client, tableId, label, viewName, opts.apply);
      } catch (error) {
        console.log(`   ❌ ${label} 归档失败: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  if (!opts.apply) {
    const flag = opts.archiveCurrent
      ? ' --archive-current'
      : opts.promoteIndex
        ? ' --promote-index'
        : opts.dashboardViews
          ? ' --dashboard-views'
          : opts.tidyOnly
            ? ' --tidy-only'
            : '';
    console.log(`\n💡 确认无误后执行: npm run feishu:bitable-maintain -- --apply${flag}`);
  }
}

main().catch((error: unknown) => {
  console.error('❌ 维护失败:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
