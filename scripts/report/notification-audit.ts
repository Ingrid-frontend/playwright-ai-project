#!/usr/bin/env tsx
/**
 * 通知审计 CLI — 查询和统计 JSONL 通知历史
 *
 * 用法:
 *   tsx scripts/report/notification-audit.ts                    # 全部记录
 *   tsx scripts/report/notification-audit.ts --env=stage9084    # 按环境过滤
 *   tsx scripts/report/notification-audit.ts --kind=weekly      # 按类型过滤
 *   tsx scripts/report/notification-audit.ts --status=sent      # 按状态过滤
 *   tsx scripts/report/notification-audit.ts --summary          # 统计摘要
 *   tsx scripts/report/notification-audit.ts --dedup-key=xxx    # 查特定去重键
 */
import path from 'path';
import dotenv from 'dotenv';
import {
  readNotificationHistory,
  type NotificationKind,
  type NotificationRecord,
  type NotificationStatus,
} from './notification-history.js';

dotenv.config({ path: path.join(process.cwd(), '.env') });

type Filters = {
  env?: string;
  kind?: NotificationKind;
  status?: NotificationStatus;
  dedupKey?: string;
  summary: boolean;
};

function parseArgs(): Filters {
  const args = process.argv.slice(2);
  const get = (prefix: string) => args.find((a) => a.startsWith(prefix))?.slice(prefix.length);
  return {
    env: get('--env='),
    kind: get('--kind=') as NotificationKind | undefined,
    status: get('--status=') as NotificationStatus | undefined,
    dedupKey: get('--dedup-key='),
    summary: args.includes('--summary'),
  };
}

function applyFilters(records: NotificationRecord[], f: Filters): NotificationRecord[] {
  let result = records;
  if (f.env) result = result.filter((r) => r.env === f.env);
  if (f.kind) result = result.filter((r) => r.kind === f.kind);
  if (f.status) result = result.filter((r) => r.status === f.status);
  if (f.dedupKey) result = result.filter((r) => r.dedupKey === f.dedupKey);
  return result;
}

function formatRecord(r: NotificationRecord): string {
  const time = r.sentAt || '(未发送)';
  const err = r.error ? ` · ${r.error}` : '';
  const skip = r.skipReason ? ` · ${r.skipReason}` : '';
  return `${r.id}  ${r.env}  ${r.kind.padEnd(8)}  ${r.status.padEnd(8)}  ${time}${err}${skip}  ${r.payloadSummary || ''}`;
}

function printSummary(records: NotificationRecord[]): void {
  const byEnv = new Map<string, number>();
  const byKind = new Map<string, number>();
  const byStatus = new Map<string, number>();

  for (const r of records) {
    byEnv.set(r.env, (byEnv.get(r.env) || 0) + 1);
    byKind.set(r.kind, (byKind.get(r.kind) || 0) + 1);
    byStatus.set(r.status, (byStatus.get(r.status) || 0) + 1);
  }

  console.log(`\n总计 ${records.length} 条通知记录\n`);

  console.log('按环境：');
  for (const [env, count] of [...byEnv.entries()].sort()) {
    console.log(`  ${env}: ${count}`);
  }

  console.log('\n按类型：');
  for (const [kind, count] of [...byKind.entries()].sort()) {
    console.log(`  ${kind}: ${count}`);
  }

  console.log('\n按状态：');
  for (const [status, count] of [...byStatus.entries()].sort()) {
    console.log(`  ${status}: ${count}`);
  }

  const unknowns = records.filter((r) => r.status === 'unknown');
  if (unknowns.length > 0) {
    console.log(`\n⚠️  ${unknowns.length} 条状态未知，需对账：`);
    for (const r of unknowns) {
      console.log(`  ${formatRecord(r)}`);
    }
  }
}

function main(): void {
  const filters = parseArgs();
  const all = readNotificationHistory();
  const filtered = applyFilters(all, filters);

  if (filters.summary) {
    printSummary(filtered);
    return;
  }

  if (filtered.length === 0) {
    console.log('无匹配记录');
    return;
  }

  console.log(`共 ${filtered.length} 条记录：\n`);
  for (const r of filtered) {
    console.log(formatRecord(r));
  }
}

main();
