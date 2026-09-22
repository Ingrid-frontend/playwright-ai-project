/**
 * request-flow 稳定性 smoke：登录态预检 + changeDetection 配置 + Page Object 导出
 * 全量连跑请在 dev 环境手动执行：
 *   REQUEST_ENABLE_WRITE=1 npx playwright test --config request-flow/playwright.config.ts request/golden-regression.spec.ts request/travel-submit.spec.ts request/full-flow.spec.ts --workers=1
 */
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '../..');
const repoEnv = require(path.join(repoRoot, 'pw-files/repo-env.js'));

function pass(name) {
  console.log(`  ✓ ${name}`);
}

function fail(name, detail) {
  console.error(`  ✗ ${name}${detail ? `: ${detail}` : ''}`);
  process.exitCode = 1;
}

// 1) validateStorageForRun
const goldenRel = 'storage/loginState/dev/golden.json';
const goldenAbs = path.join(repoRoot, goldenRel);
if (fs.existsSync(goldenAbs)) {
  const r = repoEnv.validateStorageForRun(repoRoot, goldenRel);
  if (r.ok) pass(`validateStorageForRun · ${goldenRel}${r.account ? ` (${r.account})` : ''}`);
  else fail('validateStorageForRun · dev/golden', r.reason);
} else {
  pass('validateStorageForRun · 跳过（无 dev/golden.json）');
}

const missing = repoEnv.validateStorageForRun(repoRoot, 'storage/loginState/dev/__missing__.json');
if (!missing.ok && /不存在/.test(missing.reason)) pass('validateStorageForRun · 缺失文件拒收');
else fail('validateStorageForRun · 缺失文件', missing.reason);

// 2) changeDetection 含 request-flow 分区
const uiCfgPath = path.join(repoRoot, 'config/ui-regression.json');
const uiCfg = JSON.parse(fs.readFileSync(uiCfgPath, 'utf8'));
const cdKeys = new Set((uiCfg.changeDetection?.sections || []).map((s) => s.key));
const required = [
  'request-list-root',
  'request-list-table',
  'request-search-table',
  'request-filter-panel',
  'request-detail-slide',
];
for (const key of required) {
  if (cdKeys.has(key)) pass(`changeDetection.sections · ${key}`);
  else fail(`changeDetection.sections · ${key}`, '未配置');
}

const structPrefixes = uiCfg.gate?.structureScriptPrefixes;
if (Array.isArray(structPrefixes) && structPrefixes.some((p) => String(p).includes('flows/request-flow/'))) {
  pass('gate.structureScriptPrefixes · request-flow');
} else {
  fail('gate.structureScriptPrefixes', '未配置 request-flow 前缀');
}

const jobsCfg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'config/test-jobs.json'), 'utf8'));
const goldenJob = (jobsCfg.jobs || []).find((j) => j.id === 'request-flow-golden');
if (goldenJob?.steps?.compareGate === true && goldenJob?.steps?.compare === true) {
  pass('test-jobs.json · request-flow-golden compareGate');
} else {
  fail('test-jobs.json · request-flow-golden compareGate', '未开启');
}

// 3) submit 轻量路径 + write job 配置
const editSrc = fs.readFileSync(path.join(repoRoot, 'request-flow/pages/request-edit.page.ts'), 'utf8');
const writeJob = (jobsCfg.jobs || []).find((j) => j.id === 'request-flow-write');
if (writeJob?.runner === 'request-flow-write') pass('test-jobs.json · request-flow-write');
else fail('test-jobs.json · request-flow-write', '未配置');

if (writeJob?.steps?.feishuNotify === true) pass('test-jobs.json · request-flow-write feishuNotify');
else fail('test-jobs.json · request-flow-write feishuNotify', '未开启');

if (writeJob?.steps?.resetFlowArtifacts === true) pass('test-jobs.json · request-flow-write resetFlowArtifacts');
else fail('test-jobs.json · request-flow-write resetFlowArtifacts', '未开启');

if (writeJob?.steps?.uiAuditGate === true) pass('test-jobs.json · request-flow-write uiAuditGate');
else fail('test-jobs.json · request-flow-write uiAuditGate', '未开启');

if (goldenJob?.steps?.login === true) pass('test-jobs.json · request-flow-golden login');
else fail('test-jobs.json · request-flow-golden login', '未开启');

const checkDomHash = uiCfg.structureChecks?.checkDomHash === true;
if (checkDomHash) pass('structureChecks.checkDomHash · 已开启');
else fail('structureChecks.checkDomHash', '未开启');

