import { execSync } from "child_process";
import path from "path";
import type { JobSummaryFile } from "./job-lock.js";
import { buildJobFailReasons } from "./job-notify.js";
import { formatRunId, type AccountProfileFilter } from "./job-utils.js";
import { resolveJobRunEnv, type ResolvedTestJob } from "./test-jobs-config.js";
import {
  clearLock,
  writeLock,
  writeStatus,
  writeSummary,
} from "./job-lock.js";

type FlowJobCtx = {
  runId?: string;
  trigger: "manual" | "schedule" | "cli" | "run-optimized-tests";
  persistState?: boolean;
  force?: boolean;
  playwrightEnv?: string;
  accountProfile?: AccountProfileFilter;
};

export function isFlowRunner(runner?: string | null): boolean {
  return runner === "request-flow-golden";
}

export async function runFlowJob(
  job: ResolvedTestJob,
  ctxPartial: FlowJobCtx,
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
  const effectiveEnv = resolveJobRunEnv(job, ctxPartial.playwrightEnv);
  const profileRaw = ctxPartial.accountProfile && ctxPartial.accountProfile !== "all"
    ? ctxPartial.accountProfile
    : job.accountProfile && job.accountProfile !== "all"
      ? job.accountProfile
      : "";
  const profile = Array.isArray(profileRaw) ? profileRaw[0] || "" : String(profileRaw || "");

  const ctx = {
    jobId: job.id,
    job,
    runId,
    trigger: ctxPartial.trigger,
    persistState: ctxPartial.persistState !== false,
    force: ctxPartial.force,
  };

  const persist = ctx.persistState !== false && Boolean(ctx.jobId);
  if (persist && ctx.jobId) {
    writeLock(ctx.jobId, {
      pid: process.pid,
      runId,
      startedAt: new Date().toISOString(),
      trigger: ctx.trigger,
    });
    writeStatus(ctx.jobId, runId, {
      jobId: ctx.jobId,
      runId,
      status: "running",
      trigger: ctx.trigger,
      startedAt: new Date().toISOString(),
      pid: process.pid,
    });
  }

  if (effectiveEnv) process.env.PLAYWRIGHT_ENV = effectiveEnv;

  console.log(`\n🎬 开始执行任务「${job.id}」· 申请单 Golden (runId=${runId})\n`);

  const scriptPath = path.join(process.cwd(), "scripts/flow/run-request-flow-golden.ts");
  const args = [`tsx`, scriptPath, `--env=${effectiveEnv}`];
  if (profile) args.push(`--profile=${profile}`);

  let exitCode = 1;
  try {
    execSync(`npx ${args.map((a) => JSON.stringify(a)).join(" ")}`, {
      stdio: "inherit",
      env: process.env,
    });
    exitCode = 0;
  } catch (e: unknown) {
    const err = e as { status?: number };
    exitCode = typeof err.status === "number" ? err.status : 1;
  }

  const testPassed = exitCode === 0;
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
    specPaths: ["request-flow/tests/request/golden-regression.spec.ts"],
    compareGate: false,
    failReasons: buildJobFailReasons({
      testPassed,
      comparePassed: true,
      compareSkipped: true,
      aborted: false,
      failCount: testPassed ? 0 : 1,
      executedCount: 1,
      compareGate: false,
      feishuDocPassed: true,
      feishuDocAttempted: false,
    }),
  };

  const flowAllOk = testPassed;
  if (persist && ctx.jobId) {
    writeSummary(ctx.jobId, runId, summary);
    writeStatus(ctx.jobId, runId, {
      jobId: ctx.jobId,
      runId,
      status: flowAllOk ? "success" : "failed",
      trigger: ctx.trigger,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      pid: process.pid,
    });
    clearLock(ctx.jobId);
  }

  return {
    exitCode,
    testPassed,
    comparePassed: true,
    compareSkipped: true,
    aborted: false,
    feishuDocPassed: true,
    summary,
  };
}
