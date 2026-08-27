const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { send, logLine, stripAnsi, errText } = require('./ws-safe');
const { getEnvEntryResolved } = require('./repo-context');
const {
  logPlaywrightFailureReport,
  parsePlaywrightFailures,
  parsePlaywrightResultJson,
  headedFailurePlaceholder,
} = require('./failure-report');
const { finalizeFlowRun, detectPipeline, flowScriptKey } = require('./flow-run-common');
const repoEnv = require('../repo-env');

const catalogCheckMod = (() => {
  try {
    return require(path.join(__dirname, '../../request-flow/utils/catalog-check.cjs'));
  } catch {
    return null;
  }
})();
const checkCatalogAgainstSnapshot = catalogCheckMod?.checkCatalogAgainstSnapshot || null;

const FLOW_DIR = 'request-flow';
const CONFIG_REL = path.join(FLOW_DIR, 'playwright.config.ts');
const SNAPSHOT_REL = path.join(FLOW_DIR, 'datasource/live-snapshot.json');
const DEFAULT_FRONTEND_REPO = '/Users/hly/project/huilianyi-refactoring';
const ENTRY_PATH = '/main/request';

function flowDir(repoRoot) {
  return path.join(repoRoot, FLOW_DIR);
}

function resolveProfile(session, repoRoot, msg = {}) {
  const envId = String(msg.env || '').trim();
  const override = String(msg.accountProfile || '').trim();
  if (override) return override;
  const { getSessionAccountProfile } = require('./repo-context');
  return getSessionAccountProfile(session, repoRoot);
}

function resolveStorageAbs(repoRoot, envId, profileId) {
  const rel = repoEnv.resolveStorageStateRelDirect(repoRoot, envId, profileId);
  if (rel && repoEnv.storageExists(repoRoot, rel)) {
    return path.resolve(repoRoot, rel);
  }
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

const DEFAULT_SPEC = 'request/full-flow.spec.ts';

function listRequestFlowSpecs(repoRoot) {
  const dir = path.join(repoRoot, FLOW_DIR, 'tests', 'request');
  if (!fs.existsSync(dir)) return [DEFAULT_SPEC];
  const specs = fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.spec.ts'))
    .sort()
    .map((name) => `request/${name}`);
  return specs.length ? specs : [DEFAULT_SPEC];
}

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
    if (!grep || /^request\//.test(grep)) continue;
    items.push({ grep, label });
  }
  return items;
}

