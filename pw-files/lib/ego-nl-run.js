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

/** 自然语言 → 生成临时脚本 → Playwright 执行 → 可选 ego 选择器体检 */
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

  send(ws, 'ego:nl-run:start', { outRel, seq, env, profile, audit: doAudit });
  logLine(ws, `[ego-nl] 生成临时脚本 · env=${env}`, 'info');

  const tsxBin = path.join(
    repoRoot,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'tsx.cmd' : 'tsx',
  );
  const spawnEnv = buildRepoSpawnEnv(session);

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
    send(ws, 'ego:nl-run:done', { ok: false, outRel, seq, message });
    return;
  }

  logLine(ws, '[ego-nl] 脚本已生成，开始执行…', 'info');
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

  let runReport = null;
  const resultPath = path.join(runDir, 'result.json');
  if (fs.existsSync(resultPath)) {
    try {
      runReport = JSON.parse(fs.readFileSync(resultPath, 'utf-8'));
    } catch {
      /* ignore */
    }
  }
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

    if (fs.existsSync(auditJson)) {
      try {
        auditPayload = JSON.parse(fs.readFileSync(auditJson, 'utf-8'));
      } catch {
        /* ignore */
      }
    }

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
    scriptRel: `${outRel}/generated.ts`,
    passed: runOk,
    runError: runReport?.error || (runResult.error ? String(runResult.error) : undefined),
    message: ok ? undefined : runReport?.error || runResult.error || '执行未通过',
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
  logLine(ws, ok ? '[ego-nl] 完成：脚本执行通过' : `[ego-nl] ${payload.message}`, ok ? 'ok' : 'err');
}

module.exports = { runEgoNlFlow };