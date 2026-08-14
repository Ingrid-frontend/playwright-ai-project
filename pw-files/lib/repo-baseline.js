const { send, logLine, stripAnsi } = require('./ws-safe');

async function runRepoPromoteBaseline(ws, session, msg, deps) {
  const { resolveRepoRoot, buildRepoSpawnEnv, spawn } = deps;
  const repoRoot = resolveRepoRoot();
  const scriptKey = String(msg.scriptKey || msg.script || '').trim();
  const runTs = String(msg.runTimestamp || msg.run || '').trim();
  const browser = String(msg.browser || 'chrome').trim().toLowerCase();

  if (!scriptKey || !runTs) {
    send(ws, 'error', { message: 'promote 需要 scriptKey 与 runTimestamp' });
    send(ws, 'repo:promote-baseline:done', { ok: false });
    return;
  }

  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const args = [
    'run',
    'promote-baseline',
    '--',
    `--script=${scriptKey}`,
    `--run=${runTs}`,
    `--browser=${browser}`,
  ];
  logLine(ws, `[repo] promote-baseline ${scriptKey} @ ${runTs}`, 'info');
  const proc = spawn(npmCmd, args, {
    cwd: repoRoot,
    env: buildRepoSpawnEnv(session),
    shell: false,
  });
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
  if (exitCode !== 0) {
    send(ws, 'error', { message: `promote-baseline 退出码 ${exitCode}` });
    send(ws, 'repo:promote-baseline:done', { ok: false });
    return;
  }
  send(ws, 'repo:promote-baseline:done', { ok: true, scriptKey, runTimestamp: runTs });
  logLine(ws, '[repo] Golden 基线已更新', 'ok');
}

module.exports = { runRepoPromoteBaseline };
