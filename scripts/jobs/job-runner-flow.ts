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
import {
  FLOW_RUNNER_LABELS,
  FLOW_RUNNER_SCRIPTS,
  resolveFlowRunnerKey,
  type FlowRunnerKey,
} from "./flow-runner-registry.js";

type FlowJobCtx = {
  runId?: string;
  trigger: "manual" | "schedule" | "cli" | "run-optimized-tests";
  persistState?: boolean;
  force?: boolean;
  playwrightEnv?: string;
  accountProfile?: AccountProfileFilter;
};

export function isFlowRunner(runner?: string | null, jobId?: string): boolean {
  return resolveFlowRunnerKey(runner, jobId) != null;
}

function buildFlowScriptArgs(
  runnerKey: FlowRunnerKey,
  effectiveEnv: string,
  profile: string,
  job: ResolvedTestJob,
): string[] {
  const scriptPath = path.join(process.cwd(), "scripts/flow", FLOW_RUNNER_SCRIPTS[runnerKey]);
  const args = [`tsx`, scriptPath, `--env=${effectiveEnv}`];
  if (profile) args.push(`--profile=${profile}`);
  if (runnerKey === "request-flow-write" && Array.isArray(job.specs)) {
    for (const spec of job.specs) {
      args.push(`--spec=${spec}`);
    }
  }
  return args;
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
  const runnerKey = resolveFlowRunnerKey(job.runner, job.id);
  if (!runnerKey) {
    throw new Error(`未知 flow runner: ${job.runner || job.id}`);
  }

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

  console.log(`\n🎬 开始执行任务「${job.id}」· ${FLOW_RUNNER_LABELS[runnerKey]} (runId=${runId})\n`);

  const args = buildFlowScriptArgs(runnerKey, effectiveEnv, profile, job);

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
  const specPaths =
    runnerKey === "request-flow-write" && Array.isArray(job.specs)
      ? job.specs.map((s) => `request-flow/tests/${s}`)
      : ["request-flow/tests/request/golden-regression.spec.ts"];

  const summary: JobSummaryFile = {
    jobId: job.id,
    runId,
    trigger: ctx.trigger,
    testPassed,
    comparePassed: true,
    compareSkipped: true,
    aborted: false,
    totalSpecs: specPaths.length,
    executedCount: 1,
    successCount: testPassed ? 1 : 0,
    failCount: testPassed ? 0 : 1,
    projects: job.projects,
    specPaths,
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
