const fs = require('fs');
const path = require('path');
const { spawnTsx, killProcessTreeHard, stopProcessTree } = require('./kill-proc');
const { send, logLine, errText } = require('./ws-safe');
const { createPlaywrightLogSink, parsePlaywrightResultJson, parsePlaywrightFailures } = require('./failure-report');
const { resolveCatalogAbs, readCatalogForm, writeCatalogForm } = require('./catalog-form-io');
const { readLastFlowRun } = require('./flow-run-common');
const repoEnv = require('../repo-env');


function deriveFlowMeta(label, entry, tabbed = false) {
  const rawEntry = String(entry || '').trim();
  const entryPath = rawEntry.startsWith('/') ? rawEntry : `/${rawEntry}`;
  const seg = entryPath.split('/').filter(Boolean).pop() || 'flow';
  const domain = seg.replace(/[^a-zA-Z0-9_-]/g, '') || 'biz';
  const id = `${domain}-flow`;
  return {
    id,
    label: String(label || '').trim() || id,
    entry: entryPath,
    domain,
    tabbed: Boolean(tabbed),
  };
}

function queryFlowJson(repoRoot, scriptRel, args, maxBytes) {
  return new Promise((resolve, reject) => {
    const proc = spawnTsx(repoRoot, scriptRel, args, process.env, { localOnly: true });
    const stdout = [];
    const stderr = [];
    let bytes = 0;
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // Reject at the deadline even if close is delayed; session ownership is retained
      // independently until the child really closes.
      killProcessTreeHard(proc);
      reject(error);
    };
    const timer = setTimeout(() => fail(new Error('读取流程列表失败: 查询超时')), 15000);
    const collect = (chunks, data) => {
      if (settled) return;
      const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data);
      bytes += chunk.length;
      if (bytes > maxBytes) {
        fail(new Error('读取流程列表失败: 输出超出限制'));
        return;
      }
      chunks.push(chunk);
    };
    proc.stdout?.on('data', (data) => collect(stdout, data));
    proc.stderr?.on('data', (data) => collect(stderr, data));
    proc.once('error', fail);
    proc.once('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const out = Buffer.concat(stdout).toString('utf8').trim();
      if (code !== 0 || !out) {
        reject(new Error(stripErr(Buffer.concat(stderr).toString('utf8')) || '读取流程列表失败'));
        return;
      }
      try {
        resolve(JSON.parse(out));
      } catch (error) {
        reject(error);
      }
    });
  });
}

async function resolveEntry(repoRoot, label, entryHint = '') {
  const args = [`--label=${String(label || '').trim()}`];
  const hint = String(entryHint || '').trim();
  if (hint) args.push(`--entry=${hint}`);
  try {
    return await queryFlowJson(repoRoot, 'scripts/flow/resolve-flow-entry.ts', args, 1024 * 1024);
  } catch {
    return null;
  }
}

async function listFlowsFromRegistry(repoRoot) {
  const flows = await queryFlowJson(repoRoot, 'scripts/flow/flow-registry-json.ts', [], 4 * 1024 * 1024);
  if (!Array.isArray(flows)) throw new Error('读取流程列表失败');
  return flows;
}

