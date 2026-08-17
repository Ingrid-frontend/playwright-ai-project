#!/usr/bin/env tsx
/**
 * 飞书多维表：字段校验 + 仪表盘发现 + 搭建指引
 *
 * 用法:
 *   npm run feishu:bitable-setup
 *   npm run feishu:bitable-setup -- --fix-fields   # 自动补缺失字段
 */
import dotenv from 'dotenv';
import {
  BitableClient,
  DAILY_FIELDS,
  ISSUE_FIELDS,
  RUN_FIELDS,
  explainMissingBitableConfig,
  loadBitableRuntimeConfig,
} from './index.js';

dotenv.config();

type FieldSpec = {
  name: string;
  type: number;
  property?: Record<string, unknown>;
};

type FieldItem = { field_id: string; field_name: string; type: number };

const FIELD_TYPE: Record<string, number> = {
  text: 1,
  number: 2,
  singleSelect: 3,
  dateTime: 5,
  checkbox: 7,
  url: 15,
};

const RUN_SPECS: FieldSpec[] = [
  { name: RUN_FIELDS.executionId, type: FIELD_TYPE.text },
  { name: RUN_FIELDS.jobId, type: FIELD_TYPE.text },
  { name: RUN_FIELDS.env, type: FIELD_TYPE.singleSelect, property: { options: [{ name: 'stage' }, { name: 'uat' }, { name: 'dev' }] } },
  { name: RUN_FIELDS.trigger, type: FIELD_TYPE.text },
  { name: RUN_FIELDS.executedAt, type: FIELD_TYPE.dateTime, property: { date_formatter: 'yyyy/MM/dd HH:mm', auto_fill: false } },
  { name: RUN_FIELDS.status, type: FIELD_TYPE.singleSelect, property: { options: [{ name: 'success' }, { name: 'failed' }, { name: 'aborted' }, { name: 'skipped' }] } },
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
];

const ISSUE_SPECS: FieldSpec[] = [
  { name: ISSUE_FIELDS.issueRecordId, type: FIELD_TYPE.text },
  { name: ISSUE_FIELDS.executionId, type: FIELD_TYPE.text },
  { name: ISSUE_FIELDS.issueId, type: FIELD_TYPE.text },
  { name: ISSUE_FIELDS.scriptKey, type: FIELD_TYPE.text },
  { name: ISSUE_FIELDS.stepNumber, type: FIELD_TYPE.number, property: { formatter: '0' } },
  { name: ISSUE_FIELDS.stepName, type: FIELD_TYPE.text },
  { name: ISSUE_FIELDS.browser, type: FIELD_TYPE.singleSelect, property: { options: [{ name: 'chrome' }, { name: 'webkit' }, { name: 'firefox' }] } },
  { name: ISSUE_FIELDS.compareKind, type: FIELD_TYPE.singleSelect, property: { options: [{ name: 'golden' }, { name: 'last-green' }, { name: 'cross-browser' }, { name: 'run-drift' }] } },
  { name: ISSUE_FIELDS.severity, type: FIELD_TYPE.singleSelect, property: { options: [{ name: 'blocker' }, { name: 'warning' }, { name: 'noise' }] } },
  { name: ISSUE_FIELDS.difference, type: FIELD_TYPE.number, property: { formatter: '0.0000' } },
  { name: ISSUE_FIELDS.differencePercent, type: FIELD_TYPE.number, property: { formatter: '0.00' } },
  { name: ISSUE_FIELDS.route, type: FIELD_TYPE.text },
  { name: ISSUE_FIELDS.isNewRegression, type: FIELD_TYPE.checkbox },
  { name: ISSUE_FIELDS.baselinePath, type: FIELD_TYPE.text },
  { name: ISSUE_FIELDS.currentPath, type: FIELD_TYPE.text },
  { name: ISSUE_FIELDS.diffImagePath, type: FIELD_TYPE.text },
];

