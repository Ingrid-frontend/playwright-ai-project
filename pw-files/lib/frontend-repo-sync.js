const fs = require('fs');
const path = require('path');
const { spawnTsx } = require('./kill-proc');
const { logLine } = require('./ws-safe');

const DEFAULT_LOCAL_REPO = '/Users/hly/project/huilianyi-refactoring';
const DEFAULT_SSH_REPO = 'gogsio@code.huilianyi.com:huilianyi/huilianyi-refactoring.git';
const CACHE_REL = '.cache/frontend-repo';
const SSH_SCP_URL_RE = /^[^@\s/]+@[^@\s]+:[^\s]+$/;

/** Playwright 环境 → 前端仓库分支 */
const ENV_BRANCH_MAP = {
  dev: 'hly-deploy',
  uat: 'hly-dev',
  stage9084: 'hly-release',
  stage: 'hly-release',
};

function resolveFrontendRepoBranch(playwrightEnv) {
  const override = String(process.env.FRONTEND_REPO_BRANCH || '').trim();
  if (override) return override;
  const envId = String(playwrightEnv || process.env.PLAYWRIGHT_ENV || '').trim();
  return ENV_BRANCH_MAP[envId] || 'main';
}

function isSshRepoUrl(s) {
  const v = String(s || '').trim();
  return v.startsWith('ssh://') || SSH_SCP_URL_RE.test(v);
}

function isRemoteRepoUrl(s) {
  const v = String(s || '').trim();
  return v.startsWith('https://') || isSshRepoUrl(v);
}

function isLocalRepoPath(s) {
  const v = String(s || '').trim();
  if (!v || isRemoteRepoUrl(v)) return false;
  return v.startsWith('/') || v.startsWith('./') || v.startsWith('../') || /^[a-zA-Z]:[\\/]/.test(v);
}

function redactRepoUrl(url) {
  try {
    const u = new URL(url);
    if (u.password) u.password = '***';
    if (u.username) u.username = '***';
    return u.toString();
  } catch {
    return String(url || '').replace(/:[^/@]+@/, ':***@');
  }
}

function resolveFrontendRepoConfig(msg = {}) {
  const fromMsg = String(msg.frontendRepo || '').trim();
  const envSsh = String(process.env.FRONTEND_REPO_SSH_URL || '').trim();
  const envUrl = String(process.env.FRONTEND_REPO_URL || '').trim();
  const remoteFromEnv = envSsh || (isRemoteRepoUrl(envUrl) ? envUrl : '');
  const url = isRemoteRepoUrl(fromMsg) ? fromMsg : remoteFromEnv;
  const localFromMsg = isLocalRepoPath(fromMsg) ? fromMsg : '';
  const localPath = localFromMsg || String(process.env.FRONTEND_REPO_LOCAL || '').trim() || DEFAULT_LOCAL_REPO;
  const branch = resolveFrontendRepoBranch(msg.env || msg.playwrightEnv);
  const token = String(process.env.FRONTEND_REPO_TOKEN || '').trim();
  const cacheDir = path.join(resolveRepoRootFromMsg(msg), CACHE_REL);
  return { url, localPath, branch, token, cacheDir, transport: url && isSshRepoUrl(url) ? 'ssh' : 'remote' };
}

function resolveRepoRootFromMsg(msg) {
  if (msg.repoRoot) return path.resolve(msg.repoRoot);
  const { resolveRepoRoot } = require('./repo-context');
  return resolveRepoRoot();
}

function pipeProcLogs(ws, proc) {
  proc.stdout?.on('data', (d) => {
    const t = String(d || '').trimEnd();
    if (t) logLine(ws, t, 'dim');
  });
  proc.stderr?.on('data', (d) => {
    const t = String(d || '').trimEnd();
    if (t) logLine(ws, t, 'warn');
  });
}

function runTsxSync(repoRoot, args, spawnEnv, ws) {
  const proc = spawnTsx(repoRoot, 'scripts/index-frontend/sync-frontend-repo.ts', args, spawnEnv);
  let out = '';
  proc.stdout?.on('data', (d) => { out += d.toString(); });
  proc.stderr?.on('data', (d) => { out += d.toString(); });
  if (ws) pipeProcLogs(ws, proc);
  return new Promise((resolve) => {
    proc.on('close', (code) => resolve({ code, out }));
  });
}

function runTsxIndex(repoRoot, localPath, spawnEnv, ws) {
  const proc = spawnTsx(repoRoot, 'scripts/index-frontend/build-ui-contract.ts', [`--repo=${localPath}`], spawnEnv);
  if (ws) pipeProcLogs(ws, proc);
  return new Promise((resolve) => {
    proc.on('close', (code) => resolve(code));
  });
}

