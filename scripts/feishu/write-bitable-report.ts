#!/usr/bin/env tsx
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { BitableClient, type BitableFieldValue } from './bitable-client.js';
import {
  BITABLE_RESULT_FILE,
  DAILY_FIELDS,
  ISSUE_FIELDS,
  RUN_FIELDS,
  explainMissingBitableConfig,
  loadBitableRuntimeConfig,
  type BitableRuntimeConfig,
} from './bitable-schema.js';
import type { JobSummaryFile } from '../jobs/job-lock.js';
import type { UiIssue, UiIssuesReport } from '../report/ui-issues.js';

dotenv.config();

type BitableWriteInput = {
  summary?: JobSummaryFile;
  env?: string;
  status?: 'success' | 'failed' | 'aborted' | 'skipped';
};

type BitableWriteResult = {
  skipped: boolean;
  executionId?: string;
  runRecordId?: string;
  issueRecordCount?: number;
  dailySummaryRecordId?: string;
  dashboardUrl?: string;
  runRecordUrl?: string;
  reason?: string;
};

type HistorySnapshot = {
  date: string;
  generatedAt: string;
  summary?: UiIssuesReport['summary'];
  byScript?: Record<string, ScriptSummary>;
};

type ScriptSummary = {
  blocker: number;
  warning: number;
  avgDifference: number;
};

const ISSUES_FILE = 'results/ui-issues.json';
const DOC_URL_FILE = 'results/feishu-doc-url.txt';
const REPORT_FILE = 'results/screenshot-comparison.html';
const HISTORY_DIR = path.join('results', 'history');
const MAX_ISSUES_TO_WRITE = Number.parseInt(process.env.FEISHU_BITABLE_MAX_ISSUES || '500', 10);

export async function writeBitableReport(input: BitableWriteInput = {}): Promise<BitableWriteResult> {
  const config = loadBitableRuntimeConfig();
  if (!config) {
    const reason = explainMissingBitableConfig();
    console.log(`ℹ️  跳过飞书多维表写入：${reason}`);
    return { skipped: true, reason };
  }

  const issuesReport = readIssuesReport();
  const summary = input.summary ?? buildFallbackSummary(issuesReport);
  const env = input.env || process.env.PLAYWRIGHT_ENV || 'stage';
  const generatedAt = issuesReport?.generatedAt || new Date().toISOString();
  const executionId = summary.runId || buildExecutionId(generatedAt, env, summary.specPaths);
  const status = input.status ?? resolveStatus(summary);
  const client = new BitableClient(config);

  const runFields = buildRunFields({ config, summary, issuesReport, env, status, generatedAt, executionId });
  console.log(`📊 写入飞书多维表执行记录: ${executionId}`);
  const runResult = await client.upsertRecord(config.runTableId, RUN_FIELDS.executionId, executionId, runFields);

  let issueRecordCount = 0;
  if (config.issueTableId && issuesReport?.issues?.length) {
    const issues = issuesReport.issues.slice(0, Number.isFinite(MAX_ISSUES_TO_WRITE) ? MAX_ISSUES_TO_WRITE : 500);
    for (const issue of issues) {
      const fields = buildIssueFields(executionId, issue);
      await client.upsertRecord(config.issueTableId, ISSUE_FIELDS.issueRecordId, String(fields[ISSUE_FIELDS.issueRecordId]), fields);
      issueRecordCount++;
    }
    console.log(`📋 已写入/更新 ${issueRecordCount} 条 UI 问题明细`);
  }

  let dailySummaryRecordId: string | undefined;
  if (config.dailySummaryTableId) {
    const dailyFields = buildDailySummaryFields({ summary, issuesReport, env, generatedAt });
    const dailyResult = await client.upsertRecord(
      config.dailySummaryTableId,
      DAILY_FIELDS.summaryKey,
      String(dailyFields[DAILY_FIELDS.summaryKey]),
      dailyFields,
    );
    dailySummaryRecordId = dailyResult.recordId;
  }

  const runRecordUrl = buildBitableRecordUrl(config, runResult.recordId);
  const output: BitableWriteResult = {
    skipped: false,
    executionId,
    runRecordId: runResult.recordId,
    issueRecordCount,
    dailySummaryRecordId,
    dashboardUrl: config.dashboardUrl || undefined,
    runRecordUrl,
  };
  saveBitableResult(output);
  console.log(`✅ 飞书多维表写入完成: ${runResult.created ? '新增' : '更新'}执行记录 ${runResult.recordId}`);
  return output;
}

