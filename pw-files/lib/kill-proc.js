const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

function spawnTracked(cmd, args, opts = {}) {
  const detached = process.platform !== 'win32';
  return spawn(cmd, args, { ...opts, shell: false, detached });
}

function resolveRepoBin(repoRoot, rel) {
  const abs = path.join(repoRoot, rel);
  return fs.existsSync(abs) ? abs : '';
}

function spawnTsx(repoRoot, scriptRel, args, env) {
  const script = path.join(repoRoot, scriptRel);
  const tsxCli =
    resolveRepoBin(repoRoot, 'node_modules/tsx/dist/cli.mjs') ||
    (() => {
      try {
        return require.resolve('tsx/cli', { paths: [repoRoot] });
      } catch {
        return '';
      }
    })();
  if (tsxCli) {
    return spawnTracked(process.execPath, [tsxCli, script, ...args], { cwd: repoRoot, env });
  }
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  return spawnTracked(npx, ['tsx', script, ...args], { cwd: repoRoot, env });
}

function spawnPlaywright(repoRoot, args, env) {
  const pwCli =
    resolveRepoBin(repoRoot, 'node_modules/@playwright/test/cli.js') ||
    resolveRepoBin(repoRoot, 'node_modules/playwright/cli.js');
  if (pwCli) {
    return spawnTracked(process.execPath, [pwCli, ...args], { cwd: repoRoot, env });
  }
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  return spawnTracked(npx, ['playwright', ...args], { cwd: repoRoot, env });
}

function killProcessTree(proc, signal = 'SIGTERM') {
  if (!proc || proc.killed) return false;
  const pid = proc.pid;
  if (!pid) return false;
  if (process.platform === 'win32') {
    try {
      spawnSync('taskkill', ['/pid', String(pid), '/f', '/t'], { stdio: 'ignore' });
      return true;
    } catch {
      try {
        proc.kill(signal);
        return true;
      } catch {
        return false;
      }
    }
  }
  try {
    process.kill(-pid, signal);
    return true;
  } catch {
    /* fall through */
  }
  try {
    spawnSync('pkill', ['-TERM', '-P', String(pid)], { stdio: 'ignore' });
  } catch {
    /* ignore */
  }
  try {
    proc.kill(signal);
    return true;
  } catch {
    return false;
  }
}

function killProcessTreeHard(proc) {
  if (!proc || proc.killed) return false;
  killProcessTree(proc, 'SIGKILL');
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(proc.pid), '/f', '/t'], { stdio: 'ignore' });
    } else {
      try {
        process.kill(-proc.pid, 'SIGKILL');
      } catch {
        /* ignore */
      }
      proc.kill('SIGKILL');
    }
    return true;
  } catch {
    return false;
  }
}

module.exports = { spawnTracked, spawnTsx, spawnPlaywright, killProcessTree, killProcessTreeHard };
