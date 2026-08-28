const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const FLOW_COMPARE_REL = 'results/flow-screenshot-comparison.html';
const FLOW_CUSTOMER_REL = 'results/flow-customer-report.html';
const FLOW_SUMMARY_REL = 'results/flow-run-summary.html';
const UI_AUDIT_REPORT_REL = path.join('results', 'ui-audit', 'index.html');

function readJsonSafe(p) {
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch {
    return null;
  }
}

function writeFlowManifest(repoRoot, manifest) {
  const dir = path.join(repoRoot, 'results', 'flow-runs', manifest.flowId, manifest.runId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');
  fs.writeFileSync(
    path.join(repoRoot, 'results', 'flow-runs', manifest.flowId, 'last-run.json'),
    JSON.stringify(manifest, null, 2),
    'utf-8',
  );
  const day = (manifest.finishedAt || manifest.startedAt || new Date().toISOString()).slice(0, 10);
  const histDir = path.join(repoRoot, 'results', 'flow-runs', manifest.flowId, 'history');
  fs.mkdirSync(histDir, { recursive: true });
  const histPath = path.join(histDir, `${day}.json`);
  let rows = readJsonSafe(histPath) || [];
  rows.push(manifest);
  fs.writeFileSync(histPath, JSON.stringify(rows, null, 2), 'utf-8');
}

function readApiFailures(repoRoot, flowId, runId) {
  const p = path.join(repoRoot, 'results', 'flow-runs', flowId, runId, 'api-failures.json');
  return readJsonSafe(p) || [];
}

function runNpmScript(repoRoot, script, extraArgs = []) {
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const proc = spawnSync(npmCmd, ['run', script, '--', ...extraArgs], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
  return { ok: proc.status === 0, exitCode: proc.status ?? 1, out: `${proc.stdout || ''}${proc.stderr || ''}` };
}

function hasFlowScreenshots(repoRoot) {
  const root = path.join(repoRoot, 'screenshots', 'flows');
  if (!fs.existsSync(root)) return false;
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      const st = fs.statSync(p);
      if (st.isDirectory()) {
        if (walk(p)) return true;
      } else if (name.endsWith('.png') && /step-\d+/.test(name)) {
        return true;
      }
    }
    return false;
  };
  return walk(root);
}

function specSlug(spec) {
  const base = path.basename(spec, path.extname(spec)).replace(/\.spec$/, '');
  return base.replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]+/g, '-').slice(0, 60) || 'flow';
}

function flowScriptKey(flowId, env, spec, roleSlug) {
  const envId = String(env || 'dev').trim() || 'dev';
  const base = `flows/${flowId}/${envId}/${specSlug(spec)}`;
  const slug = String(roleSlug || '').trim();
  if (slug) return `${base}/by-account/${slug}`;
  return base;
}

function detectPipeline(spec, msg = {}) {
  if (msg.pipeline) return msg.pipeline;
  const s = String(spec || '');
  if (/golden-regression/.test(s)) return 'golden';
  if (/full-flow/.test(s) && msg.runUiAudit) return 'probe';
  return 'default';
}

function tryPromoteFlowBaseline(repoRoot, scriptKey) {
  const result = runNpmScript(repoRoot, 'promote-baseline', [
    `--script=${scriptKey}`,
    '--latest',
    '--browser=chrome',
    '--only-if-missing',
    '--promoted-by=studio-golden',
  ]);
  const seeded = result.ok && /已提升 Golden/.test(result.out);
  return { ...result, seeded };
}

function runFlowUiAudit(repoRoot, flowId, limit = 24) {
  return runNpmScript(repoRoot, 'ui-audit', [
    '--dir=screenshots/flows',
    `--script=${flowId}`,
    `--limit=${limit}`,
  ]);
}

function alignRunTimes(payload) {
  const finishedAt = payload.finishedAt || new Date().toISOString();
  const durationSec = Number(payload.duration) || 0;
  let startedAt = payload.startedAt || new Date(Date.now() - durationSec * 1000).toISOString();

  if (durationSec > 0) {
    const finishMs = new Date(finishedAt).getTime();
    const startMs = new Date(startedAt).getTime();
    if (finishMs - startMs > durationSec * 1000 + 5000) {
      startedAt = new Date(finishMs - durationSec * 1000).toISOString();
    }
  }

  const runIdFromStart = startedAt.replace(/[:.]/g, '-');
  return { startedAt, finishedAt, runId: runIdFromStart };
}

