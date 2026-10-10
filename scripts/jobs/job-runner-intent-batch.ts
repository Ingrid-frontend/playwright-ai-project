import { execSync } from "child_process";
import fs from "fs";
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

type IntentBatchJobCtx = {
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

/** 取最近 10 分钟内最新的 stable-batch 汇总（run-stable-intents 每次运行写独立 stamp 目录） */
function readLatestStableSummary(): {
  total: number;
  passed: number;
  failed: number;
  skipped: Record<string, number>;
  cases: Array<{ rel: string; passed: boolean; error?: string }>;
} | null {
  const dir = path.resolve(process.cwd(), "results/intent-runs");
  if (!fs.existsSync(dir)) return null;
  const cutoff = Date.now() - 10 * 60_000;
  const candidates = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.endsWith("-stable-batch"))
    .map((d) => path.join(dir, d.name, "summary.json"))
    .filter((p) => fs.existsSync(p) && fs.statSync(p).mtimeMs >= cutoff)
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  if (!candidates.length) return null;
  try {
    return JSON.parse(fs.readFileSync(candidates[0], "utf8"));
  } catch {
    return null;
  }
}

export async function runIntentBatchJob(
  job: ResolvedTestJob,
  ctxPartial: IntentBatchJobCtx,
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
  const startedAtIso = new Date().toISOString();

  if (persist && job.id) {
    writeLock(job.id, {
      pid: process.pid,
      runId,
      startedAt: startedAtIso,
      trigger: ctx.trigger,
    });
    writeStatus(job.id, runId, {
      jobId: job.id,
      runId,
      status: "running",
      trigger: ctx.trigger,
      startedAt: startedAtIso,
      pid: process.pid,
    });
  }

  const env = ctxPartial.playwrightEnv || job.playwrightEnv || "dev";
  console.log(`\n🎯 开始执行任务「${job.id}」· Stable Intent 回归 (env=${env}, runId=${runId})\n`);

  // 额外参数透传（如 INTENT_BATCH_ARGS="--engine=pw --key=审批"）
  const extraArgs = String(process.env.INTENT_BATCH_ARGS || "").trim();

  let exitCode = 1;
  try {
    execSync(
      `npx tsx scripts/ai/run-stable-intents.ts --env=${env}${extraArgs ? ` ${extraArgs}` : ""}`,
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
  const summaryData = readLatestStableSummary();
  const failedCases = (summaryData?.cases || []).filter((c) => !c.passed);

  const failReasons = buildJobFailReasons({
    testPassed,
    comparePassed: true,
    compareSkipped: true,
    aborted: false,
    failCount: summaryData?.failed ?? (testPassed ? 0 : 1),
    executedCount: summaryData?.total ?? 1,
    compareGate: false,
    feishuDocPassed: true,
    feishuDocAttempted: false,
  });
  for (const c of failedCases.slice(0, 8)) {
    failReasons.push(`❌ ${c.rel}${c.error ? ` — ${c.error.slice(0, 120)}` : ""}`);
  }

  const total = summaryData?.total ?? 0;
  const passed = summaryData?.passed ?? 0;
  const failed = summaryData?.failed ?? (testPassed ? 0 : 1);
  const watchSkipped = Object.entries(summaryData?.skipped || {}).find(([k]) => k.includes("watch"))?.[1] || 0;

  const summary: JobSummaryFile = {
    jobId: job.id,
    runId,
    trigger: ctx.trigger,
    testPassed,
    comparePassed: true,
    compareSkipped: true,
    aborted: false,
    totalSpecs: total,
    executedCount: total,
    successCount: passed,
    failCount: failed,
    projects: job.projects,
    specPaths: ["scripts/ai/run-stable-intents.ts"],
    compareGate: false,
    failReasons,
  };

  if (job.steps.feishuNotify && shouldNotify(job.notifyOn, testPassed)) {
    const batchSummary = summaryData
      ? `stable 回归 ${total} 条：通过 ${passed} · 失败 ${failed}${watchSkipped ? ` · watch 待复查 ${watchSkipped}` : ""}`
      : undefined;
    await sendJobFeishuNotification(job.feishuMode, {
      jobId: job.id,
      jobDescription: [job.description, batchSummary].filter(Boolean).join(" · "),
      trigger: ctx.trigger,
      testPassed,
      comparePassed: true,
      compareSkipped: true,
      feishuDocAttempted: false,
      feishuDocPassed: true,
      aborted: false,
      errorSummary: testPassed ? undefined : failReasons.join("; ").slice(0, 800),
    });
  }

  if (persist && job.id) {
    writeSummary(job.id, runId, summary);
    writeStatus(job.id, runId, {
      jobId: job.id,
      runId,
      status: testPassed ? "success" : "failed",
      trigger: ctx.trigger,
      startedAt: startedAtIso,
      finishedAt: new Date().toISOString(),
      pid: process.pid,
    });
    clearLock(job.id);
  }

  if (watchSkipped) {
    console.log(`🔔 watch 用例 ${watchSkipped} 条未进本批（需人工复查，npm run ai:promote-intent）`);
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
