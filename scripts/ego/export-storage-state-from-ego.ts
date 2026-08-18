#!/usr/bin/env tsx
import path from 'path';
import dotenv from 'dotenv';
import { getBaseEnvConfig, resolveStorageState } from '../../src/utils/env-config.js';
import { exportStorageStateFromEgo } from '../../src/utils/ego-storage-sync.js';
import { validateStorageStateFile } from '../../src/utils/login-detection.js';
import { getLoginCredentials } from '../../src/utils/credentials.js';

dotenv.config({ path: path.join(process.cwd(), '.env') });

function getArgValue(name: string): string | undefined {
  const args = process.argv.slice(2);
  const prefix = `--${name}=`;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === `--${name}` && i + 1 < args.length) return args[i + 1];
    if (arg.startsWith(prefix)) return arg.slice(prefix.length);
  }
  return undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.slice(2).includes(`--${name}`);
}

function printHelp(): void {
  console.log(`用法: npx tsx scripts/ego/export-storage-state-from-ego.ts [选项]

选项:
  --env=<env>         环境名，默认 stage
  --profile=<id>      账号 profile
  --url=<path|url>    导出前打开的页面；默认取 baseURL + /
  --out=<file>        输出文件；默认写入 results/ego-storage-state/<env>-<profile>.json
  --settle=<sec>      打开后额外等待秒数，默认 2
  --apply             额外写入该 env/profile 的正式 storageState 路径（谨慎使用）
  -h, --help
`);
}

async function main(): Promise<void> {
  if (hasFlag('help') || hasFlag('h')) {
    printHelp();
    return;
  }
  const env = getArgValue('env') || process.env.PLAYWRIGHT_ENV || 'stage';
  const profile = getArgValue('profile') || process.env.PLAYWRIGHT_ACCOUNT;
  const baseURL = getBaseEnvConfig(env)?.baseURL;
  const rawUrl = getArgValue('url') || '/';
  if (!/^https?:\/\//i.test(rawUrl) && !baseURL) {
    throw new Error(`环境 ${env} 未配置 baseURL，请显式传 --url=https://...`);
  }
  const targetUrl = /^https?:\/\//i.test(rawUrl) ? rawUrl : new URL(rawUrl, baseURL).toString();
  const loginAccount = (() => {
    try {
      return getLoginCredentials(env, profile).username;
    } catch {
      return undefined;
    }
  })();
  const prof = profile || 'default';
  const outPath = path.resolve(
    getArgValue('out') || path.join('results', 'ego-storage-state', `${env}-${prof}.json`),
  );
  const settleSec = Number(getArgValue('settle') || 2);

  const result = await exportStorageStateFromEgo({
    targetUrl,
    outPath,
    env,
    loginAccount,
    settleSec,
  });
  const validity = validateStorageStateFile(result.outPath);
  if (!validity.valid) {
    throw new Error(validity.reason || '导出的 storageState 无效');
  }

  console.log(`✅ 已导出 ego storageState 原型`);
  console.log(`🌐 页面: ${result.pageUrl}`);
  console.log(`🍪 cookies: ${result.cookieCount}`);
  console.log(`🗂 origins: ${result.originCount}`);
  console.log(`📁 输出: ${result.outPath}`);

  if (hasFlag('apply')) {
    const finalPath = path.resolve(process.cwd(), resolveStorageState(env, profile));
    await exportStorageStateFromEgo({
      targetUrl,
      outPath: finalPath,
      env,
      loginAccount,
      settleSec,
    });
    const finalValidity = validateStorageStateFile(finalPath);
    if (!finalValidity.valid) {
      throw new Error(`写入正式 storageState 后校验失败: ${finalValidity.reason}`);
    }
    console.log(`♻️ 已同步到正式 storageState: ${finalPath}`);
  }
}

main().catch((error) => {
  console.error('❌', error instanceof Error ? error.message : error);
  process.exit(1);
});
