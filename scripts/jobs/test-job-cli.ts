#!/usr/bin/env tsx
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  assertJobNotRunning,
  isJobRunning,
  readLatestRun,
  readLock,
  stdoutLogPath,
} from './job-lock.js';
import { runJobById, stopJob } from './job-runner.js';
import { buildJobFailReasons } from './job-notify.js';
import { listJobs, loadTestJobsConfig, resolveJob, resolveJobRunEnv } from './test-jobs-config.js';
import { countResolvedSpecs, formatRunId } from './job-utils.js';

const __filename = fileURLToPath(import.meta.url);
const CLI_PATH = path.resolve(__filename);

function printHelp(): void {
  console.log(`用法: tsx scripts/jobs/test-job-cli.ts <command> [选项]

命令:
  run       执行指定 Job
  list      列出所有 Job
  status    查看 Job 运行状态
  stop      停止后台 Job
  logs      查看最近一次运行日志

run 选项:
  --id=<jobId>              必填（run 时）
  --env=<playwrightEnv>     覆盖 Job 配置中的环境，仅执行该 env 下用例
  --profile=<accountProfile>  覆盖/限定账号档案（如 default、admin；all 表示不限）
  --spec=<relativePath>       覆盖 Job 配置 glob，仅执行指定用例（可重复）
  --specs=<a,b,c>             同上，逗号分隔多个相对路径
  --background, -b          后台 detached 执行
  --force                   忽略并发锁
  --run-id=<runId>          指定 runId（后台模式内部使用）
  --trigger=<manual|schedule|cli>  触发来源（默认 cli）

示例:
  npm run test-job -- run --id=nightly-regression
  npm run test-job -- run --id=smoke-workbench --env=uat --profile=default
  npm run test-job -- run --id=smoke-workbench --spec=tests/optimized/stage/260612/我的审批_2026-06-09_16-48-19.optimized.spec.ts
  npm run test-job -- run --id=smoke-workbench --background
  npm run test-job -- list
  npm run test-job -- status --id=nightly-regression
  npm run test-job -- stop --id=nightly-regression
  npm run test-job -- logs --id=nightly-regression
`);
}

type ParsedArgs = {
  command: string;
  jobId?: string;
  playwrightEnv?: string;
  accountProfile?: string;
  specs: string[];
  background: boolean;
  force: boolean;
  runId?: string;
  trigger: 'manual' | 'schedule' | 'cli';
  tailLines: number;
};

function parseArgs(argv: string[]): ParsedArgs {
  let command = '';
  let jobId: string | undefined;
  let playwrightEnv: string | undefined;
  let accountProfile: string | undefined;
  const specs: string[] = [];
  let background = false;
  let force = false;
  let runId: string | undefined;
  let trigger: 'manual' | 'schedule' | 'cli' = 'cli';
  let tailLines = 80;

  const positional: string[] = [];
  for (const arg of argv) {
    if (arg === '-h' || arg === '--help') {
      printHelp();
      process.exit(0);
    }
    if (arg === '--background' || arg === '-b') {
      background = true;
      continue;
    }
    if (arg === '--force') {
      force = true;
      continue;
    }
    if (arg.startsWith('--id=')) {
      jobId = arg.slice('--id='.length).trim();
      continue;
    }
    if (arg.startsWith('--env=')) {
      playwrightEnv = arg.slice('--env='.length).trim();
      continue;
    }
    if (arg.startsWith('--profile=')) {
      accountProfile = arg.slice('--profile='.length).trim();
      continue;
    }
    if (arg.startsWith('--spec=')) {
      const v = arg.slice('--spec='.length).trim();
      if (v) specs.push(v);
      continue;
    }
    if (arg.startsWith('--specs=')) {
      specs.push(
        ...arg
          .slice('--specs='.length)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      );
      continue;
    }
    if (arg.startsWith('--run-id=')) {
      runId = arg.slice('--run-id='.length).trim();
      continue;
    }
    if (arg.startsWith('--trigger=')) {
      const v = arg.slice('--trigger='.length).trim() as ParsedArgs['trigger'];
      if (v === 'manual' || v === 'schedule' || v === 'cli') trigger = v;
      continue;
    }
    if (arg.startsWith('--lines=')) {
      tailLines = Number(arg.slice('--lines='.length)) || 80;
      continue;
    }
    if (!arg.startsWith('-')) positional.push(arg);
  }

  command = positional[0] ?? '';
  if (!jobId && positional[1] && !positional[1].startsWith('-')) {
    /* allow: run nightly-regression */
    jobId = positional[1];
  }

  return { command, jobId, playwrightEnv, accountProfile, specs, background, force, runId, trigger, tailLines };
}

