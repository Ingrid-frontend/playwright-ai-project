import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  appendDeliveryHistory,
  readDeliveryHistory,
  buildDeliveryTrend,
} from '../report/customer-delivery-history.js';
import {
  deriveStableIssueId,
  recordRetestAttempt,
  readRetestTrace,
  buildRetestSummary,
  formatRetestSummary,
} from '../feishu/retest-trace.js';
import { buildCustomerReportMarkdown } from '../report/export-customer-report-markdown.js';
import { runDeliveryGate, formatGateResult } from '../feishu/delivery-gate.js';
import {
  buildCustomerDeliveryPayload, computeContentHash, assertDeliveryContentHash,
  readCustomerDeliveryPayload, writeCustomerDeliveryPayload, SNAPSHOT_VERSION, type DeliveryPayload,
} from '../report/customer-delivery-payload.js';
import { buildCoverageStats } from '../report/coverage-stats.js';
import { buildCustomerReportModel } from '../report/customer-report-model.js';
import { renderCustomerReportHtml } from '../report/customer-report-render.js';
import { checkReview, writeReview } from '../feishu/delivery-review.js';
import { writeDeliveryRecords } from '../feishu/bitable-delivery.js';
import { buildDeliverySummaryRecord, writeDeliverySummaryRecord } from '../feishu/bitable-delivery-summary.js';
import { DELIVERY_SUMMARY_FIELDS } from '../feishu/bitable-schema.js';
import { BitableClient } from '../feishu/bitable-client.js';

function pass(name: string) {
  console.log(`  ✓ ${name}`);
}

// ── 临时目录隔离 ───────────────────────────────────────────
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-upgrade-'));
const origCwd = process.cwd();

// 每个模块测试前切到独立子目录，避免文件互相覆盖
function isolatedDir(label: string): string {
  const dir = path.join(tmpRoot, label);
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, 'results'), { recursive: true });
  return dir;
}

// ── M7: customer-delivery-history ──────────────────────────
{
  const dir = isolatedDir('history');
  process.chdir(dir);

  const makePayload = (overrides: Partial<DeliveryPayload> = {}): DeliveryPayload => ({
    version: 1,
    snapshotVersion: SNAPSHOT_VERSION,
    runId: 'history-run',
    deliveryId: 'test-delivery-1',
    generatedAt: '2026-09-20T10:00:00.000Z',
    envId: 'stage9084',
    envLabel: 'Stage9084环境',
    contentHash: 'abc123',
    headline: '测试结论',
    shipAdvice: 'ship',
    shipAdviceLabel: '可发布',
    releaseTag: '',
    deliveryReady: true,
    totalIssueCount: 0,
    totalSampleCount: 0,
    items: [],
    actionItems: [],
    uncoveredList: [],
    stats: {
      expectedSteps: 20,
      comparedSteps: 18,
      passSteps: 15,
      regressSteps: 1,
      minorSteps: 2,
      degradedSteps: 1,
      benignSteps: 1,
      uncoveredSteps: 2,
      coveragePct: 90,
      passRate: 83,
    },
    ...overrides,
  });

  // append + read
  appendDeliveryHistory(makePayload());
  const entries = readDeliveryHistory('stage9084');
  assert.equal(entries.length, 1);
  assert.equal(entries[0]!.deliveryId, 'test-delivery-1');
  assert.equal(entries[0]!.stats.comparedSteps, 18);
  pass('appendDeliveryHistory + readDeliveryHistory');

  // dedup by deliveryId
  appendDeliveryHistory(makePayload());
  assert.equal(readDeliveryHistory('stage9084').length, 1, '相同 deliveryId 应去重');
  pass('deliveryId 去重');

  // 第二条不同 entry
  appendDeliveryHistory(makePayload({
    deliveryId: 'test-delivery-2',
    generatedAt: '2026-09-21T10:00:00.000Z',
    stats: { ...makePayload().stats, regressSteps: 0, passRate: 90, coveragePct: 95 },
  }));
  const two = readDeliveryHistory('stage9084');
  assert.equal(two.length, 2);
  pass('多条 entry 按时间排序');

  // trend
  const trend = buildDeliveryTrend('stage9084');
  assert.equal(trend.entries.length, 2);
  assert.equal(trend.current!.deliveryId, 'test-delivery-2');
  assert.equal(trend.previous!.deliveryId, 'test-delivery-1');
  assert.equal(trend.regressDelta, -1, '衰退应从 1 → 0');
  assert.equal(trend.passRateDelta, 7, '通过率应从 83 → 90');
  assert.equal(trend.coverageDelta, 5, '覆盖率应从 90 → 95');
  pass('buildDeliveryTrend 计算 delta');

  // 空环境返回空
  assert.equal(buildDeliveryTrend('nonexistent').entries.length, 0);
  pass('空环境 trend 返回空');

  // 滑动窗口 30 条
  for (let i = 3; i <= 35; i++) {
    appendDeliveryHistory(makePayload({
      deliveryId: `test-delivery-${i}`,
      generatedAt: `2026-09-${String(Math.min(28, 20 + Math.floor(i / 3))).padStart(2, '0')}T${String(i % 24).padStart(2, '0')}:00:00.000Z`,
    }));
  }
  const capped = readDeliveryHistory('stage9084');
  assert.ok(capped.length <= 30, `应 ≤ 30 条，实际 ${capped.length}`);
  pass('滑动窗口 ≤ 30 条');

  process.chdir(origCwd);
}

