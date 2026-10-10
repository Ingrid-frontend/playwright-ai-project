import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import type { JobSummaryFile } from "./job-lock.js";
import { buildJobFailReasons, sendJobFeishuNotification } from "./job-notify.js";
import {
  beginJobRun,
  finalizeJobRun,
  shouldNotify,
  type JobRunnerCtx,
} from "./job-runner-kit.js";
import type { ResolvedTestJob } from "./test-jobs-config.js";

type SmokeJobCtx = JobRunnerCtx;

/** 取最近 10 分钟内最新一份 smoke-report（巡检执行器每次运行写独立 runId 目录） */
function readLatestSmokeReport(): {
  runId: string;
  env: string;
  totals: { pages: number; passed: number; suspicious: number; failed: number; consoleErrors: number };
  pages: Array<{ pageId: string; label: string; route: string; status: string; checks: Array<{ detail?: string }> }>;
} | null {
  const dir = path.resolve(process.cwd(), "results/smoke");
  if (!fs.existsSync(dir)) return null;
  const cutoff = Date.now() - 10 * 60_000;
  const candidates = fs
    .readdirSync(dir)
    .map((name) => path.join(dir, name, "smoke-report.json"))
    .filter((p) => fs.existsSync(p) && fs.statSync(p).mtimeMs >= cutoff)
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  if (!candidates.length) return null;
  try {
    return JSON.parse(fs.readFileSync(candidates[0], "utf8"));
  } catch {
    return null;
  }
}

export async function runSmokePatrolJob(
  job: ResolvedTestJob,
  ctxPartial: SmokeJobCtx,
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

  const env = ctxPartial.playwrightEnv || job.playwrightEnv || "dev";
  console.log(`\n🕵️  开始执行任务「${job.id}」· 全站 Smoke 巡检 (env=${env}, runId=${runId})\n`);

  // 额外参数透传（如 SMOKE_PATROL_ARGS="--weight=core --enforce-console"）
  const extraArgs = String(process.env.SMOKE_PATROL_ARGS || "").trim();

  let exitCode = 1;
  try {
    execSync(
      `npx tsx scripts/smoke/run-smoke-patrol.ts --env=${env}${extraArgs ? ` ${extraArgs}` : ""}`,
      {
        stdio: "inherit",
        env: { ...process.env, PLAYWRIGHT_ENV: env },
        cwd: process.cwd(),
      },
    );
    exitCode = 0;
  } catch (e: unknown) {
    const err = e as { status?: number };
    exitCode = typeof err.status === "number" ? err.status : 1;
  }

  const testPassed = exitCode === 0;
  const report = readLatestSmokeReport();
  const failedPages = (report?.pages || []).filter((p) => p.status === "failed");
  const suspiciousPages = (report?.pages || []).filter((p) => p.status === "suspicious");

  const failReasons = buildJobFailReasons({
    testPassed,
    comparePassed: true,
    compareSkipped: true,
    aborted: false,
    failCount: failedPages.length,
    executedCount: report?.totals.pages ?? 1,
    compareGate: false,
    feishuDocPassed: true,
    feishuDocAttempted: false,
  });
  for (const p of failedPages.slice(0, 8)) {
    const reason = p.checks.find((c) => c.detail && c.detail)?.detail || "";
    failReasons.push(`❌ ${p.pageId} ${p.route}${reason ? ` — ${reason.slice(0, 120)}` : ""}`);
  }

  const pages = report?.totals.pages ?? 0;
  const passed = report?.totals.passed ?? 0;
  const suspicious = report?.totals.suspicious ?? 0;
  const failed = report?.totals.failed ?? (testPassed ? 0 : 1);

  const summary: JobSummaryFile = {
    jobId: job.id,
    runId,
    trigger: run.trigger,
    testPassed,
    comparePassed: true,
    compareSkipped: true,
    aborted: false,
    totalSpecs: pages,
    executedCount: pages,
    successCount: passed + suspicious,
    failCount: failed,
    projects: job.projects,
    specPaths: ["scripts/smoke/run-smoke-patrol.ts"],
    compareGate: false,
    failReasons,
  };

  if (job.steps.feishuNotify && shouldNotify(job.notifyOn, testPassed)) {
    const smokeSummary = report
      ? `巡检 ${pages} 页：通过 ${passed} · 可疑 ${suspicious} · 失败 ${failed}（console 错误 ${report.totals.consoleErrors} 条）`
      : undefined;
    await sendJobFeishuNotification(job.feishuMode, {
      jobId: job.id,
      jobDescription: [job.description, smokeSummary].filter(Boolean).join(" · "),
      trigger: run.trigger,
      testPassed,
      comparePassed: true,
      compareSkipped: true,
      feishuDocAttempted: false,
      feishuDocPassed: true,
      aborted: false,
      errorSummary: testPassed ? undefined : failReasons.join("; ").slice(0, 800),
    });
  }

  finalizeJobRun(job, run, summary, testPassed ? "success" : "failed");

  if (suspiciousPages.length) {
    console.log(`🟡 可疑页（不挡门禁）: ${suspiciousPages.map((p) => p.pageId).join("、")}`);
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
