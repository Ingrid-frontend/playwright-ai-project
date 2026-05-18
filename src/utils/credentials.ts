import {
  getEnvAccountConfig,
  resolveAccountProfile,
  type AccountProfile,
} from './env-config.js';

export type LoginCredentials = {
  username: string;
  password: string;
  source: 'env' | 'accounts.json';
  profile: string;
};

export function getLoginCredentials(env: string, profile?: string): LoginCredentials {
  const username = process.env.TEST_USERNAME;
  const password = process.env.TEST_PASSWORD;
  if (username && password) {
    return {
      username,
      password,
      source: 'env',
      profile: resolveAccountProfile(env, profile),
    };
  }

  const cfg = getEnvAccountConfig(env);
  const prof = resolveAccountProfile(env, profile);
  const acc: AccountProfile | undefined = cfg?.profiles[prof];
  if (acc?.username && acc?.password) {
    return {
      username: acc.username,
      password: acc.password,
      source: 'accounts.json',
      profile: prof,
    };
  }

  throw new Error(
    `缺少登录凭据：请设置 TEST_USERNAME/TEST_PASSWORD 或在 datasource/accounts.json 配置 env=${env} profile=${prof}`,
  );
}