// ── M8: retest-trace ───────────────────────────────────────
{
  const dir = isolatedDir('retest');
  process.chdir(dir);

  // deriveStableIssueId 确定性
  const id1 = deriveStableIssueId('stage9084', '审批流程', '首页', 'chrome', '按钮溢出');
  const id2 = deriveStableIssueId('stage9084', '审批流程', '首页', 'chrome', '按钮溢出');
  const id3 = deriveStableIssueId('stage9084', '审批流程', '首页', 'chrome', '不同的标题');
  assert.equal(id1, id2, '同输入应同 id');
  assert.notEqual(id1, id3, '不同输入应不同 id');
  assert.equal(id1.length, 16, 'stableIssueId 应为 16 位 hex');
  pass('deriveStableIssueId 确定性 + 16 位');

  // recordRetestAttempt 首次
  const entry = recordRetestAttempt({
    stableIssueId: id1,
    envId: 'stage9084',
    scriptLabel: '审批流程',
    stepLabel: '首页',
    browserLabel: 'chrome',
    title: '按钮溢出',
    runId: 'run-001',
    verdict: 'still-present',
    notes: '首次复验仍存在',
  });
  assert.equal(entry.attempts.length, 1);
  assert.equal(entry.attempts[0]!.attemptIndex, 1);
  assert.equal(entry.attempts[0]!.verdict, 'still-present');
  assert.equal(entry.resolvedAt, undefined);
  pass('recordRetestAttempt 首次记录');

  // 第二次 resolved
  const resolved = recordRetestAttempt({
    stableIssueId: id1,
    envId: 'stage9084',
    scriptLabel: '审批流程',
    stepLabel: '首页',
    browserLabel: 'chrome',
    title: '按钮溢出',
    runId: 'run-002',
    verdict: 'resolved',
  });
  assert.equal(resolved.attempts.length, 2);
  assert.equal(resolved.attempts[1]!.attemptIndex, 2);
  assert.ok(resolved.resolvedAt, 'resolved 后应有 resolvedAt');
  assert.equal(resolved.resolvedByRunId, 'run-002');
  pass('recordRetestAttempt resolved 自动设 resolvedAt');

  // readRetestTrace
  const all = readRetestTrace();
  assert.equal(all.length, 1);
  const byId = readRetestTrace(id1);
  assert.equal(byId.length, 1);
  assert.equal(byId[0]!.stableIssueId, id1);
  pass('readRetestTrace 按 id 查询');

  // buildRetestSummary
  const summary = buildRetestSummary();
  assert.equal(summary.totalTracked, 1);
  assert.equal(summary.resolved, 1);
  assert.equal(summary.stillPresent, 0);
  assert.equal(summary.avgAttemptsToResolve, 2);
  pass('buildRetestSummary 统计正确');

  // formatRetestSummary
  const formatted = formatRetestSummary(summary);
  assert.match(formatted, /复验追踪/);
  assert.match(formatted, /已解决 1/);
  pass('formatRetestSummary 输出格式');

  // resolved 后再追加 still-present → 清除 resolvedAt
  const reopened = recordRetestAttempt({
    stableIssueId: id1,
    envId: 'stage9084',
    scriptLabel: '审批流程',
    stepLabel: '首页',
    browserLabel: 'chrome',
    title: '按钮溢出',
    runId: 'run-003',
    verdict: 'still-present',
  });
  assert.equal(reopened.resolvedAt, undefined, 'still-present 应清除 resolvedAt');
  assert.equal(reopened.resolvedByRunId, undefined);
  const summary2 = buildRetestSummary();
  assert.equal(summary2.resolved, 0);
  assert.equal(summary2.stillPresent, 1);
  pass('still-present 清除 resolved 状态');

  process.chdir(origCwd);
}

