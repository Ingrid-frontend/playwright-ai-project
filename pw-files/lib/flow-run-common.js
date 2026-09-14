const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { makeRunMarker, writeRunMarkerFile, readRunMarkerFile } = require('./flow-run-marker.js');

const FLOW_COMPARE_REL = 'results/flow-screenshot-comparison.html';
const FLOW_CUSTOMER_REL = 'results/flow-customer-report.html';
const FLOW_PROBE_REL = 'results/flow-probe-report.html';
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

function runFlowUiAudit(repoRoot, flowId, limit = 24, gate = false, opts = {}) {
  const args = [
    '--dir=screenshots/flows',
    `--limit=${limit}`,
  ];
  if (opts.scriptKey) args.push(`--script-key=${opts.scriptKey}`);
  else args.push(`--script=${flowId}`);
  if (opts.runId) args.push(`--run=${opts.runId}`);
  if (gate) args.push('--gate');
  return runNpmScript(repoRoot, 'ui-audit', args);
}

function flowRunVideoAbs(repoRoot, flowId, runId) {
  return path.join(repoRoot, 'results', 'flow-runs', flowId, runId, 'flow.webm');
}

function flowRunReplayAbs(repoRoot, flowId, runId) {
  return path.join(repoRoot, 'results', 'flow-runs', flowId, runId, 'flow.html');
}

function resolveFlowRunVideoRel(repoRoot, flowId, ...runIds) {
  for (const id of runIds) {
    if (!id) continue;
    const abs = flowRunVideoAbs(repoRoot, flowId, id);
    if (fs.existsSync(abs)) {
      return path.relative(repoRoot, abs).replace(/\\/g, '/');
    }
  }
  return '';
}

