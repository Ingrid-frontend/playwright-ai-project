import fs from 'fs';

export type BitableTableConfig = {
  appToken: string;
  runTableId: string;
  issueTableId?: string;
  dailySummaryTableId?: string;
  /** 中控 UI 采集反馈表（手动登记） */
  feedbackTableId?: string;
  /** 客户验收交付明细表（含证据图附件） */
  deliveryTableId?: string;
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
  executionId: '执行ID',
  jobId: '任务',
  env: '环境',
  trigger: '触发来源',
  executedAt: '执行时间',
  status: '状态',
  testPassed: '用例通过',
  comparePassed: '对比通过',
  compareSkipped: '跳过对比',
  totalSpecs: '用例总数',
  executedCount: '已执行',
  successCount: '成功数',
  failCount: '失败数',
  blockerCount: '阻断问题',
  warningCount: '警告问题',
  noiseCount: '噪声问题',
  totalIssues: '问题总数',
  goldenCount: 'Golden对比',
  lastGreenCount: 'LastGreen对比',
  crossBrowserCount: '跨浏览器对比',
  runDriftCount: '运行漂移',
  topRoutes: '高频路由',
  topScripts: '高频脚本',
  reportUrl: '报告链接',
  feishuDocUrl: '飞书文档',
  failureReasons: '失败原因',
} as const;

export const RUN_FIELD_RENAMES: Record<string, string> = {
  execution_id: RUN_FIELDS.executionId,
  job_id: RUN_FIELDS.jobId,
  env: RUN_FIELDS.env,
  trigger: RUN_FIELDS.trigger,
  executed_at: RUN_FIELDS.executedAt,
  status: RUN_FIELDS.status,
  test_passed: RUN_FIELDS.testPassed,
  compare_passed: RUN_FIELDS.comparePassed,
  compare_skipped: RUN_FIELDS.compareSkipped,
  total_specs: RUN_FIELDS.totalSpecs,
  executed_count: RUN_FIELDS.executedCount,
  success_count: RUN_FIELDS.successCount,
  fail_count: RUN_FIELDS.failCount,
  blocker_count: RUN_FIELDS.blockerCount,
  warning_count: RUN_FIELDS.warningCount,
  noise_count: RUN_FIELDS.noiseCount,
  total_issues: RUN_FIELDS.totalIssues,
  golden_count: RUN_FIELDS.goldenCount,
  last_green_count: RUN_FIELDS.lastGreenCount,
  cross_browser_count: RUN_FIELDS.crossBrowserCount,
  run_drift_count: RUN_FIELDS.runDriftCount,
  top_routes: RUN_FIELDS.topRoutes,
  top_scripts: RUN_FIELDS.topScripts,
  report_url: RUN_FIELDS.reportUrl,
  feishu_doc_url: RUN_FIELDS.feishuDocUrl,
  failure_reasons: RUN_FIELDS.failureReasons,
};

export const ISSUE_FIELDS = {
  issueRecordId: '问题记录ID',
  executionId: '执行ID',
  runRecordLink: '关联执行',
  runRecordUrl: '执行链接',
  issueId: '问题ID',
  scriptKey: '脚本',
  scriptShort: '脚本简称',
  stepNumber: '步骤号',
  stepName: '步骤名',
  browser: '浏览器',
  compareKind: '对比类型',
  severity: '严重度',
  difference: '差异值',
  differencePercent: '差异%',
  route: '路由',
  isNewRegression: '新回归',
  baselinePath: '基线路径',
  currentPath: '当前路径',
  diffImagePath: '差异图路径',
  source: '来源',
  reporter: '登记人',
  description: '描述',
  elementXpath: 'XPath',
  elementSelector: '选择器',
  aiDocPath: 'AI文档路径',
  aiDocUrl: 'AI分析',
} as const;

export const ISSUE_FIELD_RENAMES: Record<string, string> = {
  issue_record_id: ISSUE_FIELDS.issueRecordId,
  execution_id: ISSUE_FIELDS.executionId,
  run_record: ISSUE_FIELDS.runRecordLink,
  run_record_url: ISSUE_FIELDS.runRecordUrl,
  issue_id: ISSUE_FIELDS.issueId,
  script_key: ISSUE_FIELDS.scriptKey,
  script_short: ISSUE_FIELDS.scriptShort,
  step_number: ISSUE_FIELDS.stepNumber,
  step_name: ISSUE_FIELDS.stepName,
  browser: ISSUE_FIELDS.browser,
  compare_kind: ISSUE_FIELDS.compareKind,
  severity: ISSUE_FIELDS.severity,
  difference: ISSUE_FIELDS.difference,
  difference_percent: ISSUE_FIELDS.differencePercent,
  route: ISSUE_FIELDS.route,
  is_new_regression: ISSUE_FIELDS.isNewRegression,
  baseline_path: ISSUE_FIELDS.baselinePath,
  current_path: ISSUE_FIELDS.currentPath,
  diff_image_path: ISSUE_FIELDS.diffImagePath,
  source: ISSUE_FIELDS.source,
  reporter: ISSUE_FIELDS.reporter,
  description: ISSUE_FIELDS.description,
  element_xpath: ISSUE_FIELDS.elementXpath,
  element_selector: ISSUE_FIELDS.elementSelector,
  ai_doc_path: ISSUE_FIELDS.aiDocPath,
  ai_doc_url: ISSUE_FIELDS.aiDocUrl,
};

