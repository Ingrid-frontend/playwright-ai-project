const path = require('path');
const { spawn } = require('child_process');
const { logLine, stripAnsi } = require('./ws-safe');

function scriptKeyFromOptimizedSpec(specRel) {
  const norm = String(specRel || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const m = norm.match(/^tests\/optimized\/(.+)\.optimized\.spec\.ts$/i);
  if (m) return m[1];
  const m2 = norm.match(/^(.+)\.optimized\.spec\.ts$/i);
  return m2 ? m2[1].replace(/^tests\/optimized\//, '') : '';
}

function browsersFromProjects(projects) {
  const list = Array.isArray(projects) ? projects : [];
  const out = [];
  for (const p of list) {
    const id = String(p || '');
    if (id === 'optimized' || id === 'chromium') out.push('chrome');
    else if (id === 'optimized-webkit' || id === 'webkit') out.push('webkit');
    else if (id === 'optimized-firefox' || id === 'firefox') out.push('firefox');
  }
  return [...new Set(out.length ? out : ['chrome'])];
}

/**
 * 用例跑通且尚无 Golden 时，把最新 run 自动 seed 为基线（不阻断测试结果）。
 */
function seedGoldenIfMissingAfterSuccess(ws, deps, opts) {
  const { resolveRepoRoot, buildRepoSpawnEnv, spawn: spawnFn } = deps;
  const spawnImpl = spawnFn || spawn;
  if (process.env.AUTO_PROMOTE_BASELINE === '0') return;

  const scriptKey = scriptKeyFromOptimizedSpec(opts.specRelative);
  if (!scriptKey) return;

  const repoRoot = resolveRepoRoot();
  const browsers = browsersFromProjects(opts.projects);
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

  (async () => {
    for (const browser of browsers) {
      const args = [
        'run',
        'promote-baseline',
        '--',
        `--script=${scriptKey}`,
        '--latest',
        `--browser=${browser}`,
        '--only-if-missing',
        '--promoted-by=studio-first-run',
      ];
      logLine(ws, `[repo] 首次无基线则自动 seed Golden: ${scriptKey} / ${browser}`, 'dim');
      const exitCode = await new Promise((resolve) => {
        const proc = spawnImpl(npmCmd, args, {
          cwd: repoRoot,
          env: buildRepoSpawnEnv(opts.session, undefined, opts.playwrightEnv),
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
        proc.on('close', (c) => resolve(c == null ? 1 : c));
      });
      if (exitCode === 0) {
        logLine(ws, `[repo] Golden seed 完成或已存在: ${scriptKey} / ${browser}`, 'ok');
      } else {
        logLine(
          ws,
          `[repo] Golden seed 跳过/失败（不影响用例结果）: ${scriptKey} / ${browser} exit=${exitCode}`,
          'warn',
        );
      }
    }
  })().catch((e) => {
    logLine(ws, `[repo] Golden seed 异常: ${e?.message || e}`, 'warn');
  });
}

module.exports = {
  scriptKeyFromOptimizedSpec,
  browsersFromProjects,
  seedGoldenIfMissingAfterSuccess,
};
