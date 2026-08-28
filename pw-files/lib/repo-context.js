const path = require('path');
const fs = require('fs');
const os = require('os');
const repoEnv = require('../repo-env');

const DEFAULT_PLAYWRIGHT_ENV = 'stage';

function resolveRepoRoot() {
  if (process.env.PLAYWRIGHT_REPO_ROOT) {
    const r = path.resolve(process.env.PLAYWRIGHT_REPO_ROOT);
    if (fs.existsSync(path.join(r, 'playwright.config.ts'))) return r;
  }
  let dir = path.resolve(__dirname, '..');
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, 'playwright.config.ts'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(__dirname, '..');
}

function loadRepoEnvironments(repoRoot) {
  const configPath = path.join(repoRoot, 'datasource', 'base-config.json');
  if (!fs.existsSync(configPath)) {
    return { defaultEnv: DEFAULT_PLAYWRIGHT_ENV, environments: [] };
  }
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (e) {
    console.warn('[studio] 无法解析 base-config.json', e);
    return { defaultEnv: DEFAULT_PLAYWRIGHT_ENV, environments: [] };
  }
  const environments = Object.keys(raw).map((id) => {
    const c = raw[id] || {};
    const storageRel = typeof c.storageState === 'string' ? c.storageState : '';
    return {
      id,
      baseURL: typeof c.baseURL === 'string' ? c.baseURL : '',
      storageState: storageRel,
      hasStorage: repoEnv.envHasAnyStorage(repoRoot, id),
    };
  });
  const defaultEnv =
    (process.env.PLAYWRIGHT_ENV && environments.some((e) => e.id === process.env.PLAYWRIGHT_ENV)
      ? process.env.PLAYWRIGHT_ENV
      : null) ||
    (environments.some((e) => e.id === DEFAULT_PLAYWRIGHT_ENV) ? DEFAULT_PLAYWRIGHT_ENV : null) ||
    environments[0]?.id ||
    DEFAULT_PLAYWRIGHT_ENV;
  return { defaultEnv, environments };
}

function getSessionPlaywrightEnv(session) {
  return session.playwrightEnv || process.env.PLAYWRIGHT_ENV || DEFAULT_PLAYWRIGHT_ENV;
}

function getEnvEntry(repoRoot, envId) {
  const { environments } = loadRepoEnvironments(repoRoot);
  return environments.find((e) => e.id === envId) || null;
}

function getSessionAccountProfile(session, repoRoot) {
  const envId = getSessionPlaywrightEnv(session);
  return repoEnv.resolveAccountProfile(repoRoot, envId, session.accountProfile);
}

function getEnvEntryResolved(repoRoot, envId, profileId) {
  const entry = getEnvEntry(repoRoot, envId);
  if (!entry) return null;
  const storageRel = repoEnv.resolveStorageStateRel(repoRoot, envId, profileId);
  return {
    ...entry,
    storageState: storageRel,
    hasStorage: repoEnv.storageExists(repoRoot, storageRel),
    accountProfile: repoEnv.resolveAccountProfile(repoRoot, envId, profileId),
  };
}

function isValidBrowsersDir(dir) {
  if (!dir || !fs.existsSync(dir)) return false;
  try {
    return fs.readdirSync(dir).some((n) => n.startsWith('chromium'));
  } catch {
    return false;
  }
}

function fixPlaywrightBrowsersEnv(env) {
  const cur = env.PLAYWRIGHT_BROWSERS_PATH;
  const mac = path.join(os.homedir(), 'Library/Caches/ms-playwright');
  if (isValidBrowsersDir(cur)) return env;
  if (isValidBrowsersDir(mac)) env.PLAYWRIGHT_BROWSERS_PATH = mac;
  else delete env.PLAYWRIGHT_BROWSERS_PATH;
  return env;
}

function buildRepoSpawnEnv(session, profileOverride, envOverride) {
  const env = { ...process.env };
  const id = envOverride || getSessionPlaywrightEnv(session);
  if (id) env.PLAYWRIGHT_ENV = id;
  const repoRoot = resolveRepoRoot();
  const prof = profileOverride || repoEnv.resolveAccountProfile(repoRoot, id, session.accountProfile);
  if (prof) env.PLAYWRIGHT_ACCOUNT = prof;
  return fixPlaywrightBrowsersEnv(env);
}

function buildStudioRunEnv(session) {
  const env = buildRepoSpawnEnv(session);
  const repoRoot = resolveRepoRoot();
  const envId = getSessionPlaywrightEnv(session);
  const profile = getSessionAccountProfile(session, repoRoot);
  const resolved = getEnvEntryResolved(repoRoot, envId, profile);
  if (resolved?.storageState) {
    env.STORAGE_STATE_PATH = path.resolve(repoRoot, resolved.storageState);
  }
  if (resolved?.baseURL) {
    env.PLAYWRIGHT_BASE_URL = resolved.baseURL;
  }
  return { env, resolved, repoRoot };
}

module.exports = {
  DEFAULT_PLAYWRIGHT_ENV,
  resolveRepoRoot,
  loadRepoEnvironments,
  getSessionPlaywrightEnv,
  getEnvEntry,
  getSessionAccountProfile,
  getEnvEntryResolved,
  buildRepoSpawnEnv,
  buildStudioRunEnv,
  fixPlaywrightBrowsersEnv,
};
