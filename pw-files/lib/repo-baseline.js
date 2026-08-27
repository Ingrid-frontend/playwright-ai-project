const { send, logLine, stripAnsi } = require('./ws-safe');

async function runRepoPromoteBaseline(ws, session, msg, deps) {
  const { resolveRepoRoot, buildRepoSpawnEnv, spawn } = deps;
  const repoRoot = resolveRepoRoot();
  const scriptKey = String(msg.scriptKey || msg.script || '').trim();
  const runTs = String(msg.runTimestamp || msg.run || '').trim();
  const browser = String(msg.browser || 'chrome').trim().toLowerCase();
  const onlyIfMissing = Boolean(msg.onlyIfMissing);
  const useLatest = Boolean(msg.latest) || !runTs;

  if (!scriptKey) {
    send(ws, 'error', { message: 'promote 需要 scriptKey' });
    send(ws, 'repo:promote-baseline:done', { ok: false });
    return;
  }

  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const args = [
    'run',
    'promote-baseline',
    '--',
    `--script=${scriptKey}`,
    `--browser=${browser}`,
  ];
  if (runTs) args.push(`--run=${runTs}`);
  else if (useLatest) args.push('--latest');
  if (onlyIfMissing) args.push('--only-if-missing');
  logLine(ws, `[repo] promote-baseline ${scriptKey}${runTs ? ` @ ${runTs}` : ' --latest'}`, 'info');
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

async function runRepoVisualReview(ws, session, msg, deps) {
  const { resolveRepoRoot, buildRepoSpawnEnv, spawn } = deps;
  const repoRoot = resolveRepoRoot();
  const verdict = String(msg.verdict || '').trim();
  const scriptKey = String(msg.scriptKey || msg.script || '').trim();
  const runTs = String(msg.runTimestamp || msg.run || '').trim();
  const step = String(msg.stepFileName || msg.step || '').trim();
  const browser = String(msg.browser || 'chrome').trim().toLowerCase();
  const issueId = String(msg.issueId || '').trim();

  if (!verdict || !scriptKey || !runTs || !step) {
    send(ws, 'error', { message: 'visual-review 需要 verdict、scriptKey、runTimestamp、step' });
    send(ws, 'repo:visual-review:done', { ok: false });
    return;
  }

  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const args = [
    'run',
    'visual-review',
    '--',
    `--verdict=${verdict}`,
    `--script=${scriptKey}`,
    `--run=${runTs}`,
    `--step=${step}`,
    `--browser=${browser}`,
  ];
  if (issueId) args.push(`--issueId=${issueId}`);
  logLine(ws, `[repo] visual-review ${verdict} ${scriptKey} ${step}`, 'info');
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
    send(ws, 'error', { message: `visual-review 退出码 ${exitCode}` });
    send(ws, 'repo:visual-review:done', { ok: false });
    return;
  }
  send(ws, 'repo:visual-review:done', { ok: true, verdict, scriptKey, step });
  logLine(ws, '[repo] Visual Review 已记录', 'ok');
}

module.exports = { runRepoPromoteBaseline, runRepoVisualReview };
