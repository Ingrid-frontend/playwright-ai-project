const fs = require('fs');
const { spawnSync } = require('child_process');
const path = require('path');
const { spawnTracked } = require('./kill-proc');
const { createPlaywrightLogSink } = require('./failure-report');
const { flowScriptKey, readLastFlowRun } = require('./flow-run-common');
const { readGoldenBatch, summarizeGoldenBatch } = require('./golden-batch');
const {
  reportBatchCustomerRel,
  writeReportBatch,
} = require('./report-batch.js');

function readLastRunManifest(repoRoot, flowId) {
  const abs = path.join(repoRoot, 'results', 'flow-runs', flowId, 'last-run.json');
  if (!fs.existsSync(abs)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(abs, 'utf8'));
    return data && typeof data === 'object' ? data : null;
  } catch {
    return null;
  }
}

function linkBatchReportToLastRun(repoRoot, flowId, batchId, reportRel) {
  const manifest = readLastRunManifest(repoRoot, flowId);
  if (!manifest?.runId) return;
  const next = {
    ...manifest,
    reportBatchId: batchId,
    customerReportRel: reportRel,
  };
  const lastAbs = path.join(repoRoot, 'results', 'flow-runs', flowId, 'last-run.json');
  const runAbs = path.join(repoRoot, 'results', 'flow-runs', flowId, manifest.runId, 'manifest.json');
  fs.writeFileSync(lastAbs, JSON.stringify(next, null, 2), 'utf8');
  if (fs.existsSync(runAbs)) fs.writeFileSync(runAbs, JSON.stringify(next, null, 2), 'utf8');
}

function resolveReplayOpenPath(repoRoot, flowId, lastRun, manifest) {
  const direct = lastRun?.replayReportOpenPath || lastRun?.videoReportOpenPath || '';
  if (direct) return direct;
  const runId = String(lastRun?.runId || manifest?.runId || '').trim();
  if (!runId) return '';
  const rel = `results/flow-runs/${flowId}/${runId}/flow.html`;
  const abs = path.join(repoRoot, rel);
  return fs.existsSync(abs) ? `/repo-report/${rel.replace(/\\/g, '/')}` : '';
}

function buildGoldenCliDonePayload(repoRoot, flowId, result, base) {
  const lastRun = result.lastRun || {};
  const manifest = readLastRunManifest(repoRoot, flowId) || lastRun.manifest || null;
  const runId = String(lastRun.runId || manifest?.runId || '').trim();
  const replayReportOpenPath = resolveReplayOpenPath(repoRoot, flowId, lastRun, manifest);
  const videoReportOpenPath = lastRun.videoReportOpenPath || '';
  const spec = manifest?.spec || base.spec || '';
  return {
    ...base,
    runId,
    startedAt: lastRun.startedAt || manifest?.startedAt,
    finishedAt: lastRun.finishedAt || manifest?.finishedAt,
    passed: manifest?.passed,
    failed: manifest?.failed,
    total: manifest?.total,
    skipped: manifest?.skipped,
    skips: manifest?.skips || [],
    failures: manifest?.failures || [],
    pipeline: manifest?.pipeline || 'golden',
    runMarker: manifest?.runMarker,
    specRelative: spec ? `${flowId}/tests/${spec}` : undefined,
    roleSlug: manifest?.roleSlug,
    accountProfile: manifest?.accountProfile,
    compareReportOpenPath: lastRun.compareReportOpenPath || '',
    customerReportOpenPath: result.customerReportOpenPath || lastRun.customerReportOpenPath || '',
    uiAuditReportOpenPath: lastRun.uiAuditReportOpenPath || '',
    summaryReportOpenPath: lastRun.summaryReportOpenPath || '',
    reportOpenPath: lastRun.reportOpenPath || '',
    replayReportOpenPath,
    videoReportOpenPath,
    lastRun,
    manifest,
  };
}

const GOLDEN_NPM_SCRIPTS = {
  'request-flow': 'request-flow:golden',
  'approval-flow': 'approval-flow:golden',
  'expense-flow': 'expense-flow:golden',
  'ap-request-flow': 'ap-request-flow:golden',
};

