const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { spawnTracked, spawnTsx, spawnPlaywright, killProcessTree, killProcessTreeHard } = require('./kill-proc');
const { send, logLine, stripAnsi, errText } = require('./ws-safe');
const { getEnvEntryResolved } = require('./repo-context');
const {
  logConcisePlaywrightFailures,
  logPlaywrightFailureReport,
  parsePlaywrightFailures,
  parsePlaywrightSkips,
  parsePlaywrightResultJson,
  createPlaywrightLogSink,
  headedFailurePlaceholder,
} = require('./failure-report');
const { finalizeFlowRun, detectPipeline, flowScriptKey, readLastFlowRun } = require('./flow-run-common');
const { shouldUseGoldenCli, runStudioGoldenRun } = require('./flow-golden-cli');
const { makeRunMarker, writeRunMarkerFile } = require('./flow-run-marker.js');
const { createReportBatchId } = require('./report-batch.js');
const repoEnv = require('../repo-env');
const { getFrontendRepoDefaults, prepareFrontendIndex, resolveFrontendRepoConfig } = require('./frontend-repo-sync');

function sessionKeys(flowId) {
  const camel = flowId.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  return {
    proc: `${camel}Proc`,
    cancelled: `${camel}Cancelled`,
    goldenAllRun: `${camel}GoldenAllRun`,
  };
}

