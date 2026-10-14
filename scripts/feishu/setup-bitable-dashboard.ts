#!/usr/bin/env tsx
/**
 * 飞书多维表：字段校验 + 仪表盘发现 + 搭建指引
 *
 * 用法:
 *   npm run feishu:bitable-setup
 *   npm run feishu:bitable-setup -- --fix-fields   # 自动补缺失字段
 */
import {
  BitableClient,
  DAILY_FIELDS,
  FEEDBACK_FIELD_SPECS,
  ISSUE_FIELDS,
  RUN_FIELDS,
  BITABLE_ENV_OPTIONS,
  ARCHIVE_FIELD,
  BITABLE_FIELD_TYPE,
  buildIssueLinkFieldSpec,
  DELIVERY_FIELD_SPECS,
  DELIVERY_TABLE_NAME,
  DELIVERY_SUMMARY_FIELD_SPECS,
  DELIVERY_SUMMARY_TABLE_NAME,
  explainMissingBitableConfig,
  loadBitableRuntimeConfig,
} from './index.js';

import {
  BITABLE_COMPARE_KIND_OPTIONS,
  BITABLE_SEVERITY_OPTIONS,
  BITABLE_STATUS_OPTIONS,
} from './bitable-display.js';

type FieldSpec = {
  name: string;
  type: number;
  property?: Record<string, unknown>;
};


const FIELD_TYPE = BITABLE_FIELD_TYPE;

const RUN_SPECS: FieldSpec[] = [
  { name: RUN_FIELDS.executionId, type: FIELD_TYPE.text },
  { name: RUN_FIELDS.jobId, type: FIELD_TYPE.text },
  { name: RUN_FIELDS.env, type: FIELD_TYPE.singleSelect, property: { options: BITABLE_ENV_OPTIONS } },
  { name: RUN_FIELDS.trigger, type: FIELD_TYPE.text },
  { name: RUN_FIELDS.executedAt, type: FIELD_TYPE.dateTime, property: { date_formatter: 'yyyy/MM/dd HH:mm', auto_fill: false } },
  { name: RUN_FIELDS.status, type: FIELD_TYPE.singleSelect, property: { options: BITABLE_STATUS_OPTIONS } },
  { name: RUN_FIELDS.testPassed, type: FIELD_TYPE.checkbox },
  { name: RUN_FIELDS.comparePassed, type: FIELD_TYPE.checkbox },
  { name: RUN_FIELDS.compareSkipped, type: FIELD_TYPE.checkbox },
  { name: RUN_FIELDS.totalSpecs, type: FIELD_TYPE.number, property: { formatter: '0' } },
  { name: RUN_FIELDS.executedCount, type: FIELD_TYPE.number, property: { formatter: '0' } },
  { name: RUN_FIELDS.successCount, type: FIELD_TYPE.number, property: { formatter: '0' } },
  { name: RUN_FIELDS.failCount, type: FIELD_TYPE.number, property: { formatter: '0' } },
  { name: RUN_FIELDS.blockerCount, type: FIELD_TYPE.number, property: { formatter: '0' } },
  { name: RUN_FIELDS.warningCount, type: FIELD_TYPE.number, property: { formatter: '0' } },
  { name: RUN_FIELDS.noiseCount, type: FIELD_TYPE.number, property: { formatter: '0' } },
  { name: RUN_FIELDS.totalIssues, type: FIELD_TYPE.number, property: { formatter: '0' } },
  { name: RUN_FIELDS.goldenCount, type: FIELD_TYPE.number, property: { formatter: '0' } },
  { name: RUN_FIELDS.lastGreenCount, type: FIELD_TYPE.number, property: { formatter: '0' } },
  { name: RUN_FIELDS.crossBrowserCount, type: FIELD_TYPE.number, property: { formatter: '0' } },
  { name: RUN_FIELDS.runDriftCount, type: FIELD_TYPE.number, property: { formatter: '0' } },
  { name: RUN_FIELDS.topRoutes, type: FIELD_TYPE.text },
  { name: RUN_FIELDS.topScripts, type: FIELD_TYPE.text },
  { name: RUN_FIELDS.reportUrl, type: FIELD_TYPE.url },
  { name: RUN_FIELDS.feishuDocUrl, type: FIELD_TYPE.url },
  { name: RUN_FIELDS.failureReasons, type: FIELD_TYPE.text },
  { name: ARCHIVE_FIELD, type: FIELD_TYPE.checkbox },
];

