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

if (/ensureTravelReadyForSubmit/.test(editSrc) && /tripDatesReady\(root\)/.test(editSrc)) {
  pass('RequestEditPage.submit · save 后自动轻量 submit');
} else {
  fail('RequestEditPage.submit', '缺少 tripDatesReady 自动判断');
}

if (process.exitCode) {
  console.error('\nverify-request-flow-stable 失败');
} else {
  console.log('\nverify-request-flow-stable 通过');
}