function tsxSpawnArgs(scriptArgs: string[]): { cmd: string; args: string[] } {
  const tsxLocal = path.join(process.cwd(), 'node_modules', '.bin', 'tsx');
  if (fs.existsSync(tsxLocal)) {
    return { cmd: tsxLocal, args: [CLI_PATH, ...scriptArgs] };
  }
  return { cmd: 'npx', args: ['tsx', CLI_PATH, ...scriptArgs] };
}

function spawnBackground(
  jobId: string,
  runId: string,
  trigger: ParsedArgs['trigger'],
  force: boolean,
  playwrightEnv?: string,
  accountProfile?: string,
  specOverrides?: string[],
): void {
  const job = resolveJob(jobId);
  const effectiveEnv = resolveJobRunEnv(job, playwrightEnv);
  const effectiveProfile = accountProfile ?? job.accountProfile ?? undefined;
  const logPath = stdoutLogPath(jobId, runId);
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const logFd = fs.openSync(logPath, 'a');

  const scriptArgs = [
    'run',
    `--id=${jobId}`,
    `--run-id=${runId}`,
    `--trigger=${trigger}`,
    `--env=${effectiveEnv}`,
    '--internal-foreground',
    ...(force ? ['--force'] : []),
  ];
  if (effectiveProfile && effectiveProfile !== 'all') {
    scriptArgs.push(`--profile=${effectiveProfile}`);
  }
  if (specOverrides?.length) {
    for (const spec of specOverrides) {
      scriptArgs.push(`--spec=${spec}`);
    }
  }
  const { cmd, args } = tsxSpawnArgs(scriptArgs);

  const child = spawn(cmd, args, {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: { ...process.env, PLAYWRIGHT_ENV: effectiveEnv },
  });
  child.unref();
  fs.closeSync(logFd);

  console.log(`🚀 Job「${jobId}」已在后台启动`);
  console.log(`   env:   ${effectiveEnv}${playwrightEnv && playwrightEnv !== job.playwrightEnv ? `（覆盖 ${job.playwrightEnv}）` : ''}`);
  if (effectiveProfile && effectiveProfile !== 'all') {
    console.log(`   profile: ${effectiveProfile}`);
  }
  if (specOverrides?.length) {
    console.log(`   specs:   ${specOverrides.length} 个用例（覆盖 Job 配置）`);
  }
  console.log(`   runId: ${runId}`);
  console.log(`   pid:   ${child.pid}`);
  console.log(`   log:   ${logPath}`);
  console.log(`\n查看状态: npm run test-job -- status --id=${jobId}`);
}

async function cmdRun(args: ParsedArgs, internalForeground = false): Promise<void> {
  if (!args.jobId) {
    console.error('❌ 请指定 --id=<jobId>');
    process.exit(1);
  }

  const job = resolveJob(args.jobId);
  const effectiveEnv = resolveJobRunEnv(job, args.playwrightEnv);

  if (args.background && !internalForeground) {
    assertJobNotRunning(args.jobId, args.force);
    const runId = formatRunId();
    spawnBackground(args.jobId, runId, args.trigger, args.force, args.playwrightEnv, args.accountProfile, args.specs);
    return;
  }

  assertJobNotRunning(args.jobId, args.force);

  const effectiveProfile =
    args.accountProfile && args.accountProfile !== 'all' ? args.accountProfile : job.accountProfile ?? null;

  const specOverrides = args.specs.length ? [...new Set(args.specs)] : undefined;

  const runId = args.runId ?? formatRunId();
  const result = await runJobById(args.jobId, {
    trigger: args.trigger,
    runId,
    force: args.force,
    persistState: true,
    playwrightEnv: effectiveEnv,
    accountProfile: effectiveProfile,
    specOverrides,
  });

  process.exit(result.exitCode);
}