function listRequestFlowTests(repoRoot, specRel, spawnEnv = process.env) {
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

function requestFlowReportOpenPath() {
  return 'request-flow/playwright-report/index.html';
}

function requestFlowReportHref(repoRoot) {
  const rel = requestFlowReportOpenPath();
  return fs.existsSync(path.join(repoRoot, rel)) ? `/repo-report/${rel}` : '';
}

function snapshotSummary(snapshot) {
  const frame = pickSnapshotFrame(snapshot);
  if (!frame) return null;
  const searchInputs = frame.searchInputs || [];
  const searchPlaceholder =
    searchInputs.find((s) => String(s.placeholder || '').includes('单号'))?.placeholder || '';
  const apis = Array.isArray(snapshot.listApis) ? snapshot.listApis : [];
  const rows = apis[0]?.sample || snapshot.sampleRows || [];
  const first = Array.isArray(rows) ? rows[0] : null;
  const docFromRow = first?.businessCode || first?.documentNumber || '';
  const docFromText = String(frame.firstRowText || '').match(/(?:EA|ER|AR|BX|CD|comic)\w{6,}/i);
  return {
    probedAt: snapshot.probedAt || snapshot.capturedAt || snapshot.generatedAt || '',
    headers: Array.isArray(frame.headers) ? frame.headers.filter((h) => h && h !== '+').slice(0, 12) : [],
    searchPlaceholder,
    inIframe: Boolean(snapshot.list?.iframeCount || snapshot.list?.iframeSrcs?.length),
    tbodyRows: frame.tbodyRows ?? 0,
    sampleDocNo: docFromRow || (docFromText ? docFromText[0] : ''),
    listApi: apis[0]?.url?.split('?')[0] || '/api/applications/v4/search',
  };
}

function getRequestFlowStatus(repoRoot, session, deps, msg = {}) {
  const { getSessionPlaywrightEnv } = deps;
  const envId = String(msg.env || getSessionPlaywrightEnv(session) || 'dev').trim();
  const profile = resolveProfile(session, repoRoot, { env: envId, accountProfile: msg.accountProfile });
  const resolved = getEnvEntryResolved(repoRoot, envId, profile);
  const enriched = repoEnv.enrichProfileStorageEntry(repoRoot, envId, profile);
  const storageAbs = resolveStorageAbs(repoRoot, envId, profile);
  const storageRel = storageAbs ? path.relative(repoRoot, storageAbs).replace(/\\/g, '/') : '';
  const snapshot = readSnapshot(repoRoot);
  const catalogCheck =
    snapshot && checkCatalogAgainstSnapshot
      ? checkCatalogAgainstSnapshot(snapshot)
      : { ok: true, warnings: snapshot ? [] : ['未探活，跳过 catalog 校验'] };
  const hasConfig = fs.existsSync(path.join(repoRoot, CONFIG_REL));
  const specs = listRequestFlowSpecs(repoRoot);
  const spec = String(msg.spec || DEFAULT_SPEC).trim() || DEFAULT_SPEC;
  const spawnEnv = buildSpawnEnv(session, deps, msg).spawnEnv;
  const listed = hasConfig ? listRequestFlowTests(repoRoot, spec, spawnEnv) : { spec, tests: [], error: '' };
  const flowProfileIds = [
    ...repoEnv.listGoldenProfileIds(repoRoot, envId),
    'write',
  ].filter((id) => id === 'write' || repoEnv.getEnvAccountConfig(repoRoot, envId)?.profiles?.[id]);
  const profileStorage = repoEnv.listProfilesStorageStatus(repoRoot, envId, flowProfileIds);
  return {
    ready: hasConfig,
    env: envId,
    accountProfile: profile,
    roleSlug: enriched.roleSlug,
    roleLabel: enriched.roleLabel,
    baseURL: resolved?.baseURL || 'https://dev.huilianyi.com',
    storageState: storageRel,
    hasStorage: Boolean(storageAbs),
    configRel: CONFIG_REL,
    snapshotRel: snapshot ? SNAPSHOT_REL : '',
    snapshot: snapshotSummary(snapshot),
    catalogCheck,
    reportOpenPath: requestFlowReportHref(repoRoot),
    frontendRepoDefault: DEFAULT_FRONTEND_REPO,
    specs,
    defaultSpec: DEFAULT_SPEC,
    spec: listed.spec,
    tests: listed.tests,
    testsError: listed.error || '',
    profileStorage,
  };
}

function sendRequestFlowStatus(ws, session, deps, msg = {}) {
  const repoRoot = deps.resolveRepoRoot();
  send(ws, 'request-flow:status', getRequestFlowStatus(repoRoot, session, deps, msg));
}

function sendRequestFlowTestList(ws, session, deps, msg = {}) {
  const repoRoot = deps.resolveRepoRoot();
  const { spawnEnv } = buildSpawnEnv(session, deps, msg);
  const listed = listRequestFlowTests(repoRoot, msg.spec, spawnEnv);
  send(ws, 'request-flow:tests', listed);
}

function buildSpawnEnv(session, deps, msg = {}) {
  const repoRoot = deps.resolveRepoRoot();
  const { getSessionPlaywrightEnv, buildRepoSpawnEnv } = deps;
  const envId = String(msg.env || getSessionPlaywrightEnv(session) || 'dev').trim();
  const profile = resolveProfile(session, repoRoot, { env: envId, accountProfile: msg.accountProfile });
  const resolved = getEnvEntryResolved(repoRoot, envId, profile);
  const spawnEnv = buildRepoSpawnEnv(session, profile, envId);
  spawnEnv.BASE_URL = String(msg.baseURL || resolved?.baseURL || 'https://dev.huilianyi.com').trim();
  spawnEnv.PLAYWRIGHT_ENV = envId;
  spawnEnv.PLAYWRIGHT_ACCOUNT = profile;
  spawnEnv.FLOW_SPEC = String(msg.spec || DEFAULT_SPEC).trim() || DEFAULT_SPEC;
  const storageAbs = resolveStorageAbs(repoRoot, envId, profile);
  if (storageAbs) spawnEnv.STORAGE_STATE = storageAbs;
  const roleSlug = repoEnv.resolveFlowRoleSlug(repoRoot, envId, profile);
  if (roleSlug) spawnEnv.FLOW_ACCOUNT_SLUG = roleSlug;
  else delete spawnEnv.FLOW_ACCOUNT_SLUG;
  const creds = repoEnv.resolveAccountCredentials(repoRoot, envId, profile);
  if (creds) {
    spawnEnv.LOGIN_USERNAME = creds.username;
    spawnEnv.LOGIN_PASSWORD = creds.password;
  }
  if (msg.writeEnabled) spawnEnv.REQUEST_ENABLE_WRITE = '1';
  else delete spawnEnv.REQUEST_ENABLE_WRITE;
  const docNo = String(msg.docNo || '').trim();
  if (docNo) spawnEnv.REQUEST_DOC_NO = docNo;
  else delete spawnEnv.REQUEST_DOC_NO;
  const formName = String(msg.formName || '').trim();
  if (formName) spawnEnv.REQUEST_FORM_NAME = formName;
  else delete spawnEnv.REQUEST_FORM_NAME;
  const filterKeyword = String(msg.filterKeyword || '').trim();
  if (filterKeyword) spawnEnv.REQUEST_FILTER_KEYWORD = filterKeyword;
  else delete spawnEnv.REQUEST_FILTER_KEYWORD;
  return { repoRoot, envId, profile, roleSlug, spawnEnv, storage: storageAbs };
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

async function runRequestFlowProbe(ws, session, msg, deps) {
  const { repoRoot, envId, spawnEnv } = buildSpawnEnv(session, deps, msg);
  const frontendRepo = String(msg.frontendRepo || DEFAULT_FRONTEND_REPO).trim();
  const outRel = SNAPSHOT_REL;
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

  if (!fs.existsSync(flowDir(repoRoot))) {
    send(ws, 'error', { message: `未找到 ${FLOW_DIR}/ 目录` });
    send(ws, 'request-flow:probe:done', { ok: false });
    return;
  }

  send(ws, 'request-flow:probe:start', { env: envId, frontendRepo, outRel });
  logLine(ws, `[request-flow] 实机探活 · env=${envId} · ${frontendRepo} · ${ENTRY_PATH}`, 'info');

  const args = [
    'tsx',
    'scripts/index-frontend/probe-live-page.ts',
    `--env=${envId}`,
    `--entry=${ENTRY_PATH}`,
    `--out=${outRel}`,
  ];
  const result = await streamProc(ws, session, 'requestFlowProc', 'requestFlowCancelled', 'request-flow/probe', npx, args, {
    spawn: deps.spawn,
    cwd: repoRoot,
    env: spawnEnv,
  });

  const status = getRequestFlowStatus(repoRoot, session, deps, msg);
  send(ws, 'request-flow:probe:done', { ...result, ...status });
  if (result.ok) logLine(ws, `[request-flow] 探活完成 · ${outRel}`, 'ok');
  else if (!result.cancelled) send(ws, 'error', { message: `探活退出码 ${result.exitCode}` });
}

async function runRequestFlowTests(ws, session, msg, deps) {
  if (msg.goldenAll) {
    return runRequestFlowGoldenAll(ws, session, msg, deps);
  }
  const { repoRoot, envId, profile, roleSlug, spawnEnv, storage } = buildSpawnEnv(session, deps, msg);
  const configRel = CONFIG_REL;
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const mode = String(msg.mode || 'headless').trim();
  const spec = String(msg.spec || DEFAULT_SPEC).trim() || DEFAULT_SPEC;
  const grep = msg.grep === undefined || msg.grep === null ? '' : String(msg.grep);

  if (!fs.existsSync(path.join(repoRoot, configRel))) {
    send(ws, 'error', { message: `未找到 ${configRel}` });
    send(ws, 'request-flow:run:done', { ok: false, mode });
    return;
  }
  if (!storage) {
    const relHint = repoEnv.resolveStorageStateRel(repoRoot, envId, profile) || `storage/loginState/${envId}.json`;
    send(ws, 'error', {
      message: `缺少登录态 profile=${profile}（${relHint}），请先在侧栏用该档案登录`,
    });
    send(ws, 'request-flow:run:done', { ok: false, mode });
    return;
  }

  const args = ['playwright', 'test', '--config', configRel, spec];
  if (grep) args.push('--grep', grep);
  const headless = mode === 'headless';
  if (mode === 'headed') args.push('--headed');
  else if (mode === 'debug') args.push('--debug');
  else if (mode === 'ui') args.push('--ui');
  else if (headless) args.push('--reporter=json,html');

  const startTime = Date.now();
  const startedAt = new Date(startTime).toISOString();
  const runId = startedAt.replace(/[:.]/g, '-');
  spawnEnv.FLOW_RUN_ID = runId;
  spawnEnv.FLOW_RUN_STARTED_AT = startedAt;
  spawnEnv.FLOW_SPEC = spec;
  spawnEnv.FLOW_RUN_MODE = mode;

  send(ws, 'request-flow:run:start', {
    env: envId,
    accountProfile: profile,
    roleSlug,
    roleLabel: repoEnv.enrichProfileStorageEntry(repoRoot, envId, profile).roleLabel,
    mode,
    spec,
    grep,
  });
  logLine(
    ws,
    `[request-flow] 运行用例 · profile=${profile}${roleSlug ? ` · role=${roleSlug}` : ''} · mode=${mode} · ${spec}${grep ? ` · grep=${grep}` : ''}`,
    'info',
  );

  session.requestFlowCancelled = false;
  let proc;
  try {
    proc = deps.spawn(npx, args, { cwd: repoRoot, env: spawnEnv, shell: false });
  } catch (e) {
    send(ws, 'error', { message: `用例启动失败: ${errText(e)}` });
    send(ws, 'request-flow:run:done', { ok: false, mode, spec, grep, env: envId });
    return;
  }
  session.requestFlowProc = proc;

  let stdout = '';
  proc.stdout.on('data', (d) => {
    const raw = d.toString();
    stdout += raw;
    if (!headless) {
      const t = stripAnsi(raw);
      if (t.trim()) logLine(ws, t.trimEnd(), 'dim');
    }
  });
  proc.stderr.on('data', (d) => {
    const t = stripAnsi(d.toString());
    if (t.trim()) logLine(ws, t.trimEnd(), 'warn');
  });

  const exitCode = await new Promise((resolve) => proc.on('close', resolve));
  session.requestFlowProc = null;

  if (session.requestFlowCancelled) {
    logLine(ws, '[request-flow/test] 已取消', 'warn');
    send(ws, 'request-flow:run:done', {
      ok: false,
      cancelled: true,
      mode,
      spec,
      grep,
      env: envId,
    });
    return;
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  const specRelative = path.join(FLOW_DIR, 'tests', spec).replace(/\\/g, '/');
  let passed = 0;
  let failed = 0;
  let total = 0;
  let failures = [];

  if (headless) {
    try {
      const result = parsePlaywrightResultJson(stdout);
      const s = result.stats || {};
      const expected = Number(s.expected) || 0;
      const unexpected = Number(s.unexpected) || 0;
      const skipped = Number(s.skipped) || 0;
      const flaky = Number(s.flaky) || 0;
      passed = expected + flaky;
      failed = unexpected;
      total = expected + unexpected + skipped + flaky;
      if (exitCode !== 0 || failed > 0) {
        failures = logPlaywrightFailureReport(ws, result, session, exitCode);
      } else {
        session.lastRunFailures = [];
      }
    } catch {
      passed = exitCode === 0 ? 1 : 0;
      failed = exitCode === 0 ? 0 : 1;
      total = 1;
      if (exitCode !== 0) {
        failures = parsePlaywrightFailures({ suites: [] }, session, exitCode);
        session.lastRunFailures = failures;
      }
    }
  } else {
    logLine(ws, '[request-flow] 有界面模式已结束，请在浏览器窗口查看结果', 'info');
    passed = exitCode === 0 ? 1 : 0;
    failed = exitCode === 0 ? 0 : 1;
    total = 1;
    if (exitCode !== 0) {
      failures = headedFailurePlaceholder(specRelative);
      session.lastRunFailures = failures;
    }
  }

  const ok = exitCode === 0 && failed === 0;
  const reportRel = requestFlowReportOpenPath();
  const reportOpenPath = requestFlowReportHref(repoRoot);

  const finalized = finalizeFlowRun(repoRoot, 'request-flow', '申请单流程', {
    ok,
    exitCode,
    cancelled: false,
    mode,
    spec,
    grep,
    env: envId,
    passed,
    failed,
    total,
    duration,
    runId,
    startedAt,
    finishedAt: new Date().toISOString(),
    failures,
    specRelative,
    runMode: mode,
    playwrightReportDir: 'request-flow/playwright-report',
    reportHint: reportRel,
    reportOpenPath,
    pipeline: msg.pipeline || detectPipeline(spec, msg),
    accountProfile: profile,
    roleSlug,
    runUiAudit: Boolean(msg.runUiAudit),
    uiAuditLimit: Number(msg.uiAuditLimit) || 24,
  });

  send(ws, 'request-flow:run:done', finalized);
  if (ok) logLine(ws, '[request-flow] 用例通过', 'ok');
  else send(ws, 'error', { message: `用例退出码 ${exitCode}` });
}

async function runRequestFlowGoldenAll(ws, session, msg, deps) {
  const repoRoot = deps.resolveRepoRoot();
  const { getSessionPlaywrightEnv } = deps;
  const envId = String(msg.env || getSessionPlaywrightEnv(session) || 'dev').trim();
  const goldenIds = repoEnv.listGoldenProfileIds(repoRoot, envId);
  const ready = goldenIds.filter((id) => {
    const rel = repoEnv.resolveStorageStateRelDirect(repoRoot, envId, id);
    return repoEnv.storageExists(repoRoot, rel);
  });

  if (!ready.length) {
    send(ws, 'error', { message: '无已登录 Golden 角色，请先为 golden* 档案完成登录' });
    send(ws, 'request-flow:golden-all:done', { ok: false, results: [], env: envId });
    return;
  }

  const filterKeyword =
    msg.filterKeyword != null
      ? String(msg.filterKeyword).trim()
      : String(process.env.REQUEST_FILTER_KEYWORD || '').trim();
  const spec = String(msg.spec || 'request/golden-regression.spec.ts').trim();
  const results = [];

  send(ws, 'request-flow:golden-all:start', { env: envId, profiles: ready, total: ready.length });
  logLine(ws, `[request-flow] Golden 全角色回归 · ${ready.length} 个角色`, 'info');

  for (let i = 0; i < ready.length; i++) {
    if (session.requestFlowCancelled) break;
    const profileId = ready[i];
    const entry = repoEnv.enrichProfileStorageEntry(repoRoot, envId, profileId);
    logLine(ws, `[request-flow] Golden 角色 ${i + 1}/${ready.length}: ${entry.roleLabel} (${profileId})`, 'info');
    await runRequestFlowTests(ws, session, {
      ...msg,
      goldenAll: false,
      accountProfile: profileId,
      spec,
      pipeline: 'golden',
      writeEnabled: false,
      filterKeyword: filterKeyword || '测试',
      mode: 'headless',
    }, deps);
    results.push({
      profile: profileId,
      roleSlug: entry.roleSlug,
      roleLabel: entry.roleLabel,
    });
  }

  send(ws, 'request-flow:golden-all:done', {
    ok: results.length > 0 && !session.requestFlowCancelled,
    env: envId,
    results,
    cancelled: Boolean(session.requestFlowCancelled),
  });
}

function cancelRequestFlow(session) {
  session.requestFlowCancelled = true;
  if (session.requestFlowProc) {
    try {
      session.requestFlowProc.kill('SIGTERM');
    } catch {
      /* ignore */
    }
  }
}

module.exports = {
  getRequestFlowStatus,
  sendRequestFlowStatus,
  sendRequestFlowTestList,
  listRequestFlowSpecs,
  listRequestFlowTests,
  runRequestFlowProbe,
  runRequestFlowTests,
  runRequestFlowGoldenAll,
  cancelRequestFlow,
  DEFAULT_SPEC,
  flowScriptKey,
};