function readIssuesReport(): UiIssuesReport | null {
  if (!fs.existsSync(ISSUES_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(ISSUES_FILE, 'utf-8')) as UiIssuesReport;
  } catch {
    return null;
  }
}

function buildFallbackSummary(report: UiIssuesReport | null): JobSummaryFile {
  const totalBlocker = report?.summary.blocker ?? 0;
  return {
    jobId: process.env.TEST_JOB_ID || 'direct',
    runId: process.env.TEST_RUN_ID || buildExecutionId(report?.generatedAt || new Date().toISOString(), process.env.PLAYWRIGHT_ENV || 'stage', []),
    trigger: process.env.TEST_TRIGGER || 'cli',
    testPassed: true,
    comparePassed: totalBlocker === 0,
    compareSkipped: false,
    aborted: false,
    totalSpecs: 0,
    executedCount: 0,
    successCount: 0,
    failCount: 0,
    projects: [],
    specPaths: [],
    uiIssuesBlocker: report?.summary.blocker,
    uiIssuesWarning: report?.summary.warning,
    failReasons: totalBlocker > 0 ? [`截图对比 gate 未通过（blocker ${totalBlocker}）`] : [],
  };
}

function buildExecutionId(generatedAt: string, env: string, specPaths: string[]): string {
  const hash = crypto.createHash('sha1').update(`${generatedAt}|${env}|${specPaths.join('|')}`).digest('hex').slice(0, 10);
  return `ui-${generatedAt.replace(/[-:.TZ]/g, '').slice(0, 14)}-${hash}`;
}

function resolveStatus(summary: JobSummaryFile): 'success' | 'failed' | 'aborted' | 'skipped' {
  if (summary.aborted) return 'aborted';
  if (summary.compareSkipped && summary.executedCount === 0) return 'skipped';
  return summary.testPassed && (summary.compareSkipped || summary.comparePassed) && summary.failCount === 0 ? 'success' : 'failed';
}

function buildRunFields(input: {
  config: BitableRuntimeConfig;
  summary: JobSummaryFile;
  issuesReport: UiIssuesReport | null;
  env: string;
  status: string;
  generatedAt: string;
  executionId: string;
}) {
  const { summary, issuesReport, env, status, generatedAt, executionId } = input;
  const issueSummary = issuesReport?.summary;
  const compareKind = issueSummary?.byCompareKind ?? {};
  return {
    [RUN_FIELDS.executionId]: executionId,
    [RUN_FIELDS.jobId]: summary.jobId,
    [RUN_FIELDS.env]: env,
    [RUN_FIELDS.trigger]: summary.trigger,
    [RUN_FIELDS.executedAt]: Date.parse(generatedAt),
    [RUN_FIELDS.status]: status,
    [RUN_FIELDS.testPassed]: summary.testPassed,
    [RUN_FIELDS.comparePassed]: summary.comparePassed,
    [RUN_FIELDS.compareSkipped]: summary.compareSkipped,
    [RUN_FIELDS.totalSpecs]: summary.totalSpecs,
    [RUN_FIELDS.executedCount]: summary.executedCount,
    [RUN_FIELDS.successCount]: summary.successCount,
    [RUN_FIELDS.failCount]: summary.failCount,
    [RUN_FIELDS.blockerCount]: issueSummary?.blocker ?? summary.uiIssuesBlocker ?? 0,
    [RUN_FIELDS.warningCount]: issueSummary?.warning ?? summary.uiIssuesWarning ?? 0,
    [RUN_FIELDS.noiseCount]: issueSummary?.noise ?? 0,
    [RUN_FIELDS.totalIssues]: issueSummary?.total ?? 0,
    [RUN_FIELDS.goldenCount]: compareKind.golden ?? 0,
    [RUN_FIELDS.lastGreenCount]: compareKind['last-green'] ?? 0,
    [RUN_FIELDS.crossBrowserCount]: compareKind['cross-browser'] ?? 0,
    [RUN_FIELDS.runDriftCount]: compareKind['run-drift'] ?? 0,
    [RUN_FIELDS.topRoutes]: formatTopEntries(issueSummary?.byRoute),
    [RUN_FIELDS.topScripts]: formatTopScripts(issuesReport?.issues ?? []),
    [RUN_FIELDS.reportUrl]: toUrlField(resolveReportUrl()),
    [RUN_FIELDS.feishuDocUrl]: toUrlField(readTextFile(DOC_URL_FILE)),
    [RUN_FIELDS.failureReasons]: (summary.failReasons ?? []).join('\n'),
  };
}

