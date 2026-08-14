import { execSync } from 'child_process';
import type { NotifyOn, ResolvedTestJob } from './test-jobs-config.js';
import {
  groupSpecEntriesByProfile,
  type AccountProfileFilter,
  type SpecRunEntry,
} from './job-utils.js';
import { resolveAccountProfile } from '../../src/utils/env-config.js';

const UNKNOWN_PROFILE = 'unknown';

export type DirectRunOptions = {
  /** 非 Job 模式：直接传入执行参数（run-optimized-tests 使用） */
  projects: string[];
  optimizedDir: string;
  specs: 'all' | string[];
  stopOnTestFailure: boolean;
  stopOnCompareGate: boolean;
  runCompareAfterAbort: boolean;
  verbose: boolean;
  playwrightEnv?: string;
  accountProfile?: AccountProfileFilter;
  steps: ResolvedTestJob['steps'];
  feishuMode: ResolvedTestJob['feishuMode'];
  notifyOn: NotifyOn[];
  /** 始终创建飞书文档（run-optimized-tests 兼容） */
  alwaysCreateFeishuDoc?: boolean;
  /** 覆盖 Job specs glob，仅执行指定相对路径用例 */
  specOverrides?: string[];
  /** flake 失败重跑次数（默认 0） */
  retryOnFail?: number;
};

export function runCommandBool(command: string, description: string, env: NodeJS.ProcessEnv = process.env): boolean {
  console.log(`\n📋 ${description}`);
  console.log(`🔧 执行命令: ${command}`);
  try {
    execSync(command, { stdio: 'inherit', env });
    console.log(`✅ ${description} 完成`);
    return true;
  } catch {
    console.error(`❌ ${description} 失败`);
    return false;
  }
}

function runLoginForProfile(
  playwrightEnv: string,
  profile: string,
  refreshLogin: boolean,
): boolean {
  const resolved = resolveAccountProfile(playwrightEnv, profile);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PLAYWRIGHT_ENV: playwrightEnv,
    PLAYWRIGHT_ACCOUNT: resolved,
    ...(refreshLogin ? { PLAYWRIGHT_REFRESH_STORAGE: '1' } : {}),
  };
  const cmd = refreshLogin ? 'npm run login:force' : 'npm run login';
  return runCommandBool(cmd, `登录 ${playwrightEnv} / ${resolved}`, env);
}

function buildTestRunEnv(playwrightEnv: string, accountProfile?: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, PLAYWRIGHT_ENV: playwrightEnv };
  if (accountProfile && accountProfile !== UNKNOWN_PROFILE) {
    env.PLAYWRIGHT_ACCOUNT = resolveAccountProfile(playwrightEnv, accountProfile);
  }
  return env;
}

export async function executeTests(
  opts: DirectRunOptions,
  entries: SpecRunEntry[],
): Promise<{
  totalSuccessCount: number;
  totalFailCount: number;
  aborted: boolean;
  executedSpecPaths: string[];
}> {
  let totalSuccessCount = 0;
  let totalFailCount = 0;
  let aborted = false;
  const executedSpecPaths: string[] = [];
  const runtimeEnv = opts.playwrightEnv || process.env.PLAYWRIGHT_ENV || 'stage';
  const groups = groupSpecEntriesByProfile(entries);

  for (const [profile, groupEntries] of groups) {
    const profLabel = profile === UNKNOWN_PROFILE ? 'default（未标注 meta）' : profile;
    console.log(`\n👤 账号组 ${profLabel}（${groupEntries.length} 个用例）\n`);

    if (opts.steps.login) {
      const loginProfile = profile === UNKNOWN_PROFILE ? 'default' : profile;
      const loginOk = runLoginForProfile(runtimeEnv, loginProfile, opts.steps.refreshLogin);
      if (!loginOk) {
        for (const entry of groupEntries) {
          for (let i = 0; i < opts.projects.length; i++) {
            executedSpecPaths.push(entry.absPath);
            totalFailCount++;
          }
        }
        if (opts.stopOnTestFailure) {
          aborted = true;
          console.log('\n⏹️  登录失败且已启用失败即停，后续账号组不再执行。');
          break;
        }
        continue;
      }
    }

    for (const project of opts.projects) {
      console.log(`\n🌐 开始执行 project「${project}」（账号组 ${profLabel}）...\n`);

      for (const entry of groupEntries) {
        const relPath = entry.relPath;
        console.log(`\n🧪 执行测试: ${relPath} (${project})`);
        executedSpecPaths.push(entry.absPath);

        const reporter = opts.verbose ? '--reporter=list' : '';
        const env = buildTestRunEnv(runtimeEnv, entry.accountProfile);
        if (env.PLAYWRIGHT_ACCOUNT) {
          console.log(`   PLAYWRIGHT_ACCOUNT=${env.PLAYWRIGHT_ACCOUNT}`);
        }
        const maxRetry = opts.retryOnFail ?? 0;
        let passed = false;
        for (let attempt = 0; attempt <= maxRetry; attempt++) {
          if (attempt > 0) console.log(`   🔁 重试 ${attempt}/${maxRetry}…`);
          try {
            execSync(`npx playwright test "${relPath}" --project=${project} --workers=1 ${reporter}`.trim(), {
              stdio: 'inherit',
              env,
            });
            passed = true;
            break;
          } catch {
            if (attempt >= maxRetry) {
              console.error(`❌ ${relPath} 测试失败 (${project})`);
            }
          }
        }
        if (passed) {
          console.log(`✅ ${relPath} 测试通过 (${project})`);
          totalSuccessCount++;
        } else {
          totalFailCount++;
          if (opts.stopOnTestFailure) {
            aborted = true;
            break;
          }
        }
      }

      if (aborted) break;
    }

    if (aborted) {
      console.log('\n⏹️  已启用失败即停，后续 project / 账号组 / 用例不再执行。');
      break;
    }
  }

  return { totalSuccessCount, totalFailCount, aborted, executedSpecPaths };
}