/** 已不再写入的英文列名，maintain-bitable 可删除 */
export const ISSUE_DEPRECATED_FIELDS = [
  'baseline_path',
  '基线路径',
  'current_path',
  '当前路径',
  'diff_image_path',
  '差异图路径',
  'difference',
  '差异值',
  'ai_doc_path',
  'AI文档路径',
] as const;

/** 中控 UI 采集反馈表字段（手动登记，与自动化 issue 表可分开） */
export const FEEDBACK_FIELDS = {
  feedbackId: '反馈ID',
  reporter: '登记人',
  description: '问题描述',
  env: '环境',
  pageUrl: '页面链接',
  route: '页面路由',
  selector: '选择器',
  xpath: 'XPath',
  bbox: '元素区域',
  screenshotUrl: '截图链接',
  aiDocUrl: 'AI分析',
  assignees: '处理人',
  status: '状态',
  createdAt: '登记时间',
} as const;

export const FEEDBACK_FIELD_RENAMES: Record<string, string> = {
  feedback_id: FEEDBACK_FIELDS.feedbackId,
  reporter: FEEDBACK_FIELDS.reporter,
  description: FEEDBACK_FIELDS.description,
  env: FEEDBACK_FIELDS.env,
  page_url: FEEDBACK_FIELDS.pageUrl,
  route: FEEDBACK_FIELDS.route,
  element_selector: FEEDBACK_FIELDS.selector,
  element_xpath: FEEDBACK_FIELDS.xpath,
  element_bbox: FEEDBACK_FIELDS.bbox,
  screenshot_url: FEEDBACK_FIELDS.screenshotUrl,
  ai_doc_url: FEEDBACK_FIELDS.aiDocUrl,
  assignees: FEEDBACK_FIELDS.assignees,
  status: FEEDBACK_FIELDS.status,
  created_at: FEEDBACK_FIELDS.createdAt,
};

/** 多维表字段类型（飞书官方枚举） */
export const BITABLE_FIELD_TYPE = {
  text: 1,
  number: 2,
  singleSelect: 3,
  multiSelect: 4,
  dateTime: 5,
  checkbox: 7,
  url: 15,
  attachment: 17,
  singleLink: 18,
  duplexLink: 21,
} as const;

export function buildIssueLinkFieldSpec(runTableId: string): {
  name: string;
  type: number;
  property: Record<string, unknown>;
} {
  return {
    name: ISSUE_FIELDS.runRecordLink,
    type: BITABLE_FIELD_TYPE.singleLink,
    property: { table_id: runTableId, multiple: false },
  };
}

/** 客户验收交付明细表：一行一个检测项，含证据图附件 */
export const DELIVERY_FIELDS = {
  itemKey: 'item_key',
  generatedAt: 'generated_at',
  env: 'env',
  releaseTag: 'release_tag',
  verdict: 'verdict',
  page: 'page',
  flow: 'flow',
  step: 'step',
  stepNumber: 'step_number',
  browser: 'browser',
  difference: 'difference',
  affectedSteps: 'affected_steps',
  actionable: 'actionable',
  reason: 'reason',
  baselineImage: 'baseline_image',
  currentImage: 'current_image',
  diffImage: 'diff_image',
  docUrl: 'doc_url',
} as const;

export const DELIVERY_TABLE_NAME = 'UI 验收明细';

/** 建表字段定义，首字段必须是索引列 */
export const DELIVERY_FIELD_SPECS: Array<{
  name: string;
  type: number;
  property?: Record<string, unknown>;
}> = [
  { name: '页面', type: BITABLE_FIELD_TYPE.text },
  { name: DELIVERY_FIELDS.itemKey, type: BITABLE_FIELD_TYPE.text },
  { name: DELIVERY_FIELDS.generatedAt, type: BITABLE_FIELD_TYPE.text },
  { name: DELIVERY_FIELDS.env, type: BITABLE_FIELD_TYPE.text },
  { name: DELIVERY_FIELDS.releaseTag, type: BITABLE_FIELD_TYPE.text },
  { name: DELIVERY_FIELDS.verdict, type: BITABLE_FIELD_TYPE.text },
  { name: DELIVERY_FIELDS.flow, type: BITABLE_FIELD_TYPE.text },
  { name: DELIVERY_FIELDS.step, type: BITABLE_FIELD_TYPE.text },
  { name: DELIVERY_FIELDS.stepNumber, type: BITABLE_FIELD_TYPE.number },
  { name: DELIVERY_FIELDS.browser, type: BITABLE_FIELD_TYPE.text },
  { name: DELIVERY_FIELDS.difference, type: BITABLE_FIELD_TYPE.text },
  { name: DELIVERY_FIELDS.affectedSteps, type: BITABLE_FIELD_TYPE.number },
  { name: DELIVERY_FIELDS.actionable, type: BITABLE_FIELD_TYPE.text },
  { name: DELIVERY_FIELDS.reason, type: BITABLE_FIELD_TYPE.text },
  { name: DELIVERY_FIELDS.baselineImage, type: BITABLE_FIELD_TYPE.attachment },
  { name: DELIVERY_FIELDS.currentImage, type: BITABLE_FIELD_TYPE.attachment },
  { name: DELIVERY_FIELDS.diffImage, type: BITABLE_FIELD_TYPE.attachment },
  { name: DELIVERY_FIELDS.docUrl, type: BITABLE_FIELD_TYPE.url },
];