function buildIssueFields(executionId: string, issue: UiIssue) {
  const issueRecordId = `${executionId}|${issue.issueId}`;
  return {
    [ISSUE_FIELDS.issueRecordId]: issueRecordId,
    [ISSUE_FIELDS.executionId]: executionId,
    [ISSUE_FIELDS.issueId]: issue.issueId,
    [ISSUE_FIELDS.scriptKey]: issue.scriptKey,
    [ISSUE_FIELDS.stepNumber]: issue.stepNumber,
    [ISSUE_FIELDS.stepName]: issue.stepName,
    [ISSUE_FIELDS.browser]: issue.browser,
    [ISSUE_FIELDS.compareKind]: issue.compareKind,
    [ISSUE_FIELDS.severity]: issue.severity,
    [ISSUE_FIELDS.difference]: issue.difference,
    [ISSUE_FIELDS.differencePercent]: Number((issue.difference * 100).toFixed(4)),
    [ISSUE_FIELDS.route]: issue.route,
    [ISSUE_FIELDS.isNewRegression]: Boolean(issue.isNewRegression),
    [ISSUE_FIELDS.baselinePath]: issue.baselinePath,
    [ISSUE_FIELDS.currentPath]: issue.currentPath,
    [ISSUE_FIELDS.diffImagePath]: issue.diffImagePath,
  };
}

function buildDailySummaryFields(input: {
  summary: JobSummaryFile;
  issuesReport: UiIssuesReport | null;
  env: string;
  generatedAt: string;
}) {
  const { summary, issuesReport, env, generatedAt } = input;
  const date = generatedAt.slice(0, 10);
  const history = readHistorySnapshot(date);
  const previous = readPreviousHistorySnapshot(date);
  const currentSummary = issuesReport?.summary ?? history?.summary;
  const previousSummary = previous?.summary;
  const byScript = history?.byScript ?? buildScriptSummary(issuesReport?.issues ?? []);
  const worstScript = Object.entries(byScript).sort((a, b) => b[1].avgDifference - a[1].avgDifference)[0];
  const worstRoute = topEntry(currentSummary?.byRoute);
  const successCount = resolveStatus(summary) === 'success' ? 1 : 0;
  const failedCount = resolveStatus(summary) === 'failed' || resolveStatus(summary) === 'aborted' ? 1 : 0;
  return {
    [DAILY_FIELDS.summaryKey]: `${date}|${env}|${summary.jobId}`,
    [DAILY_FIELDS.date]: Date.parse(`${date}T00:00:00+08:00`),
    [DAILY_FIELDS.env]: env,
    [DAILY_FIELDS.jobId]: summary.jobId,
    [DAILY_FIELDS.runCount]: 1,
    [DAILY_FIELDS.successCount]: successCount,
    [DAILY_FIELDS.failedCount]: failedCount,
    [DAILY_FIELDS.passRate]: successCount,
    [DAILY_FIELDS.blockerCount]: currentSummary?.blocker ?? 0,
    [DAILY_FIELDS.warningCount]: currentSummary?.warning ?? 0,
    [DAILY_FIELDS.totalIssues]: currentSummary?.total ?? 0,
    [DAILY_FIELDS.blockerDelta]: (currentSummary?.blocker ?? 0) - (previousSummary?.blocker ?? 0),
    [DAILY_FIELDS.warningDelta]: (currentSummary?.warning ?? 0) - (previousSummary?.warning ?? 0),
    [DAILY_FIELDS.totalDelta]: (currentSummary?.total ?? 0) - (previousSummary?.total ?? 0),
    [DAILY_FIELDS.avgDifference]: worstScript?.[1]?.avgDifference ?? 0,
    [DAILY_FIELDS.worstScript]: worstScript ? `${worstScript[0]} (${(worstScript[1].avgDifference * 100).toFixed(2)}%)` : '',
    [DAILY_FIELDS.worstRoute]: worstRoute,
  };
}

