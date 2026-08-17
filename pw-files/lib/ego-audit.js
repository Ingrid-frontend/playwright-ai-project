const fs = require('fs');
const path = require('path');
const { send, logLine, stripAnsi, errText } = require('./ws-safe');

async function runEgoAudit(ws, session, msg = {}, deps) {
  const {
    resolveRepoRoot,
    spawn,
    buildRepoSpawnEnv,
    getSessionPlaywrightEnv,
    assertAllowedOptimizedSpec,
  } = deps;
  const repoRoot = resolveRepoRoot();
  if (!fs.existsSync(path.join(repoRoot, 'playwright.config.ts'))) {
    send(ws, 'error', { message: '未找到项目根，无法执行 ego 体检' });
    send(ws, 'ego:audit:done', { ok: false, message: '未找到项目根' });
    return;
  }

  const specRel = String(msg.spec || '').trim().replace(/\\/g, '/');
  if (!specRel) {
    send(ws, 'error', { message: '请先选择 optimized spec' });
    send(ws, 'ego:audit:done', { ok: false, message: '缺少 spec' });
    return;
  }

  let specAbs;
  try {
    specAbs = assertAllowedOptimizedSpec(repoRoot, specRel);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    send(ws, 'error', { message });
    send(ws, 'ego:audit:done', { ok: false, message });
    return;
  }
  if (!fs.existsSync(specAbs)) {
    send(ws, 'error', { message: `spec 不存在: ${specRel}` });
    send(ws, 'ego:audit:done', { ok: false, message: `文件不存在: ${specRel}` });
    return;
  }

  const env = String(msg.env || getSessionPlaywrightEnv(session) || 'stage').trim();
  const url = String(msg.url || '').trim();
  const settle = Math.max(0, Number(msg.settle) || 3);
  const keepTab = Boolean(msg.keepTab);
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const outRel = `results/ego-audit/${stamp}-studio.json`;
  const outAbs = path.join(repoRoot, outRel);
  fs.mkdirSync(path.dirname(outAbs), { recursive: true });

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
  send(ws, 'ego:audit:start', { outRel, seq, env, spec: specRel, url, keepTab });
  logLine(ws, `[ego] 体检 ${specRel} · env=${env}${url ? ` · url=${url}` : ''}`, 'info');

  const tsxBin = path.join(
    repoRoot,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'tsx.cmd' : 'tsx',
  );
  const args = [
    'scripts/ego/audit-selectors.ts',
    specAbs,
    `--env=${env}`,
    `--settle=${settle}`,
    `--json=${outAbs}`,
  ];
  if (url) args.push(`--url=${url}`);
  if (keepTab) args.push('--keep-tab');

  const proc = spawn(tsxBin, args, {
    cwd: repoRoot,
    env: buildRepoSpawnEnv(session),
    shell: false,
  });
  session.egoAuditProc = proc;

  const runResult = await new Promise((resolve) => {
    proc.stdout.on('data', (d) => {
      const text = stripAnsi(d.toString()).trimEnd();
      if (text) logLine(ws, text, 'dim');
    });
    proc.stderr.on('data', (d) => {
      const text = stripAnsi(d.toString()).trimEnd();
      if (text) logLine(ws, text, 'warn');
    });
    proc.on('error', (error) => {
      if (session.egoAuditProc === proc) session.egoAuditProc = null;
      resolve({ code: null, error: errText(error) });
    });
    proc.on('close', (code) => {
      if (session.egoAuditProc === proc) session.egoAuditProc = null;
      resolve({ code, error: null });
    });
  });

  if (session.egoAuditCancelled || session.egoAuditSeq !== seq) return;

  let report = null;
  if (fs.existsSync(outAbs)) {
    try {
      report = JSON.parse(fs.readFileSync(outAbs, 'utf-8'));
    } catch {
      /* ignore */
    }
  }

  const results = Array.isArray(report?.results) ? report.results : [];
  const blocking = results.filter((r) => r.verdict === 'missing' && !r.optional);
  const warnings = results.filter((r) => r.verdict === 'ambiguous' || r.verdict === 'invisible');
  const healthy = results.filter((r) => r.verdict === 'ok');
  const exitCode = runResult.code;
  const ok = exitCode === 0;

  let message;
  if (runResult.error) message = String(runResult.error);
  else if (exitCode === 2) message = 'ego lite 不可用（未安装 / 未启动 / PATH 无 ego-browser）';
  else if (exitCode === 3) message = 'ego lite task space 被用户接管，请交还控制权后重试';
  else if (exitCode === 4) message = 'ego lite 中该环境尚未登录，请勾选「保留页面」后登录再跑';
  else if (!ok) message = blocking.length ? `${blocking.length} 个必经步骤定位失败` : 'ego 体检未通过';

  const payload = {
    ok,
    outRel,
    seq,
    spec: specRel,
    url: report?.url || url || '',
    exitCode,
    message,
    summary: {
      healthy: healthy.length,
      blocking: blocking.length,
      warnings: warnings.length,
      total: results.length,
    },
    results,
    unparsed: report?.unparsed || [],
  };
  send(ws, 'ego:audit:done', payload);
  logLine(ws, ok ? '[ego] 体检通过' : `[ego] ${message || '体检未通过'}`, ok ? 'ok' : 'err');
}

module.exports = { runEgoAudit };
