import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const golden = require('../../pw-files/lib/golden-batch.js');
const { summarizeGoldenBatch, parseGoldenExecution, finalizeGoldenExecution, goldenBatchStatus, summarizeGoldenRounds } = golden;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const allSkippedBatch = {
  flowId: 'approval-flow',
  env: 'dev',
  ok: false,
  exitCode: 2,
  skippedOnly: true,
  ignored: [],
  results: [
    {
      ok: false,
      skipped: true,
      skippedOnly: true,
      profileId: 'golden-staff',
      roleSlug: 'staff',
      exitCode: 2,
      passed: 0,
      failed: 0,
      total: 1,
      reason: '待审批无可用单号',
    },
  ],
};
const realPassBatch = {
  flowId: 'approval-flow',
  env: 'dev',
  ok: true,
  exitCode: 0,
  skippedOnly: false,
  ignored: [],
  results: [
    {
      ok: true,
      skipped: false,
      profileId: 'golden-staff',
      roleSlug: 'staff',
      exitCode: 0,
      passed: 5,
      failed: 0,
      total: 5,
    },
  ],
};
const partialFailBatch = {
  flowId: 'approval-flow',
  env: 'dev',
  ok: false,
  exitCode: 1,
  skippedOnly: false,
  ignored: [],
  results: [
    { ok: true, skipped: false, profileId: 'a', roleSlug: 'a', exitCode: 0, passed: 5, failed: 0, total: 5 },
    { ok: false, skipped: false, profileId: 'b', roleSlug: 'b', exitCode: 1, passed: 1, failed: 2, total: 3 },
  ],
};
const mixedSkipBatch = {
  flowId: 'approval-flow',
  env: 'dev',
  ok: false,
  exitCode: 1,
  skippedOnly: false,
  ignored: [],
  results: [
    { ok: false, skipped: true, skippedOnly: true, profileId: 'a', roleSlug: 'a', exitCode: 2, passed: 0, failed: 0, total: 1 },
    { ok: true, skipped: false, profileId: 'b', roleSlug: 'b', exitCode: 0, passed: 4, failed: 0, total: 4 },
  ],
};

{
  const s = summarizeGoldenBatch(allSkippedBatch);
  assert.equal(s.ok, false, 'allSkipped 批次不应视为 ok');
  assert.equal(s.exitCode, 2, 'allSkipped 退出码应为 2');
  assert.equal(s.skippedOnly, true, 'summary.skippedOnly 应为 true');
  assert.ok(s.headline.includes('无效'), `headline 应说明批次无效，实际 ${s.headline}`);
  assert.ok(s.headline.includes('跳过'), 'headline 应包含跳过统计');
}
{
  const s = summarizeGoldenBatch(realPassBatch);
  assert.equal(s.ok, true);
  assert.equal(s.exitCode, 0);
  assert.equal(s.skippedOnly, false);
  assert.ok(s.headline.startsWith('Golden 批次完成'), `real pass headline: ${s.headline}`);
}
{
  const s = summarizeGoldenBatch(partialFailBatch);
  assert.equal(s.ok, false);
  assert.equal(s.exitCode, 1);
  assert.ok(s.headline.includes('部分失败'), `partial fail headline: ${s.headline}`);
}
{
  const s = summarizeGoldenBatch(mixedSkipBatch);
  assert.equal(s.ok, false);
  assert.equal(s.exitCode, 1, '部分跑通部分跳过 → 退出码 1（真实失败）');
  assert.equal(s.skippedOnly, false, '混合批次不算 skippedOnly');
}
assert.deepEqual(summarizeGoldenBatch(null), { ok: false, exitCode: 1, lines: [], skippedOnly: false });

// 旧批次即使错误地持久化 ok=true/exit=0，也不能把全跳过或零用例显示成绿。
for (const batch of [
  { ...allSkippedBatch, ok: true, exitCode: 0, skippedOnly: false },
  { ...realPassBatch, results: [] },
  { ...realPassBatch, results: [{ ...realPassBatch.results[0], passed: 0, total: 0 }] },
  { ...mixedSkipBatch, ok: true, exitCode: 0 },
]) assert.equal(summarizeGoldenBatch(batch).ok, false);
assert.equal(goldenBatchStatus([]).exitCode, 1);

