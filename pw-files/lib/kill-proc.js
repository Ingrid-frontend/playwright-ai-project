const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { AsyncLocalStorage } = require('async_hooks');

// Only spawnTracked participates; shared Jobs and HTTP background jobs use their own spawn.
const processScope = new AsyncLocalStorage();
const processStates = new WeakMap();

function observeProcess(proc, detached = false) {
  let state = processStates.get(proc);
  if (state) return state;
  state = { closed: false, detached };
  state.close = new Promise((resolve) => {
    proc.once('close', () => {
      state.closed = true;
      resolve();
    });
  });
  // A spawn error is followed by close, not evidence that an existing child exited.
  proc.on('error', () => {});
  processStates.set(proc, state);
  return state;
}

function spawnTracked(cmd, args, opts = {}) {
  const owner = processScope.getStore();
  if (owner?.cancelled) throw new Error('会话已取消');
  const detached = process.platform !== 'win32';
  const proc = spawn(cmd, args, { ...opts, shell: false, detached });
  observeProcess(proc, detached);
  owner?.trackProcess(proc);
  return proc;
}

function resolveRepoBin(repoRoot, rel) {
  const abs = path.join(repoRoot, rel);
  return fs.existsSync(abs) ? abs : '';
}

function spawnTsx(repoRoot, scriptRel, args, env, { localOnly = false } = {}) {
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
  if (localOnly) throw new Error('未找到本地 tsx，请在项目根执行 npm install');
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

function processGroupAlive(proc) {
  if (!processStates.get(proc)?.detached || !proc.pid) return false;
  try {
    process.kill(-proc.pid, 0);
    return true;
  } catch (err) {
    return err.code !== 'ESRCH';
  }
}

function killProcessTree(proc, signal = 'SIGTERM') {
  if (!proc || !proc.pid) return false;
  const state = processStates.get(proc);
  if (state?.closed && !processGroupAlive(proc)) return false;
  if (!state && (proc.exitCode != null || proc.signalCode != null)) return false;
  const pid = proc.pid;
  const killParent = () => {
    try { return proc.kill(signal); } catch { return false; }
  };
  if (process.platform === 'win32') {
    try {
      const args = ['/pid', String(pid), '/t'];
      if (signal === 'SIGKILL') args.push('/f');
      const killer = spawn('taskkill', args, { stdio: 'ignore', shell: false });
      killer.on('error', killParent);
      killer.on('close', (code) => { if (code !== 0) killParent(); });
      return true;
    } catch {
      return killParent();
    }
  }
  try {
    process.kill(-pid, signal);
    return true;
  } catch {
    /* Non-detached legacy callers: signal children before their parent. */
  }
  try {
    const killer = spawn('pkill', [`-${signal.replace(/^SIG/, '')}`, '-P', String(pid)], {
      stdio: 'ignore', shell: false,
    });
    killer.on('error', killParent);
    killer.on('close', killParent);
    return true;
  } catch {
    return killParent();
  }
}

function killProcessTreeHard(proc) {
  return killProcessTree(proc, 'SIGKILL');
}

function stopProcessTree(proc, { termTimeoutMs = 3000 } = {}) {
  const state = observeProcess(proc);
  if (state.stopping) return state.stopping;
  state.stopping = new Promise((resolve) => {
    let pollTimer;
    const hardTimer = setTimeout(() => killProcessTreeHard(proc), termTimeoutMs);
    const check = () => {
      if (state.closed && !processGroupAlive(proc)) {
        clearTimeout(hardTimer);
        clearTimeout(pollTimer);
        resolve();
      } else {
        pollTimer = setTimeout(check, 100);
      }
    };
    killProcessTree(proc);
    state.close.then(check);
  });
  return state.stopping;
}

module.exports = {
  spawnTracked, spawnTsx, spawnPlaywright, killProcessTree, killProcessTreeHard,
  stopProcessTree, observeProcess, processGroupAlive, processScope,
};
