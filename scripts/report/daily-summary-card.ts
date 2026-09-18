import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import {
  flowRunsDir,
  type FlowId,
  type FlowRunManifest,
} from '../../src/utils/flow-run-report.js';
import {
  readCustomerReportSummary,
} from './customer-report-summary.js';
import { sendSummaryCard } from './send-report-card.js';

dotenv.config({ path: path.join(process.cwd(), '.env') });

const FLOW_IDS: FlowId[] = ['request-flow', 'approval-flow', 'expense-flow'];

export type DailyCardData = {
  date: string;
  env: string;
  runCount: number;
  successCount: number;
  failedCount: number;
  totalPassed: number;
  totalFailed: number;
  totalSkipped: number;
  passRate: number;
  coveragePct?: number;
  regressSteps?: number;
  minorSteps?: number;
  uncoveredSteps?: number;
  snapshotDate?: string;
  hasData: boolean;
};

/** 业务日按 Asia/Shanghai 切分（UTC 存储、北京时间展示） */
function shanghaiDate(isoDate: string | Date): string {
  const d = typeof isoDate === 'string' ? new Date(isoDate) : isoDate;
  if (Number.isNaN(d.getTime())) return '';
  return new Date(d.getTime() + 8 * 3600_000).toISOString().slice(0, 10);
}

function isSameDate(isoDate: string, targetDate: string): boolean {
  return shanghaiDate(isoDate) === targetDate;
}

function readManifestsForDate(env: string, date: string): FlowRunManifest[] {
  const all: FlowRunManifest[] = [];
  for (const flowId of FLOW_IDS) {
    const dir = path.join(flowRunsDir(flowId), 'history');
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
    for (const f of files) {
      try {
        const batch = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'));
        if (Array.isArray(batch)) {
          for (const m of batch as FlowRunManifest[]) {
            if (m.env === env && isSameDate(m.startedAt, date)) {
              all.push(m);
            }
          }
        }
      } catch {
        /* ignore */
      }
    }
  }
  return all;
}

export function buildDailySummary(env: string, date?: string): DailyCardData {
  const targetDate = date || shanghaiDate(new Date());
  const manifests = readManifestsForDate(env, targetDate);

  const seen = new Set<string>();
  let successCount = 0;
  let failedCount = 0;
  let totalPassed = 0;
  let totalFailed = 0;
  let totalSkipped = 0;

  for (const m of manifests) {
    const key = `${m.flowId}|${m.runId}`;
    if (seen.has(key)) continue;
    seen.add(key);

    if (m.ok === true) successCount++;
    else if (m.ok === false) failedCount++;

    totalPassed += m.passed || 0;
    totalFailed += m.failed || 0;
    totalSkipped += m.skipped || 0;
  }

  const total = totalPassed + totalFailed + totalSkipped;
  const passRate = total > 0 ? totalPassed / total : 0;

  const summary = readCustomerReportSummary();
  const hasData = seen.size > 0 || summary !== null;

  return {
    date: targetDate,
    env,
    runCount: seen.size,
    successCount,
    failedCount,
    totalPassed,
    totalFailed,
    totalSkipped,
    passRate,
    coveragePct: summary?.coveragePct,
    regressSteps: summary?.regressSteps,
    minorSteps: summary?.minorSteps,
    uncoveredSteps: summary?.uncoveredSteps,
    snapshotDate: summary?.generatedAt ? shanghaiDate(summary.generatedAt) : undefined,
    hasData,
  };
}

export function formatDailyCardMarkdown(data: DailyCardData): string {
  if (!data.hasData) {
    return `**${data.date} 日报**\n环境：${data.env}\n\n今日无运行数据，数据不足，不作通过判定。`;
  }

  const lines: string[] = [
    `**${data.date} 日报**`,
    `环境：${data.env}`,
    data.runCount > 0
      ? `运行 ${data.runCount} 次（成功 ${data.successCount}，失败 ${data.failedCount}）`
      : '今日无运行数据（下方为最新验收批次参考，非今日结果）',
  ];

  if (data.totalPassed + data.totalFailed + data.totalSkipped > 0) {
    lines.push(
      `用例通过 ${data.totalPassed} / 失败 ${data.totalFailed} / 跳过 ${data.totalSkipped}`,
      `通过率：${(data.passRate * 100).toFixed(1)}%`,
    );
  }

  if (data.coveragePct !== undefined) {
    const cutoff = data.snapshotDate ? `（截至 ${data.snapshotDate}）` : '';
    lines.push(`最新验收快照${cutoff}：覆盖率 ${data.coveragePct}%`);
  }
  if (data.regressSteps !== undefined && data.regressSteps > 0) {
    lines.push(`需修复 ${data.regressSteps} 步`);
  }
  if (data.minorSteps !== undefined && data.minorSteps > 0) {
    lines.push(`轻微变化 ${data.minorSteps} 步`);
  }
  if (data.uncoveredSteps !== undefined && data.uncoveredSteps > 0) {
    lines.push(`待补基线 ${data.uncoveredSteps} 步`);
  }

  if (data.runCount > 0 && (data.regressSteps ?? 0) === 0 && (data.minorSteps ?? 0) === 0) {
    lines.push('', '今日验收状态正常。');
  }

  return lines.join('\n');
}

function dailyCardTemplate(data: DailyCardData): 'green' | 'orange' | 'blue' {
  if (!data.hasData) return 'blue';
  // 例行汇总不用阻断红：仅有 UI 需修复项时用橙色提示，其余（含流程运行失败）走正常色
  if ((data.regressSteps ?? 0) > 0) return 'orange';
  return 'green';
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const getArg = (prefix: string) => args.find((a) => a.startsWith(prefix))?.slice(prefix.length);
  const env = getArg('--env=') || 'stage9084';
  const date = getArg('--date=');
  const send = args.includes('--send');
  const force = args.includes('--force');

  const data = buildDailySummary(env, date);
  const markdown = formatDailyCardMarkdown(data);
  if (!send) {
    console.log(markdown);
    return;
  }

  const result = await sendSummaryCard({
    env,
    kind: 'daily',
    period: data.date,
    title: `UI 验收日报 · ${data.date} · ${env}`,
    template: dailyCardTemplate(data),
    markdown,
    channel: 'internal',
    force,
    note: 'UI 验收日报 · 内部群推送',
  });
  if (result.sent) console.log(`✅ 日报已发送（${data.date}）`);
  else console.log(`跳过日报发送：${result.reason}`);
}

if (process.argv[1]?.includes('daily-summary-card')) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
}