function buildIssueSpecs(runTableId?: string): FieldSpec[] {
  const specs: FieldSpec[] = [
    { name: ISSUE_FIELDS.issueRecordId, type: FIELD_TYPE.text },
    { name: ISSUE_FIELDS.executionId, type: FIELD_TYPE.text },
    { name: ISSUE_FIELDS.runRecordUrl, type: FIELD_TYPE.url },
    { name: ISSUE_FIELDS.issueId, type: FIELD_TYPE.text },
    { name: ISSUE_FIELDS.scriptKey, type: FIELD_TYPE.text },
    { name: ISSUE_FIELDS.scriptShort, type: FIELD_TYPE.text },
    { name: ISSUE_FIELDS.stepNumber, type: FIELD_TYPE.number, property: { formatter: '0' } },
    { name: ISSUE_FIELDS.stepName, type: FIELD_TYPE.text },
    { name: ISSUE_FIELDS.browser, type: FIELD_TYPE.singleSelect, property: { options: [{ name: 'chrome' }, { name: 'webkit' }, { name: 'firefox' }] } },
    { name: ISSUE_FIELDS.compareKind, type: FIELD_TYPE.singleSelect, property: { options: BITABLE_COMPARE_KIND_OPTIONS } },
    { name: ISSUE_FIELDS.severity, type: FIELD_TYPE.singleSelect, property: { options: BITABLE_SEVERITY_OPTIONS } },
    { name: ISSUE_FIELDS.differencePercent, type: FIELD_TYPE.number, property: { formatter: '0.00' } },
    { name: ISSUE_FIELDS.route, type: FIELD_TYPE.text },
    { name: ISSUE_FIELDS.isNewRegression, type: FIELD_TYPE.checkbox },
    { name: ISSUE_FIELDS.source, type: FIELD_TYPE.singleSelect, property: { options: [{ name: 'automated' }, { name: 'manual' }] } },
    { name: ISSUE_FIELDS.reporter, type: FIELD_TYPE.text },
    { name: ISSUE_FIELDS.description, type: FIELD_TYPE.text },
    { name: ISSUE_FIELDS.elementXpath, type: FIELD_TYPE.text },
    { name: ISSUE_FIELDS.elementSelector, type: FIELD_TYPE.text },
    { name: ISSUE_FIELDS.aiDocUrl, type: FIELD_TYPE.url },
    { name: ARCHIVE_FIELD, type: FIELD_TYPE.checkbox },
  ];
  if (runTableId) {
    specs.splice(2, 0, buildIssueLinkFieldSpec(runTableId));
  }
  return specs;
}

const FEEDBACK_SPECS: FieldSpec[] = FEEDBACK_FIELD_SPECS;

const DAILY_SPECS: FieldSpec[] = [
  { name: DAILY_FIELDS.summaryKey, type: FIELD_TYPE.text },
  { name: DAILY_FIELDS.date, type: FIELD_TYPE.dateTime, property: { date_formatter: 'yyyy/MM/dd', auto_fill: false } },
  { name: DAILY_FIELDS.dateText, type: FIELD_TYPE.text },
  { name: DAILY_FIELDS.env, type: FIELD_TYPE.singleSelect, property: { options: BITABLE_ENV_OPTIONS } },
  { name: DAILY_FIELDS.jobId, type: FIELD_TYPE.text },
  { name: DAILY_FIELDS.runCount, type: FIELD_TYPE.number, property: { formatter: '0' } },
  { name: DAILY_FIELDS.successCount, type: FIELD_TYPE.number, property: { formatter: '0' } },
  { name: DAILY_FIELDS.failedCount, type: FIELD_TYPE.number, property: { formatter: '0' } },
  { name: DAILY_FIELDS.passRate, type: FIELD_TYPE.number, property: { formatter: '0.0' } },
  { name: DAILY_FIELDS.blockerCount, type: FIELD_TYPE.number, property: { formatter: '0' } },
  { name: DAILY_FIELDS.warningCount, type: FIELD_TYPE.number, property: { formatter: '0' } },
  { name: DAILY_FIELDS.totalIssues, type: FIELD_TYPE.number, property: { formatter: '0' } },
  { name: DAILY_FIELDS.blockerDelta, type: FIELD_TYPE.number, property: { formatter: '0' } },
  { name: DAILY_FIELDS.warningDelta, type: FIELD_TYPE.number, property: { formatter: '0' } },
  { name: DAILY_FIELDS.totalDelta, type: FIELD_TYPE.number, property: { formatter: '0' } },
  { name: DAILY_FIELDS.avgDifference, type: FIELD_TYPE.number, property: { formatter: '0.00' } },
  { name: DAILY_FIELDS.worstScript, type: FIELD_TYPE.text },
  { name: DAILY_FIELDS.worstRoute, type: FIELD_TYPE.text },
  { name: DAILY_FIELDS.cutoffTime, type: FIELD_TYPE.text },
  { name: DAILY_FIELDS.coveragePct, type: FIELD_TYPE.number, property: { formatter: '0.0' } },
  { name: DAILY_FIELDS.newIssues, type: FIELD_TYPE.number, property: { formatter: '0' } },
  { name: DAILY_FIELDS.closedIssues, type: FIELD_TYPE.number, property: { formatter: '0' } },
  { name: DAILY_FIELDS.remainingIssues, type: FIELD_TYPE.number, property: { formatter: '0' } },
  { name: DAILY_FIELDS.overdueIssues, type: FIELD_TYPE.number, property: { formatter: '0' } },
  { name: DAILY_FIELDS.dataIntegrity, type: FIELD_TYPE.text },
  { name: DAILY_FIELDS.countedExecutions, type: FIELD_TYPE.text },
  { name: ARCHIVE_FIELD, type: FIELD_TYPE.checkbox },
];

