import fs from 'fs';
import path from 'path';

export type AccountProfile = {
  username: string;
  password: string;
  label?: string;
};

export type EnvAccountConfig =
  | AccountProfile
  | {
      defaultProfile?: string;
      profiles: Record<string, AccountProfile & { label?: string }>;
    };

export type BaseEnvConfig = {
  baseURL?: string;
  storageState?: string;
  storageStates?: Record<string, string>;
  defaultProfile?: string;
};

const ACCOUNTS_PATH = path.resolve(process.cwd(), 'datasource/accounts.json');
const BASE_CONFIG_PATH = path.resolve(process.cwd(), 'datasource/base-config.json');

function readJsonFile<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
  } catch {
    return null;
  }
}

/** 解析某环境的账号档案（兼容旧版单账号对象） */
export function getEnvAccountConfig(env: string): {
  defaultProfile: string;
  profiles: Record<string, AccountProfile & { label?: string }>;
} | null {
  const raw = readJsonFile<Record<string, EnvAccountConfig>>(ACCOUNTS_PATH);
  if (!raw) return null;
  const entry = raw[env];
  if (!entry) return null;

  if ('profiles' in entry && entry.profiles && typeof entry.profiles === 'object') {
    const defaultProfile =
      entry.defaultProfile?.trim() ||
      Object.keys(entry.profiles)[0] ||
      'default';
    return { defaultProfile, profiles: entry.profiles };
  }

  const legacy = entry as AccountProfile;
  if (legacy?.username && legacy?.password) {
    return {
      defaultProfile: 'default',
      profiles: {
        default: {
          username: legacy.username,
          password: legacy.password,
          label: 'default',
        },
      },
    };
  }

  return null;
}

export function resolveAccountProfile(env: string, profile?: string): string {
  const cfg = getEnvAccountConfig(env);
  if (!cfg) return profile?.trim() || process.env.PLAYWRIGHT_ACCOUNT?.trim() || 'default';

  const fromEnv = process.env.PLAYWRIGHT_ACCOUNT?.trim();
  const candidate = profile?.trim() || fromEnv || cfg.defaultProfile || 'default';
  if (cfg.profiles[candidate]) return candidate;
  if (cfg.profiles[cfg.defaultProfile]) return cfg.defaultProfile;
  return Object.keys(cfg.profiles)[0] || 'default';
}

export function listAccountProfileIds(env: string): string[] {
  const cfg = getEnvAccountConfig(env);
  if (!cfg) return ['default'];
  return Object.keys(cfg.profiles);
}

export function maskUsername(username: string): string {
  const u = String(username || '');
  if (u.length <= 4) return '****';
  if (u.includes('@')) {
    const [name, domain] = u.split('@');
    const head = name.slice(0, Math.min(3, name.length));
    return `${head}***@${domain}`;
  }
  return `${u.slice(0, 3)}***${u.slice(-2)}`;
}

export function getBaseEnvConfig(env: string): BaseEnvConfig | null {
  const raw = readJsonFile<Record<string, BaseEnvConfig>>(BASE_CONFIG_PATH);
  return raw?.[env] ?? null;
}

/**
 * 解析 storageState 相对路径（相对项目根）。
 * - profile=default：沿用 base-config.storageState（如 storage/loginState/stage.json）
 * - 其它 profile：storage/loginState/stage/<profile>.json，或 storageStates[profile]
 */
export function resolveStorageState(env: string, profile?: string): string {
  const base = getBaseEnvConfig(env);
  if (!base) {
    throw new Error(`未找到环境配置: ${env}（datasource/base-config.json）`);
  }

  const prof = resolveAccountProfile(env, profile);

  if (base.storageStates?.[prof]) {
    return base.storageStates[prof];
  }

  if (base.storageState) {
    if (prof === 'default') return base.storageState;
    const withoutExt = base.storageState.replace(/\.json$/i, '');
    return `${withoutExt}/${prof}.json`;
  }

  throw new Error(`环境 ${env} 未配置 storageState`);
}

export function shouldRefreshStorageState(): boolean {
  const v = process.env.PLAYWRIGHT_REFRESH_STORAGE;
  return v === '1' || v === 'true' || process.argv.includes('--force');
}