if (typeof repoEnv.isStorageStale === 'function' && typeof repoEnv.ensureFlowProfilesLogin === 'function') {
  pass('repo-env · 登录态治理 API');
} else {
  fail('repo-env · 登录态治理 API', '缺少 isStorageStale / ensureFlowProfilesLogin');
}

const resetFlowScript = path.join(repoRoot, 'scripts/flow/reset-flow-artifacts.ts');
if (fs.existsSync(resetFlowScript)) pass('reset-flow-artifacts.ts');
else fail('reset-flow-artifacts.ts', '未找到');

if (fs.existsSync(path.join(repoRoot, 'scripts/report/selector-drift-suggest.ts'))) pass('selector-drift-suggest.ts');
else fail('selector-drift-suggest.ts', '未找到');

const approvalJob = (jobsCfg.jobs || []).find((j) => j.id === 'approval-flow-write');
if (approvalJob?.runner === 'approval-flow-write') pass('test-jobs.json · approval-flow-write');
else fail('test-jobs.json · approval-flow-write', '未配置');

if (approvalJob?.steps?.resetFlowArtifacts === true) pass('test-jobs.json · approval-flow-write resetFlowArtifacts');
else fail('test-jobs.json · approval-flow-write resetFlowArtifacts', '未开启');

const submitSrc = fs.readFileSync(
  path.join(repoRoot, 'request-flow/tests/request/submit-then-approve.spec.ts'),
  'utf8',
);
if (/classifySubmitFail/.test(submitSrc) && /recoverSubmitRetry/.test(submitSrc)) {
  pass('submit-then-approve · 分类重试');
} else {
  fail('submit-then-approve · 分类重试', '未实现');
}

if (fs.existsSync(path.join(repoRoot, 'scripts/flow/run-request-flow-stability-gate.ts'))) {
  pass('run-request-flow-stability-gate.ts');
} else {
  fail('run-request-flow-stability-gate.ts', '未找到');
}

