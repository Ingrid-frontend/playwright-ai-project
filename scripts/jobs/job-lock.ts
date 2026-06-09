import fs from 'fs';
import path from 'path';
import { jobDir, isProcessAlive } from './job-utils.js';

export type JobLock = {
  pid: number;
  runId: string;
  startedAt: string;
  trigger: string;
};

export type JobRunStatus = 'pending' | 'running' | 'success' | 'failed' | 'aborted' | 'cancelled';

export type JobStatusFile = {
  jobId: string;
  runId: string;
  status: JobRunStatus;
  trigger: string;
  startedAt: string;
  finishedAt?: string;
  pid?: number;
};

export type JobSummaryFile = {
  jobId: string;
  runId: string;
  trigger: string;
  testPassed: boolean;
  comparePassed: boolean;
  compareSkipped: boolean;
  aborted: boolean;
  totalSpecs: number;
  executedCount: number;
  successCount: number;
  failCount: number;
  projects: string[];
  specPaths: string[];
  /** 是否启用了 compare-screenshots --gate */
  compareGate?: boolean;
  feishuDocAttempted?: boolean;
  feishuDocPassed?: boolean;
  uiIssuesBlocker?: number;
  uiIssuesWarning?: number;
  /** 任务 failed/aborted 时的可读原因（Studio 展示） */
  failReasons?: string[];
};

function lockPath(jobId: string): string {
  return path.join(jobDir(jobId), 'lock.json');
}

function ensureJobDir(jobId: string): void {
  fs.mkdirSync(jobDir(jobId), { recursive: true });
}

export function readLock(jobId: string): JobLock | null {
  const p = lockPath(jobId);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as JobLock;
  } catch {
    return null;
  }
}

export function writeLock(jobId: string, lock: JobLock): void {
  ensureJobDir(jobId);
  fs.writeFileSync(lockPath(jobId), JSON.stringify(lock, null, 2));
}

export function clearLock(jobId: string): void {
  const p = lockPath(jobId);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

export function isJobRunning(jobId: string): boolean {
  const lock = readLock(jobId);
  if (!lock) return false;
  if (!isProcessAlive(lock.pid)) {
    clearLock(jobId);
    return false;
  }
  return true;
}

export function assertJobNotRunning(jobId: string, force = false): void {
  if (force) return;
  const lock = readLock(jobId);
  if (!lock) return;
  if (isProcessAlive(lock.pid)) {
    throw new Error(
      `Job「${jobId}」正在运行中（pid=${lock.pid}, runId=${lock.runId}）。` +
        `使用 --force 覆盖，或 npm run test-job -- stop --id ${jobId}`,
    );
  }
  clearLock(jobId);
}

export function runDir(jobId: string, runId: string): string {
  return path.join(jobDir(jobId), 'runs', runId);
}

export function writeStatus(jobId: string, runId: string, status: JobStatusFile): void {
  const dir = runDir(jobId, runId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'status.json'), JSON.stringify(status, null, 2));
}

export function writeSummary(jobId: string, runId: string, summary: JobSummaryFile): void {
  const dir = runDir(jobId, runId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify(summary, null, 2));
}

export function readLatestRun(jobId: string): { runId: string; status?: JobStatusFile; summary?: JobSummaryFile } | null {
  const runsRoot = path.join(jobDir(jobId), 'runs');
  if (!fs.existsSync(runsRoot)) return null;
  const runs = fs
    .readdirSync(runsRoot)
    .filter((f) => fs.statSync(path.join(runsRoot, f)).isDirectory())
    .sort((a, b) => b.localeCompare(a));
  if (!runs.length) return null;
  const runId = runs[0];
  const dir = path.join(runsRoot, runId);
  let status: JobStatusFile | undefined;
  let summary: JobSummaryFile | undefined;
  const statusPath = path.join(dir, 'status.json');
  const summaryPath = path.join(dir, 'summary.json');
  if (fs.existsSync(statusPath)) {
    try {
      status = JSON.parse(fs.readFileSync(statusPath, 'utf-8')) as JobStatusFile;
    } catch {
      /* ignore */
    }
  }
  if (fs.existsSync(summaryPath)) {
    try {
      summary = JSON.parse(fs.readFileSync(summaryPath, 'utf-8')) as JobSummaryFile;
    } catch {
      /* ignore */
    }
  }
  return { runId, status, summary };
}

export function listRunIds(jobId: string): string[] {
  const runsRoot = path.join(jobDir(jobId), 'runs');
  if (!fs.existsSync(runsRoot)) return [];
  return fs
    .readdirSync(runsRoot)
    .filter((f) => fs.statSync(path.join(runsRoot, f)).isDirectory())
    .sort((a, b) => b.localeCompare(a));
}

export function stdoutLogPath(jobId: string, runId: string): string {
  return path.join(runDir(jobId, runId), 'stdout.log');
}