const DASHBOARD_CHARTS = [
  {
    title: '① KPI · 当前 UI 通过率',
    table: '日汇总',
    type: '数字卡',
    metric: 'UI通过率',
    agg: '最新值',
    filter: '环境 = uat',
    note: '纵轴 0–100，表示对比项通过率',
  },
  {
    title: '② KPI · 当前阻断问题',
    table: '日汇总',
    type: '数字卡',
    metric: '阻断问题',
    agg: '最新值',
    filter: '环境 = uat',
  },
  {
    title: '③ 趋势 · 阻断 / 警告（按天）',
    table: '日汇总',
    type: '折线图',
    x: '日期文本',
    y: ['阻断问题', '警告问题'],
    filter: '环境 = uat',
    note: '横轴用「日期文本」，不要用「日期」时间字段（飞书折线图常不显示）',
  },
  {
    title: '④ 趋势 · UI 通过率（按天）',
    table: '日汇总',
    type: '折线图',
    x: '日期文本',
    y: ['UI通过率'],
    filter: '环境 = uat',
    note: '横轴用「日期文本」；指标可用最大值或平均值',
  },
  {
    title: '⑤ 最近执行',
    table: '执行记录',
    type: '表格',
    cols: ['环境', '执行时间', '状态', '阻断问题', '警告问题', '高频脚本', '失败原因'],
    sort: '执行时间 降序',
    limit: 8,
    note: '不放「执行ID」「报告链接」：ID 过长，报告链接多为本地路径，看板上看不清',
  },
  {
    title: '⑥ 待处理问题（明细）',
    table: '问题明细',
    type: '表格',
    cols: ['步骤名', '对比类型', '严重度', '差异%', '描述', '脚本简称'],
    sort: '严重度 降序',
    limit: 15,
    filter: '严重度 = 阻断 或 严重度 = 警告',
  },
  {
    title: '⑦ 迭代交付通过率（交付批次）',
    table: 'UI 验收汇总',
    type: '折线图',
    x: '交付时间',
    y: ['通过率%'],
    note: '一行一个交付批次；按「迭代」筛选可对比同一迭代内多次交付的变化',
  },
  {
    title: '⑧ 迭代问题分布（交付批次）',
    table: 'UI 验收汇总',
    type: '堆叠柱状图',
    x: '迭代',
    y: ['需修复数', '无需处理数', '待建基线数'],
    note: '按「迭代」分组，观察各迭代问题构成的变化',
  },
];

const DASHBOARD_AVOID = [
  '不要用「执行记录」的执行时间做趋势图（一次回填会挤在一个点，看不清）',
  '不要同时放 3 个饼图/柱状图（严重度、对比类型、脚本 TOP 信息重复）',
  'Blocker TOP 脚本请用维度「脚本简称」，不要用完整「脚本」路径',
  '筛选环境要与 .env 的 PLAYWRIGHT_ENV 一致（当前多为 uat）',
];

type RoleView = {
  name: string;
  table: string;
  role: string;
  filter: string;
  sort?: string;
  groupBy?: string;
  columns?: string[];
  note?: string;
};

