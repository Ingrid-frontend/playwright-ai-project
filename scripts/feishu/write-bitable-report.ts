#!/usr/bin/env tsx
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import {
  formatCompareKindLabel,
  formatScriptLabel,
  formatSeverityLabel,
  formatStatusLabel,
} from './bitable-display.js';
import { BitableClient, type BitableFieldValue, type BitableRecordFields } from './bitable-client.js';
import {
  BITABLE_RESULT_FILE,
  DAILY_FIELDS,
  ISSUE_FIELDS,
  RUN_FIELDS,
  explainMissingBitableConfig,
  loadBitableRuntimeConfig,
  type BitableRuntimeConfig,
  BITABLE_FIELD_TYPE,
} from './bitable-schema.js';
import type { JobSummaryFile } from '../jobs/job-lock.js';
import type { UiIssue, UiIssuesReport } from '../report/ui-issues-index.js';
import { writeFeedbackDocsFromReport } from '../report/ui-feedback-doc.js';
import { isFlowIssuesSource, readIssuesReport, resolveIssuesSource } from '../report/issues-source.js';
import type { HistorySnapshot } from '../report/ui-regression-history.js';
import {
  buildScriptSummaryFromIssues,
  readHistorySnapshotForDate,
  readPreviousHistorySnapshot,
} from '../report/ui-regression-history.js';

dotenv.config();

export type BitableWriteInput = {
  summary?: JobSummaryFile;
  env?: string;
  status?: 'success' | 'failed' | 'aborted' | 'skipped';
};

export type BitableWriteResult = {
  skipped: boolean;
  executionId?: string;
  runRecordId?: string;
  issueRecordCount?: number;
  dailySummaryRecordId?: string;
  dashboardUrl?: string;
  runRecordUrl?: string;
  reason?: string;
};

const DOC_URL_FILE = 'results/feishu-doc-url.txt';
const REPORT_FILE = 'results/screenshot-comparison.html';
const FLOW_REPORT_FILE = 'results/flow-screenshot-comparison.html';
const MAX_ISSUES_TO_WRITE = Number.parseInt(process.env.FEISHU_BITABLE_MAX_ISSUES || '500', 10);

