import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { canSendFeishuNotify } from './index.js';
import { readUiIssuesSummaryLine, sendJobFeishuNotification } from '../jobs/job-notify.js';
import { gateShouldFail, type UiIssuesReport } from '../report/ui-issues-index.js';

dotenv.config({ path: path.join(process.cwd(), '.env') });

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

async function main(): Promise<void> {
  if (!canSendFeishuNotify()) {
    console.error('未配置飞书通知：请设置 FEISHU_CHAT_ID + FEISHU_APP_ID/SECRET，或 FEISHU_WEBHOOK_URL');
    process.exit(1);
  }

  const { comparePassed, compareSkipped } = readCompareState();
  const doc = readFeishuDoc();
  const ok = await sendJobFeishuNotification('interactive', {
    jobId: 'studio-manual',
    jobDescription: 'Studio 手动发送',
    trigger: 'manual',
    testPassed: readTestPassed(),
    comparePassed,
    compareSkipped,
    feishuDocAttempted: doc.attempted,
    feishuDocPassed: doc.passed,
    uiIssuesSummary: readUiIssuesSummaryLine(),
  });

  if (!ok) process.exit(1);
  console.log('OK');
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
