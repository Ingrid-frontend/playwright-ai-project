/**
 * 与主仓库 src/utils/env-config.ts 对齐的 JS 实现（供 Studio server 使用）
 */
const fs = require('fs');
const path = require('path');

const { slugifyLoginAccount, isGoldenProfileId } = require(path.join(__dirname, '../src/utils/account-slug.cjs'));
const { extractLoginAccount, extractFromCode } = require(path.join(__dirname, '../src/utils/extract-login-account.cjs'));
const {
  readLoginStateMeta,
  formatLoginAccountLabel,
} = require(path.join(__dirname, '../src/utils/storage-state-meta.cjs'));

const META_MARKERS = /录制元信息|录制环境:/;

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

/** 按 profile 字面 id 解析 storage 路径（不因 accounts.json 缺项回退到 default） */
function resolveStorageStateRelDirect(repoRoot, env, profileId) {
  const base = getBaseEnvConfig(repoRoot, env);
  if (!base) return '';
  const prof = String(profileId || '').trim() || 'default';
  if (base.storageStates?.[prof]) return base.storageStates[prof];
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

/** 批量查询 profile 登录态（用于 Golden / write 双线） */
function normalizeEnvEntryToProfiles(entry) {
  if (!entry || typeof entry !== 'object') return null;
  if (entry.profiles && typeof entry.profiles === 'object') return entry;
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

function nextGoldenProfileId(profiles) {
  const keys = Object.keys(profiles || {}).filter(isGoldenProfileId);
  if (!keys.includes('golden')) return 'golden';
  let n = 2;
  while (keys.includes(`golden_${n}`)) n += 1;
  return `golden_${n}`;
}

function defaultEnvAccountEntry() {
  return {
    defaultProfile: 'default',
    profiles: {
      default: { label: '默认账号', username: '', password: '' },
      golden: { label: 'Golden 只读', username: '', password: '' },
      write: { label: '流程调试', username: '', password: '' },
    },
  };
}

function ensureAccountsEnvEntry(repoRoot, envId) {
  const accountsPath = path.join(repoRoot, 'datasource', 'accounts.json');
  const examplePath = path.join(repoRoot, 'datasource', 'accounts.json.example');
  const env = String(envId || '').trim();
  if (!env) return { ok: false, error: '环境 id 为空' };
  if (!getBaseEnvConfig(repoRoot, env)) {
    return { ok: false, error: `base-config.json 中未配置环境: ${env}` };
  }

  let raw = readJsonFile(accountsPath);
  let needsWrite = false;
  if (!raw) {
    raw = readJsonFile(examplePath) || {};
    needsWrite = true;
  }
  if (!raw[env]) {
    raw[env] = defaultEnvAccountEntry();
    needsWrite = true;
  }

  if (needsWrite) {
    try {
      fs.mkdirSync(path.dirname(accountsPath), { recursive: true });
      fs.writeFileSync(accountsPath, `${JSON.stringify(raw, null, 2)}\n`, 'utf8');
    } catch (e) {
      return { ok: false, error: `写入 accounts.json 失败: ${e.message || e}` };
    }
  }

  return { ok: true, raw, accountsPath, env, createdFile: needsWrite };
}

function addGoldenProfile(repoRoot, envId, opts = {}) {
  const ensured = ensureAccountsEnvEntry(repoRoot, envId);
  if (!ensured.ok) return ensured;

  const accountsPath = ensured.accountsPath;
  const raw = readJsonFile(accountsPath) || ensured.raw;
  const env = ensured.env;

  const normalized = normalizeEnvEntryToProfiles(raw[env]);
  if (!normalized) return { ok: false, error: `环境 ${env} 的 accounts.json 格式无法扩展 Golden 档案` };

  raw[env] = normalized;
  const profiles = normalized.profiles;
  const profileId = nextGoldenProfileId(profiles);
  if (profiles[profileId]) return { ok: false, error: `profile ${profileId} 已存在` };

  const label = String(opts.label || '').trim() || `Golden ${profileId}`;
  profiles[profileId] = {
    label,
    username: String(opts.username || '').trim(),
    password: String(opts.password || '').trim(),
  };

  try {
    fs.writeFileSync(accountsPath, `${JSON.stringify(raw, null, 2)}\n`, 'utf8');
  } catch (e) {
    return { ok: false, error: `写入 accounts.json 失败: ${e.message || e}` };
  }

  const storageRel = resolveStorageStateRelDirect(repoRoot, env, profileId);
  return {
    ok: true,
    profileId,
    label,
    storageState: storageRel,
    initializedAccounts: ensured.createdFile,
  };
}

function removeGoldenProfile(repoRoot, envId, profileId) {
  const id = String(profileId || '').trim();
  if (!isGoldenProfileId(id)) return { ok: false, error: '仅可删除 golden* 档案' };

  const accountsPath = path.join(repoRoot, 'datasource', 'accounts.json');
  const raw = readJsonFile(accountsPath);
  if (!raw) return { ok: false, error: '未找到 datasource/accounts.json' };

  const env = String(envId || '').trim();
  if (!env || !raw[env]) return { ok: false, error: `accounts.json 中未配置环境: ${env}` };

  const normalized = normalizeEnvEntryToProfiles(raw[env]);
  if (!normalized) return { ok: false, error: `环境 ${env} 的 accounts.json 格式不支持删除` };

  if (!normalized.profiles[id]) return { ok: false, error: `档案 ${id} 不存在` };

  const label = normalized.profiles[id].label || id;
  delete normalized.profiles[id];
  raw[env] = normalized;

  const storageRel = resolveStorageStateRelDirect(repoRoot, env, id);
  let removedStorage = false;
  if (storageRel) {
    const storageAbs = path.resolve(repoRoot, storageRel);
    if (fs.existsSync(storageAbs)) {
      try {
        fs.unlinkSync(storageAbs);
        removedStorage = true;
      } catch (e) {
        return { ok: false, error: `删除登录态失败: ${e.message || e}` };
      }
    }
  }

  try {
    fs.writeFileSync(accountsPath, `${JSON.stringify(raw, null, 2)}\n`, 'utf8');
  } catch (e) {
    return { ok: false, error: `写入 accounts.json 失败: ${e.message || e}` };
  }

  return { ok: true, profileId: id, label, storageState: storageRel || '', removedStorage };
}

function listGoldenProfileIds(repoRoot, envId) {
  const cfg = getEnvAccountConfig(repoRoot, envId);
  if (!cfg?.profiles) return ['golden'];
  const ids = Object.keys(cfg.profiles).filter(isGoldenProfileId).sort();
  return ids.length ? ids : ['golden'];
}

function resolveFlowRoleSlug(repoRoot, envId, profileId) {
  const prof = String(profileId || '').trim();
  if (!prof) return '';
  const rel = resolveStorageStateRelDirect(repoRoot, envId, prof);
  const abs = rel ? path.resolve(repoRoot, rel) : '';
  const loginAccount = formatLoginAccountLabel(readLoginStateMeta(abs));
  if (loginAccount) return slugifyLoginAccount(loginAccount);
  return slugifyLoginAccount(prof) || prof.replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]+/g, '_').slice(0, 48);
}

