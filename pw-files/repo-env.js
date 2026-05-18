/**
 * 与主仓库 src/utils/env-config.ts 对齐的 JS 实现（供 Studio server 使用）
 */
const fs = require('fs');
const path = require('path');

function readJsonFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function getEnvAccountConfig(repoRoot, env) {
  const raw = readJsonFile(path.join(repoRoot, 'datasource', 'accounts.json'));
  if (!raw) return null;
  const entry = raw[env];
  if (!entry) return null;

  if (entry.profiles && typeof entry.profiles === 'object') {
    const defaultProfile =
      (entry.defaultProfile && String(entry.defaultProfile).trim()) ||
      Object.keys(entry.profiles)[0] ||
      'default';
    return { defaultProfile, profiles: entry.profiles };
  }

  if (entry.username && entry.password) {
    return {
      defaultProfile: 'default',
      profiles: {
        default: {
          username: entry.username,
          password: entry.password,
          label: 'default',
        },
      },
    };
  }

  return null;
}

function resolveAccountProfile(repoRoot, env, profile) {
  const cfg = getEnvAccountConfig(repoRoot, env);
  if (!cfg) return (profile && String(profile).trim()) || process.env.PLAYWRIGHT_ACCOUNT?.trim() || 'default';

  const fromEnv = process.env.PLAYWRIGHT_ACCOUNT?.trim();
  const candidate = (profile && String(profile).trim()) || fromEnv || cfg.defaultProfile || 'default';
  if (cfg.profiles[candidate]) return candidate;
  if (cfg.profiles[cfg.defaultProfile]) return cfg.defaultProfile;
  return Object.keys(cfg.profiles)[0] || 'default';
}

function getBaseEnvConfig(repoRoot, env) {
  const raw = readJsonFile(path.join(repoRoot, 'datasource', 'base-config.json'));
  return raw?.[env] ?? null;
}

function resolveStorageStateRel(repoRoot, env, profile) {
  const base = getBaseEnvConfig(repoRoot, env);
  if (!base) return '';

  const prof = resolveAccountProfile(repoRoot, env, profile);

  if (base.storageStates?.[prof]) {
    return base.storageStates[prof];
  }

  if (base.storageState) {
    if (prof === 'default') return base.storageState;
    const withoutExt = base.storageState.replace(/\.json$/i, '');
    return `${withoutExt}/${prof}.json`;
  }

  return '';
}

function maskUsername(username) {
  const u = String(username || '');
  if (u.length <= 4) return '****';
  if (u.includes('@')) {
    const [name, domain] = u.split('@');
    const head = name.slice(0, Math.min(3, name.length));
    return `${head}***@${domain}`;
  }
  return `${u.slice(0, 3)}***${u.slice(-2)}`;
}

function listAccountProfiles(repoRoot, env) {
  const cfg = getEnvAccountConfig(repoRoot, env);
  if (!cfg) return [{ id: 'default', label: 'default', maskedUsername: '' }];
  return Object.keys(cfg.profiles).map((id) => ({
    id,
    label: cfg.profiles[id].label || id,
    maskedUsername: maskUsername(cfg.profiles[id].username),
  }));
}

function storageExists(repoRoot, storageRel) {
  if (!storageRel) return false;
  const abs = path.resolve(repoRoot, storageRel);
  try {
    return fs.existsSync(abs) && fs.statSync(abs).size > 10;
  } catch {
    return false;
  }
}

const META_MARKERS = /录制元信息|录制环境:/;

const { extractLoginAccount, extractFromCode } = require(path.join(__dirname, '../src/utils/extract-login-account.cjs'));
const {
  readLoginStateMeta,
  formatLoginAccountLabel,
} = require(path.join(__dirname, '../src/utils/storage-state-meta.cjs'));

function isLikelyInternalUserId(value) {
  return typeof value === 'string' && /^\d{4,}$/.test(value.trim());
}

function resolveLoginUsernameForComment(repoRoot, envId, profileId, opts = {}) {
  const prof = resolveAccountProfile(repoRoot, envId, profileId);
  const storageRel = resolveStorageStateRel(repoRoot, envId, prof) || '';
  const storageAbs = opts.storagePath || (storageRel ? path.resolve(repoRoot, storageRel) : '');
  const fromCode = extractFromCode(opts.code);
  if (fromCode) return fromCode;
  const fromMeta = formatLoginAccountLabel(readLoginStateMeta(storageAbs));
  if (fromMeta) return fromMeta;
  const detected = extractLoginAccount({ code: opts.code, storagePath: storageAbs });
  if (detected && !isLikelyInternalUserId(detected)) return detected;
  return null;
}

/** 录制脚本头部注释（不含密码；登录账号优先读 storageState._loginStateMeta） */
function buildRecordingAccountHeader(repoRoot, envId, profileId, opts = {}) {
  const prof = resolveAccountProfile(repoRoot, envId, profileId);
  const storageRel = resolveStorageStateRel(repoRoot, envId, prof) || '';
  const storageAbs = opts.storagePath || (storageRel ? path.resolve(repoRoot, storageRel) : '');
  const meta = readLoginStateMeta(storageAbs) || {};
  const recordedAt = new Date().toISOString();
  const loginAccount = resolveLoginUsernameForComment(repoRoot, envId, prof, { ...opts, storagePath: storageAbs });
  const detectedId = extractLoginAccount({ storagePath: storageAbs });
  const userId = meta.userId || (isLikelyInternalUserId(detectedId || '') ? detectedId : null);

  const lines = ['// Playwright 录制元信息（勿在仓库中提交密码）'];
  if (loginAccount) {
    lines.push(`// 环境: ${envId} | 登录账号: ${loginAccount}`);
  } else if (userId) {
    lines.push(`// 环境: ${envId} | 登录账号: 未识别`);
    lines.push(`// 用户ID: ${userId}`);
  } else {
    lines.push(`// 环境: ${envId} | 登录账号: 浏览器手动登录（未识别账号）`);
  }
  lines.push(`// storageState: ${storageRel}`, `// 录制时间: ${recordedAt}`, '');
  return lines.join('\n');
}

function prependRecordingAccountHeader(repoRoot, code, envId, profileId) {
  if (!code || !String(code).trim()) return code;
  if (META_MARKERS.test(String(code).slice(0, 600))) return code;
  return buildRecordingAccountHeader(repoRoot, envId, profileId, { code }) + String(code).replace(/^\s*/, '');
}

module.exports = {
  getEnvAccountConfig,
  resolveAccountProfile,
  resolveStorageStateRel,
  maskUsername,
  listAccountProfiles,
  storageExists,
  buildRecordingAccountHeader,
  prependRecordingAccountHeader,
};