const ROLE_VIEWS: RoleView[] = [
  {
    name: '本轮客户验收',
    table: 'UI 验收明细',
    role: '客户 / 交付负责人',
    filter: '环境 = Stage9084环境；按 delivery_id 筛选当前批次',
    sort: '需处理 降序 → 差异% 降序',
    groupBy: '判定（按问题分类分组：需要修复 → 无需处理 → 待建基线 → 完全一致）',
    columns: ['页面', '判定', '流程', '登录账号', '步骤', '浏览器', '差异', '差异%', '受影响步骤数', '需处理', '判定说明', '验收报告'],
    note: '流程名不含账号；登录账号单独成列，同一流程多账号时可筛选',
  },
  {
    name: '迭代交付对比',
    table: 'UI 验收汇总',
    role: '交付负责人 / 项目经理',
    filter: '全量',
    sort: '交付时间 降序',
    groupBy: '迭代（同迭代内按交付时间排）',
    columns: ['交付时间', '迭代', '环境', '版本标签', '通过率%', '覆盖率%', '发布建议', '报告链接'],
    note: '一行一个交付批次。检测步骤数、已比对数、通过数、无需处理数、需修复数、待建基线数留给仪表盘，默认视图不展示',
  },
  {
    name: '我的待办',
    table: 'UI采集反馈',
    role: '开发 / 测试',
    filter: '处理人 包含当前用户；状态 ≠ 已修复 且 状态 ≠ 忽略',
    sort: '严重度 降序 → 截止时间 升序',
    columns: ['稳定问题ID', '问题描述', '严重度', '状态', '截止时间', '处理人', '环境'],
    note: '飞书多维表「我的待办」视图需配合人员字段；当前用「处理人」文本字段模拟',
  },
  {
    name: '问题分诊看板',
    table: 'UI采集反馈',
    role: 'QA / 研发负责人',
    filter: '全量未修复',
    groupBy: '状态（待处理 → 处理中 → 已修复 → 忽略 → 待确认）',
    sort: '严重度 降序',
    columns: ['稳定问题ID', '问题描述', '严重度', '环境', '处理人', '首次发现', '最近发现', '截止时间'],
    note: '分组看板用于快速识别积压状态',
  },
  {
    name: '待确认与逾期',
    table: 'UI采集反馈',
    role: 'QA / 项目经理',
    filter: '状态 = 待确认；或 截止时间 < 当前时间 且 状态 ≠ 已修复 且 状态 ≠ 忽略',
    sort: '截止时间 升序',
    columns: ['稳定问题ID', '问题描述', '严重度', '状态', '截止时间', '处理人', '确认运行'],
    note: '逾期项需标红提醒；确认通过后关联运行链接',
  },
  {
    name: '待补基线 / 缺测',
    table: '执行记录',
    role: '测试维护人员',
    filter: 'goldenCount < totalSpecs 或 executedCount < totalSpecs',
    sort: '执行时间 降序',
    columns: ['执行时间', '环境', '状态', 'goldenCount', 'totalSpecs', 'executedCount', 'failureReasons'],
    note: '定位缺失基线和未覆盖步骤，指导补充种子截图',
  },
  {
    name: '运行与投递审计',
    table: '执行记录',
    role: '维护人员',
    filter: '全量',
    sort: '执行时间 降序',
    columns: ['执行时间', '环境', '状态', 'testPassed', 'comparePassed', 'totalIssues', 'reportUrl', 'feishuDocUrl'],
    note: '全量运行事实，含失败原因和报告链接；用于排查同步/发布异常',
  },
  {
    name: '周度质量看板',
    table: '日汇总',
    role: '项目负责人',
    filter: '环境 = stage9084；最近 30 天',
    sort: '日期 降序',
    columns: ['日期文本', 'UI通过率', '覆盖率', '阻断问题', '警告问题', '新增问题', '关闭问题', '遗留问题', '逾期问题', '数据截止'],
    note: '趋势需配合仪表盘折线图；此处提供表格形式的明细数据',
  },
];