function goldenSessionKeys(flowId) {
  const camel = String(flowId || '').replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  return {
    eventPrefix: flowId,
    cancelKey: `${camel}Cancelled`,
    procKey: `${camel}Proc`,
  };
}

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
    runUiAudit = false,
    uiAuditLimit = 24,
    reportBatchId = '',
    reportBatchExpected = 0,
    spec = '',
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
  const launchedAt = Date.now();
  try {
    const env = {
      ...process.env,
      FLOW_PROMOTE_IF_CLEAN: process.env.FLOW_PROMOTE_IF_CLEAN || '0',
    };
    if (runUiAudit) {
      env.FLOW_UI_AUDIT_AFTER_GOLDEN = '1';
      env.FLOW_UI_AUDIT_LIMIT = String(uiAuditLimit);
    }
    if (reportBatchId) env.FLOW_REPORT_BATCH_ID = reportBatchId;
    proc = spawnTracked(npm, args, {
      cwd: repoRoot,
      env,
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
  const goldenBatch = readGoldenBatch(repoRoot, flowId);
  const batchSummary = summarizeGoldenBatch(goldenBatch);
  const reportGoldenBatch =
    goldenBatch && Date.parse(goldenBatch.finishedAt || '') >= launchedAt - 5000
      ? goldenBatch
      : null;
  let customerReportOpenPath = '';
  if (reportBatchId && reportGoldenBatch?.results?.length) {
    const runs = reportGoldenBatch.results.map((item) => ({
      flowId,
      env: envId,
      profileId: item.profileId,
      roleSlug: item.roleSlug,
      scriptKey: item.roleSlug
        ? flowScriptKey(flowId, envId, spec, item.roleSlug).replace(/^flows\//, '')
        : '',
      runId: item.runId || '',
      ok: Boolean(item.ok),
      skipped: Boolean(item.skipped),
      required: true,
      passed: item.passed,
      failed: item.failed,
      total: item.total,
    }));
    writeReportBatch(repoRoot, {
      batchId: reportBatchId,
      flowId,
      env: envId,
      createdAt: new Date().toISOString(),
      expectedRunCount: Number(reportBatchExpected) || runs.length,
      runs,
    });
    if (runs.some((item) => item.runId && item.scriptKey)) {
      const batchProc = spawnSync(
        npm,
        ['run', 'report:flow-customer', '--', `--batch-id=${reportBatchId}`],
        {
          cwd: repoRoot,
          env: { ...process.env, FLOW_REPORT_BATCH_ID: reportBatchId },
          encoding: 'utf8',
          maxBuffer: 16 * 1024 * 1024,
        },
      );
      const batchOutput = `${batchProc.stdout || ''}${batchProc.stderr || ''}`;
      if (batchOutput.trim()) logSink.feed(batchOutput);
      if (batchProc.status === 0) {
        const reportRel = reportBatchCustomerRel(reportBatchId);
        customerReportOpenPath = `/repo-report/${reportRel}`;
        linkBatchReportToLastRun(repoRoot, flowId, reportBatchId, reportRel);
      }
    }
  }
  const procExit = exitCode || 0;
  const ok = procExit === 0 && (goldenBatch ? goldenBatch.ok !== false : lastRun?.ok !== false);
  const failedRun = goldenBatch?.results?.find((r) => !r.ok && !r.skipped) || null;
  return {
    ok,
    exitCode: ok ? 0 : procExit || 1,
    lastRun,
    goldenBatch,
    batchSummary,
    failedRun,
    logPrefix,
    label,
    reportBatchId,
    customerReportOpenPath,
  };
}

function shouldUseGoldenCli(msg = {}) {
  const spec = String(msg.spec || '').trim();
  if (msg.goldenAll) return true;
  if (!isGoldenSpec(spec)) return false;
  const mode = String(msg.mode || 'headless').trim();
  return mode === 'headless';
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
  const { eventPrefix, cancelKey, procKey } = goldenSessionKeys(flowId);

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
    runUiAudit: Boolean(msg.runUiAudit),
    uiAuditLimit: Number(msg.uiAuditLimit) || 24,
    reportBatchId: String(msg.reportBatchId || '').trim(),
    reportBatchExpected: Number(msg.reportBatchExpected) || 0,
    spec,
    cancelKey,
    procKey,
    label: `${flowId}/golden-cli`,
  });

  const payload = buildGoldenCliDonePayload(repoRoot, flowId, result, {
    ok: result.ok,
    exitCode: result.exitCode,
    cancelled: Boolean(result.cancelled),
    mode,
    spec,
    grep,
    env: envId,
    viaCli: true,
    reportBatchId: result.reportBatchId || '',
    goldenBatch: result.goldenBatch || null,
    batchHeadline: result.batchSummary?.headline || '',
  });

  send(ws, `${eventPrefix}:run:done`, payload);
  if (result.ok) logLine(ws, `[${flowId}] Golden CLI 通过`, 'ok');
  else if (!result.cancelled) {
    if (result.batchSummary?.lines?.length) {
      logLine(ws, `[${flowId}] ${result.batchSummary.headline}`, 'warn');
      for (const line of result.batchSummary.lines) {
        logLine(ws, `[${flowId}]   ${line}`, line.startsWith('失败') ? 'err' : 'warn');
      }
    }
    send(ws, 'error', {
      message: result.error || result.batchSummary?.headline || `Golden CLI 退出码 ${result.exitCode}`,
    });
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
