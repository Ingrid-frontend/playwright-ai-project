import { execSync } from "child_process";
import path from "path";
import {
  clearLock,
  writeLock,
  writeStatus,
  writeSummary,
  type JobSummaryFile,
} from "./job-lock.js";
import { buildJobFailReasons, sendJobFeishuNotification } from "./job-notify.js";
import { formatRunId } from "./job-utils.js";
import type { ResolvedTestJob } from "./test-jobs-config.js";

type CatalogJobCtx = {
  runId?: string;
  trigger: "manual" | "schedule" | "cli" | "run-optimized-tests";
  persistState?: boolean;
  force?: boolean;
  playwrightEnv?: string;
};

function shouldNotify(notifyOn: ResolvedTestJob["notifyOn"], success: boolean): boolean {
  if (success && notifyOn.includes("success")) return true;
  if (!success && notifyOn.includes("failure")) return true;
  return false;
}

export async function runCatalogDriftJob(
  job: ResolvedTestJob,
  ctxPartial: CatalogJobCtx,
): Promise<{
  exitCode: number;
  testPassed: boolean;
  comparePassed: boolean;
  compareSkipped: boolean;
  aborted: boolean;
  feishuDocPassed: boolean;
  summary: JobSummaryFile;
}> {
  const runId = ctxPartial.runId ?? formatRunId();
  const ctx = {
    jobId: job.id,
    runId,
    trigger: ctxPartial.trigger,
    persistState: ctxPartial.persistState !== false,
  };
  const persist = ctx.persistState !== false && Boolean(job.id);

  if (persist && job.id) {
    writeLock(job.id, {
      pid: process.pid,
      runId,
      startedAt: new Date().toISOString(),
      trigger: ctx.trigger,
    });
    writeStatus(job.id, runId, {
      jobId: job.id,
      runId,
      status: "running",
      trigger: ctx.trigger,
      startedAt: new Date().toISOString(),
      pid: process.pid,
    });
  }

  console.log(`\n🔍 开始执行任务「${job.id}」· catalog 漂移检测 (runId=${runId})\n`);

  let exitCode = 1;
  try {
    execSync("npx tsx scripts/flow/run-catalog-drift-check.ts", {
      stdio: "inherit",
      env: process.env,
      cwd: process.cwd(),
    });
    exitCode = 0;
  } catch (e: unknown) {
    const err = e as { status?: number };
    exitCode = typeof err.status === "number" ? err.status : 1;
  }

  const testPassed = exitCode === 0;
  const failReasons = buildJobFailReasons({
    testPassed,
    comparePassed: true,
    compareSkipped: true,
    aborted: false,
    failCount: testPassed ? 0 : 1,
    executedCount: 1,
    compareGate: false,
    feishuDocPassed: true,
    feishuDocAttempted: false,
  });

  const summary: JobSummaryFile = {
    jobId: job.id,
    runId,
    trigger: ctx.trigger,
    testPassed,
    comparePassed: true,
    compareSkipped: true,
    aborted: false,
    totalSpecs: 1,
    executedCount: 1,
    successCount: testPassed ? 1 : 0,
    failCount: testPassed ? 0 : 1,
    projects: job.projects,
    specPaths: ["scripts/flow/run-catalog-drift-check.ts"],
    compareGate: false,
    failReasons,
  };

  if (job.steps.feishuNotify && shouldNotify(job.notifyOn, testPassed)) {
    await sendJobFeishuNotification(job.feishuMode, {
      jobId: job.id,
      jobDescription: job.description,
      trigger: ctx.trigger,
      testPassed,
      comparePassed: true,
      compareSkipped: true,
      feishuDocAttempted: false,
      feishuDocPassed: true,
      aborted: false,
      errorSummary: testPassed ? undefined : failReasons.join("; "),
    });
  }

  if (persist && job.id) {
    writeSummary(job.id, runId, summary);
    writeStatus(job.id, runId, {
      jobId: job.id,
      runId,
      status: testPassed ? "success" : "failed",
      trigger: ctx.trigger,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      pid: process.pid,
    });
    clearLock(job.id);
  }

  console.log(`\n📊 任务结束：${testPassed ? "success" : "failed"}`);

  return {
    exitCode: testPassed ? 0 : 1,
    testPassed,
    comparePassed: true,
    compareSkipped: true,
    aborted: false,
    feishuDocPassed: true,
    summary,
  };
}