function finalizeFlowRun(repoRoot, flowId, flowLabel, payload) {
  const { startedAt, finishedAt, runId } = alignRunTimes(payload);
  const pipeline = detectPipeline(payload.spec, payload);

  let apiFailures = readApiFailures(repoRoot, flowId, runId);
  if (!apiFailures.length && payload.runId && payload.runId !== runId) {
    apiFailures = readApiFailures(repoRoot, flowId, payload.runId);
  }
  const apiFailureCount = apiFailures.reduce((n, e) => n + (e.failures?.length || 0), 0);

  let compareReportRel = '';
  let customerReportRel = '';
  let uiAuditReportRel = '';
  let replayReportRel = '';
  let baselinePromoted = false;

  if (!payload.cancelled && hasFlowScreenshots(repoRoot)) {
    if (pipeline === 'golden' || pipeline === 'default') {
      const cmp = runNpmScript(repoRoot, 'compare-flow-screenshots');
      if (cmp.ok && fs.existsSync(path.join(repoRoot, FLOW_COMPARE_REL))) {
        compareReportRel = FLOW_COMPARE_REL;
      }
      const cust = runNpmScript(repoRoot, 'report:flow-customer');
      if (cust.ok && fs.existsSync(path.join(repoRoot, FLOW_CUSTOMER_REL))) {
        customerReportRel = FLOW_CUSTOMER_REL;
      }
    }
    const replayArgs = [
      `--flow=${flowId}`,
      `--run=${runId}`,
      `--env=${payload.env || 'dev'}`,
      `--spec=${payload.spec || ''}`,
    ];
    if (payload.roleSlug) replayArgs.push(`--role=${payload.roleSlug}`);
    runNpmScript(repoRoot, 'report:flow-replay', replayArgs);
    const replayAbs = path.join(repoRoot, 'results', 'flow-runs', flowId, runId, 'flow.html');
    if (fs.existsSync(replayAbs)) {
      replayReportRel = path.relative(repoRoot, replayAbs).replace(/\\/g, '/');
    }
  }

  if (pipeline === 'golden' && payload.ok && !payload.cancelled) {
    const scriptKey = flowScriptKey(flowId, payload.env, payload.spec, payload.roleSlug);
    const promoted = tryPromoteFlowBaseline(repoRoot, scriptKey);
    baselinePromoted = promoted.seeded;
  }

  if (pipeline === 'probe' && payload.runUiAudit && payload.ok && !payload.cancelled) {
    const audit = runFlowUiAudit(repoRoot, flowId, payload.uiAuditLimit || 24);
    if (audit.ok && fs.existsSync(path.join(repoRoot, UI_AUDIT_REPORT_REL))) {
      uiAuditReportRel = UI_AUDIT_REPORT_REL;
    }
  }

  const playwrightReportRel = payload.playwrightReportDir
    ? `${payload.playwrightReportDir}/index.html`
    : `${flowId}/playwright-report/index.html`;

  const manifest = {
    runId,
    flowId,
    flowLabel,
    startedAt,
    finishedAt,
    env: payload.env || 'dev',
    spec: payload.spec || '',
    grep: payload.grep || '',
    mode: payload.mode || 'headless',
    pipeline,
    ok: Boolean(payload.ok),
    exitCode: payload.exitCode,
    passed: payload.passed,
    failed: payload.failed,
    total: payload.total,
    durationSec: payload.duration ? Number(payload.duration) : undefined,
    scriptKey: flowScriptKey(flowId, payload.env, payload.spec, payload.roleSlug),
    roleSlug: payload.roleSlug || undefined,
    screenshotDir: `screenshots/flows/${flowId}`,
    compareReportRel: compareReportRel || undefined,
    customerReportRel: customerReportRel || undefined,
    uiAuditReportRel: uiAuditReportRel || undefined,
    replayReportRel: replayReportRel || undefined,
    baselinePromoted: baselinePromoted || undefined,
    summaryReportRel: FLOW_SUMMARY_REL,
    apiFailureLogRel: apiFailures.length
      ? `results/flow-runs/${flowId}/${runId}/api-failures.json`
      : undefined,
    apiFailureCount,
    playwrightReportRel,
    traceMode: process.env.FLOW_TRACE || 'on-first-retry',
    failures: payload.failures || [],
  };

  writeFlowManifest(repoRoot, manifest);

  runNpmScript(repoRoot, 'report:flow-summary');

  return {
    ...payload,
    pipeline,
    runId,
    startedAt,
    finishedAt,
    baselinePromoted,
    compareReportOpenPath: compareReportRel ? `/repo-report/${compareReportRel}` : '',
    customerReportOpenPath: customerReportRel ? `/repo-report/${customerReportRel}` : '',
    uiAuditReportOpenPath: uiAuditReportRel ? `/repo-report/${UI_AUDIT_REPORT_REL.split(path.sep).join('/')}` : '',
    replayReportOpenPath: replayReportRel ? `/repo-report/${replayReportRel}` : '',
    summaryReportOpenPath: `/repo-report/${FLOW_SUMMARY_REL}`,
    apiFailureCount,
    apiFailures,
    manifest,
  };
}

module.exports = {
  FLOW_COMPARE_REL,
  FLOW_CUSTOMER_REL,
  FLOW_SUMMARY_REL,
  finalizeFlowRun,
  hasFlowScreenshots,
  detectPipeline,
  flowScriptKey,
  specSlug,
};