export async function writeBitableReport(input: BitableWriteInput = {}): Promise<BitableWriteResult> {
  const config = loadBitableRuntimeConfig();
  if (!config) {
    const reason = explainMissingBitableConfig();
    console.log(`ℹ️  跳过飞书多维表写入：${reason}`);
    return { skipped: true, reason };
  }

  const issuesSource = resolveIssuesSource();
  const issuesReport = readIssuesReport();
  const summary = input.summary ?? buildFallbackSummary(issuesReport);
  const env = input.env || process.env.PLAYWRIGHT_ENV || 'stage';
  const generatedAt = issuesReport?.generatedAt || new Date().toISOString();
  const executionId = summary.runId || buildExecutionId(generatedAt, env, summary.specPaths);
  const status = input.status ?? resolveStatus(summary);

  if (issuesReport?.issues?.length) {
    writeFeedbackDocsFromReport(issuesReport, { env, executionId });
    if (issuesSource) {
      fs.writeFileSync(issuesSource, JSON.stringify(issuesReport, null, 2), 'utf-8');
    }
    console.log(`📝 AI 分析文档 ${issuesReport.issues.filter((i) => i.aiDocPath).length} 条 → results/ui-feedback-docs/latest.md`);
  }

  const client = new BitableClient(config);

  const runFields = buildRunFields({
    config,
    summary,
    issuesReport,
    env,
    status,
    generatedAt,
    executionId,
    issuesSource,
  });
  console.log(`📊 写入飞书多维表执行记录: ${executionId}`);
  const runResult = await client.upsertRecord(config.runTableId, RUN_FIELDS.executionId, executionId, runFields);
  const runRecordUrl = buildBitableRecordUrl(config, runResult.recordId);
  const issueLinkField = await resolveIssueLinkField(client, config);

  let issueRecordCount = 0;
  if (config.issueTableId && issuesReport?.issues?.length) {
    const issues = issuesReport.issues.slice(0, Number.isFinite(MAX_ISSUES_TO_WRITE) ? MAX_ISSUES_TO_WRITE : 500);
    for (const issue of issues) {
      const fields = buildIssueFields(executionId, issue, runRecordUrl, runResult.recordId, issueLinkField);
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

export function buildDailySummaryKey(date: string, env: string): string {
  return `${date}|${env}`;
}

export function calcUiPassRate(summary?: UiIssuesReport['summary']): number {
  if (!summary) return 100;
  const cmpTotal = summary.comparisonTotal ?? summary.total ?? 0;
  const cmpBlocker = summary.comparisonBlocker ?? summary.blocker ?? 0;
  const cmpWarning = summary.comparisonWarning ?? summary.warning ?? 0;
  if (cmpTotal <= 0) return 100;
  return Number((((cmpTotal - cmpBlocker - cmpWarning) / cmpTotal) * 100).toFixed(1));
}

function buildFallbackSummary(report: UiIssuesReport | null): JobSummaryFile {
  const totalBlocker = report?.summary.comparisonBlocker ?? report?.summary.blocker ?? 0;
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
  issuesSource: string | null;
}) {
  const { summary, issuesReport, env, status, generatedAt, executionId, issuesSource } = input;
  const issueSummary = issuesReport?.summary;
  const compareKind = issueSummary?.byCompareKind ?? {};
  const blockerCount = issueSummary?.comparisonBlocker ?? issueSummary?.blocker ?? summary.uiIssuesBlocker ?? 0;
  const warningCount = issueSummary?.comparisonWarning ?? issueSummary?.warning ?? summary.uiIssuesWarning ?? 0;
  const totalIssues = issueSummary?.comparisonTotal ?? issueSummary?.total ?? 0;
  return {
    [RUN_FIELDS.executionId]: executionId,
    [RUN_FIELDS.jobId]: summary.jobId,
    [RUN_FIELDS.env]: env,
    [RUN_FIELDS.trigger]: summary.trigger,
    [RUN_FIELDS.executedAt]: Date.parse(generatedAt),
    [RUN_FIELDS.status]: formatStatusLabel(status),
    [RUN_FIELDS.testPassed]: summary.testPassed,
    [RUN_FIELDS.comparePassed]: summary.comparePassed,
    [RUN_FIELDS.compareSkipped]: summary.compareSkipped,
    [RUN_FIELDS.totalSpecs]: summary.totalSpecs,
    [RUN_FIELDS.executedCount]: summary.executedCount,
    [RUN_FIELDS.successCount]: summary.successCount,
    [RUN_FIELDS.failCount]: summary.failCount,
    [RUN_FIELDS.blockerCount]: blockerCount,
    [RUN_FIELDS.warningCount]: warningCount,
    [RUN_FIELDS.noiseCount]: issueSummary?.comparisonNoise ?? issueSummary?.noise ?? 0,
    [RUN_FIELDS.totalIssues]: totalIssues,
    [RUN_FIELDS.goldenCount]: compareKind.golden ?? 0,
    [RUN_FIELDS.lastGreenCount]: compareKind['last-green'] ?? 0,
    [RUN_FIELDS.crossBrowserCount]: compareKind['cross-browser'] ?? 0,
    [RUN_FIELDS.runDriftCount]: compareKind['run-drift'] ?? 0,
    [RUN_FIELDS.topRoutes]: formatTopEntries(issueSummary?.byRoute),
    [RUN_FIELDS.topScripts]: formatTopScripts(issuesReport?.issues ?? []),
    [RUN_FIELDS.reportUrl]: toUrlField(resolveReportUrl(issuesSource)),
    [RUN_FIELDS.feishuDocUrl]: toUrlField(readTextFile(DOC_URL_FILE)),
    [RUN_FIELDS.failureReasons]: (summary.failReasons ?? []).join('\n'),
  };
}

function buildIssueFields(
  executionId: string,
  issue: UiIssue,
  runRecordUrl: string,
  runRecordId: string,
  issueLinkField?: string | null,
) {
  const issueRecordId = `${executionId}|${issue.issueId}`;
  const publicBase = process.env.PUBLIC_REPORT_URL || process.env.FEISHU_REPORT_URL || '';
  const aiDocUrl =
    issue.aiDocUrl ||
    (issue.aiDocPath && publicBase ? `${publicBase.replace(/\/$/, '')}/${issue.aiDocPath}` : '');
  const fields: BitableRecordFields = {
    [ISSUE_FIELDS.issueRecordId]: issueRecordId,
    [ISSUE_FIELDS.executionId]: executionId,
    [ISSUE_FIELDS.runRecordUrl]: toUrlField(runRecordUrl),
    [ISSUE_FIELDS.issueId]: issue.issueId,
    [ISSUE_FIELDS.scriptKey]: issue.scriptKey,
    [ISSUE_FIELDS.scriptShort]: formatScriptLabel(issue.scriptKey),
    [ISSUE_FIELDS.stepNumber]: issue.stepNumber,
    [ISSUE_FIELDS.stepName]: issue.stepName,
    [ISSUE_FIELDS.browser]: issue.browser,
    [ISSUE_FIELDS.compareKind]: formatCompareKindLabel(issue.compareKind),
    [ISSUE_FIELDS.severity]: formatSeverityLabel(issue.severity),
    [ISSUE_FIELDS.differencePercent]: Number((issue.difference * 100).toFixed(4)),
    [ISSUE_FIELDS.route]: issue.route,
    [ISSUE_FIELDS.isNewRegression]: Boolean(issue.isNewRegression),
    [ISSUE_FIELDS.source]: issue.source || 'automated',
    [ISSUE_FIELDS.reporter]: issue.reporter || '',
    [ISSUE_FIELDS.description]: issue.description || issue.detail || '',
    [ISSUE_FIELDS.elementXpath]: issue.elementXpath || '',
    [ISSUE_FIELDS.elementSelector]: issue.elementSelector || '',
    [ISSUE_FIELDS.aiDocUrl]: aiDocUrl ? toUrlField(aiDocUrl) : null,
  };
  if (issueLinkField && runRecordId) {
    fields[issueLinkField] = [runRecordId];
  }
  return fields;
}

async function resolveIssueLinkField(
  client: BitableClient,
  config: BitableRuntimeConfig,
): Promise<string | null> {
  if (!config.issueTableId || !config.runTableId) return null;
  if (process.env.FEISHU_BITABLE_ISSUE_RUN_LINK === '0') return null;
  const fields = await client.listFields(config.issueTableId);
  const hit = fields.find(
    (item) => item.field_name === ISSUE_FIELDS.runRecordLink && item.type === BITABLE_FIELD_TYPE.singleLink,
  );
  return hit ? ISSUE_FIELDS.runRecordLink : null;
}

function buildDailySummaryFields(input: {
  summary: JobSummaryFile;
  issuesReport: UiIssuesReport | null;
  env: string;
  generatedAt: string;
}) {
  const { summary, issuesReport, env, generatedAt } = input;
  const date = generatedAt.slice(0, 10);
  const history = readHistorySnapshotForDate(date);
  const previous = readPreviousHistorySnapshot(date);
  const currentSummary = issuesReport?.summary ?? history?.summary;
  return buildDailySummaryFromSnapshot({
    date,
    env,
    jobId: summary.jobId,
    status: resolveStatus(summary),
    currentSummary,
    previousSummary: previous?.summary,
    byScript: history?.byScript ?? buildScriptSummaryFromIssues(issuesReport?.issues ?? []),
  });
}

export function buildDailySummaryFromSnapshot(input: {
  date: string;
  env: string;
  jobId: string;
  status: 'success' | 'failed' | 'aborted' | 'skipped';
  currentSummary?: UiIssuesReport['summary'];
  previousSummary?: UiIssuesReport['summary'];
  byScript?: HistorySnapshot['byScript'];
}) {
  const { date, env, jobId, status, currentSummary, previousSummary, byScript = {} } = input;
  const worstScript = Object.entries(byScript).sort((a, b) => b[1].avgDifference - a[1].avgDifference)[0];
  const worstRoute = topEntry(currentSummary?.byRoute);
  const successCount = status === 'success' ? 1 : 0;
  const failedCount = status === 'failed' || status === 'aborted' ? 1 : 0;
  const blockerCount = currentSummary?.comparisonBlocker ?? currentSummary?.blocker ?? 0;
  const warningCount = currentSummary?.comparisonWarning ?? currentSummary?.warning ?? 0;
  const totalIssues = currentSummary?.comparisonTotal ?? currentSummary?.total ?? 0;
  const prevBlocker = previousSummary?.comparisonBlocker ?? previousSummary?.blocker ?? 0;
  const prevWarning = previousSummary?.comparisonWarning ?? previousSummary?.warning ?? 0;
  const prevTotal = previousSummary?.comparisonTotal ?? previousSummary?.total ?? 0;
  return {
    [DAILY_FIELDS.summaryKey]: buildDailySummaryKey(date, env),
    [DAILY_FIELDS.date]: Date.parse(`${date}T00:00:00+08:00`),
    [DAILY_FIELDS.dateText]: date,
    [DAILY_FIELDS.env]: env,
    [DAILY_FIELDS.jobId]: jobId,
    [DAILY_FIELDS.runCount]: 1,
    [DAILY_FIELDS.successCount]: successCount,
    [DAILY_FIELDS.failedCount]: failedCount,
    [DAILY_FIELDS.passRate]: calcUiPassRate(currentSummary),
    [DAILY_FIELDS.blockerCount]: blockerCount,
    [DAILY_FIELDS.warningCount]: warningCount,
    [DAILY_FIELDS.totalIssues]: totalIssues,
    [DAILY_FIELDS.blockerDelta]: blockerCount - prevBlocker,
    [DAILY_FIELDS.warningDelta]: warningCount - prevWarning,
    [DAILY_FIELDS.totalDelta]: totalIssues - prevTotal,
    [DAILY_FIELDS.avgDifference]: worstScript?.[1]?.avgDifference ?? 0,
    [DAILY_FIELDS.worstScript]: worstScript ? `${worstScript[0]} (${(worstScript[1].avgDifference * 100).toFixed(2)}%)` : '',
    [DAILY_FIELDS.worstRoute]: worstRoute,
  };
}

export function buildRunFieldsFromSnapshot(input: {
  snapshot: HistorySnapshot;
  env: string;
  jobId: string;
  executionId: string;
  status: 'success' | 'failed' | 'aborted' | 'skipped';
  issuesSource: string | null;
}) {
  const { snapshot, env, jobId, executionId, status, issuesSource } = input;
  const summary = snapshot.summary;
  const compareKind = summary.byCompareKind ?? {};
  const blockerCount = summary.comparisonBlocker ?? summary.blocker ?? 0;
  const warningCount = summary.comparisonWarning ?? summary.warning ?? 0;
  const totalIssues = summary.comparisonTotal ?? summary.total ?? 0;
  return {
    [RUN_FIELDS.executionId]: executionId,
    [RUN_FIELDS.jobId]: jobId,
    [RUN_FIELDS.env]: env,
    [RUN_FIELDS.trigger]: 'history-backfill',
    [RUN_FIELDS.executedAt]: Date.parse(snapshot.generatedAt),
    [RUN_FIELDS.status]: formatStatusLabel(status),
    [RUN_FIELDS.testPassed]: status === 'success',
    [RUN_FIELDS.comparePassed]: blockerCount === 0,
    [RUN_FIELDS.compareSkipped]: false,
    [RUN_FIELDS.totalSpecs]: 0,
    [RUN_FIELDS.executedCount]: 0,
    [RUN_FIELDS.successCount]: status === 'success' ? 1 : 0,
    [RUN_FIELDS.failCount]: status === 'failed' ? 1 : 0,
    [RUN_FIELDS.blockerCount]: blockerCount,
    [RUN_FIELDS.warningCount]: warningCount,
    [RUN_FIELDS.noiseCount]: summary.comparisonNoise ?? summary.noise ?? 0,
    [RUN_FIELDS.totalIssues]: totalIssues,
    [RUN_FIELDS.goldenCount]: compareKind.golden ?? 0,
    [RUN_FIELDS.lastGreenCount]: compareKind['last-green'] ?? 0,
    [RUN_FIELDS.crossBrowserCount]: compareKind['cross-browser'] ?? 0,
    [RUN_FIELDS.runDriftCount]: compareKind['run-drift'] ?? 0,
    [RUN_FIELDS.topRoutes]: formatTopEntries(summary.byRoute),
    [RUN_FIELDS.topScripts]: '',
    [RUN_FIELDS.reportUrl]: toUrlField(resolveReportUrl(issuesSource)),
    [RUN_FIELDS.feishuDocUrl]: toUrlField(readTextFile(DOC_URL_FILE)),
    [RUN_FIELDS.failureReasons]: blockerCount > 0 ? `历史回填 · blocker ${blockerCount}` : '',
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
  for (const issue of issues) {
    const label = formatScriptLabel(issue.scriptKey) || issue.scriptKey;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
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

function toUrlField(url: string): BitableFieldValue | null {
  if (!url) return null;
  return { link: url, text: url };
}

function resolveReportUrl(issuesSource: string | null): string {
  const explicit = process.env.FEISHU_REPORT_URL || process.env.PUBLIC_REPORT_URL || '';
  if (explicit) return explicit;
  if (isFlowIssuesSource(issuesSource) && fs.existsSync(FLOW_REPORT_FILE)) return FLOW_REPORT_FILE;
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
