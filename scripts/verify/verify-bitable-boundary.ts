#!/usr/bin/env tsx
/** 离线边界回归：只读取源码，在 VM 内用内存文件、命令和写表替身运行，不加载业务依赖或 .env。 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';
import type { BitableWriteInput } from '../feishu/write-bitable-report.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const NOW = Date.parse('2026-09-01T12:00:00.000Z');
const noop = () => undefined;

function isolated<T>(relative: string, mocks: Record<string, unknown>, env: NodeJS.ProcessEnv, logs: string[] = [], argv: string[] = []): T {
  const filename = path.join(ROOT, relative);
  let source = fs.readFileSync(filename, 'utf-8');
  // ESM 的局部 createRequire 绑定不应遮蔽转译后的 CommonJS require。
  if (relative.endsWith('job-runner-flow.ts')) source = source.replace(/\brequire\b/g, 'repoRequire');
  source = source.replace(/import\.meta\.url/g, JSON.stringify(pathToFileURL(filename).href));
  const compiled = ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  new vm.Script(compiled, { filename }).runInNewContext({
    module,
    exports: module.exports,
    require: (id: string) => {
      assert.ok(Object.hasOwn(mocks, id), `禁止加载未替身依赖: ${id}`);
      return mocks[id];
    },
    process: {
      env, argv, cwd: () => ROOT, pid: 12345,
      exit: (code: number) => { throw new Error(`offline-exit:${code}`); },
    },
    Date: class extends Date { static now() { return NOW; } },
    console: Object.fromEntries(['log', 'warn', 'error'].map((level) => [
      level, (...args: unknown[]) => logs.push(args.map(String).join(' ')),
    ])),
  }, { timeout: 1000 });
  return module.exports as T;
}

function verifyLocalEntrypoints(): void {
  for (const file of ['compare-screenshots.ts', 'compare-flow-screenshots.ts']) {
    const source = fs.readFileSync(path.join(ROOT, 'scripts/report', file), 'utf-8');
    assert.doesNotMatch(source, /writeBitable|bitable-auto|sendJobFeishuNotification|job-notify/);
    assert.match(source, /writeUiIssuesReport\(issuesReport, issuesOut\)/);
    assert.match(source, /gateShouldFail\(issuesReport\)/);
  }
  for (const file of ['scripts/flow/auto-test-flow.ts', 'pw-files/lib/flow-run-common.js']) {
    const source = fs.readFileSync(path.join(ROOT, file), 'utf-8');
    assert.doesNotMatch(source, /writeBitable|bitable-auto|feishu:bitable/);
  }
}

async function verifyAutoSwitch(): Promise<void> {
  for (const setting of [undefined, '0', '1']) {
    const env: NodeJS.ProcessEnv = {};
    if (setting !== undefined) env.FEISHU_BITABLE_AUTO = setting;
    const writes: BitableWriteInput[] = [];
    const commands: string[] = [];
    const auto = isolated<typeof import('../feishu/bitable-auto.js')>('scripts/feishu/bitable-auto.ts', {
      child_process: { execSync: (command: string) => commands.push(command) },
      './write-bitable-report.js': {
        writeBitableReport: async (input: BitableWriteInput) => {
          writes.push(input);
          return { skipped: false };
        },
      },
    }, env);
    const input = { env: 'offline', issuesSource: 'explicit.json' };
    const result = await auto.writeBitableIfAuto(input);
    assert.equal(writes.length, setting === '0' ? 0 : 1);
    assert.equal(result === null, setting === '0');
    if (writes.length) assert.equal(writes[0], input);
    assert.equal(commands.length, 0, '普通写表禁止隐式字段维护');
    auto.ensureBitableFields();
    assert.deepEqual(commands, ['npm run feishu:bitable-setup -- --fix-fields']);
    env.FEISHU_BITABLE_AUTO_FIX_FIELDS = '0';
    auto.ensureBitableFields();
    assert.equal(commands.length, 1, '显式维护保留自身开关');
  }
}

type Case = {
  name: string;
  write?: boolean;
  compare?: boolean;
  gate?: boolean;
  commandFailed?: boolean;
  testFailed?: boolean;
  artifact?: 'fresh' | 'unchanged' | 'missing' | 'invalid-json' | 'invalid-time' | 'old' | 'future' | 'invalid-shape';
  aborted?: boolean;
  compareAfterAbort?: boolean;
  nonGolden?: boolean;
  empty?: boolean;
  loginFailed?: boolean;
  customSource?: boolean;
  env?: string;
  auto?: string;
  writerFailed?: boolean;
};

async function verifyRunner(kind: 'direct' | 'flow', test: Case): Promise<void> {
  const logs: string[] = [];
  const writes: BitableWriteInput[] = [];
  const env: NodeJS.ProcessEnv = { PLAYWRIGHT_ENV: 'wrong-parent', UI_ISSUES_SOURCE: 'results/unrelated.json' };
  if (test.auto !== undefined) env.FEISHU_BITABLE_AUTO = test.auto;
  const defaultSource = kind === 'direct' ? 'results/ui-issues.json' : 'results/flow-ui-issues.json';
  if (test.customSource) env[kind === 'direct' ? 'UI_ISSUES_OUT' : 'FLOW_UI_ISSUES_OUT'] = 'results/custom-issues.json';
  const issuesSource = path.resolve(ROOT, test.customSource ? 'results/custom-issues.json' : defaultSource);
  const runtimeEnv = test.env || 'offline';
  const report = (generatedAt: string, blocker: number) => JSON.stringify({
    generatedAt,
    issues: [],
    summary: { blocker: 90, warning: 91, total: 99, comparisonBlocker: blocker, comparisonWarning: 3, comparisonTotal: 7 },
  });
  const files = new Map<string, string>([
    [issuesSource, report(new Date(NOW - 1000).toISOString(), 55)],
    [path.resolve(ROOT, 'results/unrelated.json'), report(new Date(NOW).toISOString(), 99)],
  ]);
  const optimizedDir = path.join(ROOT, 'tests/optimized');
  const memoryFs = {
    existsSync: (file: string) => file === optimizedDir || files.has(path.resolve(ROOT, file)),
    statSync: () => ({ isDirectory: () => true, mtimeMs: NOW }),
    readFileSync: (file: string) => {
      const content = files.get(path.resolve(ROOT, file));
      assert.notEqual(content, undefined, `未知内存文件: ${file}`);
      return content;
    },
  };
  const issues = isolated<typeof import('../report/issues-source.js')>('scripts/report/issues-source.ts', { fs: memoryFs }, env);
  const auto = isolated<typeof import('../feishu/bitable-auto.js')>('scripts/feishu/bitable-auto.ts', {
    child_process: { execSync: () => { throw new Error('禁止隐式字段维护'); } },
    './write-bitable-report.js': {
      writeBitableReport: async (input: BitableWriteInput) => {
        writes.push(input);
        if (test.writerFailed) throw new Error('offline writer failure');
        return { skipped: false };
      },
    },
  }, env, logs);
  let compares = 0;
  function compare(commandEnv: NodeJS.ProcessEnv): boolean {
    compares++;
    assert.equal(commandEnv.PLAYWRIGHT_ENV, runtimeEnv);
    switch (test.artifact ?? 'fresh') {
      case 'fresh': files.set(issuesSource, report(new Date(NOW).toISOString(), 2)); break;
      case 'missing': files.delete(issuesSource); break;
      case 'invalid-json': files.set(issuesSource, '{'); break;
      case 'invalid-time': files.set(issuesSource, report('invalid', 2)); break;
      case 'old': files.set(issuesSource, report(new Date(NOW - 1).toISOString(), 2)); break;
      case 'future': files.set(issuesSource, report(new Date(NOW + 1).toISOString(), 2)); break;
      case 'invalid-shape': files.set(issuesSource, JSON.stringify({ generatedAt: new Date(NOW).toISOString() })); break;
      case 'unchanged': break;
    }
    return !test.commandFailed;
  }
  const entry = { absPath: path.join(optimizedDir, 'offline/example.optimized.spec.ts'), relPath: 'tests/optimized/offline/example.optimized.spec.ts' };
  const entries = test.empty ? [] : [entry];
  const steps = {
    login: Boolean(test.loginFailed), refreshLogin: false,
    compare: test.compare !== false, compareGate: Boolean(test.gate),
    writeFeishuBitable: test.write !== false, recordLastGreen: false,
    createFeishuDoc: false, feishuNotify: false, deliveryPreview: false,
    resetFlowArtifacts: false, promoteBaselineIfClean: false, uiAuditGate: false,
  };
  const commonMocks = {
    path,
    './job-lock.js': {},
    './job-notify.js': {
      buildJobFailReasons: () => [],
      sendJobFeishuNotification: () => { throw new Error('禁止真实通知'); },
    },
    '../feishu/bitable-auto.js': auto,
    '../report/issues-source.js': issues,
    '../report/generate-quality-dashboard.js': { writeQualityDashboard: () => 'offline-dashboard' },
    '../feishu/deliver-ready.js': { listReportEnvs: () => ['offline'] },
  };
  const ctx = { runId: 'offline-run', trigger: 'cli' as const, persistState: false, playwrightEnv: runtimeEnv };
  let result: Awaited<ReturnType<typeof import('../jobs/job-runner.js')['runDirect']>>;
  if (kind === 'direct') {
    const runner = isolated<typeof import('../jobs/job-runner.js')>('scripts/jobs/job-runner.ts', {
      ...commonMocks,
      fs: memoryFs,
      './test-jobs-config.js': {},
      '../flow/flow-shared.js': { runAnalyzeErrorsOnFailure: noop },
      './job-utils.js': {
        resolveSpecEntries: () => entries,
        groupSpecEntriesByProfile: () => new Map([['offline', entries]]),
        summarizeSpecProfileCounts: () => ({ offline: entries.length }),
      },
      '../../src/utils/test-env-path.js': { assertSpecEnvMatch: noop },
      './job-runner-execute.js': {
        executeTests: async () => ({
          totalSuccessCount: test.testFailed ? 0 : 1, totalFailCount: test.testFailed ? 1 : 0,
          aborted: Boolean(test.aborted), executedSpecPaths: [entry.absPath],
        }),
        runCommandBool: (command: string, _label: string, commandEnv: NodeJS.ProcessEnv) => {
          if (command.startsWith('npm run compare-screenshots')) return compare(commandEnv);
          assert.equal(command, 'npm run report:customer -- --reuse-compare');
          return true;
        },
      },
      './job-runner-flow.js': {},
      './job-runner-catalog.js': {},
    }, env, logs);
    result = await runner.runDirect({
      projects: ['optimized'], optimizedDir: 'tests/optimized', specs: 'all',
      stopOnTestFailure: true, stopOnCompareGate: true, runCompareAfterAbort: Boolean(test.compareAfterAbort),
      verbose: false, playwrightEnv: runtimeEnv, steps, feishuMode: 'none', notifyOn: [],
    }, { ...ctx, jobId: 'offline-job' });
  } else {
    const runnerKey = test.nonGolden ? 'request-flow-write' : 'request-flow-golden';
    const runner = isolated<typeof import('../jobs/job-runner-flow.js')>('scripts/jobs/job-runner-flow.ts', {
      ...commonMocks,
      child_process: {
        execSync: (command: string, options: { env: NodeJS.ProcessEnv }) => {
          if (command.startsWith('npm run compare-flow-screenshots')) {
            if (!compare(options.env)) throw Object.assign(new Error('offline gate'), { status: 1 });
          } else {
            assert.ok(command.startsWith('npx '));
            if (test.testFailed) throw Object.assign(new Error('offline test failure'), { status: 1 });
          }
        },
      },
      module: {
        createRequire: () => (id: string) => {
          assert.equal(id, '../../pw-files/repo-env.js');
          return { listGoldenProfileIds: () => ['reader'], ensureFlowProfilesLogin: () => ({ ok: false, reason: 'offline login failure' }) };
        },
      },
      './job-utils.js': {},
      './test-jobs-config.js': { resolveJobRunEnv: () => runtimeEnv, listJobRunEnvs: () => [runtimeEnv] },
      './flow-runner-registry.js': {
        resolveFlowRunnerKey: () => runnerKey,
        FLOW_RUNNER_LABELS: { [runnerKey]: 'offline' }, FLOW_RUNNER_SCRIPTS: { [runnerKey]: 'offline.ts' },
      },
      '../flow/flow-registry.js': { getFlow: () => ({ id: 'request-flow', goldenSpec: 'offline.spec.ts' }) },
    }, env, logs);
    result = await runner.runFlowJob({
      id: 'offline-job', runner: runnerKey, enabled: true, playwrightEnv: runtimeEnv,
      projects: ['optimized'], optimizedDir: 'tests/optimized', specs: 'all',
      stopOnTestFailure: true, stopOnCompareGate: true, runCompareAfterAbort: false,
      feishuMode: 'none', notifyOn: [], steps,
    } as Parameters<typeof runner.runFlowJob>[0], ctx);
  }
  const skipped = test.compare === false || Boolean(test.nonGolden || test.empty || test.loginFailed)
    || Boolean(test.aborted && !test.compareAfterAbort);
  const fresh = !skipped && (!test.artifact || test.artifact === 'fresh');
  const expectedWrites = fresh && test.write !== false && test.auto !== '0' ? 1 : 0;
  const label = `${kind}: ${test.name}`;
  assert.equal(compares, skipped ? 0 : 1, label);
  assert.equal(result.compareSkipped, skipped, label);
  if (!skipped) assert.equal(result.comparePassed, fresh && !test.commandFailed, label);
  assert.equal(result.summary.uiIssuesBlocker, fresh ? 2 : undefined, label);
  assert.equal(result.summary.uiIssuesWarning, fresh ? 3 : undefined, label);
  assert.equal(writes.length, expectedWrites, label);
  if (expectedWrites) {
    const written = writes[0]!;
    assert.equal(written.summary, result.summary, `${label}: 必须传真实 summary`);
    assert.equal(written.summary?.runId, 'offline-run', label);
    assert.equal(written.env, runtimeEnv, label);
    assert.equal(written.issuesSource, issuesSource, label);
    assert.equal(written.status, test.aborted ? 'aborted' : result.exitCode === 0 ? 'success' : 'failed', label);
  }
  if (!fresh && test.write !== false) assert.ok(logs.some((line) => line.includes('跳过飞书多维表同步')), label);
  if (test.writerFailed) assert.equal(result.exitCode, 0, `${label}: 写表失败不改变任务结果`);
}

async function verifyRecordRetryPolicy(): Promise<void> {
  const calls: Array<{ url: string; retries?: number; method?: string }> = [];
  const { BitableClient } = isolated<typeof import('../feishu/bitable-client.js')>('scripts/feishu/bitable-client.ts', {
    './feishu-utils.js': {
      fetchWithRetry: async (url: string, options: { retries?: number; method?: string }) => {
        calls.push({ url, ...options });
        const data = url.includes('/auth/') ? { tenant_access_token: 'mock' }
          : url.includes('/search') ? { items: [] }
          : { record: { record_id: 'mock-record' } };
        return new Response(JSON.stringify({ code: 0, data }));
      },
    },
  }, {});
  const client = new BitableClient({ appId: 'mock', appSecret: 'mock', appToken: 'mock', runTableId: 'mock' });
  await client.upsertRecord('table', 'key', 'value', {});
  await client.updateRecord('table', 'mock-record', {});
  assert.equal(calls.find((call) => call.url.endsWith('/records'))?.retries, 0);
  assert.equal(calls.find((call) => call.url.includes('/search'))?.retries, undefined, '读取保留原重试策略');
  assert.equal(calls.find((call) => call.method === 'PUT')?.retries, undefined, '幂等更新保留原重试策略');
}

function verifyMissingHtml(): void {
  for (const [argv, expected] of [
    [[], 1],
    [['--report=results/missing.html'], 1],
    [['--report', 'results/missing.html'], 1],
    [['--report='], 1],
    [['--report', '--allow-missing'], 1],
    [['--allow-missing'], 0],
    [['--allow-missing', '--report=results/missing.html'], 1],
  ] as Array<[string[], number]>) {
    const logs: string[] = [];
    assert.throws(() => isolated('scripts/verify/verify-customer-report-html.ts', {
      fs: { existsSync: () => false }, path, 'node:assert/strict': assert,
    }, {}, logs, argv), new RegExp(`offline-exit:${expected}`));
    assert.equal(logs.some((line) => line.includes('SKIP')), expected === 0);
    assert.ok(!logs.some((line) => line.includes('通过')), '跳过不能报告验证通过');
  }
}

async function main(): Promise<void> {
  verifyLocalEntrypoints();
  verifyMissingHtml();
  await verifyRecordRetryPolicy();
  await verifyAutoSwitch();
  const cases: Case[] = [
    { name: '默认本地', write: false },
    { name: '显式写表' },
    { name: '自定义 issues 来源', customSource: true },
    { name: '全局杀开关', auto: '0' },
    { name: 'gate 失败仍同步本轮结果', gate: true, commandFailed: true },
    { name: 'gate 成功以命令判定为准', gate: true },
    { name: '测试失败使用真实 summary', testFailed: true },
    { name: 'compare 禁用不带入旧 issues', compare: false },
    { name: '正常退出但未更新产物', artifact: 'unchanged' },
    { name: '失败且未更新产物', artifact: 'unchanged', commandFailed: true },
    ...(['missing', 'invalid-json', 'invalid-time', 'old', 'future', 'invalid-shape'] as const)
      .map((artifact) => ({ name: `拒绝 ${artifact}`, artifact })),
    { name: '写表失败不阻断', writerFailed: true },
  ];
  for (const kind of ['direct', 'flow'] as const) {
    for (const test of cases) await verifyRunner(kind, test);
  }
  await verifyRunner('direct', { name: '中断跳过比较', aborted: true });
  await verifyRunner('direct', { name: '中断后比较产物可同步', aborted: true, compareAfterAbort: true });
  await verifyRunner('direct', { name: '无用例跳过', empty: true });
  await verifyRunner('flow', { name: '非 golden 不借用旧报告', nonGolden: true });
  await verifyRunner('flow', { name: '登录失败跳过', loginFailed: true });
  await verifyRunner('flow', { name: 'all 环境不继承父进程环境', env: 'all' });
  console.log('PASS: bitable boundary (isolated, offline)');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