function formatProfileRoleLabel(configLabel, loginAccount, profileId) {
  const label = String(configLabel || '').trim();
  const account = String(loginAccount || '').trim();
  const id = String(profileId || '').trim();
  if (label && account && label !== account) return `${label} · ${account}`;
  if (account) return account;
  if (label) return label;
  return id;
}

function enrichProfileStorageEntry(repoRoot, envId, profileId) {
  const id = String(profileId || '').trim();
  const rel = resolveStorageStateRelDirect(repoRoot, envId, id);
  const cfg = getEnvAccountConfig(repoRoot, envId);
  const prof = cfg?.profiles?.[id];
  const abs = rel ? path.resolve(repoRoot, rel) : '';
  const loginAccount = formatLoginAccountLabel(readLoginStateMeta(abs));
  const roleSlug = resolveFlowRoleSlug(repoRoot, envId, id);
  const configLabel = prof?.label || id;
  const roleLabel = formatProfileRoleLabel(configLabel, loginAccount, id);
  return {
    id,
    label: configLabel,
    roleSlug,
    roleLabel,
    loginAccount: loginAccount || null,
    storageState: rel,
    hasStorage: storageExists(repoRoot, rel),
    maskedUsername: loginAccount ? maskUsername(loginAccount) : maskUsername(prof?.username || ''),
    isGolden: isGoldenProfileId(id),
  };
}

function listProfilesStorageStatus(repoRoot, envId, profileIds) {
  const cfg = getEnvAccountConfig(repoRoot, envId);
  const ids =
    Array.isArray(profileIds) && profileIds.length
      ? profileIds
      : Object.keys(cfg?.profiles || {});
  return ids.map((id) => enrichProfileStorageEntry(repoRoot, envId, id));
}

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

function resolveAccountCredentials(repoRoot, envId, profileId) {
  const cfg = getEnvAccountConfig(repoRoot, envId);
  const literal = String(profileId || '').trim();
  const prof = literal && cfg?.profiles?.[literal]
    ? literal
    : resolveAccountProfile(repoRoot, envId, profileId);
  const acc = cfg?.profiles?.[prof];
  if (acc?.username && acc?.password) {
    return { username: acc.username, password: acc.password, profile: prof };
  }
  return null;
}

module.exports = {
  getEnvAccountConfig,
  resolveAccountProfile,
  resolveStorageStateRel,
  resolveStorageStateRelDirect,
  resolveAccountCredentials,
  listProfilesStorageStatus,
  listGoldenProfileIds,
  resolveFlowRoleSlug,
  enrichProfileStorageEntry,
  isGoldenProfileId,
  addGoldenProfile,
  removeGoldenProfile,
  ensureAccountsEnvEntry,
  maskUsername,
  listAccountProfiles,
  storageExists,
  buildRecordingAccountHeader,
  prependRecordingAccountHeader,
};