const gitignore = fs.readFileSync(path.join(repoRoot, '.gitignore'), 'utf8');
if (/storage\/loginState\//.test(gitignore)) pass('.gitignore · storage/loginState/');
else fail('.gitignore · storage/loginState/', '未忽略子目录');

const fullFlowSrc = fs.readFileSync(
  path.join(repoRoot, 'request-flow/tests/request/full-flow.spec.ts'),
  'utf8',
);
if (/test\.setTimeout\(300_000\)/.test(fullFlowSrc)) pass('full-flow · submit 超时 300s');
else fail('full-flow · submit 超时', '未对齐 travel-submit');

if (/ensureTravelReadyForSubmit/.test(editSrc) && /tripDatesReady\(root\)/.test(editSrc)) {
  pass('RequestEditPage.submit · save 后自动轻量 submit');
} else {
  fail('RequestEditPage.submit', '缺少 tripDatesReady 自动判断');
}

async function verifyRequestSafety() {
  const assert = require('node:assert/strict');
  const vm = require('node:vm');
  const ts = require('typescript');
  const events = [];
  let existingDocNo = '';
  let reasons = ['本轮事由'];
  let selectedDocNo = 'CURRENT001';
  const expect = () => ({ toBeVisible: async () => undefined });
  expect.poll = (read, options) => ({
    toBeGreaterThan: async (n) => assert.ok(await read() > n, options?.message),
    toBe: async (value) => assert.equal(await read(), value, options?.message),
  });
  class GenericListPage { constructor(page) { this.page = page; } }
  class EditPage {
    async confirmNewRequestModal() { events.push('confirm-new'); }
    async expectEditVisible() {}
    async tryReadDocNo() { return existingDocNo; }
    async deleteDraftIfPresent() { throw new Error('禁止删除已有草稿'); }
    async fillReason() { events.push('fill'); }
    async save() { events.push('save'); }
    async submit() { events.push('submit'); }
    async readDocNo() { throw new Error('提交后详情关闭'); }
  }
  function load(relative, mocks) {
    const filename = path.join(repoRoot, relative);
    const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      fileName: filename,
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText;
    const module = { exports: {} };
    new vm.Script(compiled, { filename }).runInNewContext({
      module, exports: module.exports,
      require: (id) => {
        assert.ok(Object.hasOwn(mocks, id), `禁止加载未替身依赖: ${id}`);
        return mocks[id];
      },
    }, { timeout: 5_000 });
    return module.exports;
  }
  const actual = load('request-flow/pages/request-list.page.ts', {
    '@playwright/test': { expect },
    '../../flow-kit/list/generic-list-page': { GenericListPage },
    './request-edit.page': { RequestEditPage: EditPage },
    '../utils/request-catalog': { FILTER_LABELS: { reason: '事由' } },
  });
  class RequestListPage extends actual.RequestListPage {
    async goto() { events.push('goto'); }
    async expectLoaded() {}
    async expectListReady() {}
    async closeDetailIfOpen() {}
    async clickNewRequest() { events.push('new'); }
    async clearListQuery() { events.push('clear'); selectedDocNo = 'DEFAULT001'; }
    async clickFilterSearch() { events.push('search'); }
    async hasDataRows() { return reasons.length > 0; }
    async readFirstDocNo() { events.push('read'); return selectedDocNo; }
    async columnIndex() { return 1; }
    dataRows() {
      return { count: async () => reasons.length, locator: () => ({ allTextContents: async () => reasons }) };
    }
    async filterByReason(reason) {
      events.push('filter');
      reasons = [reason];
      selectedDocNo = 'CURRENT001';
    }
    async expectReasonFilterResult(reason) {
      events.push('assert-reason');
      await super.expectReasonFilterResult(reason);
    }
  }
  const list = new RequestListPage({});
  assert.equal(await list.pickFirstDocNo(), 'DEFAULT001', '默认调用仍清筛选');
  assert.deepEqual(events, ['clear', 'read']);
  events.length = 0;
  await list.filterByReason('本轮事由');
  await list.expectReasonFilterResult('本轮事由');
  assert.equal(await list.pickFirstDocNo({ keepListFilters: true }), 'CURRENT001');
  assert.deepEqual(events, ['filter', 'assert-reason', 'read']);
  reasons = ['别人的事由', '本轮事由'];
  await assert.rejects(list.expectReasonFilterResult('本轮事由'), /不匹配行/);
  reasons = [];
  events.length = 0;
  await assert.rejects(list.pickFirstDocNo({ keepListFilters: true }), /没有可解析单号/);
  assert.deepEqual(events, [], '保留筛选且空结果时不得清筛选或重新搜索');

  existingDocNo = 'OTHER-DRAFT';
  events.length = 0;
  await assert.rejects(list.startNewRequest(), (error) =>
    error instanceof actual.ExistingRequestDraftError && /独立账号.*人工确认/.test(error.message));
  assert.deepEqual(events, ['new', 'confirm-new'], '有单号即终止，不删除、不填表、不重试');
  existingDocNo = '';
  assert.ok(await list.startNewRequest() instanceof EditPage, '空白单据允许继续');

  for (const spec of ['submit-then-approve', 'travel-submit']) {
    const cases = [];
    const test = (_title, run) => cases.push(run);
    test.describe = (_title, run) => run();
    test.describe.configure = () => undefined;
    test.beforeAll = () => undefined;
    test.skip = () => undefined;
    test.setTimeout = () => undefined;
    load(`request-flow/tests/request/${spec}.spec.ts`, {
      '../../fixtures': { test },
      '../../pages/request-list.page': { ...actual, RequestListPage },
      '../../../approval-flow/pages/approval-list.page': { ApprovalListPage: class {} },
      '../../utils/env': { env: { writeEnabled: true } },
      '../../utils/random': { randomReason: () => '本轮事由' },
      '../../../src/utils/flow-step': { bindFlowStepCapture() {}, flowStep: async (_title, run) => run() },
    });
    events.length = 0;
    await cases[0]({ page: {}, apiGuard: { dismissMatching() {} } });
    assert.deepEqual(events.slice(-3), ['filter', 'assert-reason', 'read'], `${spec} 回退取号先校验且保留筛选`);
    assert.ok(!events.includes('clear'), `${spec} 不得读默认首行`);
    existingDocNo = 'OTHER-DRAFT';
    events.length = 0;
    await assert.rejects(cases[0]({ page: {}, apiGuard: { dismissMatching() {} } }),
      (error) => error instanceof actual.ExistingRequestDraftError);
    assert.equal(events.filter((event) => event === 'new').length, 1, `${spec} 不能重试未知归属草稿`);
    assert.ok(!events.includes('fill') && !events.includes('save') && !events.includes('submit'));
    existingDocNo = '';
  }
  pass('request-flow · 筛选取号与未知归属草稿安全契约');
}

verifyRequestSafety().catch((error) => fail('request-flow safety', error.stack || error.message)).then(() => {
  if (process.exitCode) {
    console.error('\nverify-request-flow-stable 失败');
  } else {
    console.log('\nverify-request-flow-stable 通过');
  }
});