function parseSyncJson(out) {
  const lines = String(out || '').trim().split('\n').filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i].trim();
    if (!line.startsWith('{')) continue;
    try {
      return JSON.parse(line);
    } catch {
      continue;
    }
  }
  return null;
}

function getFrontendRepoDefaults(envId) {
  const sshUrl = String(process.env.FRONTEND_REPO_SSH_URL || '').trim();
  const envUrl = String(process.env.FRONTEND_REPO_URL || '').trim();
  const remote = sshUrl || (isRemoteRepoUrl(envUrl) ? envUrl : '') || DEFAULT_SSH_REPO;
  const branch = resolveFrontendRepoBranch(envId);
  return {
    frontendRepoDefault: remote,
    frontendRepoUrl: remote,
    frontendRepoBranch: branch,
    frontendRepoBranchByEnv: ENV_BRANCH_MAP,
    frontendRepoTransport: isSshRepoUrl(remote) ? 'ssh' : 'https',
    frontendRepoCache: CACHE_REL,
  };
}

/**
 * 探活前：远程 SSH/HTTPS → clone/pull；本地路径 → 直接用；然后跑 build-ui-contract。
 * @returns {Promise<{ ok: boolean, localPath?: string, reason?: string }>}
 */
async function prepareFrontendIndex(ws, repoRoot, msg, spawnEnv) {
  const cfg = resolveFrontendRepoConfig({ ...msg, repoRoot });

  let localPath = '';
  if (cfg.url) {
    const via = isSshRepoUrl(cfg.url) ? 'SSH' : 'HTTPS';
    logLine(ws, `[frontend] 同步远程仓库（${via}） ${cfg.url} · branch=${cfg.branch}`, 'info');
    if (via === 'HTTPS' && !cfg.token) {
      logLine(ws, '[frontend] HTTPS 未配置 FRONTEND_REPO_TOKEN，将尝试匿名拉取（仅公开仓库）', 'warn');
    }
    if (via === 'SSH') {
      logLine(ws, '[frontend] 使用本机 SSH 密钥（请在 Gitea 帐户设置 → SSH 密钥 中配置公钥）', 'dim');
    }
    const args = [
      `--url=${cfg.url}`,
      `--cache=${cfg.cacheDir}`,
      `--branch=${cfg.branch}`,
    ];
    const sync = await runTsxSync(repoRoot, args, spawnEnv, ws);
    if (sync.code !== 0) {
      const reason = sync.out.trim().split('\n').slice(-3).join(' ') || `同步退出码 ${sync.code}`;
      logLine(ws, `[frontend] 同步失败: ${reason}`, 'warn');
      return { ok: false, reason: reason.slice(0, 400) };
    }
    const parsed = parseSyncJson(sync.out);
    localPath = parsed?.localPath || cfg.cacheDir;
    logLine(ws, `[frontend] 同步完成 · ${parsed?.action || 'sync'} · ${localPath}`, 'ok');
  } else if (cfg.localPath && fs.existsSync(cfg.localPath)) {
    localPath = path.resolve(cfg.localPath);
    logLine(ws, `[frontend] 使用本地仓库 ${localPath}`, 'info');
  } else {
    const reason = '未配置 FRONTEND_REPO_SSH_URL，且本地仓库路径不存在';
    logLine(ws, `[frontend] ${reason}`, 'warn');
    return { ok: false, reason };
  }

  if (!fs.existsSync(path.join(localPath, 'package.json'))) {
    const reason = `前端仓库无效（缺少 package.json）: ${localPath}`;
    logLine(ws, `[frontend] ${reason}`, 'warn');
    return { ok: false, reason };
  }

  logLine(ws, '[frontend] 重建 UI 契约索引…', 'info');
  const indexCode = await runTsxIndex(repoRoot, localPath, spawnEnv, ws);
  if (indexCode !== 0) {
    const reason = `build-ui-contract 退出码 ${indexCode}`;
    logLine(ws, `[frontend] ${reason}`, 'warn');
    return { ok: false, reason, localPath };
  }
  logLine(ws, '[frontend] UI 契约索引已更新 · datasource/ui-contract.json', 'ok');
  return { ok: true, localPath };
}

module.exports = {
  CACHE_REL,
  DEFAULT_SSH_REPO,
  redactRepoUrl,
  resolveFrontendRepoBranch,
  ENV_BRANCH_MAP,
  resolveFrontendRepoConfig,
  getFrontendRepoDefaults,
  prepareFrontendIndex,
};