// ── M6: export-customer-report-markdown ────────────────────
{
  const mockPayload: DeliveryPayload = {
    version: 1,
    snapshotVersion: SNAPSHOT_VERSION,
    runId: 'markdown-run',
    deliveryId: 'md-test',
    generatedAt: '2026-09-21T08:00:00.000Z',
    envId: 'dev',
    envLabel: 'DEV环境',
    contentHash: 'def456',
    headline: '发现 2 个需要修复的问题',
    shipAdvice: 'hold',
    shipAdviceLabel: '建议修复后发布',
    releaseTag: '1.2.3',
    deliveryReady: true,
    totalIssueCount: 2,
    totalSampleCount: 0,
    items: [
      {
        key: 'item-1',
        dedupeKey: 'd-1',
        kind: 'regress' as const,
        verdictLabel: '需修复',
        title: '审批列表页 · 按钮溢出',
        scriptLabel: 'DEV环境 · 审批流程',
        stepLabel: '审批列表',
        stepNumber: 3,
        browserLabel: 'Chrome',
        differenceLabel: '3.2%',
        reason: '页面右侧按钮超出视口',
        plainText: '提交按钮在 1280px 视口下被截断',
        affectedSteps: 1,
        actionable: true,
        images: [{ role: 'current' as const, label: '当前', relPath: 'img1.png' }],
      },
      {
        key: 'item-2',
        dedupeKey: 'd-2',
        kind: 'minor' as const,
        verdictLabel: '需确认',
        title: '工作台 · 间距偏差',
        scriptLabel: 'DEV环境 · 工作台',
        stepLabel: '首页',
        stepNumber: 1,
        browserLabel: 'Chrome',
        differenceLabel: '0.8%',
        reason: '卡片间距偏小 2px',
        plainText: '',
        affectedSteps: 1,
        actionable: false,
        images: [],
      },
    ],
    actionItems: ['修复审批列表页按钮溢出', '确认工作台间距是否可接受'],
    uncoveredList: [
      { title: '报销详情', scriptLabel: 'DEV环境 · 报销流程', stepLabel: '报销详情', stepNumber: 5 },
    ],
    stats: {
      expectedSteps: 20,
      comparedSteps: 18,
      passSteps: 15,
      regressSteps: 1,
      minorSteps: 1,
      degradedSteps: 1,
      benignSteps: 0,
      uncoveredSteps: 2,
      coveragePct: 90,
      passRate: 83,
    },
    trend: {
      entries: [
        {
          generatedAt: '2026-09-20T08:00:00.000Z',
          deliveryId: 'prev',
          envId: 'dev',
          contentHash: 'old',
          stats: { expectedSteps: 20, comparedSteps: 16, passSteps: 14, regressSteps: 2, minorSteps: 0, degradedSteps: 0, benignSteps: 0, coveragePct: 80, passRate: 70 },
          verdict: '旧结论',
          shipAdvice: 'hold',
        },
        {
          generatedAt: '2026-09-21T08:00:00.000Z',
          deliveryId: 'md-test',
          envId: 'dev',
          contentHash: 'def456',
          stats: { expectedSteps: 20, comparedSteps: 18, passSteps: 15, regressSteps: 1, minorSteps: 1, degradedSteps: 1, benignSteps: 0, coveragePct: 90, passRate: 83 },
          verdict: '新结论',
          shipAdvice: 'hold',
        },
      ],
      current: {
          generatedAt: '2026-09-21T08:00:00.000Z',
          deliveryId: 'md-test',
          envId: 'dev',
          contentHash: 'def456',
          stats: { expectedSteps: 20, comparedSteps: 18, passSteps: 15, regressSteps: 1, minorSteps: 1, degradedSteps: 1, benignSteps: 0, coveragePct: 90, passRate: 83 },
          verdict: '新结论',
          shipAdvice: 'hold',
        },
        previous: {
          generatedAt: '2026-09-20T08:00:00.000Z',
          deliveryId: 'prev',
          envId: 'dev',
          contentHash: 'old',
          stats: { expectedSteps: 20, comparedSteps: 16, passSteps: 14, regressSteps: 2, minorSteps: 0, degradedSteps: 0, benignSteps: 0, coveragePct: 80, passRate: 70 },
          verdict: '旧结论',
          shipAdvice: 'hold',
        },
        regressDelta: -1,
        passRateDelta: 13,
        coverageDelta: 10,
    },
  };

  const md = buildCustomerReportMarkdown(mockPayload);

  // 统计区
  assert.match(md, /发现 2 个需要修复的问题/);
  assert.match(md, /DEV环境/);
  assert.match(md, /v1\.2\.3/);
  assert.match(md, /检测覆盖：90%/);
  assert.match(md, /需要修复 1 步/);
  assert.match(md, /待建基线 2 步/);
  pass('Markdown 统计区');

  // 趋势表
  assert.match(md, /近期待续/);
  assert.match(md, /\| 日期 \| 覆盖率/);
  assert.match(md, /覆盖率 ↑/);
  pass('Markdown 趋势表');

  // 问题清单
  assert.match(md, /问题清单/);
  assert.match(md, /\[需修复\] 审批列表页/);
  assert.match(md, /\[需确认\] 工作台/);
  assert.match(md, /附 1 张证据图/);
  pass('Markdown 问题清单');

  // 建议操作
  assert.match(md, /建议操作/);
  assert.match(md, /修复审批列表页按钮溢出/);
  pass('Markdown 建议操作');

  // 待建基线
  assert.match(md, /待建基线/);
  assert.match(md, /报销详情/);
  pass('Markdown 待建基线');

  process.chdir(origCwd);
}

