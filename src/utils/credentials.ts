import fs from 'fs';
import path from 'path';

export type LoginCredentials = {
  username: string;
  password: string;
  source: 'env' | 'accounts.json';
};

export function getLoginCredentials(env: string): LoginCredentials {
  const username = process.env.TEST_USERNAME;
  const password = process.env.TEST_PASSWORD;
  if (username && password) {
    return { username, password, source: 'env' };
  }

  const accountsPath = path.resolve(process.cwd(), 'datasource/accounts.json');
  if (fs.existsSync(accountsPath)) {
    const accounts = JSON.parse(fs.readFileSync(accountsPath, 'utf-8')) as Record<
      string,
      { username: string; password: string }
    >;
    const acc = accounts[env];
    if (acc?.username && acc?.password) {
      return { username: acc.username, password: acc.password, source: 'accounts.json' };
    }
  }

  throw new Error(
    `缺少登录凭据：请设置 TEST_USERNAME/TEST_PASSWORD 或提供 datasource/accounts.json（当前 env=${env}）`,
  );
}

