const { spawn } = require('child_process');
const path = require('path');
const { spawnTracked } = require('./kill-proc');
const { createPlaywrightLogSink } = require('./failure-report');
const { readLastFlowRun } = require('./flow-run-common');

const GOLDEN_NPM_SCRIPTS = {
  'request-flow': 'request-flow:golden',
  'approval-flow': 'approval-flow:golden',
};

function isGoldenSpec(spec) {
  return /golden-regression\.spec\.ts$/i.test(String(spec || ''));
}

function resolveGoldenNpmScript(flowId) {
  return GOLDEN_NPM_SCRIPTS[flowId] || null;
}

/**
 * Studio 侧统一走 CLI golden runner，避免与 scripts/flow/run-*-golden.ts 双轨维护。
 */
async function streamGoldenCliRun(ws, session, flowId, opts = {}) {
  const {
    repoRoot,
    envId,
    profile = '',
    grep = '',
    filterKeyword = '',
    cancelKey,
    procKey,
    label,
    logPrefix = `[${flowId}]`,
  } = opts;

  const npmScript = resolveGoldenNpmScript(flowId);
  if (!npmScript) {
    return { ok: false, exitCode: 1, error: `未注册 golden CLI: ${flowId}` };
  }

  if (session[cancelKey]) {
    return { ok: false, cancelled: true, exitCode: 130 };
  }

  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const args = ['run', npmScript, '--', `--env=${envId}`];
  if (profile) args.push(`--profile=${profile}`);
  if (grep) args.push(`--grep=${grep}`);
  if (filterKeyword) args.push(`--filter-keyword=${filterKeyword}`);

  let proc;
  try {
    proc = spawnTracked(npm, args, {
      cwd: repoRoot,
      env: { ...process.env, FLOW_PROMOTE_IF_CLEAN: process.env.FLOW_PROMOTE_IF_CLEAN || '0' },
      shell: process.platform === 'win32',
    });
  } catch (e) {
    return { ok: false, exitCode: -1, error: String(e?.message || e) };
  }

  session[procKey] = proc;
  const logSink = createPlaywrightLogSink({ ws });
  proc.stdout.on('data', (d) => logSink.feed(d.toString()));
  proc.stderr.on('data', (d) => logSink.feed(d.toString()));

  const exitCode = await new Promise((resolve) => proc.on('close', resolve));
  session[procKey] = null;

  if (session[cancelKey]) {
    return { ok: false, cancelled: true, exitCode };
  }

  const lastRun = readLastFlowRun(repoRoot, flowId);
  const ok = exitCode === 0 && (lastRun?.ok !== false);
  return {
    ok,
    exitCode: ok ? 0 : exitCode || 1,
    lastRun,
    logPrefix,
    label,
  };
}

function shouldUseGoldenCli(msg = {}) {
  const spec = String(msg.spec || '').trim();
  if (msg.goldenAll) return true;
  if (!isGoldenSpec(spec)) return false;
  const mode = String(msg.mode || 'headless').trim();
  return mode === 'headless' && !msg.runUiAudit;
}

async function runStudioGoldenRun(ws, session, flowId, msg, deps, hooks = {}) {
  const { send, logLine } = hooks;
  const repoRoot = deps.resolveRepoRoot();
  const { getSessionPlaywrightEnv } = deps;
  const envId = String(msg.env || getSessionPlaywrightEnv(session) || 'dev').trim();
  const profile = String(msg.accountProfile || '').trim();
  const grep = msg.grep === undefined || msg.grep === null ? '' : String(msg.grep);
  const filterKeyword =
    msg.filterKeyword != null ? String(msg.filterKeyword).trim() : '';
  const mode = String(msg.mode || 'headless').trim();
  const spec = String(msg.spec || '').trim();
  const eventPrefix = flowId === 'approval-flow' ? 'approval-flow' : 'request-flow';
  const cancelKey = flowId === 'approval-flow' ? 'approvalFlowCancelled' : 'requestFlowCancelled';
  const procKey = flowId === 'approval-flow' ? 'approvalFlowProc' : 'requestFlowProc';

  send(ws, `${eventPrefix}:run:start`, {
    env: envId,
    accountProfile: profile,
    mode,
    spec,
    grep,
    viaCli: true,
  });
  logLine(ws, `[${flowId}] Golden CLI · env=${envId}${profile ? ` · profile=${profile}` : ''}`, 'info');

  const result = await streamGoldenCliRun(ws, session, flowId, {
    repoRoot,
    envId,
    profile,
    grep,
    filterKeyword,
    cancelKey,
    procKey,
    label: `${flowId}/golden-cli`,
  });

  const payload = {
    ok: result.ok,
    cancelled: Boolean(result.cancelled),
    mode,
    spec,
    grep,
    env: envId,
    viaCli: true,
    lastRun: result.lastRun || null,
    manifest: result.lastRun?.manifest || null,
    compareReportOpenPath: result.lastRun?.compareReportRel
      ? `/repo-report/${result.lastRun.compareReportRel}`
      : '',
    replayReportOpenPath: result.lastRun?.replayReportRel
      ? `/repo-report/${result.lastRun.replayReportRel}`
      : '',
  };

  send(ws, `${eventPrefix}:run:done`, payload);
  if (result.ok) logLine(ws, `[${flowId}] Golden CLI 通过`, 'ok');
  else if (!result.cancelled) {
    send(ws, 'error', { message: result.error || `Golden CLI 退出码 ${result.exitCode}` });
  }
  return result;
}

module.exports = {
  GOLDEN_NPM_SCRIPTS,
  isGoldenSpec,
  resolveGoldenNpmScript,
  streamGoldenCliRun,
  shouldUseGoldenCli,
  runStudioGoldenRun,
};
