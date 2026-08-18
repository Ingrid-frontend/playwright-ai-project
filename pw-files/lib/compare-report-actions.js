const fs = require('fs');
const path = require('path');
const { send, logLine, stripAnsi } = require('./ws-safe');
const {
  COMPARE_REPORT_REL,
  repoHasScreenshotPng,
  sendCompareReportReady,
} = require('./compare-report-status');

async function openRepoCompareReport(ws, session, { regenerate = false } = {}, deps) {
  const { resolveRepoRoot } = deps;
  const repoRoot = resolveRepoRoot();
  if (!fs.existsSync(path.join(repoRoot, 'playwright.config.ts'))) {
    send(ws, 'error', { message: '未找到项目根，无法打开对比报告' });
    send(ws, 'repo:compare-report:done', { ok: false });
    return;
  }

  const absReport = path.join(repoRoot, COMPARE_REPORT_REL);
  if (!regenerate && fs.existsSync(absReport)) {
    sendCompareReportReady(ws, { openedExisting: true });
    return;
  }

  if (!repoHasScreenshotPng(path.join(repoRoot, 'screenshots'))) {
    send(ws, 'error', {
      message: 'screenshots/ 下无 PNG，无法生成对比报告（无需执行用例，但需已有截图文件）',
    });
    send(ws, 'repo:compare-report:done', { ok: false });
    return;
  }

  await runRepoCompareReport(ws, session, deps);
}

async function runRepoCompareReport(ws, session, deps) {
  const { resolveRepoRoot, spawn, buildRepoSpawnEnv } = deps;
  const repoRoot = resolveRepoRoot();
  if (!fs.existsSync(path.join(repoRoot, 'playwright.config.ts'))) {
    send(ws, 'error', { message: '未找到项目根，无法生成对比报告' });
    send(ws, 'repo:compare-report:done', { ok: false });
    return;
  }

  session.repoCompareCancelled = false;
  send(ws, 'repo:compare-report:start', {});
  logLine(ws, '[repo] 运行 compare-screenshots…', 'info');

  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const extraArgs = Array.isArray(deps.extraArgs) ? deps.extraArgs : [];
  const proc = spawn(npmCmd, ['run', 'compare-screenshots', '--', ...extraArgs], {
    cwd: repoRoot,
    env: buildRepoSpawnEnv(session),
    shell: false,
  });
  session.repoCompareProc = proc;
  proc.stdout.on('data', (d) => {
    const t = stripAnsi(d.toString());
    if (t.trim()) logLine(ws, t.trimEnd(), 'dim');
  });
  proc.stderr.on('data', (d) => {
    const t = stripAnsi(d.toString());
    if (t.trim()) logLine(ws, t.trimEnd(), 'warn');
  });

  const exitCode = await new Promise((resolve) => {
    proc.on('close', resolve);
  });
  session.repoCompareProc = null;

  if (session.repoCompareCancelled) {
    logLine(ws, '[repo] 对比报告生成已取消', 'warn');
    send(ws, 'repo:compare-report:done', { ok: false, cancelled: true });
    return;
  }
  if (exitCode !== 0) {
    send(ws, 'error', { message: `compare-screenshots 退出码 ${exitCode}` });
    send(ws, 'repo:compare-report:done', { ok: false, exitCode });
    return;
  }

  const absReport = path.join(repoRoot, COMPARE_REPORT_REL);
  if (!fs.existsSync(absReport)) {
    send(ws, 'error', {
      message: '未生成 results/screenshot-comparison.html（screenshots/ 可能为空或无可对比步骤）',
    });
    send(ws, 'repo:compare-report:done', { ok: false });
    return;
  }

  sendCompareReportReady(ws, { openedExisting: false });
}

module.exports = { openRepoCompareReport, runRepoCompareReport };
