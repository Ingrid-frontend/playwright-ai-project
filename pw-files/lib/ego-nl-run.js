const fs = require('fs');
const path = require('path');
const { send, logLine, stripAnsi, errText } = require('./ws-safe');

function runChild(session, procKey, spawn, tsxBin, args, cwd, env, ws) {
  const proc = spawn(tsxBin, args, { cwd, env, shell: false });
  session[procKey] = proc;
  return new Promise((resolve) => {
    proc.stdout.on('data', (d) => {
      const text = stripAnsi(d.toString()).trimEnd();
      if (text) logLine(ws, text, 'dim');
    });
    proc.stderr.on('data', (d) => {
      const text = stripAnsi(d.toString()).trimEnd();
      if (text) logLine(ws, text, 'warn');
    });
    proc.on('error', (error) => {
      if (session[procKey] === proc) session[procKey] = null;
      resolve({ code: null, error: errText(error) });
    });
    proc.on('close', (code) => {
      if (session[procKey] === proc) session[procKey] = null;
      resolve({ code, error: null });
    });
  });
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

/** 自然语言 → ego Intent 执行，或 Playwright 临时脚本执行 */
async function runEgoNlFlow(ws, session, msg = {}, deps) {
  const {
    resolveRepoRoot,
    spawn,
    buildRepoSpawnEnv,
    getSessionPlaywrightEnv,
    getSessionAccountProfile,
  } = deps;
  const repoRoot = resolveRepoRoot();
  if (!fs.existsSync(path.join(repoRoot, 'playwright.config.ts'))) {
    send(ws, 'error', { message: '未找到项目根' });
    send(ws, 'ego:nl-run:done', { ok: false, message: '未找到项目根' });
    return;
  }

  const caseDescription = String(msg.caseDescription || '').trim();
  if (!caseDescription) {
    send(ws, 'error', { message: '请先填写自然语言测试步骤' });
    send(ws, 'ego:nl-run:done', { ok: false, message: '缺少测试步骤' });
    return;
  }

  const env = String(msg.env || getSessionPlaywrightEnv(session) || 'stage').trim();
  const profile = getSessionAccountProfile(session, repoRoot);
  const entry = String(msg.entry || '').trim();
  const headed = Boolean(msg.headed);
  const heal = msg.heal !== false;
  const engine = String(msg.engine || 'ego').toLowerCase() === 'pw' ? 'pw' : 'ego';
  const doAudit = msg.audit !== false;
  const settle = Math.max(0, Number(msg.settle) || 3);
  const keepTab = Boolean(msg.keepTab);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outRel = `results/ego-studio/${stamp}`;
  const outAbs = path.join(repoRoot, outRel);
  fs.mkdirSync(outAbs, { recursive: true });
  const scriptPath = path.join(outAbs, 'generated.ts');
  const runDir = path.join(outAbs, 'run');
  const auditJson = path.join(outAbs, 'audit.json');

  if (session.egoAuditProc) {
    try {
      session.egoAuditProc.kill('SIGTERM');
    } catch {
      /* ignore */
    }
  }
  session.egoAuditProc = null;
  session.egoAuditCancelled = false;
  session.egoAuditSeq = (session.egoAuditSeq || 0) + 1;
  const seq = session.egoAuditSeq;

  send(ws, 'ego:nl-run:start', { outRel, seq, env, profile, audit: doAudit, engine });
  logLine(ws, `[ego-nl] engine=${engine} · env=${env}`, 'info');

  const tsxBin = path.join(
    repoRoot,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'tsx.cmd' : 'tsx',
  );
  const spawnEnv = buildRepoSpawnEnv(session);

  if (engine === 'ego') {
    await runEgoNlIntentPath(ws, session, {
      seq,
      outRel,
      outAbs,
      runDir,
      caseDescription,
      entry,
      env,
      profile,
      heal,
      keepTab,
      repoRoot,
      tsxBin,
      spawnEnv,
      spawn,
    });
    return;
  }

  logLine(ws, '[ego-nl] 生成临时 Playwright 脚本…', 'info');
  const genArgs = [
    'scripts/ai/generate-playwright-script.ts',
    `--case=${caseDescription}`,
    `--env=${env}`,
    `--out=${scriptPath}`,
  ];
  if (entry) genArgs.push(`--entry=${entry}`);

  const genResult = await runChild(session, 'egoAuditProc', spawn, tsxBin, genArgs, repoRoot, spawnEnv, ws);
  if (session.egoAuditCancelled || session.egoAuditSeq !== seq) return;
  if (genResult.error || genResult.code !== 0 || !fs.existsSync(scriptPath)) {
    const message = genResult.error || '临时脚本生成失败';
    logLine(ws, `[ego-nl] ${message}`, 'err');
    send(ws, 'ego:nl-run:done', {
      ok: false,
      outRel,
      seq,
      engine,
      message,
      caseDescription,
      entry,
      env,
    });
    return;
  }

  let scriptCode = '';
  try {
    scriptCode = fs.readFileSync(scriptPath, 'utf-8');
  } catch {
    /* ignore */
  }
  if (scriptCode) {
    send(ws, 'ego:nl-run:script', {
      seq,
      outRel,
      engine,
      scriptRel: `${outRel}/generated.ts`,
      scriptCode,
    });
  }

  logLine(ws, '[ego-nl] 脚本已生成，开始 Playwright 执行…', 'info');
  const runArgs = [
    'scripts/ai/run-playwright-script.ts',
    `--script=${scriptPath}`,
    `--env=${env}`,
    `--profile=${profile}`,
    `--out=${runDir}`,
  ];
  if (entry) runArgs.push(`--entry=${entry}`);
  if (headed) runArgs.push('--headed');

  const runResult = await runChild(session, 'egoAuditProc', spawn, tsxBin, runArgs, repoRoot, spawnEnv, ws);
  if (session.egoAuditCancelled || session.egoAuditSeq !== seq) return;

  const runReport = readJson(path.join(runDir, 'result.json'));
  const runOk = runResult.code === 0 && runReport?.passed !== false;

  let auditPayload = null;
  const canAudit = doAudit && /\.optimized\.spec\.ts$/i.test(scriptPath);
  if (doAudit && !canAudit) {
    logLine(
      ws,
      '[ego-nl] 已跳过 ego 体检：临时动作脚本不是 optimized.spec.ts；在入口页扫 iframe 会误报「未匹配」',
      'warn',
    );
  }
  if (canAudit) {
    logLine(ws, '[ego-nl] 开始 ego 选择器体检…', 'info');
    const auditArgs = [
      'scripts/ego/audit-selectors.ts',
      scriptPath,
      `--env=${env}`,
      `--settle=${settle}`,
      `--json=${auditJson}`,
    ];
    if (entry) auditArgs.push(`--url=${entry}`);
    if (keepTab) auditArgs.push('--keep-tab');

    const auditResult = await runChild(session, 'egoAuditProc', spawn, tsxBin, auditArgs, repoRoot, spawnEnv, ws);
    if (session.egoAuditCancelled || session.egoAuditSeq !== seq) return;

    auditPayload = readJson(auditJson);

    if (auditResult.code === 2) {
      logLine(ws, '[ego-nl] ego lite 不可用，已跳过体检（脚本执行结果仍保留）', 'warn');
    } else if (auditResult.code === 4) {
      logLine(ws, '[ego-nl] ego lite 未登录，已跳过体检', 'warn');
    }
  }

  const results = Array.isArray(auditPayload?.results) ? auditPayload.results : [];
  const blocking = results.filter((r) => r.verdict === 'missing' && !r.optional);
  const warnings = results.filter((r) => r.verdict === 'ambiguous' || r.verdict === 'invisible');
  const healthy = results.filter((r) => r.verdict === 'ok');

  const ok = runOk;
  const payload = {
    ok,
    outRel,
    seq,
    engine,
    caseDescription,
    entry,
    env,
    scriptRel: `${outRel}/generated.ts`,
    scriptCode: scriptCode || undefined,
    passed: runOk,
    runError: runReport?.error || (runResult.error ? String(runResult.error) : undefined),
    message: ok ? undefined : runReport?.error || runResult.error || '执行未通过',
    videoRel: runReport?.videoRel,
    replayRel: runReport?.replayRel,
    failureBundleRel: runReport?.failureBundleRel,
    failureSummaryRel: runReport?.failureSummaryRel,
    audit: canAudit
      ? {
          url: auditPayload?.url || entry || '',
          summary: {
            healthy: healthy.length,
            blocking: blocking.length,
            warnings: warnings.length,
            total: results.length,
          },
          results,
        }
      : doAudit
        ? {
            url: '',
            summary: { healthy: 0, blocking: 0, warnings: 0, total: 0 },
            results: [],
            skipped: true,
            skipReason: '临时动作脚本不适合入口页静态体检',
          }
        : null,
  };
  send(ws, 'ego:nl-run:done', payload);
  logLine(ws, ok ? '[ego-nl] 完成：Playwright 试跑通过' : `[ego-nl] ${payload.message}`, ok ? 'ok' : 'err');
}

async function runEgoNlIntentPath(ws, session, ctx) {
  const {
    seq,
    outRel,
    outAbs,
    runDir,
    caseDescription,
    entry,
    env,
    profile,
    heal,
    keepTab,
    repoRoot,
    tsxBin,
    spawnEnv,
    spawn,
  } = ctx;

  const intentPreviewPath = path.join(outAbs, 'intent.preview.yaml');
  logLine(ws, '[ego-nl] NL → Intent YAML…', 'info');

  const nlArgs = [
    'scripts/ai/nl-to-intent.ts',
    `--case=${caseDescription}`,
    `--env=${env}`,
    `--out=${outAbs}`,
  ];
  if (entry) nlArgs.push(`--entry=${entry}`);

  const nlResult = await runChild(session, 'egoAuditProc', spawn, tsxBin, nlArgs, repoRoot, spawnEnv, ws);
  if (session.egoAuditCancelled || session.egoAuditSeq !== seq) return;

  let previewYaml = '';
  try {
    previewYaml = fs.readFileSync(intentPreviewPath, 'utf-8');
  } catch {
    /* ignore */
  }

  if (nlResult.error || nlResult.code !== 0 || !previewYaml.trim()) {
    const message = nlResult.error || 'Intent YAML 生成失败';
    logLine(ws, `[ego-nl] ${message}`, 'err');
    send(ws, 'ego:nl-run:done', {
      ok: false,
      outRel,
      seq,
      engine: 'ego',
      message,
      caseDescription,
      entry,
      env,
    });
    return;
  }

  send(ws, 'ego:nl-run:intent', {
    seq,
    outRel,
    engine: 'ego',
    intentRel: `${outRel}/intent.preview.yaml`,
    previewYaml,
  });

  logLine(ws, '[ego-nl] YAML 已生成，ego 执行中…', 'info');
  fs.mkdirSync(runDir, { recursive: true });
  const runArgs = [
    'scripts/ai/run-intent.ts',
    `--intent=${intentPreviewPath}`,
    '--engine=ego',
    `--env=${env}`,
    `--profile=${profile}`,
    `--out=${runDir}`,
  ];
  if (!heal) runArgs.push('--no-heal');
  if (keepTab) runArgs.push('--keep-tab');

  const runResult = await runChild(session, 'egoAuditProc', spawn, tsxBin, runArgs, repoRoot, spawnEnv, ws);
  if (session.egoAuditCancelled || session.egoAuditSeq !== seq) return;

  const runReport = readJson(path.join(runDir, 'result.json'));
  const runOk = runResult.code === 0 && runReport?.passed === true;
  const steps = Array.isArray(runReport?.steps) ? runReport.steps : [];

  const payload = {
    ok: runOk,
    outRel,
    seq,
    engine: 'ego',
    caseDescription,
    entry,
    env,
    intentRel: `${outRel}/intent.preview.yaml`,
    previewYaml,
    passed: runOk,
    steps,
    screenshotDir: runReport?.screenshotDir,
    videoRel: runReport?.videoRel,
    replayRel: runReport?.replayRel,
    failureBundleRel: runReport?.failureBundleRel,
    failureSummaryRel: runReport?.failureSummaryRel,
    runError: runReport?.error || (runResult.error ? String(runResult.error) : undefined),
    message: runOk ? undefined : runReport?.error || runResult.error || 'ego Intent 未通过',
    audit: null,
  };
  send(ws, 'ego:nl-run:done', payload);
  logLine(ws, runOk ? '[ego-nl] 完成：ego Intent 试跑通过' : `[ego-nl] ${payload.message}`, runOk ? 'ok' : 'err');
}

module.exports = { runEgoNlFlow };