function cmdList(): void {
  loadTestJobsConfig();
  const jobs = listJobs();
  if (!jobs.length) {
    console.log('ℹ️  config/test-jobs.json 中无 Job 定义');
    return;
  }

  console.log('📋 测试任务列表\n');
  for (const job of jobs) {
    const running = isJobRunning(job.id) ? '🟢 运行中' : job.enabled ? '⚪ 空闲' : '⏸️  已禁用';
    const schedule = job.schedule ? `cron: ${job.schedule} (${job.timezone})` : '仅手动';
    const specCount = countResolvedSpecs(
      job.specs,
      job.optimizedDir,
      job.playwrightEnv,
      job.accountProfile,
    );
    const profileNote = job.accountProfile ? ` · profile=${JSON.stringify(job.accountProfile)}` : '';
    const specsLabel =
      job.specs === 'all'
        ? `全部 (${job.playwrightEnv}, ${specCount} 个)`
        : `${JSON.stringify(job.specs)} (${specCount} 个)`;
    console.log(`  ${job.id}`);
    console.log(`    状态: ${running}`);
    console.log(`    说明: ${job.description || '—'}`);
    console.log(`    环境: ${job.playwrightEnv}${profileNote}`);
    console.log(`    调度: ${schedule}`);
    console.log(`    用例: ${specsLabel}`);
    console.log('');
  }
}

function cmdStatus(jobId?: string): void {
  const ids = jobId ? [jobId] : listJobs().map((j) => j.id);
  if (!ids.length) {
    console.log('ℹ️  无 Job');
    return;
  }

  for (const id of ids) {
    console.log(`\n📌 Job: ${id}`);
    const lock = readLock(id);
    if (lock) {
      console.log(`  🔒 运行中 pid=${lock.pid} runId=${lock.runId} since=${lock.startedAt}`);
    } else {
      console.log('  🔓 未运行');
    }
    const latest = readLatestRun(id);
    if (latest?.status) {
      console.log(`  最近 runId: ${latest.runId}`);
      console.log(`  状态: ${latest.status.status}${latest.status.finishedAt ? ` (${latest.status.finishedAt})` : ''}`);
    }
    if (latest?.summary) {
      const s = latest.summary;
      const reasons =
        s.failReasons?.length
          ? s.failReasons
          : buildJobFailReasons({
              testPassed: s.testPassed,
              comparePassed: s.comparePassed,
              compareSkipped: s.compareSkipped,
              aborted: s.aborted,
              failCount: s.failCount,
              executedCount: s.executedCount,
              compareGate: s.compareGate,
              feishuDocPassed: s.feishuDocPassed,
              feishuDocAttempted: s.feishuDocAttempted,
              uiIssuesBlocker: s.uiIssuesBlocker,
            });
      console.log(
        `  结果: 执行 ${s.successCount}/${s.executedCount} 成功, 对比 ${s.compareSkipped ? '跳过' : s.comparePassed ? '通过' : '失败'}${s.aborted ? ', 已中断' : ''}`,
      );
      if (reasons.length) {
        console.log(`  原因: ${reasons.join('；')}`);
      }
    }
  }
}

function cmdLogs(jobId: string | undefined, tailLines: number): void {
  if (!jobId) {
    console.error('❌ 请指定 --id=<jobId>');
    process.exit(1);
  }
  const latest = readLatestRun(jobId);
  if (!latest) {
    console.log(`ℹ️  Job「${jobId}」尚无运行记录`);
    return;
  }
  const logPath = stdoutLogPath(jobId, latest.runId);
  if (!fs.existsSync(logPath)) {
    console.log(`ℹ️  日志不存在: ${logPath}`);
    return;
  }
  const content = fs.readFileSync(logPath, 'utf-8');
  const lines = content.split('\n');
  const tail = lines.slice(-tailLines).join('\n');
  console.log(`--- ${logPath} (last ${tailLines} lines) ---\n`);
  console.log(tail);
}

async function main(): Promise<void> {
  const rawArgv = process.argv.slice(2);
  const internalForeground = rawArgv.includes('--internal-foreground');
  const argv = rawArgv.filter((a) => a !== '--internal-foreground');
  const args = parseArgs(argv);

  if (!args.command) {
    printHelp();
    process.exit(args.command === '' ? 0 : 1);
  }

  switch (args.command) {
    case 'run':
      await cmdRun(args, internalForeground);
      break;
    case 'list':
      cmdList();
      break;
    case 'status':
      cmdStatus(args.jobId);
      break;
    case 'stop':
      if (!args.jobId) {
        console.error('❌ 请指定 --id=<jobId>');
        process.exit(1);
      }
      stopJob(args.jobId);
      break;
    case 'logs':
      cmdLogs(args.jobId, args.tailLines);
      break;
    default:
      console.error(`❌ 未知命令: ${args.command}`);
      printHelp();
      process.exit(1);
  }
}

main().catch((e) => {
  console.error('❌', e instanceof Error ? e.message : e);
  process.exit(1);
});
