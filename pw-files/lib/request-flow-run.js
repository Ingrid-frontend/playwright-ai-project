const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { spawnTracked, spawnTsx, spawnPlaywright, killProcessTree, killProcessTreeHard } = require('./kill-proc');
const { send, logLine, stripAnsi, errText } = require('./ws-safe');
const { getEnvEntryResolved } = require('./repo-context');
const {
  logConcisePlaywrightFailures,
  parsePlaywrightFailures,
  parsePlaywrightSkips,
  parsePlaywrightResultJson,
  createPlaywrightLogSink,
  headedFailurePlaceholder,
} = require('./failure-report');
const { finalizeFlowRun, detectPipeline, flowScriptKey, readLastFlowRun } = require('./flow-run-common');
const { makeRunMarker, writeRunMarkerFile } = require('./flow-run-marker.js');
const { resolveGoldenSeed } = require('./golden-seed.js');
const repoEnv = require('../repo-env');
const { getFrontendRepoDefaults, prepareFrontendIndex, resolveFrontendRepoConfig } = require('./frontend-repo-sync');

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
  const prof = String(profileId || '').trim();
  if (prof && prof !== 'default') return '';
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
  const storageRel =
    repoEnv.resolveStorageStateRelDirect(repoRoot, envId, profile) ||
    repoEnv.resolveStorageStateRel(repoRoot, envId, profile) ||
    '';
  const storageCheck = storageRel ? repoEnv.validateStorageForRun(repoRoot, storageRel) : { ok: false, reason: '' };
  const snapshot = readSnapshot(repoRoot);
  const catalogCheck =
    snapshot && checkCatalogAgainstSnapshot
      ? checkCatalogAgainstSnapshot(snapshot)
      : { ok: true, warnings: snapshot ? [] : ['未探活，跳过 catalog 校验'] };
  const hasConfig = fs.existsSync(path.join(repoRoot, CONFIG_REL));
  const specs = listRequestFlowSpecs(repoRoot);
  const spec = String(msg.spec || DEFAULT_SPEC).trim() || DEFAULT_SPEC;
  const spawnEnv = buildSpawnEnv(session, deps, msg).spawnEnv;
  const withTests = Boolean(msg.withTests);
  const listed = hasConfig && withTests
    ? listRequestFlowTests(repoRoot, spec, spawnEnv)
    : { spec, tests: [], error: '' };
  const flowProfileIds = [
    ...repoEnv.listGoldenProfileIds(repoRoot, envId),
    ...repoEnv.listWriteProfileIds(repoRoot, envId),
  ].filter((id) => {
    const profiles = repoEnv.getEnvAccountConfig(repoRoot, envId)?.profiles;
    return profiles?.[id] || id === 'write' || id === 'golden';
  });
  const profileStorage = repoEnv.listProfilesStorageStatus(repoRoot, envId, flowProfileIds);
  return {
    ready: hasConfig,
    env: envId,
    accountProfile: profile,
    roleSlug: enriched.roleSlug,
    roleLabel: enriched.roleLabel,
    baseURL: resolved?.baseURL || 'https://dev.huilianyi.com',
    storageState: storageRel,
    hasStorage: storageCheck.ok,
    storageHint: storageCheck.ok ? '' : storageCheck.reason || '',
    configRel: CONFIG_REL,
    snapshotRel: snapshot ? SNAPSHOT_REL : '',
    snapshot: snapshotSummary(snapshot),
    catalogCheck,
    reportOpenPath: requestFlowReportHref(repoRoot),
    ...getFrontendRepoDefaults(envId),
    specs,
    defaultSpec: DEFAULT_SPEC,
    spec: listed.spec,
    tests: listed.tests,
    testsError: listed.error || '',
    skipTests: !withTests,
    profileStorage,
    lastRun: readLastFlowRun(repoRoot, 'request-flow'),
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
  const profileDefaults = repoEnv.resolveProfileFlowDefaults(repoRoot, envId, profile);
  const goldenSeed = resolveGoldenSeed(repoRoot, envId, roleSlug);
  const snapshotDocNo = String(snapshotSummary(readSnapshot(repoRoot))?.sampleDocNo || '').trim();
  const docNo = String(
    msg.docNo || profileDefaults.requestDocNo || goldenSeed.requestDocNo || snapshotDocNo || '',
  ).trim();
  if (docNo) spawnEnv.REQUEST_DOC_NO = docNo;
  else delete spawnEnv.REQUEST_DOC_NO;
  const formName = String(msg.formName || '').trim();
  if (formName) spawnEnv.REQUEST_FORM_NAME = formName;
  else delete spawnEnv.REQUEST_FORM_NAME;
  const filterKeyword = String(
    msg.filterKeyword || profileDefaults.requestFilterKeyword || goldenSeed.requestFilterKeyword || '',
  ).trim();
  if (filterKeyword) spawnEnv.REQUEST_FILTER_KEYWORD = filterKeyword;
  else delete spawnEnv.REQUEST_FILTER_KEYWORD;
  return { repoRoot, envId, profile, roleSlug, spawnEnv, storage: storageAbs };
}

