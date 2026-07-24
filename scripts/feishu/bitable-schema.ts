import fs from 'fs';

export type BitableTableConfig = {
  appToken: string;
  runTableId: string;
  issueTableId?: string;
  dailySummaryTableId?: string;
  dashboardUrl?: string;
};

export type FeishuOpenApiConfig = {
  appId: string;
  appSecret: string;
};

export type BitableRuntimeConfig = FeishuOpenApiConfig & BitableTableConfig;

type FeishuConfigFile = {
  appId?: string;
  appSecret?: string;
  bitable?: Partial<BitableTableConfig>;
};

export const BITABLE_RESULT_FILE = 'results/feishu-bitable-record.json';

export const RUN_FIELDS = {
  executionId: 'execution_id',
  jobId: 'job_id',
  env: 'env',
  trigger: 'trigger',
  executedAt: 'executed_at',
  status: 'status',
  testPassed: 'test_passed',
  comparePassed: 'compare_passed',
  compareSkipped: 'compare_skipped',
  totalSpecs: 'total_specs',
  executedCount: 'executed_count',
  successCount: 'success_count',
  failCount: 'fail_count',
  blockerCount: 'blocker_count',
  warningCount: 'warning_count',
  noiseCount: 'noise_count',
  totalIssues: 'total_issues',
  goldenCount: 'golden_count',
  lastGreenCount: 'last_green_count',
  crossBrowserCount: 'cross_browser_count',
  runDriftCount: 'run_drift_count',
  topRoutes: 'top_routes',
  topScripts: 'top_scripts',
  reportUrl: 'report_url',
  feishuDocUrl: 'feishu_doc_url',
  failureReasons: 'failure_reasons',
} as const;

export const ISSUE_FIELDS = {
  issueRecordId: 'issue_record_id',
  executionId: 'execution_id',
  issueId: 'issue_id',
  scriptKey: 'script_key',
  stepNumber: 'step_number',
  stepName: 'step_name',
  browser: 'browser',
  compareKind: 'compare_kind',
  severity: 'severity',
  difference: 'difference',
  differencePercent: 'difference_percent',
  route: 'route',
  isNewRegression: 'is_new_regression',
  baselinePath: 'baseline_path',
  currentPath: 'current_path',
  diffImagePath: 'diff_image_path',
} as const;

export const DAILY_FIELDS = {
  summaryKey: 'summary_key',
  date: 'date',
  env: 'env',
  jobId: 'job_id',
  runCount: 'run_count',
  successCount: 'success_count',
  failedCount: 'failed_count',
  passRate: 'pass_rate',
  blockerCount: 'blocker_count',
  warningCount: 'warning_count',
  totalIssues: 'total_issues',
  blockerDelta: 'blocker_delta',
  warningDelta: 'warning_delta',
  totalDelta: 'total_delta',
  avgDifference: 'avg_difference',
  worstScript: 'worst_script',
  worstRoute: 'worst_route',
} as const;

function readConfigFile(): FeishuConfigFile {
  const configPath = 'feishu-config.json';
  if (!fs.existsSync(configPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf-8')) as FeishuConfigFile;
  } catch {
    return {};
  }
}

export function loadBitableRuntimeConfig(): BitableRuntimeConfig | null {
  const fileConfig = readConfigFile();
  const bitable = fileConfig.bitable ?? {};
  const config: BitableRuntimeConfig = {
    appId: process.env.FEISHU_APP_ID || fileConfig.appId || '',
    appSecret: process.env.FEISHU_APP_SECRET || fileConfig.appSecret || '',
    appToken: process.env.FEISHU_BITABLE_APP_TOKEN || bitable.appToken || '',
    runTableId: process.env.FEISHU_BITABLE_RUN_TABLE_ID || bitable.runTableId || '',
    issueTableId: process.env.FEISHU_BITABLE_ISSUE_TABLE_ID || bitable.issueTableId || '',
    dailySummaryTableId: process.env.FEISHU_BITABLE_DAILY_SUMMARY_TABLE_ID || bitable.dailySummaryTableId || '',
    dashboardUrl: process.env.FEISHU_BITABLE_DASHBOARD_URL || bitable.dashboardUrl || '',
  };

  if (!config.appId || !config.appSecret || !config.appToken || !config.runTableId) {
    return null;
  }
  return config;
}

export function explainMissingBitableConfig(): string {
  return '需要配置 FEISHU_APP_ID、FEISHU_APP_SECRET、FEISHU_BITABLE_APP_TOKEN、FEISHU_BITABLE_RUN_TABLE_ID，或在 feishu-config.json 的 bitable 配置块中提供。';
}
