#!/usr/bin/env tsx
/**
 * 飞书多维表维护：列名中文化、pass_rate 迁移、删除 issue 废弃列
 *
 *   npm run feishu:bitable-maintain                      # 预览
 *   npm run feishu:bitable-maintain -- --apply           # 全部执行
 *   npm run feishu:bitable-maintain -- --apply --clean-daily-only
 */
import dotenv from 'dotenv';
import {
  BitableClient,
  DAILY_FIELDS,
  DAILY_FIELD_RENAMES,
  FEEDBACK_FIELD_RENAMES,
  ISSUE_DEPRECATED_FIELDS,
  ISSUE_FIELD_RENAMES,
  RUN_FIELD_RENAMES,
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
};

function parseArgs(): MaintainOptions {
  const args = process.argv.slice(2);
  return {
    apply: args.includes('--apply'),
    renameFieldsOnly: args.includes('--rename-fields-only'),
    passRateOnly: args.includes('--pass-rate-only'),
    dropIssueFieldsOnly: args.includes('--drop-issue-fields-only'),
    cleanDailyOnly: args.includes('--clean-daily-only'),
  };
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

async function dropDeprecatedIssueFields(
  client: BitableClient,
  tableId: string,
  apply: boolean,
): Promise<{ found: string[]; deleted: number }> {
  const fields = await client.listFields(tableId);
  const deprecated = new Set<string>(ISSUE_DEPRECATED_FIELDS);
  const hits = fields.filter((item) => deprecated.has(item.field_name));

  console.log(`\n🧹 问题明细废弃列`);
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

async function main(): Promise<void> {
  const opts = parseArgs();
  const config = loadBitableRuntimeConfig();
  if (!config) {
    console.log(`❌ ${explainMissingBitableConfig()}`);
    process.exit(1);
  }

  const runRename = opts.renameFieldsOnly || (!opts.passRateOnly && !opts.dropIssueFieldsOnly && !opts.cleanDailyOnly);
  const runPassRate = opts.passRateOnly || (!opts.renameFieldsOnly && !opts.dropIssueFieldsOnly && !opts.cleanDailyOnly);
  const runDropFields = opts.dropIssueFieldsOnly || (!opts.renameFieldsOnly && !opts.passRateOnly && !opts.cleanDailyOnly);
  const runCleanDaily = opts.cleanDailyOnly || (!opts.renameFieldsOnly && !opts.passRateOnly && !opts.dropIssueFieldsOnly);

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
      await dropDeprecatedIssueFields(client, config.issueTableId, opts.apply);
    }
  }

  if (!opts.apply) {
    console.log('\n💡 确认无误后执行: npm run feishu:bitable-maintain -- --apply');
  }
}

main().catch((error: unknown) => {
  console.error('❌ 维护失败:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
