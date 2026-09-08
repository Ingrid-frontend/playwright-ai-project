#!/usr/bin/env tsx
/**
 * 将 results/history 日快照回填到飞书「日汇总」「执行记录」
 *
 *   npm run feishu:bitable-backfill              # 预览
 *   npm run feishu:bitable-backfill -- --apply
 *   npm run feishu:bitable-backfill -- --apply --env=uat
 */
import dotenv from 'dotenv';
import { BitableClient, DAILY_FIELDS, RUN_FIELDS, explainMissingBitableConfig, loadBitableRuntimeConfig } from './index.js';
import { ensureBitableFields } from './bitable-auto.js';
import { buildDailySummaryFromSnapshot, buildRunFieldsFromSnapshot } from './write-bitable-report.js';
import { loadHistorySnapshots, readPreviousHistorySnapshot, type HistorySnapshot } from '../report/ui-regression-history.js';
import { resolveIssuesSource } from '../report/issues-source.js';

dotenv.config();

const BACKFILL_JOB_ID = 'history-backfill';

function parseArgs() {
  const args = process.argv.slice(2);
  const envArg = args.find((item) => item.startsWith('--env='));
  return {
    apply: args.includes('--apply'),
    env: envArg?.slice('--env='.length) || process.env.PLAYWRIGHT_ENV || 'uat',
    dailyOnly: args.includes('--daily-only'),
  };
}

function snapshotStatus(snapshot: HistorySnapshot): 'success' | 'failed' {
  const blocker = snapshot.summary.comparisonBlocker ?? snapshot.summary.blocker ?? 0;
  return blocker === 0 ? 'success' : 'failed';
}

function runExecutionId(snapshot: HistorySnapshot): string {
  return `history-${snapshot.date}${snapshot.source === 'flow' ? '-flow' : ''}`;
}

async function backfillSnapshot(
  client: BitableClient,
  config: NonNullable<ReturnType<typeof loadBitableRuntimeConfig>>,
  snapshot: HistorySnapshot,
  env: string,
  apply: boolean,
  dailyOnly: boolean,
) {
  const previous = readPreviousHistorySnapshot(snapshot.date);
  const status = snapshotStatus(snapshot);
  const executionId = runExecutionId(snapshot);
  const issuesSource = resolveIssuesSource();

  const dailyFields = buildDailySummaryFromSnapshot({
    date: snapshot.date,
    env,
    jobId: BACKFILL_JOB_ID,
    status,
    currentSummary: snapshot.summary,
    previousSummary: previous?.summary,
    byScript: snapshot.byScript,
  });

  console.log(
    `   · ${snapshot.date} (${snapshot.source || 'optimized'}) · 阻断 ${dailyFields[DAILY_FIELDS.blockerCount]} · 通过率 ${dailyFields[DAILY_FIELDS.passRate]}%`,
  );

  if (!apply) return;

  if (config.dailySummaryTableId) {
    await client.upsertRecord(
      config.dailySummaryTableId,
      DAILY_FIELDS.summaryKey,
      String(dailyFields[DAILY_FIELDS.summaryKey]),
      dailyFields,
    );
  }

  if (!dailyOnly && config.runTableId) {
    const runFields = buildRunFieldsFromSnapshot({
      snapshot,
      env,
      jobId: BACKFILL_JOB_ID,
      executionId,
      status,
      issuesSource,
    });
    await client.upsertRecord(config.runTableId, RUN_FIELDS.executionId, executionId, runFields);
  }
}

async function main(): Promise<void> {
  const opts = parseArgs();
  const config = loadBitableRuntimeConfig();
  if (!config) {
    console.log(`❌ ${explainMissingBitableConfig()}`);
    process.exit(1);
  }

  const snapshots = loadHistorySnapshots();
  console.log(`\n📥 历史快照回填（${snapshots.length} 天 · env=${opts.env}）`);
  console.log(`   模式: ${opts.apply ? '执行' : '预览'}`);

  if (!snapshots.length) {
    console.log('   无 results/history 快照，请先跑 compare 生成日快照');
    return;
  }

  if (opts.apply) ensureBitableFields();

  const client = new BitableClient(config);
  for (const snapshot of snapshots) {
    await backfillSnapshot(client, config, snapshot, opts.env, opts.apply, opts.dailyOnly);
  }

  if (!opts.apply) {
    console.log('\n💡 确认后执行: npm run feishu:bitable-backfill -- --apply');
  } else {
    console.log(`\n✅ 已回填 ${snapshots.length} 天到飞书日汇总${opts.dailyOnly ? '' : ' + 执行记录'}`);
    console.log('   最新 issues 仍请用 compare 后自动同步问题明细');
  }
}

main().catch((error: unknown) => {
  console.error('❌ 回填失败:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
