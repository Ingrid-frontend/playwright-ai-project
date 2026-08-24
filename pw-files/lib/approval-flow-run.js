const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { send, logLine, stripAnsi, errText } = require('./ws-safe');
const { getEnvEntryResolved } = require('./repo-context');

const FLOW_DIR = 'approval-flow';
const CONFIG_REL = path.join(FLOW_DIR, 'playwright.config.ts');
const SNAPSHOT_REL = path.join(FLOW_DIR, 'datasource/live-snapshot.json');
const DEFAULT_FRONTEND_REPO = '/Users/hly/project/huilianyi-refactoring';

function flowDir(repoRoot) {
  return path.join(repoRoot, FLOW_DIR);
}

function resolveStorage(repoRoot, envId) {
  const ids = [envId, 'dev'].filter(Boolean);
  for (const id of ids) {
    const p = path.join(repoRoot, 'storage/loginState', `${id}.json`);
    if (fs.existsSync(p)) return p;
  }
  return '';
}

function readSnapshot(repoRoot) {
  const abs = path.join(repoRoot, SNAPSHOT_REL);
  if (!fs.existsSync(abs)) return null;
  try {
    return JSON.parse(fs.readFileSync(abs, 'utf-8'));
  } catch {
    return null;
  }
}

function pickSnapshotFrame(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const list = snapshot.list;
  if (list && Array.isArray(list.childFrames) && list.childFrames[0]) return list.childFrames[0];
  return list || snapshot;
}

const DEFAULT_SPEC = 'approval/full-flow.spec.ts';

function listApprovalFlowSpecs(repoRoot) {
  const dir = path.join(repoRoot, FLOW_DIR, 'tests', 'approval');
  if (!fs.existsSync(dir)) return [DEFAULT_SPEC];
  const specs = fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.spec.ts'))
    .sort()
    .map((name) => `approval/${name}`);
  return specs.length ? specs : [DEFAULT_SPEC];
}