function stripErr(text) {
  return String(text || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(-3)
    .join(' ');
}

async function getFlowFromRegistry(repoRoot, flowId) {
  const flows = await listFlowsFromRegistry(repoRoot);
  return flows.find((f) => f.id === flowId) || null;
}

function buildSpawnEnv(session, deps, msg = {}) {
  const repoRoot = deps.resolveRepoRoot();
  const envId = String(msg.env || deps.getSessionPlaywrightEnv(session) || 'dev').trim();
  const profileHint = String(msg.accountProfile || deps.getSessionAccountProfile(session, repoRoot) || '').trim();
  const { abs: storageAbs, profileId: profile } = resolveStorageAbs(repoRoot, envId, profileHint);
  const spawnEnv = deps.buildRepoSpawnEnv(session, repoRoot, { env: envId, accountProfile: profile });
  if (storageAbs) {
    spawnEnv.STORAGE_STATE = storageAbs;
    spawnEnv.STORAGE_STATE_PATH = storageAbs;
  }
  return { repoRoot, envId, profile, profileHint, spawnEnv, storageAbs };
}

function resolveStorageAbs(repoRoot, envId, profileId) {
  const hint = String(profileId || '').trim();
  const tryProfile = (id) => {
    const rel = repoEnv.resolveStorageStateRelDirect(repoRoot, envId, id);
    if (rel && repoEnv.storageExists(repoRoot, rel)) {
      return { abs: path.resolve(repoRoot, rel), profileId: id };
    }
    return null;
  };

  if (hint && hint !== 'default') {
    const hit = tryProfile(hint);
    if (hit) return hit;
    return { abs: '', profileId: hint };
  }

  const def = tryProfile('default');
  if (def) return def;

  const found = repoEnv.findAvailableProfileStorage(repoRoot, envId);
  if (found?.storageState && repoEnv.storageExists(repoRoot, found.storageState)) {
    return { abs: path.resolve(repoRoot, found.storageState), profileId: found.profileId };
  }

  for (const id of [envId, 'dev'].filter(Boolean)) {
    const p = path.join(repoRoot, 'storage/loginState', `${id}.json`);
    if (fs.existsSync(p)) return { abs: p, profileId: 'default' };
  }
  return { abs: '', profileId: hint || 'default' };
}

async function streamProc(ws, session, procKey, cancelKey, label, spawnFn) {
  const out = await streamProcCapture(ws, session, procKey, cancelKey, label, spawnFn);
  return { ok: out.ok, exitCode: out.exitCode, cancelled: out.cancelled };
}

async function streamProcCapture(ws, session, procKey, cancelKey, label, spawnFn) {
  if (session.flowConfigCancelled) {
    return { ok: false, cancelled: true, exitCode: 130, stdout: '', stderr: '' };
  }
  let proc;
  try {
    proc = spawnFn();
  } catch (e) {
    send(ws, 'error', { message: `${label} 启动失败: ${errText(e)}` });
    return { ok: false, exitCode: -1, stdout: '', stderr: '' };
  }
  session[procKey] = proc;
  const logSink = createPlaywrightLogSink({ ws });
  let stdout = '';
  let stderr = '';
  proc.stdout?.on('data', (d) => {
    const chunk = d.toString();
    stdout += chunk;
    logSink.feed(chunk);
  });
  proc.stderr?.on('data', (d) => {
    const chunk = d.toString();
    stderr += chunk;
    logSink.feed(chunk);
  });
  const exitCode = await new Promise((resolve) => proc.on('close', resolve));
  session[procKey] = null;
  if (session.flowConfigCancelled) {
    logLine(ws, `[flow-config] ${label} 已取消`, 'warn');
    return { ok: false, cancelled: true, exitCode, stdout, stderr };
  }
  return { ok: exitCode === 0, exitCode, stdout, stderr };
}

function collectPlaywrightTests(result) {
  const items = [];
  const walk = (suites, prefix = '') => {
    for (const suite of suites || []) {
      const suiteTitle = String(suite.title || '').trim();
      const nextPrefix = suiteTitle ? (prefix ? `${prefix} › ${suiteTitle}` : suiteTitle) : prefix;
      for (const spec of suite.specs || []) {
        const specTitle = String(spec.title || '未命名用例').trim();
        const title = nextPrefix ? `${nextPrefix} › ${specTitle}` : specTitle;
        for (const test of spec.tests || []) {
          const status = String(test.status || '').trim();
          const ok = status === 'expected' || (spec.ok !== false && status !== 'unexpected');
          items.push({ title, ok, status: status || (ok ? 'expected' : 'unexpected') });
        }
      }
      walk(suite.suites, nextPrefix);
    }
  };
  walk(result?.suites);
  return items;
}

function summarizePlaywrightStdout(stdout, exitCode) {
  const empty = { passed: 0, failed: 0, total: 0, skipped: 0, tests: [], failures: [] };
  const text = String(stdout || '').trim();
  if (!text) return empty;
  try {
    const result = parsePlaywrightResultJson(text);
    const s = result.stats || {};
    const expected = Number(s.expected) || 0;
    const unexpected = Number(s.unexpected) || 0;
    const skipped = Number(s.skipped) || 0;
    const flaky = Number(s.flaky) || 0;
    const passed = expected + flaky;
    const failed = unexpected;
    const total = passed + failed + skipped;
    const tests = collectPlaywrightTests(result);
    const failures = parsePlaywrightFailures(result, null, exitCode).map((item) => ({
      title: item.title || '未命名用例',
      message: item.message || '',
      hint: item.hint || '',
    }));
    return { passed, failed, total, skipped, tests, failures };
  } catch {
    return empty;
  }
}

async function flowStatus(repoRoot, flowId) {
  const flow = await getFlowFromRegistry(repoRoot, flowId);
  const domain = flow?.domain || flowId.replace(/-flow$/, '');
  const flowDir = path.join(repoRoot, flowId);
  const snapshotRel = `${flowId}/datasource/live-snapshot.json`;
  const catalogHit = resolveCatalogAbs(repoRoot, flowId, domain);
  const catalogForm = catalogHit ? readCatalogForm(catalogHit.abs) : null;
  return {
    flowId,
    label: flow?.label || flowId,
    entry: flow?.entry || '',
    hasDir: fs.existsSync(flowDir),
    hasSnapshot: fs.existsSync(path.join(repoRoot, snapshotRel)),
    snapshotRel,
    catalogRel: catalogHit?.rel || '',
    catalogForm,
    registered: Boolean(flow),
  };
}

async function sendFlowConfigList(ws, deps) {
  try {
    const repoRoot = deps.resolveRepoRoot();
    const flows = await listFlowsFromRegistry(repoRoot);
    send(ws, 'flow:config:list:done', { ok: true, flows });
  } catch (e) {
    send(ws, 'flow:config:list:done', { ok: false, message: errText(e), flows: [] });
  }
}

async function sendFlowConfigStatus(ws, msg, deps) {
  try {
    const repoRoot = deps.resolveRepoRoot();
    const flowId = String(msg.flowId || '').trim();
    if (!flowId) {
      send(ws, 'flow:config:status:done', { ok: false, message: '缺少 flowId' });
      return;
    }
    send(ws, 'flow:config:status:done', { ok: true, ...await flowStatus(repoRoot, flowId) });
  } catch (e) {
    send(ws, 'flow:config:status:done', { ok: false, message: errText(e) });
  }
}

async function runFlowConfigSetup(ws, session, msg, deps) {
  const { repoRoot, envId, profile, profileHint, spawnEnv, storageAbs } = buildSpawnEnv(session, deps, msg);
  const label = String(msg.label || msg.flowId || '').trim();
  const entryHint = String(msg.entry || '').trim();

  session.flowConfigCancelled = false;

  const emitStep = (step, text) => {
    send(ws, 'flow:config:setup:step', { flowId: msg.flowId || '', step, text });
    logLine(ws, `[flow-config] ${text}`, 'info');
  };

  if (!label && !entryHint) {
    send(ws, 'flow:config:setup:done', {
      ok: false,
      flowId: String(msg.flowId || '').trim(),
      message: '请填写流程名称',
      step: 'resolve',
    });
    return;
  }

  emitStep('resolve', '正在从菜单路由表解析入口…');
  const resolved = await resolveEntry(repoRoot, label, entryHint);
  if (session.cancelled || session.flowConfigCancelled) return;
  if (!resolved?.entry) {
    send(ws, 'flow:config:setup:done', {
      ok: false,
      flowId: String(msg.flowId || '').trim(),
      message: '无法解析页面入口。请填写以 /main/ 开头的路由，或使用菜单名称如「报销单」',
      step: 'resolve',
    });
    return;
  }

  const meta = msg.flowId
    ? { ...deriveFlowMeta(label, resolved.entry, msg.tabbed), id: msg.flowId }
    : deriveFlowMeta(label, resolved.entry, msg.tabbed);
  const flowId = meta.id;
  const flowDir = path.join(repoRoot, flowId);
  const snapshotRel = `${flowId}/datasource/live-snapshot.json`;

  send(ws, 'flow:config:setup:start', { flowId, label: meta.label, entry: meta.entry });
  const resolveNote = resolved.menuLabel ? `（${resolved.menuLabel}）` : '';
  logLine(ws, `[flow-config] 入口 ${meta.entry}${resolveNote}`, 'info');

  if (!storageAbs) {
    send(ws, 'flow:config:setup:done', {
      ok: false,
      flowId,
      message: profile
        ? `账号「${profile}」无有效登录态，请在配置区选择已就绪的 Golden 账号或点登录`
        : '请先在配置区选择 Golden 账号并登录，再分析页面',
      step: 'login',
    });
    return;
  }

  if ((!profileHint || profileHint === 'default') && profile && profile !== 'default') {
    logLine(ws, `[flow-config] 自动选用登录态 · ${profile}`, 'info');
  }

  if (!fs.existsSync(flowDir)) {
    emitStep('new', '正在创建流程…');
    const args = [
      `--id=${flowId}`,
      `--label=${meta.label}`,
      `--entry=${meta.entry}`,
      `--domain=${meta.domain}`,
    ];
    const result = await streamProc(ws, session, 'flowConfigProc', 'flowConfigCancelled', '创建流程', () =>
      spawnTsx(repoRoot, 'scripts/flow/new-flow.ts', args, spawnEnv),
    );
    if (!result.ok) {
      send(ws, 'flow:config:setup:done', {
        ok: false,
        flowId,
        message: '创建流程失败，请查看控制台日志',
        step: 'new',
      });
      return;
    }
  }

  emitStep('probe', '正在分析页面…');
  const probeArgs = [`--env=${envId}`, `--entry=${meta.entry}`, `--out=${snapshotRel}`];
  const probeResult = await streamProc(ws, session, 'flowConfigProc', 'flowConfigCancelled', '分析页面', () =>
    spawnTsx(repoRoot, 'scripts/index-frontend/probe-live-page.ts', probeArgs, spawnEnv),
  );
  if (!probeResult.ok) {
    send(ws, 'flow:config:setup:done', {
      ok: false,
      flowId,
      message: probeResult.cancelled ? '已取消' : '分析页面失败，请确认已登录且入口地址正确',
      step: 'probe',
    });
    return;
  }

  emitStep('catalog', '正在生成页面描述…');
  const catalogArgs = [`--flow=${flowId}`, '--force'];
  const catalogResult = await streamProc(ws, session, 'flowConfigProc', 'flowConfigCancelled', '生成页面描述', () =>
    spawnTsx(repoRoot, 'scripts/flow/gen-catalog-from-probe.ts', catalogArgs, spawnEnv),
  );
  if (!catalogResult.ok) {
    send(ws, 'flow:config:setup:done', {
      ok: false,
      flowId,
      message: catalogResult.cancelled ? '已取消' : '生成页面描述失败',
      step: 'catalog',
    });
    return;
  }

  const st = await flowStatus(repoRoot, flowId);
  send(ws, 'flow:config:setup:done', {
    ok: true,
    flowId,
    label: meta.label,
    entry: meta.entry,
    catalogRel: st.catalogRel,
    catalogForm: st.catalogForm,
    message: '配置完成，请确认下列信息后试跑',
  });
  logLine(ws, `[flow-config] ${meta.label} 配置完成`, 'ok');
}

async function saveFlowConfigCatalog(ws, msg, deps) {
  try {
    const repoRoot = deps.resolveRepoRoot();
    const flowId = String(msg.flowId || '').trim();
    const flow = await getFlowFromRegistry(repoRoot, flowId);
    const domain = flow?.domain || flowId.replace(/-flow$/, '');
    const hit = resolveCatalogAbs(repoRoot, flowId, domain);
    if (!hit) {
      send(ws, 'flow:config:catalog-save:done', { ok: false, message: '未找到页面描述文件' });
      return;
    }
    const tabsRaw = msg.tabs;
    const tabs = Array.isArray(tabsRaw)
      ? tabsRaw.map((t) => String(t).trim()).filter(Boolean)
      : String(tabsRaw || '')
          .split(/[,，\n]/)
          .map((t) => t.trim())
          .filter(Boolean);
    const catalogForm = writeCatalogForm(hit.abs, {
      searchPlaceholder: String(msg.searchPlaceholder ?? '').trim(),
      docNoColumn: String(msg.docNoColumn ?? '').trim(),
      tabs,
    });
    send(ws, 'flow:config:catalog-save:done', {
      ok: true,
      flowId,
      catalogRel: hit.rel,
      catalogForm,
    });
    logLine(ws, `[flow-config] 已保存页面描述 · ${hit.rel}`, 'ok');
  } catch (e) {
    send(ws, 'flow:config:catalog-save:done', { ok: false, message: errText(e) });
  }
}

async function runFlowConfigTryRun(ws, session, msg, deps) {
  const { repoRoot, envId, spawnEnv } = buildSpawnEnv(session, deps, msg);
  const flowId = String(msg.flowId || '').trim();
  if (!flowId) {
    send(ws, 'flow:config:try-run:done', { ok: false, message: '缺少 flowId' });
    return;
  }

  session.flowConfigCancelled = false;
  const flow = await getFlowFromRegistry(repoRoot, flowId);
  if (session.cancelled || session.flowConfigCancelled) return;
  if (!flow?.goldenRunner) {
    send(ws, 'flow:config:try-run:done', {
      ok: false,
      flowId,
      message: '该流程尚未接入 Golden 试跑',
    });
    return;
  }

  const grep = String(msg.grep || '列表').trim() || '列表';
  const spec = flow.goldenSpec;
  const runnerRel = path.join('scripts', 'flow', flow.goldenRunner);
  const startedAt = Date.now();

  send(ws, 'flow:config:try-run:start', {
    flowId,
    label: flow.label,
    env: envId,
    grep,
    spec,
    runner: flow.goldenRunner,
  });
  logLine(
    ws,
    `[flow-config] 试跑 · ${flow.label} · env=${envId} · grep=${grep} · ${spec}`,
    'info',
  );

  const runEnv = {
    ...spawnEnv,
    FLOW_CONFIG_TRY_RUN: '1',
    FLOW_DEBUG_FAST: '1',
    PLAYWRIGHT_RETRIES: '0',
  };
  const args = [`--env=${envId}`, `--grep=${grep}`];
  const result = await streamProcCapture(ws, session, 'flowConfigProc', 'flowConfigCancelled', '试跑', () =>
    spawnTsx(repoRoot, runnerRel, args, runEnv),
  );

  const summary = summarizePlaywrightStdout(result.stdout, result.exitCode);
  const duration = ((Date.now() - startedAt) / 1000).toFixed(1);
  const ok =
    !result.cancelled &&
    result.exitCode === 0 &&
    summary.failed === 0 &&
    (summary.total <= 0 || summary.passed > 0);

  for (const test of summary.tests) {
    logLine(ws, `[flow-config] ${test.ok ? '✓' : '✗'} ${test.title}`, test.ok ? 'ok' : 'err');
  }
  for (const fail of summary.failures.slice(0, 5)) {
    const tail = fail.message ? ` — ${fail.message.split('\n')[0]}` : '';
    logLine(ws, `[flow-config] 失败 · ${fail.title}${tail}`, 'err');
  }

  let message = '';
  if (result.cancelled) message = '已取消';
  else if (summary.total > 0) {
    message = `${summary.passed}/${summary.total} 通过${summary.skipped > 0 ? `，${summary.skipped} 跳过` : ''}，耗时 ${duration}s`;
  } else if (result.exitCode === 0) {
    message = `试跑完成，耗时 ${duration}s`;
  } else {
    message = `试跑未通过（退出码 ${result.exitCode ?? '?' }），耗时 ${duration}s`;
  }

  const lastRun = readLastFlowRun(repoRoot, flowId);
  const replayReportOpenPath = lastRun?.replayReportOpenPath || '';
  const videoReportOpenPath = lastRun?.videoReportOpenPath || '';
  if (replayReportOpenPath || videoReportOpenPath) {
    logLine(
      ws,
      `[flow-config] 回放 ${replayReportOpenPath || videoReportOpenPath}`,
      'info',
    );
  }

  send(ws, 'flow:config:try-run:done', {
    ok,
    flowId,
    label: flow.label,
    cancelled: Boolean(result.cancelled),
    exitCode: result.exitCode,
    env: envId,
    grep,
    spec,
    runner: flow.goldenRunner,
    reportDir: flow.reportDir,
    duration,
    passed: summary.passed,
    failed: summary.failed,
    total: summary.total,
    skipped: summary.skipped,
    tests: summary.tests,
    failures: summary.failures.slice(0, 8),
    replayReportOpenPath,
    videoReportOpenPath,
    runId: lastRun?.runId || '',
    message,
  });

  if (ok) logLine(ws, `[flow-config] ${message}`, 'ok');
  else if (!result.cancelled) logLine(ws, `[flow-config] ${message}`, 'err');
}

function cancelFlowConfig(session, ws) {
  const proc = session.flowConfigProc;
  session.flowConfigCancelled = true;
  if (proc) void stopProcessTree(proc);
  if (ws) send(ws, 'flow:config:cancel:ack', {});
}

module.exports = {
  deriveFlowMeta,
  sendFlowConfigList,
  sendFlowConfigStatus,
  runFlowConfigSetup,
  saveFlowConfigCatalog,
  runFlowConfigTryRun,
  cancelFlowConfig,
};
