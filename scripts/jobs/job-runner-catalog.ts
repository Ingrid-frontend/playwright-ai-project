import { execSync } from "child_process";
import type { JobSummaryFile } from "./job-lock.js";
import { buildJobFailReasons, sendJobFeishuNotification } from "./job-notify.js";
import {
  beginJobRun,
  finalizeJobRun,
  shouldNotify,
  type JobRunnerCtx,
} from "./job-runner-kit.js";
import type { ResolvedTestJob } from "./test-jobs-config.js";

type CatalogJobCtx = JobRunnerCtx;

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
  const run = beginJobRun(job, ctxPartial);
  const runId = run.runId;

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
    trigger: run.trigger,
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
      trigger: run.trigger,
      testPassed,
      comparePassed: true,
      compareSkipped: true,
      feishuDocAttempted: false,
      feishuDocPassed: true,
      aborted: false,
      errorSummary: testPassed ? undefined : failReasons.join("; "),
    });
  }

  finalizeJobRun(job, run, summary, testPassed ? "success" : "failed");

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
