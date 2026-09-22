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
import type { DeliveryPayload } from '../report/customer-delivery-payload.js';

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
  } as DeliveryPayload);

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
  const mockPayload = {
    version: 1,
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
      { scriptLabel: 'DEV环境 · 报销流程', stepLabel: '报销详情', scriptKey: 'k1', stepNumber: 5 },
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
  } as unknown as DeliveryPayload;

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

  // 无 retest 记录时 gate 仍通过（retest-trace 是信息性检查）
  const emptyPayload = {
    deliveryReady: true,
    envId: 'stage9084',
    generatedAt: new Date().toISOString(),
    contentHash: 'hash123',
    items: [],
    stats: { comparedSteps: 5, coveragePct: 80 },
  } as unknown as DeliveryPayload;

  const gate = runDeliveryGate(emptyPayload);
  const retestCheck = gate.checks.find((c) => c.name === 'retest-trace');
  assert.ok(retestCheck, '应有 retest-trace 检查项');
  assert.equal(retestCheck!.passed, true, 'retest-trace 是信息性检查，始终通过');
  assert.match(retestCheck!.detail, /无复验追踪记录/);
  pass('delivery-gate retest-trace 信息性检查（空记录）');

  // formatGateResult 包含 retest-trace
  const formatted = formatGateResult(gate);
  assert.match(formatted, /retest-trace/);
  pass('formatGateResult 包含 retest-trace');

  process.chdir(origCwd);
}

// ── 清理 ───────────────────────────────────────────────────
fs.rmSync(tmpRoot, { recursive: true, force: true });

console.log('\n✅ smoke-customer-report-upgrade 通过');
