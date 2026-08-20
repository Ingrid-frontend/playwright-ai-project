import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { canSendFeishuNotify } from '../feishu/index.js';
import {
  findLatestFailedDelivery,
  listDeliveryRecords,
  readDeliveryFile,
  type DeliveryRecord,
} from '../jobs/notification-delivery.js';
import {
  readUiIssuesSummaryLine,
  sendJobFeishuNotification,
} from '../jobs/job-notify.js';
import { gateShouldFail, type UiIssuesReport } from '../report/ui-issues-index.js';

dotenv.config({ path: path.join(process.cwd(), '.env') });

function printHelp(): void {
  console.log(`用法:
  npm run notify:resend -- --list
  npm run notify:resend -- --latest-failed [--job=<jobId>]
  npm run notify:resend -- --file=results/notification-deliveries/<file>.json

说明:
  仅重投飞书通知，不重跑用例/对比。投递结果会再写入 notification-deliveries。
`);
}

function readTestPassed(): boolean {
  const lastRunPath = path.join(process.cwd(), 'results', 'last-test-run.json');
  if (!fs.existsSync(lastRunPath)) return true;
  try {
    const last = JSON.parse(fs.readFileSync(lastRunPath, 'utf-8')) as { passed?: boolean };
    if (typeof last.passed === 'boolean') return last.passed;
  } catch {
    /* ignore */
  }
  return true;
}

function readCompareState(): { comparePassed: boolean; compareSkipped: boolean } {
  const issuesPath = path.join(process.cwd(), 'results', 'ui-issues.json');
  if (!fs.existsSync(issuesPath)) return { comparePassed: true, compareSkipped: true };
  try {
    const report = JSON.parse(fs.readFileSync(issuesPath, 'utf-8')) as UiIssuesReport;
    return { comparePassed: !gateShouldFail(report), compareSkipped: false };
  } catch {
    return { comparePassed: true, compareSkipped: true };
  }
}

function readFeishuDoc(): { attempted: boolean; passed: boolean } {
  const docPath = path.join(process.cwd(), 'results', 'feishu-doc-url.txt');
  if (!fs.existsSync(docPath)) return { attempted: false, passed: true };
  try {
    return { attempted: true, passed: Boolean(fs.readFileSync(docPath, 'utf-8').trim()) };
  } catch {
    return { attempted: true, passed: false };
  }
}

function parseArgs(argv: string[]): {
  list: boolean;
  latestFailed: boolean;
  jobId?: string;
  file?: string;
  help: boolean;
} {
  let list = false;
  let latestFailed = false;
  let help = false;
  let jobId: string | undefined;
  let file: string | undefined;
  for (const arg of argv) {
    if (arg === '-h' || arg === '--help') help = true;
    else if (arg === '--list') list = true;
    else if (arg === '--latest-failed') latestFailed = true;
    else if (arg.startsWith('--job=')) jobId = arg.slice('--job='.length).trim();
    else if (arg.startsWith('--file=')) file = arg.slice('--file='.length).trim();
  }
  return { list, latestFailed, jobId, file, help };
}

function formatRec(rec: DeliveryRecord, fileHint?: string): string {
  const issues = rec.issueCount
    ? ` blocker=${rec.issueCount.blocker} warning=${rec.issueCount.warning}`
    : '';
  const err = rec.error ? ` err=${rec.error.slice(0, 80)}` : '';
  return `${rec.sentAt}  ${rec.status.padEnd(7)}  ${rec.jobId}  #${rec.attempt}${issues}${err}${fileHint ? `  ${fileHint}` : ''}`;
}

async function resendForJob(jobId: string, resentFrom?: string): Promise<boolean> {
  if (!canSendFeishuNotify()) {
    console.error('未配置飞书通知：请设置 FEISHU_CHAT_ID + FEISHU_APP_ID/SECRET，或 FEISHU_WEBHOOK_URL');
    return false;
  }
  const { comparePassed, compareSkipped } = readCompareState();
  const doc = readFeishuDoc();
  const ok = await sendJobFeishuNotification('interactive', {
    jobId,
    jobDescription: resentFrom ? `重投自 ${path.basename(resentFrom)}` : '通知重投',
    trigger: 'manual',
    testPassed: readTestPassed(),
    comparePassed,
    compareSkipped,
    feishuDocAttempted: doc.attempted,
    feishuDocPassed: doc.passed,
    uiIssuesSummary: readUiIssuesSummaryLine(),
  });
  return ok;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help || (!opts.list && !opts.latestFailed && !opts.file)) {
    printHelp();
    process.exit(opts.help ? 0 : 1);
  }

  if (opts.list) {
    const records = listDeliveryRecords({ limit: 30 });
    if (!records.length) {
      console.log('暂无投递记录（results/notification-deliveries/）');
      return;
    }
    for (const rec of records) {
      console.log(formatRec(rec));
    }
    return;
  }

  let target: { file: string; record: DeliveryRecord } | null = null;
  if (opts.file) {
    const record = readDeliveryFile(opts.file);
    if (!record) {
      console.error(`无法读取投递记录: ${opts.file}`);
      process.exit(1);
    }
    target = { file: opts.file, record };
  } else if (opts.latestFailed) {
    target = findLatestFailedDelivery(opts.jobId);
    if (!target) {
      console.error(opts.jobId ? `未找到 job=${opts.jobId} 的失败投递` : '未找到失败投递记录');
      process.exit(1);
    }
  }

  if (!target) {
    printHelp();
    process.exit(1);
  }

  console.log(`重投: ${formatRec(target.record, target.file)}`);
  const ok = await resendForJob(target.record.jobId || 'resend', target.file);
  if (!ok) process.exit(1);
  console.log('OK');
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
