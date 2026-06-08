#!/usr/bin/env tsx
import cron from 'node-cron';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { isJobRunning } from './job-lock.js';
import { listJobs } from './test-jobs-config.js';

const __filename = fileURLToPath(import.meta.url);
const CLI_PATH = path.resolve(__filename, 'test-job-cli.ts');

function printHelp(): void {
  console.log(`用法: tsx scripts/jobs/test-jobs-daemon.ts

读取 config/test-jobs.json，为 enabled 且 schedule 非空的 Job 注册 Cron 定时器。
触发时在后台启动对应 Job（等价于 test-job run --background --trigger=schedule）。

环境变量:
  TEST_JOBS_CONFIG  可选，覆盖配置文件路径（暂未实现，使用默认 config/test-jobs.json）

Ctrl+C 停止守护进程（已在跑的 Job 不会自动终止）。
`);
}

function triggerJob(jobId: string): void {
  if (isJobRunning(jobId)) {
    console.log(`⏭️  [schedule] Job「${jobId}」仍在运行，跳过本次触发`);
    return;
  }

  const child = spawn(
    fs.existsSync(path.join(process.cwd(), 'node_modules', '.bin', 'tsx'))
      ? path.join(process.cwd(), 'node_modules', '.bin', 'tsx')
      : 'npx',
    fs.existsSync(path.join(process.cwd(), 'node_modules', '.bin', 'tsx'))
      ? [CLI_PATH, 'run', `--id=${jobId}`, '--background', '--trigger=schedule']
      : ['tsx', CLI_PATH, 'run', `--id=${jobId}`, '--background', '--trigger=schedule'],
    {
      detached: true,
      stdio: 'ignore',
      env: process.env,
    },
  );
  child.unref();
  console.log(`⏰ [schedule] 已触发 Job「${jobId}」(pid=${child.pid})`);
}

function main(): void {
  if (process.argv.includes('-h') || process.argv.includes('--help')) {
    printHelp();
    process.exit(0);
  }

  const jobs = listJobs().filter((j) => j.enabled && j.schedule);
  if (!jobs.length) {
    console.log('ℹ️  无 enabled 且带 schedule 的 Job，守护进程退出');
    process.exit(0);
  }

  console.log('🕐 Test Jobs Daemon 启动\n');
  for (const job of jobs) {
    const expr = job.schedule!;
    if (!cron.validate(expr)) {
      console.warn(`⚠️  Job「${job.id}」cron 无效: ${expr}，已跳过`);
      continue;
    }
    cron.schedule(
      expr,
      () => triggerJob(job.id),
      { timezone: job.timezone },
    );
    console.log(`  ✅ ${job.id}: "${expr}" (${job.timezone}) — ${job.description || ''}`);
  }

  console.log('\n按 Ctrl+C 停止守护进程\n');
}

main();
