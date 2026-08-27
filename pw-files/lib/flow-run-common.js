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

function readApiFailures(repoRoot, flowId, runId) {
  const p = path.join(repoRoot, 'results', 'flow-runs', flowId, runId, 'api-failures.json');
  return readJsonSafe(p) || [];
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
  const day = (manifest.startedAt || new Date().toISOString()).slice(0, 10);
  const histDir = path.join(repoRoot, 'results', 'flow-runs', manifest.flowId, 'history');
  fs.mkdirSync(histDir, { recursive: true });
  const histPath = path.join(histDir, `${day}.json`);
  let rows = readJsonSafe(histPath) || [];
  rows.push(manifest);
  fs.writeFileSync(histPath, JSON.stringify(rows, null, 2), 'utf-8');
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

function flowScriptKey(flowId, env, spec) {
  const envId = String(env || 'dev').trim() || 'dev';
  return `flows/${flowId}/${envId}/${specSlug(spec)}`;
}

function detectPipeline(spec, msg = {}) {
  if (msg.pipeline) return msg.pipeline;
  const s = String(spec || '');
  if (/golden-regression|travel-submit/.test(s)) return 'golden';
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
    `--script=flows/${flowId}`,
    `--limit=${limit}`,
  ]);
}

function finalizeFlowRun(repoRoot, flowId, flowLabel, payload) {
  const startedAt = payload.startedAt || new Date(Date.now() - (payload.duration || 0) * 1000).toISOString();
  const finishedAt = payload.finishedAt || new Date().toISOString();
  const runId = payload.runId || startedAt.replace(/[:.]/g, '-');
  const pipeline = detectPipeline(payload.spec, payload);

  const lastManifest = readJsonSafe(path.join(repoRoot, 'results', 'flow-runs', flowId, 'last-run.json'));
  const effectiveRunId = lastManifest?.runId || runId;

  const apiFailures = readApiFailures(repoRoot, flowId, effectiveRunId);
  const apiFailureCount = apiFailures.reduce((n, e) => n + (e.failures?.length || 0), 0);

  let compareReportRel = '';
  let customerReportRel = '';
  let uiAuditReportRel = '';
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
  }

  if (pipeline === 'golden' && payload.ok && !payload.cancelled) {
    const scriptKey = flowScriptKey(flowId, payload.env, payload.spec);
    const promoted = tryPromoteFlowBaseline(repoRoot, scriptKey);
    baselinePromoted = promoted.seeded;
  }

  if (pipeline === 'probe' && payload.ok && !payload.cancelled) {
    const audit = runFlowUiAudit(repoRoot, flowId, payload.uiAuditLimit || 24);
    if (audit.ok && fs.existsSync(path.join(repoRoot, UI_AUDIT_REPORT_REL))) {
      uiAuditReportRel = UI_AUDIT_REPORT_REL;
    }
  }

  runNpmScript(repoRoot, 'report:flow-summary');

  const playwrightReportRel = payload.playwrightReportDir
    ? `${payload.playwrightReportDir}/index.html`
    : `${flowId}/playwright-report/index.html`;

  const manifest = {
    runId: effectiveRunId,
    flowId,
    flowLabel,
    startedAt: lastManifest?.startedAt || startedAt,
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
    screenshotDir: `screenshots/flows/${flowId}`,
    compareReportRel: compareReportRel || undefined,
    customerReportRel: customerReportRel || undefined,
    uiAuditReportRel: uiAuditReportRel || undefined,
    baselinePromoted: baselinePromoted || undefined,
    summaryReportRel: FLOW_SUMMARY_REL,
    apiFailureLogRel: apiFailures.length
      ? `results/flow-runs/${flowId}/${effectiveRunId}/api-failures.json`
      : undefined,
    apiFailureCount,
    playwrightReportRel,
    traceMode: process.env.FLOW_TRACE || 'on-first-retry',
    failures: payload.failures || [],
  };

  writeFlowManifest(repoRoot, manifest);

  return {
    ...payload,
    pipeline,
    runId: effectiveRunId,
    startedAt: manifest.startedAt,
    finishedAt,
    baselinePromoted,
    compareReportOpenPath: compareReportRel ? `/repo-report/${compareReportRel}` : '',
    customerReportOpenPath: customerReportRel ? `/repo-report/${customerReportRel}` : '',
    uiAuditReportOpenPath: uiAuditReportRel ? `/repo-report/${UI_AUDIT_REPORT_REL.split(path.sep).join('/')}` : '',
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
