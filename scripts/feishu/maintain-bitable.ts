#!/usr/bin/env tsx
/**
 * 飞书多维表维护：pass_rate 旧 0/1 口径迁移 + 删除 issue 废弃列
 *
 *   npm run feishu:bitable-maintain                 # 预览
 *   npm run feishu:bitable-maintain -- --apply    # 执行
 *   npm run feishu:bitable-maintain -- --apply --pass-rate-only
 *   npm run feishu:bitable-maintain -- --apply --drop-issue-fields-only
 */
import dotenv from 'dotenv';
import {
  BitableClient,
  DAILY_FIELDS,
  ISSUE_DEPRECATED_FIELDS,
  explainMissingBitableConfig,
  loadBitableRuntimeConfig,
} from './index.js';

dotenv.config();

type MaintainOptions = {
  apply: boolean;
  passRateOnly: boolean;
  dropIssueFieldsOnly: boolean;
};

function parseArgs(): MaintainOptions {
  const args = process.argv.slice(2);
  return {
    apply: args.includes('--apply'),
    passRateOnly: args.includes('--pass-rate-only'),
    dropIssueFieldsOnly: args.includes('--drop-issue-fields-only'),
  };
}

function readNumberField(fields: Record<string, unknown>, key: string): number | null {
  const raw = fields[key];
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string') {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function isLegacyPassRate(value: number): boolean {
  return value === 0 || value === 1;
}

function normalizeLegacyPassRate(value: number): number {
  return value * 100;
}

async function migratePassRate(
  client: BitableClient,
  tableId: string,
  apply: boolean,
): Promise<{ scanned: number; legacy: number; updated: number }> {
  const records = await client.listRecords(tableId);
  let legacy = 0;
  let updated = 0;

  console.log(`\n📊 日汇总 pass_rate 迁移（${records.length} 条）`);
  for (const record of records) {
    const fields = record.fields ?? {};
    const current = readNumberField(fields, DAILY_FIELDS.passRate);
    if (current === null || !isLegacyPassRate(current)) continue;
    legacy += 1;
    const next = normalizeLegacyPassRate(current);
    const summaryKey = String(fields[DAILY_FIELDS.summaryKey] ?? record.record_id);
    const date = fields[DAILY_FIELDS.date];
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

async function dropDeprecatedIssueFields(
  client: BitableClient,
  tableId: string,
  apply: boolean,
): Promise<{ found: string[]; deleted: number }> {
  const fields = await client.listFields(tableId);
  const deprecated = new Set<string>(ISSUE_DEPRECATED_FIELDS);
  const hits = fields.filter((item) => deprecated.has(item.field_name));

  console.log(`\n🧹 问题明细废弃列（目标 ${ISSUE_DEPRECATED_FIELDS.join(', ')}）`);
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

  const runPassRate = !opts.dropIssueFieldsOnly;
  const runDropFields = !opts.passRateOnly;

  console.log('\n🔧 飞书多维表维护');
  console.log(`   模式: ${opts.apply ? '执行' : '预览（dry-run）'}`);

  const client = new BitableClient(config);

  if (runPassRate) {
    if (!config.dailySummaryTableId) {
      console.log('⚠️  未配置日汇总表，跳过 pass_rate 迁移');
    } else {
      await migratePassRate(client, config.dailySummaryTableId, opts.apply);
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