function resolveProfile(session, repoRoot, msg = {}) {
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

function pickSnapshotFrame(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const list = snapshot.list;
  if (list && Array.isArray(list.childFrames) && list.childFrames[0]) return list.childFrames[0];
  return list || snapshot;
}

function createFlowRun(cfg) {
  const FLOW_DIR = cfg.flowId;
  const CONFIG_REL = path.join(FLOW_DIR, 'playwright.config.ts');
  const SNAPSHOT_REL = path.join(FLOW_DIR, 'datasource/live-snapshot.json');
  const DEFAULT_SPEC = cfg.defaultSpec;
  const GOLDEN_SPEC = cfg.goldenSpec || cfg.defaultSpec;
  const keys = sessionKeys(cfg.flowId);
  const tag = `[${cfg.flowId}]`;
  const ev = cfg.flowId;

  const catalogCheckMod = (() => {
    if (!cfg.catalogCheckRel) return null;
    try {
      return require(path.join(__dirname, cfg.catalogCheckRel));
    } catch {
      return null;
    }
  })();
  const checkCatalogAgainstSnapshot = catalogCheckMod?.checkCatalogAgainstSnapshot || null;

  function flowDir(repoRoot) {
    return path.join(repoRoot, FLOW_DIR);
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

  function snapshotSummary(snapshot) {
    if (cfg.snapshotSummary) return cfg.snapshotSummary(snapshot, pickSnapshotFrame);
    const frame = pickSnapshotFrame(snapshot);
    if (!frame) return null;
    const searchInputs = frame.searchInputs || [];
    const searchPlaceholder =
      searchInputs.find((s) => String(s.placeholder || '').includes('单号'))?.placeholder || '';
    const apis = Array.isArray(snapshot.listApis) ? snapshot.listApis : [];
    const rows = apis[0]?.sample || snapshot.sampleRows || snapshot.pendingRows || [];
    const first = Array.isArray(rows) ? rows[0] : null;
    const docFromRow = first?.businessCode || first?.documentNumber || '';
    const docRe = cfg.docNoTextRe || /[A-Z]{2}\d{6,}/;
    const docFromText = String(frame.firstRowText || '').match(docRe);
    return {
      probedAt: snapshot.probedAt || snapshot.capturedAt || snapshot.generatedAt || '',
      headers: Array.isArray(frame.headers) ? frame.headers.filter((h) => h && h !== '+').slice(0, 12) : [],
      searchPlaceholder,
      inIframe: Boolean(snapshot.list?.iframeCount || snapshot.list?.iframeSrcs?.length),
      tbodyRows: frame.tbodyRows ?? 0,
      sampleDocNo: docFromRow || (docFromText ? docFromText[0] : ''),
      listApi: apis[0]?.url?.split('?')[0] || cfg.defaultListApi || '',
    };
  }

  function listFlowSpecs(repoRoot) {
    const dir = path.join(repoRoot, FLOW_DIR, 'tests', cfg.domain);
    if (!fs.existsSync(dir)) return [DEFAULT_SPEC];
    const specs = fs
      .readdirSync(dir)
      .filter((name) => name.endsWith('.spec.ts'))
      .sort()
      .map((name) => `${cfg.domain}/${name}`);
    return specs.length ? specs : [DEFAULT_SPEC];
  }

  function parsePlaywrightListOutput(text) {
    const domainPrefix = new RegExp(`^${cfg.domain}/`);
    const items = [];
    for (const raw of String(text || '').split('\n')) {
      const line = stripAnsi(raw).trim();
      if (!line.includes('›')) continue;
      const parts = line.split('›').map((s) => s.trim()).filter(Boolean);
      if (parts.length < 3) continue;
      const titleParts = parts.slice(2);
      const label = titleParts.join(' › ');
      const grep = titleParts[titleParts.length - 1] || label;
      if (!grep || domainPrefix.test(grep)) continue;
      items.push({ grep, label });
    }
    return items;
  }

  function listFlowTests(repoRoot, specRel, spawnEnv = process.env) {
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

  function reportOpenPath() {
    return `${FLOW_DIR}/playwright-report/index.html`;
  }

  function reportHref(repoRoot) {
    const rel = reportOpenPath();
    return fs.existsSync(path.join(repoRoot, rel)) ? `/repo-report/${rel}` : '';
  }

  function applySpawnFields(spawnEnv, msg, profileDefaults, goldenSeed, snapshotDocNo) {
    if (msg.writeEnabled) spawnEnv[cfg.writeEnvVar] = '1';
    else delete spawnEnv[cfg.writeEnvVar];
    for (const field of cfg.spawnFields || []) {
      const fromMsg = field.msgKey ? msg[field.msgKey] : undefined;
      const fromProfile = field.profileKey ? profileDefaults[field.profileKey] : undefined;
      const fromSeed = field.seedKey ? goldenSeed[field.seedKey] : undefined;
      const fromSnapshot = field.useSnapshot ? snapshotDocNo : '';
      const val = String(fromMsg ?? fromProfile ?? fromSeed ?? fromSnapshot ?? '').trim();
      if (val) spawnEnv[field.envVar] = val;
      else delete spawnEnv[field.envVar];
    }
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
    const profileDefaults = repoEnv.resolveProfileFlowDefaults(repoRoot, envId, profile);
    const goldenSeed = cfg.resolveGoldenSeed(repoRoot, envId, roleSlug);
    const snapshotDocNo = String(snapshotSummary(readSnapshot(repoRoot))?.sampleDocNo || '').trim();
    applySpawnFields(spawnEnv, msg, profileDefaults, goldenSeed, snapshotDocNo);
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

  function getFlowStatus(repoRoot, session, deps, msg = {}) {
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
    const specs = listFlowSpecs(repoRoot);
    const spec = String(msg.spec || DEFAULT_SPEC).trim() || DEFAULT_SPEC;
    const spawnEnv = buildSpawnEnv(session, deps, msg).spawnEnv;
    const withTests = Boolean(msg.withTests);
    const listed = hasConfig && withTests
      ? listFlowTests(repoRoot, spec, spawnEnv)
      : { spec, tests: [], error: '' };
    const flowProfileIds = [
      ...repoEnv.listGoldenProfileIds(repoRoot, envId),
      ...repoEnv.listWriteProfileIds(repoRoot, envId),
    ].filter((id) => {
      const profiles = repoEnv.getEnvAccountConfig(repoRoot, envId)?.profiles;
      return profiles?.[id] || id === 'write' || id === 'golden';
    });
    const profileStorage = repoEnv.listProfilesStorageStatus(repoRoot, envId, flowProfileIds);
    const status = {
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
      reportOpenPath: reportHref(repoRoot),
      ...getFrontendRepoDefaults(envId),
      specs,
      defaultSpec: DEFAULT_SPEC,
      spec: listed.spec,
      tests: listed.tests,
      testsError: listed.error || '',
      skipTests: !withTests,
      profileStorage,
      lastRun: readLastFlowRun(repoRoot, cfg.flowId),
    };
    if (cfg.includeGoldenSpecInStatus) status.goldenSpec = GOLDEN_SPEC;
    return status;
  }

  function sendFlowStatus(ws, session, deps, msg = {}) {
    const repoRoot = deps.resolveRepoRoot();
    send(ws, `${ev}:status`, getFlowStatus(repoRoot, session, deps, msg));
  }

  function sendFlowTestList(ws, session, deps, msg = {}) {
    const repoRoot = deps.resolveRepoRoot();
    const { spawnEnv } = buildSpawnEnv(session, deps, msg);
    const listed = listFlowTests(repoRoot, msg.spec, spawnEnv);
    send(ws, `${ev}:tests`, listed);
  }

  async function runFlowProbe(ws, session, msg, deps) {
    const { repoRoot, envId, spawnEnv } = buildSpawnEnv(session, deps, msg);
    const frontendCfg = resolveFrontendRepoConfig({ ...msg, repoRoot });
    const frontendRepo = frontendCfg.url || frontendCfg.localPath;
    const outRel = SNAPSHOT_REL;

    if (!fs.existsSync(flowDir(repoRoot))) {
      send(ws, 'error', { message: `未找到 ${FLOW_DIR}/ 目录` });
      send(ws, `${ev}:probe:done`, { ok: false });
      return;
    }

    session[keys.cancelled] = false;
    send(ws, `${ev}:probe:start`, { env: envId, frontendRepo, outRel });
    logLine(ws, `${tag} 实机探活 · env=${envId} · ${frontendRepo} · ${cfg.entryPath}`, 'info');

    const indexPrep = await prepareFrontendIndex(ws, repoRoot, msg, spawnEnv);
    if (!indexPrep.ok) {
      send(ws, 'error', { message: indexPrep.reason || '前端仓库同步/索引失败' });
      send(ws, `${ev}:probe:done`, { ok: false });
      return;
    }

    const args = [`--env=${envId}`, `--entry=${cfg.entryPath}`, `--out=${outRel}`];
    const result = await streamProc(ws, session, keys.proc, keys.cancelled, `${ev}/probe`, null, args, {
      spawnTsx: () => spawnTsx(repoRoot, 'scripts/index-frontend/probe-live-page.ts', args, spawnEnv),
      cwd: repoRoot,
      env: spawnEnv,
    });

    const status = getFlowStatus(repoRoot, session, deps, msg);
    send(ws, `${ev}:probe:done`, { ...result, ...status });
    if (result.ok) logLine(ws, `${tag} 探活完成 · ${outRel}`, 'ok');
    else if (!result.cancelled) send(ws, 'error', { message: `探活退出码 ${result.exitCode}` });
  }

  async function runFlowTests(ws, session, msg, deps) {
    if (msg.goldenAll) {
      return runFlowGoldenAll(ws, session, msg, deps);
    }
    const mode = String(msg.mode || 'headless').trim();
    const spec = String(msg.spec || DEFAULT_SPEC).trim() || DEFAULT_SPEC;
    if (shouldUseGoldenCli({ ...msg, spec, mode })) {
      return runStudioGoldenRun(ws, session, cfg.flowId, { ...msg, spec, mode }, deps, { send, logLine });
    }
    const { repoRoot, envId, profile, roleSlug, spawnEnv, storage } = buildSpawnEnv(session, deps, msg);
    const grep = msg.grep === undefined || msg.grep === null ? '' : String(msg.grep);

    if (!fs.existsSync(path.join(repoRoot, CONFIG_REL))) {
      send(ws, 'error', { message: `未找到 ${CONFIG_REL}` });
      send(ws, `${ev}:run:done`, { ok: false, mode });
      return;
    }
    if (!storage) {
      const relHint = repoEnv.resolveStorageStateRel(repoRoot, envId, profile) || `storage/loginState/${envId}.json`;
      send(ws, 'error', {
        message: `缺少登录态 profile=${profile}（${relHint}），请先在侧栏用该档案登录`,
      });
      send(ws, `${ev}:run:done`, { ok: false, mode });
      return;
    }
    const storageRel = repoEnv.resolveStorageStateRelDirect(repoRoot, envId, profile) ||
      repoEnv.resolveStorageStateRel(repoRoot, envId, profile);
    const storageCheck = repoEnv.validateStorageForRun(repoRoot, storageRel);
    if (!storageCheck.ok) {
      send(ws, 'error', {
        message: `${storageCheck.reason}，请重新登录 profile=${profile}`,
      });
      send(ws, `${ev}:run:done`, { ok: false, mode });
      return;
    }
    if (storageCheck.account) {
      logLine(ws, `${tag} 登录态: ${storageCheck.account} · ${storageRel}`, 'dim');
    }

    const args = ['test', '--config', CONFIG_REL, spec];
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
    const scriptKey = flowScriptKey(cfg.flowId, envId, spec, roleSlug);
    writeRunMarkerFile(
      path.join(repoRoot, 'screenshots', scriptKey, 'run-chromium-flow', runId),
      runMarker,
      { runId, flowId: cfg.flowId, scriptKey, startedAt },
    );

    send(ws, `${ev}:run:start`, {
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
      `${tag} 运行用例 · profile=${profile}${roleSlug ? ` · role=${roleSlug}` : ''} · mode=${mode} · ${spec}${grep ? ` · grep=${grep}` : ''}`,
      'info',
    );

    if (!session[keys.goldenAllRun]) session[keys.cancelled] = false;
    let proc;
    try {
      proc = spawnPlaywright(repoRoot, args, spawnEnv);
    } catch (e) {
      send(ws, 'error', { message: `用例启动失败: ${errText(e)}` });
      send(ws, `${ev}:run:done`, { ok: false, mode, spec, grep, env: envId });
      return;
    }
    session[keys.proc] = proc;

    let stdout = '';
    const logSink = createPlaywrightLogSink({ ws });
    proc.stdout.on('data', (d) => {
      const raw = d.toString();
      stdout += raw;
      logSink.feed(raw);
    });
    proc.stderr.on('data', (d) => logSink.feed(d.toString()));

    const exitCode = await new Promise((resolve) => proc.on('close', resolve));
    session[keys.proc] = null;

    if (session[keys.cancelled]) {
      logLine(ws, `${tag}/test 已取消`, 'warn');
      send(ws, `${ev}:run:done`, {
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
          if (cfg.failureMode === 'report') {
            failures = logPlaywrightFailureReport(ws, result, session, exitCode);
          } else {
            failures = parsePlaywrightFailures(result, session, exitCode);
            session.lastRunFailures = failures;
            logConcisePlaywrightFailures(`${tag} · `, failures, { limit: 3, ws });
          }
        } else {
          session.lastRunFailures = [];
        }
        if (skipped > 0) {
          logLine(ws, `${tag} ${skipped} 个用例已跳过`, 'warn');
          for (const item of skips.slice(0, 5)) {
            logLine(ws, `${tag} 跳过 · ${item.title} — ${item.reason}`, 'warn');
          }
          if (skips.length > 5) {
            logLine(ws, `${tag} … 另有 ${skips.length - 5} 条跳过，见运行汇总`, 'warn');
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
      logLine(ws, `${tag} 有界面模式已结束，请在浏览器窗口查看结果`, 'info');
      passed = exitCode === 0 ? 1 : 0;
      failed = exitCode === 0 ? 0 : 1;
      total = 1;
      if (exitCode !== 0) {
        failures = headedFailurePlaceholder(specRelative);
        session.lastRunFailures = failures;
      }
    }

    const ok = exitCode === 0 && failed === 0 && (total <= 0 || passed === total);
    const reportRel = reportOpenPath();
    const reportOpenPathVal = reportHref(repoRoot);

    const finalized = finalizeFlowRun(repoRoot, cfg.flowId, cfg.flowLabel, {
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
      playwrightReportDir: `${FLOW_DIR}/playwright-report`,
      reportHint: reportRel,
      reportOpenPath: reportOpenPathVal,
      pipeline: msg.pipeline || detectPipeline(spec, msg),
      accountProfile: profile,
      roleSlug,
      runMarker,
      runUiAudit: Boolean(msg.runUiAudit),
      uiAuditLimit: Number(msg.uiAuditLimit) || 24,
    });

    send(ws, `${ev}:run:done`, finalized);
    if (ok) {
      logLine(ws, `${tag} 用例通过`, 'ok');
      return;
    }
    if (cfg.verboseRunErrors) {
      const incomplete = exitCode === 0 && total > 0 && passed < total;
      if (finalized.apiFailureCount > 0) {
        logLine(ws, `${tag} 用例失败 · 接口报错 ${finalized.apiFailureCount} 条`, 'err');
      } else if (incomplete) {
        logLine(ws, `${tag} 用例未完成 · ${passed}/${total}${skipped > 0 ? `（${skipped} 跳过）` : ''}`, 'err');
      }
      if (finalized.replayReportOpenPath) {
        logLine(ws, `${tag} 步骤回放: ${finalized.replayReportOpenPath}`, 'warn');
      }
      if (finalized.manifest?.playwrightReportRel) {
        logLine(ws, `${tag} Playwright 报告: ${finalized.manifest.playwrightReportRel}`, 'dim');
      }
      if (finalized.manifest?.scriptKey) {
        logLine(ws, `${tag} 截图目录: screenshots/${finalized.manifest.scriptKey}`, 'dim');
      }
      const errMsg = finalized.apiFailureCount > 0
        ? `用例失败（退出码 ${exitCode}，${finalized.apiFailureCount} 个接口报错）`
        : exitCode !== 0 || failed > 0
          ? `用例退出码 ${exitCode}`
          : '';
      if (errMsg) send(ws, 'error', { message: errMsg });
    } else {
      send(ws, 'error', { message: `用例退出码 ${exitCode}` });
    }
  }

  async function runFlowGoldenAll(ws, session, msg, deps) {
    const repoRoot = deps.resolveRepoRoot();
    const { getSessionPlaywrightEnv } = deps;
    const envId = String(msg.env || getSessionPlaywrightEnv(session) || 'dev').trim();
    const goldenIds = repoEnv.listGoldenProfileIds(repoRoot, envId);
    const ready = [];
    for (const id of goldenIds) {
      const rel = repoEnv.resolveStorageStateRelDirect(repoRoot, envId, id);
      const check = repoEnv.validateStorageForRun(repoRoot, rel);
      if (check.ok) ready.push(id);
      else logLine(ws, `${tag} 忽略 ${id}: ${check.reason || '无有效登录态'}`, 'warn');
    }

    if (!ready.length) {
      send(ws, 'error', { message: '无已登录 Golden 角色，请先为 golden* 档案完成登录' });
      send(ws, `${ev}:golden-all:done`, { ok: false, results: [], env: envId });
      return;
    }

    const spec = String(msg.spec || GOLDEN_SPEC).trim();
    const reportBatchId = createReportBatchId(cfg.flowId, envId);
    session[keys.goldenAllRun] = true;
    session[keys.cancelled] = false;
    send(ws, `${ev}:golden-all:start`, {
      env: envId,
      profiles: ready,
      total: ready.length,
      reportBatchId,
      viaCli: true,
    });
    logLine(ws, `${tag} Golden 全角色回归 · CLI · ${ready.length} 个角色`, 'info');

    const goldenMsg = {
      ...msg,
      spec,
      reportBatchId,
      reportBatchExpected: ready.length,
      pipeline: 'golden',
      writeEnabled: false,
      mode: 'headless',
      ...(cfg.goldenAllExtras ? cfg.goldenAllExtras(msg) : {}),
    };

    try {
      const result = await runStudioGoldenRun(
        ws,
        session,
        cfg.flowId,
        goldenMsg,
        deps,
        { send, logLine },
      );
      if (result.ok && !result.cancelled) {
        const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
        logLine(ws, `${tag} 检测完成，生成飞书预览 deliver:ready --env=${envId}`, 'info');
        const ready = spawnSync(npm, ['run', 'deliver:ready', '--', `--env=${envId}`], {
          cwd: repoRoot,
          encoding: 'utf8',
          env: process.env,
          maxBuffer: 16 * 1024 * 1024,
        });
        const tail = `${ready.stdout || ''}${ready.stderr || ''}`.trim().split('\n').slice(-6);
        for (const line of tail) {
          if (line.trim()) logLine(ws, line.trimEnd(), ready.status === 0 ? 'dim' : 'warn');
        }
        if (ready.status !== 0) {
          logLine(ws, `${tag} 飞书预览未生成（退出码 ${ready.status ?? 1}），点「写入飞书」时会再试一次`, 'warn');
        }
      }
      send(ws, `${ev}:golden-all:done`, {
        ok: Boolean(result.ok),
        env: envId,
        goldenBatch: result.goldenBatch || null,
        batchHeadline: result.batchSummary?.headline || '',
        reportBatchId,
        customerReportOpenPath: result.customerReportOpenPath || '',
        results: ready.map((profileId) => {
          const entry = repoEnv.enrichProfileStorageEntry(repoRoot, envId, profileId);
          return { profile: profileId, roleSlug: entry.roleSlug, roleLabel: entry.roleLabel };
        }),
        cancelled: Boolean(result.cancelled),
        viaCli: true,
      });
    } finally {
      session[keys.goldenAllRun] = false;
    }
  }

  function cancelFlow(session, ws) {
    session[keys.cancelled] = true;
    if (session[keys.proc]) {
      killProcessTree(session[keys.proc]);
      setTimeout(() => {
        if (session[keys.proc]) {
          killProcessTreeHard(session[keys.proc]);
        }
      }, 400);
      if (ws) logLine(ws, `${tag} 已请求取消，正在终止进程…`, 'warn');
    } else if (ws) {
      logLine(ws, `${tag} 当前无运行中的任务`, 'dim');
    }
  }

  return {
    getFlowStatus,
    sendFlowStatus,
    sendFlowTestList,
    listFlowSpecs,
    listFlowTests,
    runFlowProbe,
    runFlowTests,
    runFlowGoldenAll,
    cancelFlow,
    DEFAULT_SPEC,
    GOLDEN_SPEC,
  };
}

module.exports = { createFlowRun, sessionKeys, flowScriptKey };
