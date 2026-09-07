#!/usr/bin/env tsx
/**
 * 在 Playwright 自动化报告 Base 中新建 UI 采集反馈表并补字段
 *
 * npm run feishu:feedback-table-setup
 * npm run feishu:feedback-table-setup -- --name="UI采集反馈"
 */
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import {
  BitableClient,
  FEEDBACK_FIELDS,
  FEEDBACK_FIELD_SPECS,
  BITABLE_FIELD_TYPE,
  explainMissingBitableConfig,
  loadBitableRuntimeConfig,
} from './index.js';

dotenv.config();

function getArg(name: string): string | undefined {
  const withEq = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (withEq) return withEq.slice(name.length + 3);
  return undefined;
}

function upsertEnvLine(envPath: string, key: string, value: string): void {
  let lines: string[] = [];
  if (fs.existsSync(envPath)) {
    lines = fs.readFileSync(envPath, 'utf-8').split('\n');
  }
  const idx = lines.findIndex((l) => l.startsWith(`${key}=`));
  const line = `${key}=${value}`;
  if (idx >= 0) lines[idx] = line;
  else lines.push(line);
  fs.writeFileSync(envPath, lines.filter((l, i, arr) => i < arr.length - 1 || l !== '').join('\n') + '\n', 'utf-8');
}

async function ensureFields(client: BitableClient, tableId: string): Promise<void> {
  const fields = await client.listFields(tableId);
  const names = new Set(fields.map((f) => f.field_name));
  for (const spec of FEEDBACK_FIELD_SPECS) {
    if (names.has(spec.name)) continue;
    await client.createField(tableId, spec);
    console.log(`   ➕ 字段: ${spec.name}`);
  }
}

async function main() {
  const config = loadBitableRuntimeConfig();
  if (!config) {
    console.error(`❌ ${explainMissingBitableConfig()}`);
    process.exit(1);
  }

  const tableName = getArg('name') || 'UI采集反馈';
  const client = new BitableClient(config);

  console.log(`\n📋 Playwright 自动化报告 · 创建反馈表\n`);
  console.log(`   Base: ${config.appToken}`);
  console.log(`   表名: ${tableName}\n`);

  const tables = await client.listTables();
  console.log(`   已有数据表 ${tables.length} 张:`);
  for (const t of tables) console.log(`     - ${t.name} (${t.table_id})`);

  let tableId = config.feedbackTableId || process.env.FEISHU_BITABLE_FEEDBACK_TABLE_ID || '';
  const existing = tables.find((t) => t.name === tableName);
  if (existing) {
    tableId = existing.table_id;
    console.log(`\n✅ 表已存在，复用: ${tableName} → ${tableId}`);
  } else {
    const created = await client.createTable(tableName, {
      defaultViewName: '全部反馈',
      initialFields: [{ field_name: FEEDBACK_FIELDS.feedbackId, type: BITABLE_FIELD_TYPE.text }],
    });
    tableId = created.table_id;
    console.log(`\n✅ 已新建数据表: ${tableName} → ${tableId}`);
  }

  console.log('\n🔧 补全字段…');
  await ensureFields(client, tableId);

  const envPath = path.resolve('.env');
  upsertEnvLine(envPath, 'FEISHU_BITABLE_FEEDBACK_TABLE_ID', tableId);
  console.log(`\n📝 已写入 .env: FEISHU_BITABLE_FEEDBACK_TABLE_ID=${tableId}`);
  console.log(`🔗 打开: https://zw2f66oerte.feishu.cn/base/${config.appToken}?table=${tableId}`);
}

main().catch((e) => {
  console.error('❌', e instanceof Error ? e.message : e);
  process.exit(1);
});
