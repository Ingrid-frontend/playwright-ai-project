const { send, logLine, stripAnsi } = require('./ws-safe');

function spawnPromote(ws, session, deps, opts) {
  const { resolveRepoRoot, buildRepoSpawnEnv, spawn } = deps;
  const repoRoot = resolveRepoRoot();
  const scriptKey = String(opts.scriptKey || '').trim();
  const runTs = String(opts.runTimestamp || '').trim();
  const browser = String(opts.browser || 'chrome').trim().toLowerCase();
  const onlyIfMissing = Boolean(opts.onlyIfMissing);
  const promotedBy = String(opts.promotedBy || '').trim();
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const args = ['run', 'promote-baseline', '--', `--script=${scriptKey}`, `--browser=${browser}`];
  if (runTs) args.push(`--run=${runTs}`);
  else args.push('--latest');
  if (onlyIfMissing) args.push('--only-if-missing');
  if (promotedBy) args.push(`--promoted-by=${promotedBy}`);
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
  return new Promise((resolve) => {
    proc.on('close', (code) => resolve(code ?? 1));
  });
}

function readPromoteTargets(msg) {
  if (!Array.isArray(msg.targets)) return [];
  return msg.targets
    .map((item) => ({
      scriptKey: String(item?.scriptKey || item?.script || '').trim(),
      runTimestamp: String(item?.runTimestamp || item?.run || '').trim(),
    }))
    .filter((item) => item.scriptKey && item.runTimestamp);
}

async function runRepoPromoteBaseline(ws, session, msg, deps) {
  const targets = readPromoteTargets(msg);
  if (targets.length) {
    logLine(ws, `[repo] 全量更新基线 · ${targets.length} 个角色`, 'info');
    for (const target of targets) {
      const exitCode = await spawnPromote(ws, session, deps, {
        ...target,
        browser: msg.browser,
        onlyIfMissing: false,
        promotedBy: 'studio-detect-all',
      });
      if (exitCode !== 0) {
        send(ws, 'error', { message: `promote-baseline 退出码 ${exitCode} · ${target.scriptKey}` });
        send(ws, 'repo:promote-baseline:done', { ok: false, count: targets.length, scriptKey: target.scriptKey });
        return;
      }
    }
    send(ws, 'repo:promote-baseline:done', { ok: true, count: targets.length });
    logLine(ws, `[repo] 已全量更新 ${targets.length} 个角色的 Golden 基线`, 'ok');
    return;
  }

  const scriptKey = String(msg.scriptKey || msg.script || '').trim();
  const runTs = String(msg.runTimestamp || msg.run || '').trim();
  const onlyIfMissing = Boolean(msg.onlyIfMissing);
  if (!scriptKey) {
    send(ws, 'error', { message: 'promote 需要 scriptKey' });
    send(ws, 'repo:promote-baseline:done', { ok: false });
    return;
  }
  const exitCode = await spawnPromote(ws, session, deps, {
    scriptKey,
    runTimestamp: runTs,
    browser: msg.browser,
    onlyIfMissing,
  });
  if (exitCode !== 0) {
    send(ws, 'error', { message: `promote-baseline 退出码 ${exitCode}` });
    send(ws, 'repo:promote-baseline:done', { ok: false });
    return;
  }
  send(ws, 'repo:promote-baseline:done', { ok: true, count: 1, scriptKey, runTimestamp: runTs });
  logLine(ws, '[repo] Golden 基线已更新', 'ok');
}

async function runRepoClearBaseline(ws, session, msg, deps) {
  const { resolveRepoRoot, buildRepoSpawnEnv, spawn } = deps;
  const repoRoot = resolveRepoRoot();
  const scriptKey = String(msg.scriptKey || msg.script || '').trim();
  const scope = String(msg.scope || '').trim();

  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const args = ['run', 'promote-baseline', '--', '--clear'];
  if (scope === 'flows') {
    args.push('--scope=flows');
    logLine(ws, '[repo] 清空 flows 基线 screenshots-baseline/flows/', 'warn');
  } else {
    if (!scriptKey) {
      send(ws, 'error', { message: '清空基线需要 scriptKey' });
      send(ws, 'repo:clear-baseline:done', { ok: false });
      return;
    }
    args.push(`--script=${scriptKey}`);
    logLine(ws, `[repo] 清空基线 ${scriptKey}`, 'warn');
  }

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
    send(ws, 'error', { message: `清空基线失败，退出码 ${exitCode}` });
    send(ws, 'repo:clear-baseline:done', { ok: false, scriptKey, scope });
    return;
  }
  send(ws, 'repo:clear-baseline:done', { ok: true, scriptKey, scope });
  logLine(ws, '[repo] 基线与 run 截图已清空', 'ok');
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

module.exports = { runRepoPromoteBaseline, runRepoClearBaseline, runRepoVisualReview };