// ── M4: delivery-gate retest-trace check ───────────────────
{
  const dir = isolatedDir('gate');
  process.chdir(dir);
  const originalRunEnv = { TEST_RUN_ID: process.env.TEST_RUN_ID, FLOW_REPORT_BATCH_ID: process.env.FLOW_REPORT_BATCH_ID };
  delete process.env.TEST_RUN_ID;
  delete process.env.FLOW_REPORT_BATCH_ID;

  try {
    const runId = new Date(Date.now() - 60_000).toISOString().replace(/[:.]/g, '-');
    const script = 'flows/uat/offline';
    const current = path.join(dir, 'screenshots', script, 'run-chromium-optimized', runId, 'step-1-home.png');
    fs.mkdirSync(path.dirname(current), { recursive: true });
    const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
    fs.writeFileSync(current, image);
    const coverage = {
      ...buildCoverageStats([]), expectedSteps: 1, comparedSteps: 1, regressSteps: 1,
      slots: [{
        scriptKey: script, stepNumber: 1, stepName: 'home', browser: 'chrome',
        status: 'regress' as const, difference: 0.1, pageTitle: '首页', processOnly: false,
        currentPath: current, baselinePath: current,
      }],
    };
    const sources = new Map([[script, runId]]);
    const model = buildCustomerReportModel(coverage, new Date().toISOString(),
      new Map([[script, { scriptKey: script, runId: 'latest-incomplete-run' }]]));
    const payload = buildCustomerDeliveryPayload(model, { envId: 'uat', deliveryReady: true, sourceRunIds: sources });
    assert.equal(payload.runId, runId, '顶层 runId 应采用选定完整轮，不能取最新未完成轮');
    assert.deepEqual(payload.sourceRunIds, { [script]: runId });
    assert.equal(payload.snapshotVersion, SNAPSHOT_VERSION);
    assert.equal(payload.contentHash, computeContentHash(payload));
    writeCustomerDeliveryPayload(payload);
    assert.equal(assertDeliveryContentHash(readCustomerDeliveryPayload()!), payload.contentHash);
    const gate = runDeliveryGate(payload);
    assert.ok(gate.passed, formatGateResult(gate));
    const check = (p: DeliveryPayload, name: string) => runDeliveryGate(p).checks.find((c) => c.name === name)!;
    assert.match(check(payload, 'retest-trace').detail, /无复验追踪记录/);
    assert.match(formatGateResult(gate), /retest-trace/);

    assert.throws(() => buildCustomerDeliveryPayload(model, {
      envId: 'uat', deliveryReady: true, sourceRunIds: new Map([[script, 'wrong-run']]),
    }), /源运行与比较证据不匹配/);
    for (const changed of [
      { ...payload, runId: '' }, { ...payload, snapshotVersion: 0 },
      { ...payload, generatedAt: 'invalid' }, { ...payload, deliveryId: 'wrong-identity' },
    ]) assert.equal(check(changed, 'snapshot-identity').passed, false);
    const sourceCases: Array<DeliveryPayload['sourceRunIds']> = [undefined, {}, { [script]: 'wrong-run' }, { 'flows/dev/offline': runId }];
    for (const sourceRunIds of sourceCases) {
      assert.equal(check({ ...payload, sourceRunIds }, 'source-runs').passed, false);
    }
    assert.equal(check({ ...payload, contentHash: '' }, 'content-hash').passed, false);

    // apply 即使显式跳过人工审核，也不能跳过真实哈希门禁或触发任何网络调用。
    const { main: applyDelivery } = await import('../feishu/deliver-customer-report.js');
    const originalArgv = process.argv;
    const originalExit = process.exit;
    const originalFetch = globalThis.fetch;
    let networkCalls = 0;
    try {
      writeCustomerDeliveryPayload({ ...payload, headline: '篡改的未审核结论' });
      process.argv = ['node', 'offline-delivery', '--apply', '--env=uat', '--skip-review', '--payload=results/customer-delivery.json'];
      process.exit = ((code?: number) => { throw new Error(`offline-exit:${code}`); }) as typeof process.exit;
      globalThis.fetch = async () => { networkCalls += 1; throw new Error('禁止线上请求'); };
      await assert.rejects(applyDelivery(), /offline-exit:1/);
      assert.equal(networkCalls, 0);
      assert.equal(fs.existsSync('results/feishu-delivery-preview.html'), false);
      assert.equal(fs.existsSync('results/feishu-delivery-result.json'), false);
    } finally {
      process.argv = originalArgv;
      process.exit = originalExit;
      globalThis.fetch = originalFetch;
      writeCustomerDeliveryPayload(payload);
    }
    for (const stale of ['invalid', '2020-01-01T00-00-00-000Z', '2099-01-01T00-00-00-000Z']) {
      const changed = { ...payload, generatedAt: new Date().toISOString(), sourceRunIds: { [script]: stale } };
      changed.contentHash = computeContentHash(changed);
      assert.equal(check(changed, 'freshness').passed, false, '重生成时间不能替代源执行时间');
    }

    // 超过 20 个根因组照常进入主载荷及多维表；根因组数不是步骤数。
    const representative = model.regressionGroups[0]!.representative;
    const groups = Array.from({ length: 27 }, (_, i) => ({
      ...model.regressionGroups[0]!, groupKey: `group-${i}`, affectedSteps: 2,
      representative: { ...representative, pageKey: `${script}::${i + 1}::home`, stepNumber: i + 1,
        worstStatus: i < 22 ? 'regress' as const : 'minor' as const },
    }));
    const manyModel = { ...model, regressionGroups: groups.slice(0, 22), minorGroups: groups.slice(22) };
    const many = buildCustomerDeliveryPayload(manyModel, { envId: 'uat', sourceRunIds: sources, maxItems: 1 });
    assert.equal(many.items.length, 27);
    assert.equal(many.totalIssueCount, 27);
    assert.equal(many.items.reduce((n, item) => n + item.affectedSteps, 0), 54);
    assert.equal(buildCustomerDeliveryPayload(manyModel, { maxItems: 0 }).totalIssueCount, 27);
    class OfflineBitable extends BitableClient {
      keys: string[] = [];
      override async upsertRecord(...args: Parameters<BitableClient['upsertRecord']>) {
        this.keys.push(args[2]);
        return { recordId: `offline-${this.keys.length}`, created: true };
      }
    }
    const client = new OfflineBitable({ appId: 'offline', appSecret: 'offline', appToken: 'offline', runTableId: 'offline' });
    const written = await writeDeliveryRecords(client, 'offline', many, { tokens: new Map() });
    assert.equal(written.created, 27);
    assert.equal(new Set(client.keys).size, 27);
    // 批次汇总：一行一个 deliveryId，stats 全量映射 + 0-1 通过率换算 + upsert 键
    const summaryFields = buildDeliverySummaryRecord(many, { docUrl: 'https://example.invalid/doc' });
    assert.equal(summaryFields[DELIVERY_SUMMARY_FIELDS.deliveryId], many.deliveryId);
    assert.equal(summaryFields[DELIVERY_SUMMARY_FIELDS.regressSteps], many.stats.regressSteps);
    assert.equal(summaryFields[DELIVERY_SUMMARY_FIELDS.uncoveredSteps], many.stats.uncoveredSteps);
    assert.equal(summaryFields[DELIVERY_SUMMARY_FIELDS.totalIssueCount], many.totalIssueCount);
    assert.equal(typeof summaryFields[DELIVERY_SUMMARY_FIELDS.deliveredAt], 'number');
    if (typeof many.stats.passRate === 'number') {
      assert.ok(
        Math.abs((summaryFields[DELIVERY_SUMMARY_FIELDS.passRate] as number) - many.stats.passRate * 100) < 0.11,
        '汇总通过率%应为 0-1 换算',
      );
    }
    assert.ok(summaryFields[DELIVERY_SUMMARY_FIELDS.docUrl], '汇总记录应支持报告链接回填');
    const summaryWritten = await writeDeliverySummaryRecord(client, 'offline-summary', many);
    assert.equal(summaryWritten.created, true);
    assert.equal(client.keys[client.keys.length - 1], many.deliveryId, '汇总 upsert 键应为 delivery_id');
    assert.equal(check({ ...many, items: many.items.slice(0, 20) }, 'issue-completeness').passed, false);
    const passingModel = buildCustomerReportModel({
      ...coverage, regressSteps: 0, passSteps: 1,
      slots: coverage.slots.map((slot) => ({ ...slot, status: 'pass' as const, difference: 0 })),
    });
    passingModel.pages = Array.from({ length: 8 }, (_, i) => ({ ...passingModel.pages[0]!, pageKey: `pass-${i}` }));
    const samples = buildCustomerDeliveryPayload(passingModel);
    assert.equal(samples.items.length, 5);
    assert.equal(samples.totalIssueCount, 0);
    assert.equal(samples.totalSampleCount, 5);

    // 全字段（包括第 21 项之后的内容）与证据字节均绑定审核。
    for (const mutate of [
      (p: DeliveryPayload) => { p.envId = 'dev'; },
      (p: DeliveryPayload) => { p.runId = 'other'; },
      (p: DeliveryPayload) => { p.sourceRunIds = { [script]: 'other' }; },
      (p: DeliveryPayload) => { p.headline += 'changed'; },
      (p: DeliveryPayload) => { p.shipAdvice = 'changed'; },
      (p: DeliveryPayload) => { p.shipAdviceLabel += 'changed'; },
      (p: DeliveryPayload) => { p.releaseTag = 'changed'; },
      (p: DeliveryPayload) => { p.actionItems.push('changed'); },
      (p: DeliveryPayload) => { p.stats.coveragePct -= 1; },
      (p: DeliveryPayload) => { p.items[26]!.reason += 'changed'; },
      (p: DeliveryPayload) => { p.items[26]!.images[0]!.label += 'changed'; },
      (p: DeliveryPayload) => { p.items.pop(); },
    ]) {
      const changed = structuredClone(many);
      mutate(changed);
      assert.notEqual(computeContentHash(changed), many.contentHash);
      assert.throws(() => assertDeliveryContentHash(changed), /contentHash/);
    }
    assert.equal(computeContentHash({ ...payload, contentHash: 'self-reported' }), payload.contentHash);
    writeReview({ deliveryId: payload.deliveryId, envId: 'uat', approved: true });
    assert.equal(checkReview(payload.deliveryId, payload.contentHash).approved, false, '旧审核无哈希必须拒绝');
    writeReview({ deliveryId: payload.deliveryId, envId: 'uat', approved: true, contentHash: payload.contentHash });
    assert.equal(checkReview(payload.deliveryId, payload.contentHash).approved, true);
    const modified = { ...payload, headline: 'changed' };
    modified.contentHash = computeContentHash(modified);
    assert.equal(checkReview(payload.deliveryId, modified.contentHash).approved, false);
    const stat = fs.statSync(current);
    const changedImage = Buffer.from(image);
    changedImage[changedImage.length - 1] ^= 1;
    fs.writeFileSync(current, changedImage);
    fs.utimesSync(current, stat.atime, stat.mtime);
    assert.equal(check(payload, 'content-hash').passed, false, '同路径、大小、mtime 的证据变化也须拒绝');
    fs.unlinkSync(current);
    assert.throws(() => computeContentHash(payload), /交付证据不可读/);
    assert.equal(check(payload, 'content-hash').passed, false);
    fs.writeFileSync(current, image);

    // 单环境模型故意没有 envSummaries，不能读取别的环境趋势。
    assert.equal(model.envId, 'uat');
    assert.equal(model.envSummaries, undefined);
    appendDeliveryHistory({ ...payload, deliveryId: 'uat-1', generatedAt: '2026-01-01T00:00:00Z' });
    appendDeliveryHistory({ ...payload, deliveryId: 'uat-2', generatedAt: '2026-01-02T00:00:00Z' });
    const before = renderCustomerReportHtml(model);
    assert.ok(before.includes('2026-01-01'));
    appendDeliveryHistory({ ...payload, envId: 'dev', deliveryId: 'dev-1', generatedAt: '2099-01-01T00:00:00Z' });
    appendDeliveryHistory({ ...payload, envId: 'dev', deliveryId: 'dev-2', generatedAt: '2099-01-02T00:00:00Z' });
    assert.equal(renderCustomerReportHtml(model), before);
    assert.ok(!renderCustomerReportHtml({ ...model, envId: undefined }).includes('2099-01-01'));
    pass('完整交付、真实哈希、源运行门禁及单环境趋势');
  } finally {
    for (const [key, value] of Object.entries(originalRunEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    process.chdir(origCwd);
  }
}

// ── 清理 ───────────────────────────────────────────────────
fs.rmSync(tmpRoot, { recursive: true, force: true });

console.log('\n✅ smoke-customer-report-upgrade 通过');
