import { invalidateStorageState } from '../../src/utils/storage-state-meta.js';

export type ClearStorageResult = {
  removed: boolean;
  path: string;
  profile: string;
  env: string;
  loginAccount: string | null;
};

export function clearExpiredStorageOn401(): ClearStorageResult {
  const storagePath = process.env.STORAGE_STATE?.trim() || '';
  const profile = process.env.PLAYWRIGHT_ACCOUNT?.trim() || '';
  const env = process.env.PLAYWRIGHT_ENV?.trim() || '';
  const empty: ClearStorageResult = {
    removed: false,
    path: storagePath,
    profile,
    env,
    loginAccount: null,
  };

  if (!storagePath) return empty;

  const result = invalidateStorageState(storagePath, { reason: '401' });
  if (!result.ok) return empty;

  const accountHint = result.loginAccount ? ` · 账号 ${result.loginAccount}` : '';
  console.warn(
    `[api-guard] 401 已作废登录态（保留登录账号） · env=${env || '-'} · profile=${profile || '-'}${accountHint} · ${storagePath}`,
  );
  return {
    removed: true,
    path: storagePath,
    profile,
    env,
    loginAccount: result.loginAccount,
  };
}