function ensureVideoReplayHtml(repoRoot, flowId, runId, title) {
  const htmlAbs = flowRunReplayAbs(repoRoot, flowId, runId);
  const videoAbs = flowRunVideoAbs(repoRoot, flowId, runId);
  if (!fs.existsSync(videoAbs) || fs.existsSync(htmlAbs)) return;
  fs.mkdirSync(path.dirname(htmlAbs), { recursive: true });
  const safeTitle = String(title || '流程回放').replace(/[<>&"]/g, '');
  fs.writeFileSync(
    htmlAbs,
    `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${safeTitle}</title>
<style>
  body { margin: 0; background: #0a0c10; color: #eef2f8; font: 13px/1.5 ui-sans-serif, system-ui, sans-serif; }
  header { padding: 10px 14px; border-bottom: 1px solid rgba(255,255,255,.08); }
  h1 { margin: 0; font-size: 15px; font-weight: 650; }
  .hint { color: #8899b2; margin-top: 4px; }
  video { display: block; width: 100%; max-height: 85vh; background: #000; }
</style>
</head>
<body>
<header>
  <h1>${safeTitle}</h1>
  <div class="hint">全程录像</div>
</header>
<video src="./flow.webm" controls autoplay></video>
</body>
</html>
`,
    'utf-8',
  );
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

/** 通过数与总数一致才保留截图（含部分 skip 的 1/4 等场景） */
function isCompletePassRun(payload) {
  const total = Number(payload.total) || 0;
  if (total <= 0) return true;
  return (Number(payload.passed) || 0) === total;
}

function flowScreenshotRunAbs(repoRoot, flowId, payload, runId) {
  const scriptKey = flowScriptKey(flowId, payload.env, payload.spec, payload.roleSlug);
  return path.join(repoRoot, 'screenshots', scriptKey, 'run-chromium-flow', runId);
}

function hasRunScreenshotPng(runDir) {
  if (!runDir || !fs.existsSync(runDir)) return false;
  return fs.readdirSync(runDir).some((name) => name.endsWith('.png'));
}

function discardFlowRunScreenshots(repoRoot, flowId, payload, runIds) {
  let removed = 0;
  const seen = new Set();
  for (const id of runIds) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const runDir = flowScreenshotRunAbs(repoRoot, flowId, payload, id);
    if (!fs.existsSync(runDir)) continue;
    for (const name of fs.readdirSync(runDir)) {
      if (name.endsWith('.png')) removed++;
    }
    fs.rmSync(runDir, { recursive: true, force: true });
  }
  return removed;
}

function finalizeFlowRun(repoRoot, flowId, flowLabel, payload) {
  const { startedAt, finishedAt, runId } = alignRunTimes(payload);
  const pipeline = detectPipeline(payload.spec, payload);
  const scriptKey = flowScriptKey(flowId, payload.env, payload.spec, payload.roleSlug);
  const boundScriptKey = scriptKey.replace(/^flows\//, '');
  let boundRunId = runId;

  let apiFailures = readApiFailures(repoRoot, flowId, runId);
  if (!apiFailures.length && payload.runId && payload.runId !== runId) {
    apiFailures = readApiFailures(repoRoot, flowId, payload.runId);
  }
  const apiFailureCount = apiFailures.reduce((n, e) => n + (e.failures?.length || 0), 0);

  let compareReportRel = '';
  let customerReportRel = '';
  let probeReportRel = '';
  let uiAuditReportRel = '';
  let uiAuditSummaryRel = '';
  let replayReportRel = '';
  let videoReportRel = '';
  let baselinePromoted = false;
  let hasShots = false;
  let screenshotsDiscarded = false;

  videoReportRel = resolveFlowRunVideoRel(repoRoot, flowId, runId, payload.runId);
  const fullPass = isCompletePassRun(payload);

  let compareGateFailed = false;
  let uiAuditGateFailed = false;

  const fastDebug = process.env.FLOW_DEBUG_FAST === '1';
  const configTryRun = process.env.FLOW_CONFIG_TRY_RUN === '1';

  if (!payload.cancelled && (!fastDebug || configTryRun)) {
    const runShotDir = flowScreenshotRunAbs(repoRoot, flowId, payload, runId);
    const altRunShotDir =
      payload.runId && payload.runId !== runId
        ? flowScreenshotRunAbs(repoRoot, flowId, payload, payload.runId)
        : '';
    const hasRunShots = hasRunScreenshotPng(runShotDir) || hasRunScreenshotPng(altRunShotDir);
    if (!hasRunScreenshotPng(runShotDir) && hasRunScreenshotPng(altRunShotDir)) {
      boundRunId = payload.runId;
    }

    if (hasRunShots || videoReportRel) {
      const replayArgs = [
        `--flow=${flowId}`,
        `--run=${runId}`,
        `--env=${payload.env || 'dev'}`,
        `--spec=${payload.spec || ''}`,
      ];
      if (payload.roleSlug) replayArgs.push(`--role=${payload.roleSlug}`);
      runNpmScript(repoRoot, 'report:flow-replay', replayArgs);
      ensureVideoReplayHtml(repoRoot, flowId, runId, `${flowLabel} · ${specSlug(payload.spec || '')}`);
      const replayAbs = flowRunReplayAbs(repoRoot, flowId, runId);
      if (fs.existsSync(replayAbs)) {
        replayReportRel = path.relative(repoRoot, replayAbs).replace(/\\/g, '/');
      }
      videoReportRel = resolveFlowRunVideoRel(repoRoot, flowId, runId, payload.runId);
    }

    if (!fullPass) {
      const removed = discardFlowRunScreenshots(repoRoot, flowId, payload, [runId, payload.runId]);
      if (removed > 0) {
        screenshotsDiscarded = true;
        console.log(
          `[flow] ${payload.passed}/${payload.total} 未全通过，已丢弃本次截图（保留回放）`,
        );
      }
    }

    hasShots = hasFlowScreenshots(repoRoot);
    if (fullPass && hasShots && (pipeline === 'golden' || pipeline === 'default')) {
      const cmpArgs = pipeline === 'golden' ? ['--gate'] : [];
      const cmp = runNpmScript(repoRoot, 'compare-flow-screenshots', cmpArgs);
      if (pipeline === 'golden' && hasShots && !cmp.ok) compareGateFailed = true;
      if (cmp.ok && fs.existsSync(path.join(repoRoot, FLOW_COMPARE_REL))) {
        compareReportRel = FLOW_COMPARE_REL;
      }
      if (!process.env.FLOW_REPORT_BATCH_ID) {
        const cust = runNpmScript(repoRoot, 'report:flow-customer', [
          `--script-key=${boundScriptKey}`,
          `--run=${boundRunId}`,
        ]);
        if (cust.ok && fs.existsSync(path.join(repoRoot, FLOW_CUSTOMER_REL))) {
          customerReportRel = FLOW_CUSTOMER_REL;
        }
      }
    }
  }

  const runUiAudit =
    payload.runUiAudit ||
    (pipeline === 'golden' && process.env.FLOW_UI_AUDIT_AFTER_GOLDEN === '1');
  const canAudit =
    pipeline === 'probe' ||
    (pipeline === 'golden' && fullPass && hasShots);
  if (
    canAudit &&
    runUiAudit &&
    payload.ok &&
    !payload.cancelled &&
    !fastDebug
  ) {
    const auditGate = Boolean(payload.uiAuditGate || process.env.FLOW_UI_AUDIT_GATE === '1');
    const auditLimit =
      Number(payload.uiAuditLimit) ||
      Number(process.env.FLOW_UI_AUDIT_LIMIT) ||
      24;
    const audit = runFlowUiAudit(repoRoot, flowId, auditLimit, auditGate, {
      scriptKey: boundScriptKey,
      runId: boundRunId,
    });
    if (auditGate && !audit.ok) uiAuditGateFailed = true;
    if (audit.ok && fs.existsSync(path.join(repoRoot, UI_AUDIT_REPORT_REL))) {
      uiAuditReportRel = UI_AUDIT_REPORT_REL;
      const summary = readJsonSafe(path.join(repoRoot, 'results', 'ui-audit', 'summary.json'));
      if (
        summary?.runId &&
        summary?.manifestRunId === boundRunId &&
        summary?.scriptKey === boundScriptKey
      ) {
        uiAuditSummaryRel = `results/ui-audit/runs/${summary.runId}/summary.json`;
      }
    }
  }

  const playwrightReportRel = payload.playwrightReportRel ||
    (payload.playwrightReportDir ? `${payload.playwrightReportDir}/index.html` : '');

  const runOk = Boolean(payload.ok) && !compareGateFailed && !uiAuditGateFailed;

  if (pipeline === 'golden' && runOk && fullPass && !payload.cancelled && !fastDebug) {
    const promoted = tryPromoteFlowBaseline(repoRoot, scriptKey);
    baselinePromoted = promoted.seeded;
    if (process.env.FLOW_PROMOTE_IF_CLEAN === '1') {
      const auto = runNpmScript(repoRoot, 'promote-baseline', [
        `--script=${scriptKey}`,
        '--latest',
        '--browser=chrome',
        '--promoted-by=flow-golden-clean',
      ]);
      if (auto.ok && /已提升 Golden|promote/i.test(auto.out)) {
        baselinePromoted = true;
        console.log(`[flow] compare 通过 · 已 promote 基线: ${scriptKey}`);
      }
    }
    if (hasShots) {
      runNpmScript(repoRoot, 'prune-flow-golden-runs', [
        `--script=${scriptKey}`,
        `--run=${runId}`,
      ]);
    }
  }

  const manifest = {
    runId,
    flowId,
    flowLabel,
    startedAt,
    finishedAt,
    runMarker:
      payload.runMarker ||
      process.env.FLOW_RUN_MARKER ||
      readRunMarkerFile(flowScreenshotRunAbs(repoRoot, flowId, payload, runId)) ||
      makeRunMarker({ roleSlug: payload.roleSlug, env: payload.env, spec: payload.spec, startedAt }),
    env: payload.env || 'dev',
    spec: payload.spec || '',
    grep: payload.grep || '',
    mode: payload.mode || 'headless',
    pipeline,
    debugFast: fastDebug || undefined,
    ok: runOk,
    exitCode: payload.exitCode,
    passed: payload.passed,
    failed: payload.failed,
    total: payload.total,
    skipped: payload.skipped,
    skips: payload.skips || [],
    durationSec: payload.duration ? Number(payload.duration) : undefined,
    scriptKey,
    boundRunId,
    boundScriptKey,
    reportBatchId: process.env.FLOW_REPORT_BATCH_ID || undefined,
    roleSlug: payload.roleSlug || undefined,
    screenshotDir: `screenshots/flows/${flowId}`,
    compareReportRel: compareReportRel || undefined,
    customerReportRel: customerReportRel || undefined,
    probeReportRel: probeReportRel || undefined,
    uiAuditReportRel: uiAuditReportRel || undefined,
    uiAuditSummaryRel: uiAuditSummaryRel || undefined,
    replayReportRel: replayReportRel || undefined,
    videoReportRel: videoReportRel || undefined,
    baselinePromoted: baselinePromoted || undefined,
    screenshotsDiscarded: screenshotsDiscarded || undefined,
    summaryReportRel: fastDebug ? undefined : FLOW_SUMMARY_REL,
    apiFailureLogRel: apiFailures.length
      ? `results/flow-runs/${flowId}/${runId}/api-failures.json`
      : undefined,
    apiFailureCount,
    playwrightReportRel,
    traceMode: process.env.FLOW_TRACE || 'on-first-retry',
    failures: payload.failures || [],
  };

  writeFlowManifest(repoRoot, manifest);
  writeRunMarkerFile(flowScreenshotRunAbs(repoRoot, flowId, payload, runId), manifest.runMarker, {
    runId,
    flowId,
    scriptKey: manifest.scriptKey,
    startedAt,
  });

  // 失败路径选择器诊断：run 失败时自动把失败定位链放到当前页面复算一遍，
  // 回答「是选择器漂移还是数据问题」。best-effort，诊断失败不影响主流程结论。
  if (!runOk && !payload.cancelled && !fastDebug && !configTryRun && (payload.failures || []).length > 0) {
    const auditRel = `results/flow-runs/${flowId}/${runId}/selector-audit.json`;
    runNpmScript(repoRoot, 'flow:selector-audit', [`--flow=${flowId}`, `--run=${runId}`]);
    const auditJson = readJsonSafe(path.join(repoRoot, auditRel));
    if (auditJson) {
      manifest.selectorAuditRel = auditRel;
      manifest.selectorAuditSummary = {
        missing: auditJson.summary?.missing ?? 0,
        ambiguous: auditJson.summary?.ambiguous ?? 0,
        driftCount: Array.isArray(auditJson.catalogDrift) ? auditJson.catalogDrift.length : 0,
        loginRedirect: Boolean(auditJson.loginRedirect),
      };
      writeFlowManifest(repoRoot, manifest);
      console.log(
        `[flow] 选择器诊断: 断裂 ${manifest.selectorAuditSummary.missing} · 漂移 ${manifest.selectorAuditSummary.driftCount} · ${auditRel}`,
      );
    }
  }

  if (!fastDebug) {
    const probe = runNpmScript(repoRoot, 'report:flow-probe');
    if (probe.ok && fs.existsSync(path.join(repoRoot, FLOW_PROBE_REL))) {
      probeReportRel = FLOW_PROBE_REL;
      manifest.probeReportRel = probeReportRel;
      writeFlowManifest(repoRoot, manifest);
    }
  }

  if (!fastDebug) runNpmScript(repoRoot, 'report:flow-summary');

  // 录像保留策略：通过且生成了录像的 run 结束后自动按「成功保留最近 N 份 / 失败超期回收」清理，
  // 防止 results/flow-runs 与 results/intent-runs 的 flow.webm 无限累积（P2-⑨）。
  if (!fastDebug && fullPass && videoReportRel) {
    runNpmScript(repoRoot, 'prune:flow-videos', ['--apply']);
  }

  // history 保留策略：每次 run 都会在 history/{day}.json 追加一份完整 manifest，
  // 只保留最近 N 天，防止逐日累积导致体积/单文件行数无限增长（P1：真相源收敛）。
  if (!fastDebug) {
    runNpmScript(repoRoot, 'prune:flow-history', ['--apply']);
  }

  return {
    ...payload,
    ok: runOk,
    compareGateFailed,
    uiAuditGateFailed,
    pipeline,
    runId,
    startedAt,
    finishedAt,
    baselinePromoted,
    screenshotsDiscarded,
    compareReportOpenPath: compareReportRel ? `/repo-report/${compareReportRel}` : '',
    customerReportOpenPath: customerReportRel ? `/repo-report/${customerReportRel}` : '',
    probeReportOpenPath: probeReportRel ? `/repo-report/${FLOW_PROBE_REL}` : '',
    uiAuditReportOpenPath: uiAuditReportRel ? `/repo-report/${UI_AUDIT_REPORT_REL.split(path.sep).join('/')}` : '',
    replayReportOpenPath: replayReportRel ? `/repo-report/${replayReportRel}` : '',
    videoReportOpenPath: videoReportRel ? `/repo-report/${videoReportRel}` : '',
    summaryReportOpenPath: fastDebug ? '' : `/repo-report/${FLOW_SUMMARY_REL}`,
    apiFailureCount,
    apiFailures,
    manifest,
  };
}

function readLastFlowRun(repoRoot, flowId) {
  const manifest = readJsonSafe(path.join(repoRoot, 'results', 'flow-runs', flowId, 'last-run.json'));
  if (!manifest) return null;
  const pwRel = manifest.playwrightReportRel ||
    (manifest.debugFast ? '' : `${flowId}/playwright-report/index.html`);
  const href = (rel) => {
    if (!rel) return '';
    const norm = String(rel).replace(/\\/g, '/');
    if (!fs.existsSync(path.join(repoRoot, norm))) return '';
    return `/repo-report/${norm}`;
  };
  return {
    runId: manifest.runId,
    ok: Boolean(manifest.ok),
    cancelled: false,
    startedAt: manifest.startedAt,
    finishedAt: manifest.finishedAt,
    spec: manifest.spec,
    pipeline: manifest.pipeline,
    env: manifest.env,
    mode: manifest.mode,
    reportOpenPath: href(pwRel),
    compareReportOpenPath: href(manifest.compareReportRel),
    customerReportOpenPath: href(manifest.customerReportRel),
    probeReportOpenPath: href(
      manifest.probeReportRel || (manifest.debugFast ? '' : FLOW_PROBE_REL),
    ),
    summaryReportOpenPath: href(
      manifest.summaryReportRel || (manifest.debugFast ? '' : FLOW_SUMMARY_REL),
    ),
    replayReportOpenPath: href(manifest.replayReportRel),
    videoReportOpenPath: href(manifest.videoReportRel),
    uiAuditReportOpenPath: href(manifest.uiAuditReportRel),
    selectorAuditOpenPath: href(manifest.selectorAuditRel),
    apiFailureCount: manifest.apiFailureCount || 0,
  };
}

module.exports = {
  FLOW_COMPARE_REL,
  FLOW_CUSTOMER_REL,
  FLOW_PROBE_REL,
  FLOW_SUMMARY_REL,
  finalizeFlowRun,
  hasFlowScreenshots,
  detectPipeline,
  flowScriptKey,
  specSlug,
  readLastFlowRun,
};