function formatTopEntries(record?: Record<string, number>, limit = 5): string {
  if (!record) return '';
  return Object.entries(record)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n');
}

function formatTopScripts(issues: UiIssue[], limit = 5): string {
  const counts = new Map<string, number>();
  for (const issue of issues) counts.set(issue.scriptKey, (counts.get(issue.scriptKey) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n');
}

function topEntry(record?: Record<string, number>): string {
  if (!record) return '';
  const entry = Object.entries(record).sort((a, b) => b[1] - a[1])[0];
  return entry ? `${entry[0]}: ${entry[1]}` : '';
}

function buildScriptSummary(issues: UiIssue[]): Record<string, ScriptSummary> {
  const buckets = new Map<string, { blocker: number; warning: number; diffs: number[] }>();
  for (const issue of issues) {
    const bucket = buckets.get(issue.scriptKey) ?? { blocker: 0, warning: 0, diffs: [] };
    if (issue.severity === 'blocker') bucket.blocker++;
    if (issue.severity === 'warning') bucket.warning++;
    bucket.diffs.push(issue.difference);
    buckets.set(issue.scriptKey, bucket);
  }
  const result: Record<string, ScriptSummary> = {};
  for (const [scriptKey, bucket] of buckets) {
    const avgDifference = bucket.diffs.length ? bucket.diffs.reduce((sum, item) => sum + item, 0) / bucket.diffs.length : 0;
    result[scriptKey] = { blocker: bucket.blocker, warning: bucket.warning, avgDifference };
  }
  return result;
}

function readHistorySnapshot(date: string): HistorySnapshot | null {
  const file = path.join(HISTORY_DIR, `${date}.json`);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as HistorySnapshot;
  } catch {
    return null;
  }
}

function readPreviousHistorySnapshot(currentDate: string): HistorySnapshot | null {
  if (!fs.existsSync(HISTORY_DIR)) return null;
  const file = fs.readdirSync(HISTORY_DIR)
    .filter((item) => /^\d{4}-\d{2}-\d{2}\.json$/.test(item))
    .map((item) => item.replace(/\.json$/, ''))
    .filter((date) => date < currentDate)
    .sort()
    .pop();
  return file ? readHistorySnapshot(file) : null;
}

function toUrlField(url: string): BitableFieldValue | null {
  if (!url) return null;
  return { link: url, text: url };
}

function resolveReportUrl(): string {
  const explicit = process.env.FEISHU_REPORT_URL || process.env.PUBLIC_REPORT_URL || '';
  if (explicit) return explicit;
  return fs.existsSync(REPORT_FILE) ? REPORT_FILE : '';
}

function readTextFile(filePath: string): string {
  if (!fs.existsSync(filePath)) return '';
  try {
    return fs.readFileSync(filePath, 'utf-8').trim();
  } catch {
    return '';
  }
}

function buildBitableRecordUrl(config: BitableRuntimeConfig, recordId: string): string {
  return `https://feishu.cn/base/${config.appToken}?table=${config.runTableId}&record=${recordId}`;
}

function saveBitableResult(result: BitableWriteResult): void {
  fs.mkdirSync(path.dirname(BITABLE_RESULT_FILE), { recursive: true });
  fs.writeFileSync(BITABLE_RESULT_FILE, JSON.stringify({ ...result, writtenAt: new Date().toISOString() }, null, 2), 'utf-8');
}

function readSummaryFromArg(): JobSummaryFile | undefined {
  const arg = process.argv.find((item) => item.startsWith('--summary='));
  if (!arg) return undefined;
  const filePath = arg.slice('--summary='.length);
  if (!fs.existsSync(filePath)) throw new Error(`summary 文件不存在: ${filePath}`);
  return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as JobSummaryFile;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  writeBitableReport({ summary: readSummaryFromArg() })
    .then((result) => {
      if (result.skipped) return;
      console.log(`🔗 多维表记录: ${result.runRecordUrl || result.runRecordId}`);
      if (result.dashboardUrl) console.log(`📈 质量看板: ${result.dashboardUrl}`);
    })
    .catch((error: unknown) => {
      console.error('❌ 飞书多维表写入失败:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    });
}