function report(expected: number, skipped = 0, unexpected = 0): string {
  return JSON.stringify({ stats: { expected, skipped, unexpected, flaky: 0 }, suites: [] });
}
for (const stdout of ['not json', '{}', 'null', report(0), report(-1), report(1.5)]) {
  const result = parseGoldenExecution(stdout, 0);
  assert.equal(result.ok, false);
  assert.equal(result.passed, 0);
  assert.ok(result.failures[0]?.message, '无有效执行必须保留具体原因');
  assert.equal(finalizeGoldenExecution(result, { ok: true }).ok, false);
}
const executed = parseGoldenExecution(report(2), 0);
assert.equal(finalizeGoldenExecution(executed, { ok: true }).exitCode, 0);
for (const gate of ['compareGateFailed', 'uiAuditGateFailed', 'apiFailureCount']) {
  const result = finalizeGoldenExecution(executed, { ok: false, [gate]: 1 });
  assert.equal(result.ok, false);
  assert.equal(result.exitCode, 1);
  assert.ok(result.error.includes('门禁'));
}
assert.equal(finalizeGoldenExecution(parseGoldenExecution(report(0, 2), 0), { ok: false }).exitCode, 2);
assert.equal(parseGoldenExecution(report(1), 1).ok, false);

const successfulRound = { ok: true, exitCode: 0, failureType: null };
assert.equal(summarizeGoldenRounds([successfulRound, successfulRound], 2).ok, true);
for (const failureType of ['ENV_BLOCKED', 'SEED_MISSING', 'INFRA_FAIL', 'BUSINESS_FLAKY']) {
  assert.equal(summarizeGoldenRounds([{ ok: false, exitCode: 1, failureType }], 1).ok, false);
  assert.equal(summarizeGoldenRounds([successfulRound, { ok: false, exitCode: 2, failureType }], 2).ok, false);
}
assert.equal(summarizeGoldenRounds([], 0).ok, false);
assert.equal(summarizeGoldenRounds([], 2).ok, false);
assert.equal(summarizeGoldenRounds([successfulRound], 2).ok, false);

// 执行真实入口的控制流，所有文件写入、子进程、登录和最终门禁均在 VM 中替身。
class OfflineExit extends Error {
  constructor(readonly code: number) { super(`offline exit ${code}`); }
}
const compiledSources = new Map<string, string>();
function runIsolated(relative: string, mocks: Record<string, unknown>, args: string[]): number {
  const filename = path.join(root, relative);
  if (!compiledSources.has(relative)) {
    const source = fs.readFileSync(filename, 'utf8')
      .replace(/\brequire\b/g, 'repoRequire')
      .replace(/import\.meta\.url/g, JSON.stringify(pathToFileURL(filename).href));
    compiledSources.set(relative, ts.transpileModule(source, {
      fileName: filename,
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    }).outputText);
  }
  const load = (id: string) => {
    assert.ok(Object.hasOwn(mocks, id), `禁止加载未替身依赖: ${id}`);
    return mocks[id];
  };
  mocks.module = { createRequire: () => load };
  mocks.path = path;
  mocks.dotenv = { config: () => undefined };
  const module = { exports: {} };
  try {
    new vm.Script(compiledSources.get(relative)!, { filename }).runInNewContext({
      require: load, module, exports: module.exports,
      console: { log() {}, warn() {}, error() {} },
      process: {
        cwd: () => root, platform: 'darwin', env: { FLOW_DEBUG_FAST: '1' },
        argv: ['node', filename, ...args], exit: (code: number) => { throw new OfflineExit(code); },
      },
    }, { timeout: 5_000 });
  } catch (error) {
    if (error instanceof OfflineExit) return error.code;
    throw error;
  }
  throw new Error('入口未设置退出码');
}