/** 解析 playwright test --list 输出为 { grep, label }[] */
function parsePlaywrightListOutput(text) {
  const items = [];
  for (const raw of String(text || '').split('\n')) {
    const line = stripAnsi(raw).trim();
    if (!line.includes('›')) continue;
    const parts = line.split('›').map((s) => s.trim()).filter(Boolean);
    if (parts.length < 3) continue;
    const titleParts = parts.slice(2);
    const label = titleParts.join(' › ');
    const grep = titleParts[titleParts.length - 1] || label;
    if (!grep || /^approval\//.test(grep)) continue;
    items.push({ grep, label });
  }
  return items;
}

function listApprovalFlowTests(repoRoot, specRel, spawnEnv = process.env) {
  const spec = String(specRel || DEFAULT_SPEC).trim() || DEFAULT_SPEC;
  const configAbs = path.join(repoRoot, CONFIG_REL);
  if (!fs.existsSync(configAbs)) return { spec, tests: [], error: `未找到 ${CONFIG_REL}` };
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const proc = spawnSync(npx, ['playwright', 'test', '--config', CONFIG_REL, spec, '--list'], {
    cwd: repoRoot,
    env: spawnEnv,
    encoding: 'utf8',
    maxBuffer: 2 * 1024 * 1024,
  });
  const out = `${proc.stdout || ''}\n${proc.stderr || ''}`;
  if (proc.error) {
    return { spec, tests: [], error: errText(proc.error) };
  }
  if (proc.status !== 0 && !/Listing tests:/i.test(out)) {
    return { spec, tests: [], error: stripAnsi(out).trim().slice(0, 400) || `list 退出码 ${proc.status}` };
  }
  return { spec, tests: parsePlaywrightListOutput(out), error: '' };
}

function snapshotSummary(snapshot) {
  const frame = pickSnapshotFrame(snapshot);
  if (!frame) return null;
  const tabs = (frame.tabs || []).filter((t) => /待审批|已办|抄送|操作历史/.test(String(t)));
  const searchInputs = frame.searchInputs || [];
  const searchPlaceholder =
    searchInputs.find((s) => String(s.placeholder || '').includes('单号'))?.placeholder || '';
  const apis = Array.isArray(snapshot.listApis) ? snapshot.listApis : [];
  const rows = apis[0]?.sample || snapshot.sampleRows || snapshot.pendingRows || [];
  const first = Array.isArray(rows) ? rows[0] : null;
  const docFromRow = first?.businessCode || first?.documentNumber || '';
  const docFromText = String(frame.firstRowText || '').match(/[A-Z]{2}\d{6,}/);
  return {
    probedAt: snapshot.probedAt || snapshot.generatedAt || '',
    tabs: tabs.slice(0, 8),
    headers: Array.isArray(frame.headers) ? frame.headers.filter((h) => h && h !== '+').slice(0, 12) : [],
    searchPlaceholder,
    inIframe: Boolean(snapshot.list?.iframeCount || snapshot.list?.iframeSrcs?.length),
    tbodyRows: frame.tbodyRows ?? 0,
    sampleDocNo: docFromRow || (docFromText ? docFromText[0] : ''),
    listApi: apis[0]?.url?.split('?')[0] || '/api/approvals/pendingApproval',
  };
}

function getApprovalFlowStatus(repoRoot, session, deps, msg = {}) {
  const { getSessionPlaywrightEnv, getSessionAccountProfile } = deps;
  const envId = String(msg.env || getSessionPlaywrightEnv(session) || 'dev').trim();
  const profile = getSessionAccountProfile(session, repoRoot);
  const resolved = getEnvEntryResolved(repoRoot, envId, profile);
  const storage = resolveStorage(repoRoot, envId);
  const snapshot = readSnapshot(repoRoot);
  const hasConfig = fs.existsSync(path.join(repoRoot, CONFIG_REL));
  const specs = listApprovalFlowSpecs(repoRoot);
  const spec = String(msg.spec || DEFAULT_SPEC).trim() || DEFAULT_SPEC;
  const spawnEnv = buildSpawnEnv(session, deps, msg).spawnEnv;
  const listed = hasConfig ? listApprovalFlowTests(repoRoot, spec, spawnEnv) : { spec, tests: [], error: '' };
  return {
    ready: hasConfig,
    env: envId,
    baseURL: resolved?.baseURL || 'https://dev.huilianyi.com',
    storageState: storage,
    hasStorage: Boolean(storage),
    configRel: CONFIG_REL,
    snapshotRel: snapshot ? SNAPSHOT_REL : '',
    snapshot: snapshotSummary(snapshot),
    frontendRepoDefault: DEFAULT_FRONTEND_REPO,
    specs,
    defaultSpec: DEFAULT_SPEC,
    spec: listed.spec,
    tests: listed.tests,
    testsError: listed.error || '',
  };
}

function sendApprovalFlowStatus(ws, session, deps, msg = {}) {
  const repoRoot = deps.resolveRepoRoot();
  send(ws, 'approval-flow:status', getApprovalFlowStatus(repoRoot, session, deps, msg));
}

function sendApprovalFlowTestList(ws, session, deps, msg = {}) {
  const repoRoot = deps.resolveRepoRoot();
  const { spawnEnv } = buildSpawnEnv(session, deps, msg);
  const listed = listApprovalFlowTests(repoRoot, msg.spec, spawnEnv);
  send(ws, 'approval-flow:tests', listed);
}

function buildSpawnEnv(session, deps, msg = {}) {
  const repoRoot = deps.resolveRepoRoot();
  const { getSessionPlaywrightEnv, getSessionAccountProfile, buildRepoSpawnEnv } = deps;
  const envId = String(msg.env || getSessionPlaywrightEnv(session) || 'dev').trim();
  const profile = getSessionAccountProfile(session, repoRoot);
  const resolved = getEnvEntryResolved(repoRoot, envId, profile);
  const spawnEnv = buildRepoSpawnEnv(session, profile, envId);
  spawnEnv.BASE_URL = String(msg.baseURL || resolved?.baseURL || 'https://dev.huilianyi.com').trim();
  const storage = resolveStorage(repoRoot, envId);
  if (storage) spawnEnv.STORAGE_STATE = storage;
  if (msg.writeEnabled) spawnEnv.APPROVAL_ENABLE_WRITE = '1';
  else delete spawnEnv.APPROVAL_ENABLE_WRITE;
  const docNo = String(msg.docNo || '').trim();
  if (docNo) spawnEnv.APPROVAL_DOC_NO = docNo;
  else delete spawnEnv.APPROVAL_DOC_NO;
  return { repoRoot, envId, spawnEnv, storage };
}

async function streamProc(ws, session, procKey, cancelKey, label, cmd, args, opts) {
  session[cancelKey] = false;
  let proc;
  try {
    proc = opts.spawn(cmd, args, {
      cwd: opts.cwd,
      env: opts.env,
      shell: false,
    });
  } catch (e) {
    send(ws, 'error', { message: `${label} 启动失败: ${errText(e)}` });
    return { ok: false, exitCode: -1 };
  }
  session[procKey] = proc;
  proc.stdout.on('data', (d) => {
    const t = stripAnsi(d.toString());
    if (t.trim()) logLine(ws, t.trimEnd(), 'dim');
  });
  proc.stderr.on('data', (d) => {
    const t = stripAnsi(d.toString());
    if (t.trim()) logLine(ws, t.trimEnd(), 'warn');
  });
  const exitCode = await new Promise((resolve) => proc.on('close', resolve));
  session[procKey] = null;
  if (session[cancelKey]) {
    logLine(ws, `[${label}] 已取消`, 'warn');
    return { ok: false, cancelled: true, exitCode };
  }
  return { ok: exitCode === 0, exitCode };
}

async function runApprovalFlowProbe(ws, session, msg, deps) {
  const { repoRoot, envId, spawnEnv } = buildSpawnEnv(session, deps, msg);
  const frontendRepo = String(msg.frontendRepo || DEFAULT_FRONTEND_REPO).trim();
  const outRel = SNAPSHOT_REL;
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

  if (!fs.existsSync(flowDir(repoRoot))) {
    send(ws, 'error', { message: `未找到 ${FLOW_DIR}/ 目录` });
    send(ws, 'approval-flow:probe:done', { ok: false });
    return;
  }

  send(ws, 'approval-flow:probe:start', { env: envId, frontendRepo, outRel });
  logLine(ws, `[approval-flow] 实机探活 · env=${envId} · ${frontendRepo} · /main/approve`, 'info');

  const args = [
    'tsx',
    'scripts/index-frontend/probe-live-page.ts',
    `--env=${envId}`,
    '--entry=/main/approve',
    `--out=${outRel}`,
  ];
  const result = await streamProc(ws, session, 'approvalFlowProc', 'approvalFlowCancelled', 'approval-flow/probe', npx, args, {
    spawn: deps.spawn,
    cwd: repoRoot,
    env: spawnEnv,
  });

  const status = getApprovalFlowStatus(repoRoot, session, deps, msg);
  send(ws, 'approval-flow:probe:done', { ...result, ...status });
  if (result.ok) logLine(ws, `[approval-flow] 探活完成 · ${outRel}`, 'ok');
  else if (!result.cancelled) send(ws, 'error', { message: `探活退出码 ${result.exitCode}` });
}

async function runApprovalFlowTests(ws, session, msg, deps) {
  const { repoRoot, envId, spawnEnv } = buildSpawnEnv(session, deps, msg);
  const configRel = CONFIG_REL;
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const mode = String(msg.mode || 'headless').trim();
  const spec = String(msg.spec || DEFAULT_SPEC).trim() || DEFAULT_SPEC;
  const grep = msg.grep === undefined || msg.grep === null ? '' : String(msg.grep);

  if (!fs.existsSync(path.join(repoRoot, configRel))) {
    send(ws, 'error', { message: `未找到 ${configRel}` });
    send(ws, 'approval-flow:run:done', { ok: false, mode });
    return;
  }
  if (!resolveStorage(repoRoot, envId)) {
    send(ws, 'error', { message: `缺少登录态 storage/loginState/${envId}.json，请先在侧栏登录` });
    send(ws, 'approval-flow:run:done', { ok: false, mode });
    return;
  }

  const args = ['playwright', 'test', '--config', configRel, spec];
  if (grep) args.push('--grep', grep);
  if (mode === 'headed') args.push('--headed');
  else if (mode === 'debug') args.push('--debug');
  else if (mode === 'ui') args.push('--ui');
  else if (mode === 'headless') {
    /* default */
  }

  send(ws, 'approval-flow:run:start', { env: envId, mode, spec, grep });
  logLine(ws, `[approval-flow] 运行用例 · mode=${mode} · ${spec}${grep ? ` · grep=${grep}` : ''}`, 'info');

  const result = await streamProc(ws, session, 'approvalFlowProc', 'approvalFlowCancelled', 'approval-flow/test', npx, args, {
    spawn: deps.spawn,
    cwd: repoRoot,
    env: spawnEnv,
  });

  send(ws, 'approval-flow:run:done', {
    ...result,
    mode,
    spec,
    grep,
    env: envId,
    reportHint: 'approval-flow/playwright-report/index.html',
  });
  if (result.ok) logLine(ws, '[approval-flow] 用例通过', 'ok');
  else if (!result.cancelled) send(ws, 'error', { message: `用例退出码 ${result.exitCode}` });
}

function cancelApprovalFlow(session) {
  session.approvalFlowCancelled = true;
  if (session.approvalFlowProc) {
    try {
      session.approvalFlowProc.kill('SIGTERM');
    } catch {
      /* ignore */
    }
  }
}

module.exports = {
  getApprovalFlowStatus,
  sendApprovalFlowStatus,
  sendApprovalFlowTestList,
  listApprovalFlowSpecs,
  listApprovalFlowTests,
  runApprovalFlowProbe,
  runApprovalFlowTests,
  cancelApprovalFlow,
  DEFAULT_SPEC,
};