export const BITABLE_ENV_OPTIONS = [
  { name: 'dev' },
  { name: 'uat' },
  { name: 'stage' },
  { name: 'stage9084' },
];

export const FEEDBACK_FIELD_SPECS: Array<{
  name: string;
  type: number;
  property?: Record<string, unknown>;
}> = [
  { name: FEEDBACK_FIELDS.feedbackId, type: BITABLE_FIELD_TYPE.text },
  { name: FEEDBACK_FIELDS.reporter, type: BITABLE_FIELD_TYPE.text },
  { name: FEEDBACK_FIELDS.description, type: BITABLE_FIELD_TYPE.text },
  {
    name: FEEDBACK_FIELDS.env,
    type: BITABLE_FIELD_TYPE.singleSelect,
    property: { options: BITABLE_ENV_OPTIONS },
  },
  { name: FEEDBACK_FIELDS.pageUrl, type: BITABLE_FIELD_TYPE.url },
  { name: FEEDBACK_FIELDS.route, type: BITABLE_FIELD_TYPE.text },
  { name: FEEDBACK_FIELDS.selector, type: BITABLE_FIELD_TYPE.text },
  { name: FEEDBACK_FIELDS.xpath, type: BITABLE_FIELD_TYPE.text },
  { name: FEEDBACK_FIELDS.bbox, type: BITABLE_FIELD_TYPE.text },
  { name: FEEDBACK_FIELDS.screenshotUrl, type: BITABLE_FIELD_TYPE.url },
  { name: FEEDBACK_FIELDS.aiDocUrl, type: BITABLE_FIELD_TYPE.url },
  { name: FEEDBACK_FIELDS.assignees, type: BITABLE_FIELD_TYPE.text },
  {
    name: FEEDBACK_FIELDS.status,
    type: BITABLE_FIELD_TYPE.singleSelect,
    property: { options: [{ name: '待处理' }, { name: '处理中' }, { name: '已修复' }, { name: '忽略' }] },
  },
  {
    name: FEEDBACK_FIELDS.createdAt,
    type: BITABLE_FIELD_TYPE.dateTime,
    property: { date_formatter: 'yyyy/MM/dd HH:mm', auto_fill: false },
  },
];

export const DAILY_FIELDS = {
  summaryKey: '汇总键',
  date: '日期',
  dateText: '日期文本',
  env: '环境',
  jobId: '任务',
  runCount: '运行次数',
  successCount: '成功次数',
  failedCount: '失败次数',
  passRate: 'UI通过率',
  blockerCount: '阻断问题',
  warningCount: '警告问题',
  totalIssues: '问题总数',
  blockerDelta: '阻断变化',
  warningDelta: '警告变化',
  totalDelta: '问题变化',
  avgDifference: '平均差异',
  worstScript: '最差脚本',
  worstRoute: '最差路由',
} as const;

export const DAILY_FIELD_RENAMES: Record<string, string> = {
  summary_key: DAILY_FIELDS.summaryKey,
  date: DAILY_FIELDS.date,
  date_text: DAILY_FIELDS.dateText,
  env: DAILY_FIELDS.env,
  job_id: DAILY_FIELDS.jobId,
  run_count: DAILY_FIELDS.runCount,
  success_count: DAILY_FIELDS.successCount,
  failed_count: DAILY_FIELDS.failedCount,
  pass_rate: DAILY_FIELDS.passRate,
  blocker_count: DAILY_FIELDS.blockerCount,
  warning_count: DAILY_FIELDS.warningCount,
  total_issues: DAILY_FIELDS.totalIssues,
  blocker_delta: DAILY_FIELDS.blockerDelta,
  warning_delta: DAILY_FIELDS.warningDelta,
  total_delta: DAILY_FIELDS.totalDelta,
  avg_difference: DAILY_FIELDS.avgDifference,
  worst_script: DAILY_FIELDS.worstScript,
  worst_route: DAILY_FIELDS.worstRoute,
};

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
    feedbackTableId: process.env.FEISHU_BITABLE_FEEDBACK_TABLE_ID || bitable.feedbackTableId || '',
    deliveryTableId: process.env.FEISHU_BITABLE_DELIVERY_TABLE_ID || bitable.deliveryTableId || '',
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