for (const flow of ['request', 'approval', 'expense']) {
  for (const scenario of ['pass', 'final-gate', 'all-skip', 'zero', 'parse', 'invalid-storage', 'no-profiles', ...(flow === 'request' ? ['mixed-env'] : [])]) {
    const writes: Array<{ ok: boolean; exitCode: number; results: Array<{ ok: boolean; skippedOnly?: boolean; error?: string }> }> = [];
    const payloads: Array<{ ok: boolean; passed: number; exitCode: number }> = [];
    let spawned = 0;
    const mocks: Record<string, unknown> = {
      fs: { existsSync: () => true, readFileSync: () => '{}', mkdirSync() {}, writeFileSync() {} },
      child_process: { spawnSync: () => {
        spawned += 1;
        return { status: 0, stderr: '', stdout: scenario === 'parse' ? 'not json'
          : report(scenario === 'all-skip' || scenario === 'zero' ? 0 : 2, scenario === 'all-skip' ? 2 : 0) };
      } },
      '../../src/utils/test-env-path.js': { listKnownEnvs: () => ['dev', 'stage'] },
      '../../pw-files/repo-env.js': {
        resolveValidatedStorageAbs: () => ({ abs: scenario === 'invalid-storage' ? '' : '/offline/storage.json', reason: '无有效登录态' }),
        listGoldenProfileIds: (_root: string, env: string) => scenario === 'no-profiles' || (scenario === 'mixed-env' && env === 'stage') ? [] : ['golden1'],
        isGoldenProfileId: () => true, resolveFlowRoleSlug: () => 'staff',
        getBaseEnvConfig: () => ({}), resolveAccountCredentials: () => null,
        resolveProfileFlowDefaults: () => ({}), enrichProfileStorageEntry: () => ({}),
      },
      '../../pw-files/lib/flow-run-common.js': {
        flowScriptKey: () => 'offline',
        finalizeFlowRun: (_root: string, _flow: string, _label: string, payload: { ok: boolean; passed: number; exitCode: number }) => {
          payloads.push(payload);
          return { ...payload, ok: payload.ok && scenario !== 'final-gate', compareGateFailed: scenario === 'final-gate' };
        },
      },
      '../../pw-files/lib/flow-run-marker.js': { makeRunMarker: () => 'offline', writeRunMarkerFile() {} },
      '../../pw-files/lib/golden-seed.js': { resolveGoldenSeed: () => ({}) },
      '../../pw-files/lib/approval-golden-seed.js': { resolveApprovalGoldenSeed: () => ({}) },
      '../../pw-files/lib/flow-golden-seed.js': { resolveFlowGoldenSeed: () => ({}) },
      '../../pw-files/lib/failure-report.js': { logConcisePlaywrightFailures() {} },
      '../../pw-files/lib/golden-batch.js': { ...golden, writeGoldenBatch: (_root: string, _flow: string, batch: typeof writes[number]) => writes.push(batch) },
    };
    const code = runIsolated(`scripts/flow/run-${flow}-flow-golden.ts`, mocks,
      scenario === 'mixed-env' ? ['--all-envs'] : scenario === 'no-profiles' ? ['--env=dev'] : ['--env=dev', '--profile=golden1']);
    const expectedCode = scenario === 'pass' ? 0 : scenario === 'all-skip' || scenario === 'invalid-storage' ? 2 : 1;
    assert.equal(code, expectedCode, `${flow}: ${scenario}`);
    assert.equal(writes.at(-1)?.ok, scenario === 'pass', `${flow}: batch.ok ${scenario}`);
    assert.equal(writes.at(-1)?.exitCode, expectedCode);
    if (scenario === 'invalid-storage' || scenario === 'no-profiles') assert.equal(spawned, 0);
    if (scenario === 'invalid-storage') assert.equal(writes[0].results[0].skippedOnly, true);
    if (scenario === 'parse' || scenario === 'zero') {
      assert.equal(payloads[0].passed, 0);
      assert.equal(payloads[0].exitCode, 1);
      assert.ok(writes[0].results[0].error);
    }
  }
}

for (const scenario of ['pass', 'blocked', 'seed', 'infra', 'stale', 'false-success', 'stop']) {
  let spawned = 0;
  const capture: { saved?: { verdict: string; businessFlakyRounds: number; passedRounds: number; executedRounds: number } } = {};
  const blocked = { ...allSkippedBatch, flowId: 'request-flow' };
  const mocks: Record<string, unknown> = {
    fs: { existsSync: () => true, mkdirSync() {}, writeFileSync: (_file: string, text: string) => { capture.saved = JSON.parse(text); } },
    os: { tmpdir: () => '/offline/tmp' },
    child_process: { spawnSync: () => {
      spawned += 1;
      return { status: scenario === 'pass' || scenario === 'false-success' || scenario === 'stale' ? 0 : scenario === 'infra' ? 124 : 2 };
    } },
    './flow-registry.js': { getFlow: () => ({ label: 'offline', goldenRunner: 'run-request-flow-golden.ts' }), listFlowIds: () => ['request-flow'] },
    '../../pw-files/lib/golden-batch.js': {
      ...golden,
      readGoldenBatch: () => ({
        ...(scenario === 'pass' || scenario === 'stale' ? realPassBatch : blocked),
        flowId: 'request-flow', env: 'dev', finishedAt: scenario === 'stale' ? new Date(0).toISOString() : new Date().toISOString(),
        ...(scenario === 'seed' ? { results: [{ ...blocked.results[0], reason: 'SEED_MISSING' }] } : {}),
      }),
    },
  };
  const code = runIsolated('scripts/flow/run-golden-flake-check.ts', mocks,
    ['--flow=request-flow', '--runs=2', '--env=dev', ...(scenario === 'stop' ? ['--stop-on-fail'] : [])]);
  assert.equal(code, scenario === 'pass' ? 0 : 1, `flake ${scenario}`);
  assert.equal(capture.saved?.verdict.startsWith('pass'), scenario === 'pass');
  assert.equal(capture.saved?.businessFlakyRounds, 0, 'blocked/seed/infra 不计 business flaky');
  assert.equal(capture.saved?.passedRounds, scenario === 'pass' ? 2 : 0);
  assert.equal(spawned, scenario === 'stop' ? 1 : 2);
  assert.equal(capture.saved?.executedRounds, spawned);
}

console.log('golden batch and flake acceptance verification passed');