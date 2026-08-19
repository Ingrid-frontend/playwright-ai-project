const fs = require('fs');
const path = require('path');
const { send, logLine, stripAnsi, errText } = require('./ws-safe');

const REPLAY_SUMMARY_REL = path.join('results', 'flow-replay-summary.html');

function replaySummaryOpenPath() {
  return `/repo-report/${REPLAY_SUMMARY_REL.split(path.sep).join('/')}`;
}

async function runReplaySummary(ws, session, msg = {}, deps) {
  const { resolveRepoRoot, spawn, buildRepoSpawnEnv } = deps;
  const repoRoot = resolveRepoRoot();
  if (!fs.existsSync(path.join(repoRoot, 'playwright.config.ts'))) {
    send(ws, 'error', { message: '未找到项目根，无法生成回放汇总' });
    send(ws, 'replay:summary:done', { ok: false });
    return;
  }

  const lookback = Math.max(1, Number(msg.lookback) || 20);
  const regenerate = msg.regenerate !== false;
  const absReport = path.join(repoRoot, REPLAY_SUMMARY_REL);

  if (!regenerate && fs.existsSync(absReport)) {
    send(ws, 'replay:summary:done', {
      ok: true,
      openPath: replaySummaryOpenPath(),
      openedExisting: true,
    });
    return;
  }

  send(ws, 'replay:summary:start', { lookback });
  logLine(ws, `[replay] 生成回放汇总（lookback=${lookback}）…`, 'info');

  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const proc = spawn(npmCmd, ['run', 'report:replay-summary', '--', `--lookback=${lookback}`], {
    cwd: repoRoot,
    env: buildRepoSpawnEnv(session),
    shell: false,
  });
  session.replaySummaryProc = proc;

  const runResult = await new Promise((resolve) => {
    proc.stdout.on('data', (d) => {
      const t = stripAnsi(d.toString());
      if (t.trim()) logLine(ws, t.trimEnd(), 'dim');
    });
    proc.stderr.on('data', (d) => {
      const t = stripAnsi(d.toString());
      if (t.trim()) logLine(ws, t.trimEnd(), 'warn');
    });
    proc.on('error', (error) => {
      if (session.replaySummaryProc === proc) session.replaySummaryProc = null;
      resolve({ code: null, error: errText(error) });
    });
    proc.on('close', (code) => {
      if (session.replaySummaryProc === proc) session.replaySummaryProc = null;
      resolve({ code, error: null });
    });
  });

  if (runResult.code !== 0 || !fs.existsSync(absReport)) {
    const message = runResult.error || `report:replay-summary 退出码 ${runResult.code}`;
    send(ws, 'error', { message });
    send(ws, 'replay:summary:done', { ok: false, message, exitCode: runResult.code });
    return;
  }

  send(ws, 'replay:summary:done', {
    ok: true,
    openPath: replaySummaryOpenPath(),
    openedExisting: false,
  });
  logLine(ws, `[replay] 回放汇总就绪: ${replaySummaryOpenPath()}`, 'ok');
}

module.exports = { runReplaySummary, replaySummaryOpenPath, REPLAY_SUMMARY_REL };