async function main(): Promise<void> {
  const fixFields = process.argv.includes('--fix-fields');
  const config = loadBitableRuntimeConfig();
  if (!config) {
    console.log(`❌ ${explainMissingBitableConfig()}`);
    process.exit(1);
  }

  const client = new BitableClient(config);
  console.log('\n📋 飞书多维表质量看板 Setup\n');

  const tables = [
    { label: '执行记录', id: config.runTableId, specs: RUN_SPECS },
    { label: '问题明细', id: config.issueTableId, specs: buildIssueSpecs(config.runTableId) },
    { label: '日汇总', id: config.dailySummaryTableId, specs: DAILY_SPECS },
    { label: 'UI采集反馈', id: config.feedbackTableId, specs: FEEDBACK_SPECS },
    { label: DELIVERY_TABLE_NAME, id: config.deliveryTableId, specs: DELIVERY_FIELD_SPECS },
    { label: DELIVERY_SUMMARY_TABLE_NAME, id: config.deliverySummaryTableId, specs: DELIVERY_SUMMARY_FIELD_SPECS },
  ];

  for (const table of tables) {
    if (!table.id) {
      console.log(`⚠️  ${table.label}：未配置 tableId，跳过`);
      continue;
    }
    const fields = await client.listFields(table.id);
    const names = new Set(fields.map((item) => item.field_name));
    const missing = table.specs.filter((spec) => !names.has(spec.name));
    console.log(`✅ ${table.label}（${table.id}）：${fields.length} 字段`);
    if (missing.length) {
      console.log(`   缺失 ${missing.length} 字段: ${missing.map((item) => item.name).join(', ')}`);
      if (fixFields) {
        for (const spec of missing) {
          await client.createField(table.id, spec);
          console.log(`   ➕ 已创建字段: ${spec.name}`);
        }
      }
    } else {
      console.log('   字段完整');
    }
  }

  const dashboards = await client.listDashboards();
  console.log(`\n📈 仪表盘（${dashboards.length} 个）`);
  if (!dashboards.length) {
    console.log('   尚未创建仪表盘，请按下方步骤在飞书 UI 手动新建');
  } else {
    for (const item of dashboards) {
      const url = buildDashboardUrl(config.appToken, item.block_id);
      console.log(`   · ${item.name} (${item.block_id})`);
      console.log(`     ${url}`);
    }
    const primary = dashboards[0]!;
    console.log(`\n💡 建议写入 .env:`);
    console.log(`FEISHU_BITABLE_DASHBOARD_URL=${buildDashboardUrl(config.appToken, primary.block_id)}`);
  }

  console.log('\n── 在飞书 UI 创建仪表盘 ──\n');
  console.log('1. 打开多维表格 → 左下角「+」→ 新建「仪表盘」→ 命名「UI 质量看板」');
  console.log('2. 点击「添加图表」，按下面配置逐个添加：\n');
  for (const chart of DASHBOARD_CHARTS) {
    console.log(`### ${chart.title}`);
    console.log(`   数据源：${chart.table}`);
    console.log(`   图表类型：${chart.type}`);
    if ('x' in chart && chart.x) console.log(`   横轴/维度：${chart.x}`);
    if ('y' in chart && chart.y) console.log(`   纵轴/指标：${(chart.y as string[]).join('、')}`);
    if ('dim' in chart && chart.dim) console.log(`   维度：${chart.dim}`);
    if ('metric' in chart && chart.metric) console.log(`   指标：${chart.metric}`);
    if ('cols' in chart && chart.cols) console.log(`   列：${(chart.cols as string[]).join('、')}`);
    if ('filter' in chart && chart.filter) console.log(`   筛选：${chart.filter}`);
    if ('sort' in chart && chart.sort) console.log(`   排序：${chart.sort}`);
    if ('limit' in chart && chart.limit) console.log(`   条数：${chart.limit}`);
    if ('agg' in chart && chart.agg) console.log(`   聚合：${chart.agg}`);
    if ('note' in chart && chart.note) console.log(`   说明：${chart.note}`);
    console.log('');
  }

  console.log('── 建议删除或替换的图表 ──\n');
  for (const item of DASHBOARD_AVOID) {
    console.log(`   · ${item}`);
  }

  console.log('\n── 角色视图（在飞书多维表各数据表中新建）──\n');
  for (const view of ROLE_VIEWS) {
    console.log(`### ${view.name}`);
    console.log(`   数据表：${view.table}`);
    console.log(`   使用者：${view.role}`);
    console.log(`   筛选：${view.filter}`);
    if (view.sort) console.log(`   排序：${view.sort}`);
    if (view.groupBy) console.log(`   分组：${view.groupBy}`);
    if (view.columns) console.log(`   列：${view.columns.join('、')}`);
    if (view.note) console.log(`   说明：${view.note}`);
    console.log('');
  }

  console.log('3. 保存后复制仪表盘 URL（含 blk 开头 block_id）到 FEISHU_BITABLE_DASHBOARD_URL');
  console.log('4. 列名/字段: npm run feishu:bitable-setup -- --fix-fields && npm run feishu:bitable');
  console.log('5. 历史趋势: npm run feishu:bitable-backfill -- --apply\n');
}

function buildDashboardUrl(appToken: string, blockId: string): string {
  return `https://feishu.cn/base/${appToken}?block=${blockId}`;
}

main().catch((error: unknown) => {
  console.error('❌ setup 失败:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