async function streamProc(ws, session, procKey, cancelKey, label, cmd, args, opts) {
  if (session[cancelKey]) {
    return { ok: false, cancelled: true, exitCode: 130 };
  }
  let proc;
  try {
    proc = opts.spawnTsx
      ? opts.spawnTsx()
      : spawnTracked(cmd, args, {
          cwd: opts.cwd,
          env: opts.env,
        });
  } catch (e) {
    send(ws, 'error', { message: `${label} 启动失败: ${errText(e)}` });
    return { ok: false, exitCode: -1 };
  }
  session[procKey] = proc;
  const logSink = createPlaywrightLogSink({ ws });
  proc.stdout.on('data', (d) => logSink.feed(d.toString()));
  proc.stderr.on('data', (d) => logSink.feed(d.toString()));
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
  const cfg = resolveFrontendRepoConfig({ ...msg, repoRoot });
  const frontendRepo = cfg.url || cfg.localPath;
  const outRel = SNAPSHOT_REL;

  if (!fs.existsSync(flowDir(repoRoot))) {
    send(ws, 'error', { message: `未找到 ${FLOW_DIR}/ 目录` });
    send(ws, 'request-flow:probe:done', { ok: false });
    return;
  }

  session.requestFlowCancelled = false;
  send(ws, 'request-flow:probe:start', { env: envId, frontendRepo, outRel });
  logLine(ws, `[request-flow] 实机探活 · env=${envId} · ${frontendRepo} · ${ENTRY_PATH}`, 'info');

  const indexPrep = await prepareFrontendIndex(ws, repoRoot, msg, spawnEnv);
  if (!indexPrep.ok) {
    send(ws, 'error', { message: indexPrep.reason || '前端仓库同步/索引失败' });
    send(ws, 'request-flow:probe:done', { ok: false });
    return;
  }

  const args = [
    `--env=${envId}`,
    `--entry=${ENTRY_PATH}`,
    `--out=${outRel}`,
  ];
  const result = await streamProc(ws, session, 'requestFlowProc', 'requestFlowCancelled', 'request-flow/probe', null, args, {
    spawnTsx: () => spawnTsx(repoRoot, 'scripts/index-frontend/probe-live-page.ts', args, spawnEnv),
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
  const storageRel = repoEnv.resolveStorageStateRelDirect(repoRoot, envId, profile) ||
    repoEnv.resolveStorageStateRel(repoRoot, envId, profile);
  const storageCheck = repoEnv.validateStorageForRun(repoRoot, storageRel);
  if (!storageCheck.ok) {
    send(ws, 'error', {
      message: `${storageCheck.reason}，请重新登录 profile=${profile}`,
    });
    send(ws, 'request-flow:run:done', { ok: false, mode });
    return;
  }
  if (storageCheck.account) {
    logLine(ws, `[request-flow] 登录态: ${storageCheck.account} · ${storageRel}`, 'dim');
  }

  const args = ['test', '--config', configRel, spec];
  if (grep) args.push('--grep', grep);
  const headless = mode === 'headless';
  if (mode === 'headed') args.push('--headed');
  else if (mode === 'debug') args.push('--debug');
  else if (mode === 'ui') args.push('--ui');
  else if (headless) args.push('--reporter=line,json,html');

  const startTime = Date.now();
  const startedAt = new Date(startTime).toISOString();
  const runId = startedAt.replace(/[:.]/g, '-');
  const runMarker = makeRunMarker({
    custom: msg.runMarker,
    roleSlug,
    env: envId,
    spec,
    startedAt,
  });
  spawnEnv.FLOW_RUN_ID = runId;
  spawnEnv.FLOW_RUN_STARTED_AT = startedAt;
  spawnEnv.FLOW_RUN_MARKER = runMarker;
  spawnEnv.FLOW_SPEC = spec;
  spawnEnv.FLOW_RUN_MODE = mode;
  const scriptKey = flowScriptKey('request-flow', envId, spec, roleSlug);
  writeRunMarkerFile(
    path.join(repoRoot, 'screenshots', scriptKey, 'run-chromium-flow', runId),
    runMarker,
    { runId, flowId: 'request-flow', scriptKey, startedAt },
  );

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

  if (!session.requestFlowGoldenAllRun) session.requestFlowCancelled = false;
  let proc;
  try {
    proc = spawnPlaywright(repoRoot, args, spawnEnv);
  } catch (e) {
    send(ws, 'error', { message: `用例启动失败: ${errText(e)}` });
    send(ws, 'request-flow:run:done', { ok: false, mode, spec, grep, env: envId });
    return;
  }
  session.requestFlowProc = proc;

  let stdout = '';
  const logSink = createPlaywrightLogSink({ ws });
  proc.stdout.on('data', (d) => {
    const raw = d.toString();
    stdout += raw;
    logSink.feed(raw);
  });
  proc.stderr.on('data', (d) => {
    logSink.feed(d.toString());
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
  let skipped = 0;
  let skips = [];
  let failures = [];

  if (headless) {
    try {
      const result = parsePlaywrightResultJson(stdout);
      const s = result.stats || {};
      const expected = Number(s.expected) || 0;
      const unexpected = Number(s.unexpected) || 0;
      skipped = Number(s.skipped) || 0;
      const flaky = Number(s.flaky) || 0;
      passed = expected + flaky;
      failed = unexpected;
      total = expected + unexpected + skipped + flaky;
      skips = parsePlaywrightSkips(result);
      if (exitCode !== 0 || failed > 0) {
        failures = parsePlaywrightFailures(result, session, exitCode);
        session.lastRunFailures = failures;
        logConcisePlaywrightFailures('[request-flow] · ', failures, { limit: 3, ws });
      } else {
        session.lastRunFailures = [];
      }
      if (skipped > 0) {
        logLine(ws, `[request-flow] ${skipped} 个用例已跳过`, 'warn');
        for (const item of skips.slice(0, 5)) {
          logLine(ws, `[request-flow] 跳过 · ${item.title} — ${item.reason}`, 'warn');
        }
        if (skips.length > 5) {
          logLine(ws, `[request-flow] … 另有 ${skips.length - 5} 条跳过，见运行汇总`, 'warn');
        }
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

  const ok = exitCode === 0 && failed === 0 && (total <= 0 || passed === total);
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
    skipped,
    skips,
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
    runMarker,
    runUiAudit: Boolean(msg.runUiAudit),
    uiAuditLimit: Number(msg.uiAuditLimit) || 24,
  });

  send(ws, 'request-flow:run:done', finalized);
  if (ok) logLine(ws, '[request-flow] 用例通过', 'ok');
  else {
    const incomplete = exitCode === 0 && total > 0 && passed < total;
    if (finalized.apiFailureCount > 0) {
      logLine(ws, `[request-flow] 用例失败 · 接口报错 ${finalized.apiFailureCount} 条`, 'err');
    } else if (incomplete) {
      logLine(ws, `[request-flow] 用例未完成 · ${passed}/${total}${skipped > 0 ? `（${skipped} 跳过）` : ''}`, 'err');
    }
    if (finalized.replayReportOpenPath) {
      logLine(ws, `[request-flow] 步骤回放: ${finalized.replayReportOpenPath}`, 'warn');
    }
    if (finalized.manifest?.playwrightReportRel) {
      logLine(ws, `[request-flow] Playwright 报告: ${finalized.manifest.playwrightReportRel}`, 'dim');
    }
    if (finalized.manifest?.scriptKey) {
      logLine(ws, `[request-flow] 截图目录: screenshots/${finalized.manifest.scriptKey}`, 'dim');
    }
    const errMsg = finalized.apiFailureCount > 0
      ? `用例失败（退出码 ${exitCode}，${finalized.apiFailureCount} 个接口报错）`
      : exitCode !== 0 || failed > 0
        ? `用例退出码 ${exitCode}`
        : '';
    if (errMsg) send(ws, 'error', { message: errMsg });
  }
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

  session.requestFlowGoldenAllRun = true;
  session.requestFlowCancelled = false;
  send(ws, 'request-flow:golden-all:start', { env: envId, profiles: ready, total: ready.length });
  logLine(ws, `[request-flow] Golden 全角色回归 · ${ready.length} 个角色`, 'info');

  try {
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
  } finally {
    session.requestFlowGoldenAllRun = false;
  }
}

function cancelRequestFlow(session, ws) {
  session.requestFlowCancelled = true;
  if (session.requestFlowProc) {
    killProcessTree(session.requestFlowProc);
    setTimeout(() => {
      if (session.requestFlowProc) {
        killProcessTreeHard(session.requestFlowProc);
      }
    }, 400);
    if (ws) logLine(ws, '[request-flow] 已请求取消，正在终止进程…', 'warn');
  } else if (ws) {
    logLine(ws, '[request-flow] 当前无运行中的任务', 'dim');
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
