import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import {
  flowRunsDir,
  type FlowId,
  type FlowRunManifest,
} from '../../src/utils/flow-run-report.js';
import { currentIsoWeek } from './customer-feishu-notify.js';
import { readCustomerReportSummary, type CustomerReportSummary } from './customer-report-summary.js';
import { sendSummaryCard } from './send-report-card.js';

dotenv.config({ path: path.join(process.cwd(), '.env') });

const FLOW_IDS: FlowId[] = ['request-flow', 'approval-flow', 'expense-flow'];

export type WeeklyDigest = {
  weekKey: string;
  env: string;
  runCount: number;
  successCount: number;
  failedCount: number;
  skippedCount: number;
  totalPassed: number;
  totalFailed: number;
  totalSkipped: number;
  passRate: number;
  latestSummary?: CustomerReportSummary;
  manifests: FlowRunManifest[];
};

function readManifestsForFlow(flowId: FlowId): FlowRunManifest[] {
  const dir = path.join(flowRunsDir(flowId), 'history');
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  const rows: FlowRunManifest[] = [];
  for (const f of files) {
    try {
      const batch = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'));
      if (Array.isArray(batch)) {
        rows.push(...(batch as FlowRunManifest[]));
      }
    } catch {
      /* ignore corrupt files */
    }
  }
  return rows;
}

function isSameWeek(isoDate: string, weekKey: string): boolean {
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return false;
  return currentIsoWeek(d) === weekKey;
}

export function buildWeeklyDigest(env: string, weekKey?: string): WeeklyDigest {
  const week = weekKey || currentIsoWeek();
  const allManifests = FLOW_IDS.flatMap(readManifestsForFlow);

  const weekManifests = allManifests.filter(
    (m) => m.env === env && isSameWeek(m.startedAt, week),
  );

  let successCount = 0;
  let failedCount = 0;
  let skippedCount = 0;
  let totalPassed = 0;
  let totalFailed = 0;
  let totalSkipped = 0;

  const seen = new Set<string>();
  for (const m of weekManifests) {
    if (seen.has(`${m.flowId}|${m.runId}`)) continue;
    seen.add(`${m.flowId}|${m.runId}`);

    if (m.ok === true) successCount++;
    else if (m.ok === false) failedCount++;
    else skippedCount++;

    totalPassed += m.passed || 0;
    totalFailed += m.failed || 0;
    totalSkipped += m.skipped || 0;
  }

  const total = totalPassed + totalFailed + totalSkipped;
  const passRate = total > 0 ? totalPassed / total : 0;

  const latest = readCustomerReportSummary();
  const latestSummary = latest && latest.generatedAt && isSameWeek(latest.generatedAt, week) ? latest : undefined;

  return {
    weekKey: week,
    env,
    runCount: seen.size,
    successCount,
    failedCount,
    skippedCount,
    totalPassed,
    totalFailed,
    totalSkipped,
    passRate,
    latestSummary,
    manifests: weekManifests,
  };
}

export function formatWeeklyDigestMarkdown(digest: WeeklyDigest): string {
  const lines: string[] = [
    `**周度运行概况（${digest.weekKey}）**`,
    `环境：${digest.env}`,
    `运行次数：${digest.runCount}（成功 ${digest.successCount}，失败 ${digest.failedCount}，跳过 ${digest.skippedCount}）`,
    `用例通过 ${digest.totalPassed} / 失败 ${digest.totalFailed} / 跳过 ${digest.totalSkipped}`,
    `通过率：${(digest.passRate * 100).toFixed(1)}%`,
  ];

  if (digest.latestSummary) {
    const s = digest.latestSummary;
    lines.push(
      '',
      '**最新验收状态**：',
      `覆盖率 ${s.coveragePct}%（${s.comparedSteps}/${s.expectedSteps}）`,
      `通过率 ${(s.passRate * 100).toFixed(1)}% · 需修复 ${s.regressSteps} 步 · 轻微变化 ${s.minorSteps} 步`,
    );
    if (s.uncoveredSteps > 0) {
      lines.push(`待补基线 ${s.uncoveredSteps} 步`);
    }
  } else {
    lines.push('', '本周无最新验收数据。');
  }

  const failedManifests = digest.manifests.filter((m) => m.ok === false);
  if (failedManifests.length > 0) {
    lines.push('', '**失败运行**：');
    for (const m of failedManifests.slice(0, 5)) {
      const time = m.startedAt ? shanghaiDate(m.startedAt) : '?';
      const rawReason = m.failures?.[0]?.message || m.failures?.[0]?.title || '未知原因';
      const reason = rawReason.split('\n').map((s) => s.trim()).find(Boolean) || '未知原因';
      const collapsed = reason.replace(/\s+/g, ' ');
      lines.push(`- ${m.flowLabel}（${time}）— ${collapsed.length > 120 ? `${collapsed.slice(0, 120)}…` : collapsed}`);
    }
  }

  return lines.join('\n');
}

/** 业务日按 Asia/Shanghai 切分（UTC 存储、北京时间展示） */
function shanghaiDate(isoDate: string): string {
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return '?';
  return new Date(d.getTime() + 8 * 3600_000).toISOString().slice(0, 10);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const getArg = (prefix: string) => args.find((a) => a.startsWith(prefix))?.slice(prefix.length);
  const env = getArg('--env=') || 'stage9084';
  const week = getArg('--week=');
  const send = args.includes('--send');
  const force = args.includes('--force');

  const digest = buildWeeklyDigest(env, week);
  const markdown = formatWeeklyDigestMarkdown(digest);
  if (!send) {
    console.log(markdown);
    return;
  }

  const result = await sendSummaryCard({
    env,
    kind: 'weekly-digest',
    period: digest.weekKey,
    title: `UI 验收周报（${digest.weekKey}）· ${env}`,
    template: digest.failedCount > 0 ? 'orange' : digest.runCount > 0 ? 'green' : 'blue',
    markdown,
    channel: 'internal',
    force,
    note: 'UI 验收周报 · 内部群推送',
  });
  if (result.sent) console.log(`✅ 周报已发送（${digest.weekKey}）`);
  else console.log(`跳过周报发送：${result.reason}`);
}

if (process.argv[1]?.includes('weekly-digest')) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
}