const DAILY_SPECS: FieldSpec[] = [
  { name: DAILY_FIELDS.summaryKey, type: FIELD_TYPE.text },
  { name: DAILY_FIELDS.date, type: FIELD_TYPE.dateTime, property: { date_formatter: 'yyyy/MM/dd', auto_fill: false } },
  { name: DAILY_FIELDS.env, type: FIELD_TYPE.singleSelect, property: { options: [{ name: 'stage' }, { name: 'uat' }, { name: 'dev' }] } },
  { name: DAILY_FIELDS.jobId, type: FIELD_TYPE.text },
  { name: DAILY_FIELDS.runCount, type: FIELD_TYPE.number, property: { formatter: '0' } },
  { name: DAILY_FIELDS.successCount, type: FIELD_TYPE.number, property: { formatter: '0' } },
  { name: DAILY_FIELDS.failedCount, type: FIELD_TYPE.number, property: { formatter: '0' } },
  { name: DAILY_FIELDS.passRate, type: FIELD_TYPE.number, property: { formatter: '0.00' } },
  { name: DAILY_FIELDS.blockerCount, type: FIELD_TYPE.number, property: { formatter: '0' } },
  { name: DAILY_FIELDS.warningCount, type: FIELD_TYPE.number, property: { formatter: '0' } },
  { name: DAILY_FIELDS.totalIssues, type: FIELD_TYPE.number, property: { formatter: '0' } },
  { name: DAILY_FIELDS.blockerDelta, type: FIELD_TYPE.number, property: { formatter: '0' } },
  { name: DAILY_FIELDS.warningDelta, type: FIELD_TYPE.number, property: { formatter: '0' } },
  { name: DAILY_FIELDS.totalDelta, type: FIELD_TYPE.number, property: { formatter: '0' } },
  { name: DAILY_FIELDS.avgDifference, type: FIELD_TYPE.number, property: { formatter: '0.00' } },
  { name: DAILY_FIELDS.worstScript, type: FIELD_TYPE.text },
  { name: DAILY_FIELDS.worstRoute, type: FIELD_TYPE.text },
];

const DASHBOARD_CHARTS = [
  {
    title: '① 日汇总 · Blocker / Warning 趋势',
    table: '日汇总',
    type: '折线图',
    x: 'date',
    y: ['blocker_count', 'warning_count'],
    filter: 'env = stage',
  },
  {
    title: '② 日汇总 · 通过率',
    table: '日汇总',
    type: '折线图',
    x: 'date',
    y: ['pass_rate'],
    filter: 'env = stage',
  },
  {
    title: '③ 执行记录 · 最近运行状态',
    table: '执行记录',
    type: '表格',
    cols: ['executed_at', 'status', 'blocker_count', 'warning_count', 'report_url'],
    sort: 'executed_at 降序',
    limit: 10,
  },
  {
    title: '④ 问题明细 · 严重度分布',
    table: '问题明细',
    type: '饼图',
    dim: 'severity',
    metric: '记录数',
  },
  {
    title: '⑤ 问题明细 · 脚本 TOP10',
    table: '问题明细',
    type: '柱状图',
    dim: 'script_key',
    metric: '记录数',
    filter: 'severity = blocker',
    limit: 10,
  },
  {
    title: '⑥ 问题明细 · 对比类型',
    table: '问题明细',
    type: '柱状图',
    dim: 'compare_kind',
    metric: '记录数',
  },
  {
    title: '⑦ 执行记录 · 对比类型计数',
    table: '执行记录',
    type: '堆叠柱状图',
    x: 'executed_at（按天）',
    y: ['golden_count', 'cross_browser_count', 'run_drift_count'],
  },
  {
    title: '⑧ KPI · 最新 Blocker 数',
    table: '日汇总',
    type: '数字卡',
    metric: 'blocker_count',
    agg: '最新值',
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
    { label: '问题明细', id: config.issueTableId, specs: ISSUE_SPECS },
    { label: '日汇总', id: config.dailySummaryTableId, specs: DAILY_SPECS },
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
    console.log('');
  }

  console.log('3. 保存后复制仪表盘 URL（含 blk 开头 block_id）到 FEISHU_BITABLE_DASHBOARD_URL');
  console.log('4. 重新 npm run feishu:bitable 写入数据，卡片/报告链接会指向该看板\n');
}

function buildDashboardUrl(appToken: string, blockId: string): string {
  return `https://feishu.cn/base/${appToken}?block=${blockId}`;
}

main().catch((error: unknown) => {
  console.error('❌ setup 失败:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
