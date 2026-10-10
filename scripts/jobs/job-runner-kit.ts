/**
 * Job runner 公共骨架：lock/status 持久化 + notify 判定。
 *
 * 独立 runner（smoke / catalog-drift / intent-batch）的生命周期样板从这里派生；
 * 新增 job 类型 = 新 handler 文件 + registerJobRunner 一行 + test-jobs.json 一条，
 * 不再改 job-runner.ts 分发逻辑。
 *
 * runFlowJob / runDirect 的生命周期更复杂（登录准备、abort 分支、bitable），
 * 暂不收编，避免触碰 Golden 执行路径。
 */
import {
  clearLock,
  writeLock,
  writeStatus,
  writeSummary,
  type JobRunStatus,
  type JobSummaryFile,
} from './job-lock.js';
import { formatRunId, type AccountProfileFilter } from './job-utils.js';
import type { NotifyOn, ResolvedTestJob } from './test-jobs-config.js';

export type JobTrigger = 'manual' | 'schedule' | 'cli' | 'run-optimized-tests';

/** 统一的 runner 调用上下文（各 runner 可只取自己关心的字段） */
export type JobRunnerCtx = {
  runId?: string;
  trigger: JobTrigger;
  persistState?: boolean;
  force?: boolean;
  playwrightEnv?: string;
  accountProfile?: AccountProfileFilter;
};

export function shouldNotify(notifyOn: NotifyOn[], success: boolean): boolean {
  if (success && notifyOn.includes('success')) return true;
  if (!success && notifyOn.includes('failure')) return true;
  return false;
}

export type JobRunHandle = {
  runId: string;
  trigger: JobTrigger;
  persist: boolean;
  /** 进入时取一次，最终 status.json 的 startedAt 与 lock 一致 */
  startedAtIso: string;
};

/** 写 lock + running 状态（persist=false 时只生成 runId，不动文件） */
export function beginJobRun(job: ResolvedTestJob, ctxPartial: JobRunnerCtx): JobRunHandle {
  const runId = ctxPartial.runId ?? formatRunId();
  const trigger = ctxPartial.trigger;
  const persist = ctxPartial.persistState !== false && Boolean(job.id);
  const startedAtIso = new Date().toISOString();
  if (persist && job.id) {
    writeLock(job.id, {
      pid: process.pid,
      runId,
      startedAt: startedAtIso,
      trigger,
    });
    writeStatus(job.id, runId, {
      jobId: job.id,
      runId,
      status: 'running',
      trigger,
      startedAt: startedAtIso,
      pid: process.pid,
    });
  }
  return { runId, trigger, persist, startedAtIso };
}

/** 写 summary + 最终状态 + 清锁（smoke/catalog/intent-batch 类 runner 的固定收尾） */
export function finalizeJobRun(
  job: ResolvedTestJob,
  run: JobRunHandle,
  summary: JobSummaryFile,
  status: Extract<JobRunStatus, 'success' | 'failed' | 'aborted'>,
): void {
  if (!run.persist || !job.id) return;
  writeSummary(job.id, run.runId, summary);
  writeStatus(job.id, run.runId, {
    jobId: job.id,
    runId: run.runId,
    status,
    trigger: run.trigger,
    startedAt: run.startedAtIso,
    finishedAt: new Date().toISOString(),
    pid: process.pid,
  });
  clearLock(job.id);
}
