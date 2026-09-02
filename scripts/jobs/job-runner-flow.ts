import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import type { JobSummaryFile } from "./job-lock.js";
import {
  buildJobFailReasons,
  readUiIssuesSummaryCounts,
  readUiIssuesSummaryLine,
  sendJobFeishuNotification,
} from "./job-notify.js";
import { writeBitableReport } from "../feishu/write-bitable-report.js";
import { formatRunId, type AccountProfileFilter } from "./job-utils.js";
import { listJobRunEnvs, resolveJobRunEnv, type NotifyOn, type ResolvedTestJob } from "./test-jobs-config.js";
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

const require = createRequire(import.meta.url);
const repoEnv = require("../../pw-files/repo-env.js");

type FlowJobCtx = {
  runId?: string;
  trigger: "manual" | "schedule" | "cli" | "run-optimized-tests";
  persistState?: boolean;
  force?: boolean;
  playwrightEnv?: string;
  accountProfile?: AccountProfileFilter;
};

const FLOW_ID = "request-flow";

function shouldNotify(notifyOn: NotifyOn[], success: boolean): boolean {
  if (success && notifyOn.includes("success")) return true;
  if (!success && notifyOn.includes("failure")) return true;
  return false;
}

function readLastFlowManifest(repoRoot: string, flowId = FLOW_ID) {
  const p = path.join(repoRoot, "results/flow-runs", flowId, "last-run.json");
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as {
      ok?: boolean;
      compareReportRel?: string;
      failed?: number;
      passed?: number;
    };
  } catch {
    return null;
  }
}

export function isFlowRunner(runner?: string | null, jobId?: string): boolean {
  return resolveFlowRunnerKey(runner, jobId) != null;
}

function listFlowLoginProfiles(
  repoRoot: string,
  runnerKey: FlowRunnerKey,
  env: string,
  profile: string,
  job: ResolvedTestJob,
): string[] {
  if (runnerKey === "request-flow-write" || runnerKey === "approval-flow-write") {
    if (profile) return [profile];
    const raw = job.accountProfile;
    if (Array.isArray(raw)) return raw.length ? [String(raw[0])] : ["write"];
    return [String(raw || "write")];
  }
  if (profile) return [profile];
  return repoEnv.listGoldenProfileIds(repoRoot, env);
}

function resolveFlowSpecPaths(runnerKey: FlowRunnerKey, job: ResolvedTestJob): string[] {
  if (runnerKey === "request-flow-write" && Array.isArray(job.specs)) {
    return job.specs.map((s) => `request-flow/tests/${s}`);
  }
  if (runnerKey === "approval-flow-write" && Array.isArray(job.specs)) {
    return job.specs.map((s) => `approval-flow/tests/${s}`);
  }
  if (runnerKey === "approval-flow-golden") {
    return ["approval-flow/tests/approval/golden-regression.spec.ts"];
  }
  return ["request-flow/tests/request/golden-regression.spec.ts"];
}

function buildFlowScriptArgs(
  runnerKey: FlowRunnerKey,
  effectiveEnv: string,
  profile: string,
  job: ResolvedTestJob,
): string[] {
  const scriptPath = path.join(process.cwd(), "scripts/flow", FLOW_RUNNER_SCRIPTS[runnerKey]);
  const args = [`tsx`, scriptPath];
  if (effectiveEnv === "all" && runnerKey === "request-flow-golden") {
    args.push("--all-envs");
  } else {
    args.push(`--env=${effectiveEnv}`);
  }
  if (profile) args.push(`--profile=${profile}`);
  if (runnerKey === "request-flow-write" && Array.isArray(job.specs)) {
    for (const spec of job.specs) {
      args.push(`--spec=${spec}`);
    }
    args.push("--clean-runs");
    if (job.steps.resetFlowArtifacts) args.push("--reset-artifacts");
  }
  if (runnerKey === "approval-flow-write" && Array.isArray(job.specs)) {
    for (const spec of job.specs) {
      args.push(`--spec=${spec}`);
    }
    args.push("--clean-runs");
    if (job.steps.resetFlowArtifacts) args.push("--reset-artifacts");
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

  const repoRoot = process.cwd();
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

  if (effectiveEnv && effectiveEnv !== "all") process.env.PLAYWRIGHT_ENV = effectiveEnv;

  if (job.steps.promoteBaselineIfClean) {
    process.env.FLOW_PROMOTE_IF_CLEAN = "1";
  } else {
    delete process.env.FLOW_PROMOTE_IF_CLEAN;
  }

  if (job.steps.uiAuditGate) {
    process.env.FLOW_UI_AUDIT_GATE = "1";
  } else {
    delete process.env.FLOW_UI_AUDIT_GATE;
  }

  if (job.steps.login || job.steps.refreshLogin) {
    const loginEnvs = listJobRunEnvs(job, ctxPartial.playwrightEnv);
    const loginFailures: string[] = [];
    for (const loginEnv of loginEnvs) {
      const loginProfiles = listFlowLoginProfiles(repoRoot, runnerKey, loginEnv, profile, job);
      if (!loginProfiles.length) continue;
      const loginResult = repoEnv.ensureFlowProfilesLogin(repoRoot, loginEnv, loginProfiles, {
        login: job.steps.login,
        refresh: job.steps.refreshLogin,
      });
      if (!loginResult.ok) {
        loginFailures.push(`${loginEnv}: ${loginResult.reason || "登录态准备失败"}`);
      }
    }
    if (loginFailures.length) {
      const reason = loginFailures.join("; ");
      console.error(`\n❌ ${reason}\n`);
      const specPaths = resolveFlowSpecPaths(runnerKey, job);
      const summary: JobSummaryFile = {
        jobId: job.id,
        runId,
        trigger: ctx.trigger,
        testPassed: false,
        comparePassed: true,
        compareSkipped: true,
        aborted: false,
        totalSpecs: specPaths.length,
        executedCount: 0,
        successCount: 0,
        failCount: 1,
        projects: job.projects,
        specPaths,
        compareGate: job.steps.compareGate,
        failReasons: [reason],
      };
      if (persist && ctx.jobId) {
        writeSummary(ctx.jobId, runId, summary);
        writeStatus(ctx.jobId, runId, {
          jobId: ctx.jobId,
          runId,
          status: "failed",
          trigger: ctx.trigger,
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          pid: process.pid,
        });
        clearLock(ctx.jobId);
      }
      if (job.steps.feishuNotify && shouldNotify(job.notifyOn, false)) {
        await sendJobFeishuNotification(job.feishuMode, {
          jobId: job.id,
          jobDescription: job.description,
          trigger: ctx.trigger,
          testPassed: false,
          comparePassed: true,
          compareSkipped: true,
          feishuDocAttempted: false,
          feishuDocPassed: true,
          aborted: false,
          errorSummary: reason,
        });
      }
      return {
        exitCode: 1,
        testPassed: false,
        comparePassed: true,
        compareSkipped: true,
        aborted: false,
        feishuDocPassed: true,
        summary,
      };
    }
  }

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
  const specPaths = resolveFlowSpecPaths(runnerKey, job);

  const compareSkipped =
    !job.steps.compare ||
    (runnerKey !== "request-flow-golden" && runnerKey !== "approval-flow-golden");
  let comparePassed = true;
  if (!compareSkipped) {
    const flowId = runnerKey === "approval-flow-golden" ? "approval-flow" : FLOW_ID;
    const manifest = readLastFlowManifest(repoRoot, flowId);
    const hasCompare = Boolean(manifest?.compareReportRel);
    if (hasCompare && job.steps.compareGate) {
      const ui = readUiIssuesSummaryCounts();
      comparePassed = (ui?.blocker ?? 0) === 0;
    } else if (hasCompare) {
      comparePassed = true;
    }
  }

  const flowAllOk = testPassed && (compareSkipped || comparePassed);
  const uiIssues = readUiIssuesSummaryCounts();
  const failReasons = buildJobFailReasons({
    testPassed,
    comparePassed,
    compareSkipped,
    aborted: false,
    failCount: testPassed ? 0 : 1,
    executedCount: 1,
    compareGate: job.steps.compareGate,
    feishuDocPassed: true,
    feishuDocAttempted: false,
    uiIssuesBlocker: uiIssues?.blocker,
  });

  const summary: JobSummaryFile = {
    jobId: job.id,
    runId,
    trigger: ctx.trigger,
    testPassed,
    comparePassed,
    compareSkipped,
    aborted: false,
    totalSpecs: specPaths.length,
    executedCount: 1,
    successCount: flowAllOk ? 1 : 0,
    failCount: flowAllOk ? 0 : 1,
    projects: job.projects,
    specPaths,
    compareGate: job.steps.compareGate,
    uiIssuesBlocker: uiIssues?.blocker,
    uiIssuesWarning: uiIssues?.warning,
    failReasons,
  };

  if (job.steps.feishuNotify && shouldNotify(job.notifyOn, flowAllOk)) {
    await sendJobFeishuNotification(job.feishuMode, {
      jobId: job.id,
      jobDescription: job.description,
      trigger: ctx.trigger,
      testPassed,
      comparePassed,
      compareSkipped,
      feishuDocAttempted: false,
      feishuDocPassed: true,
      aborted: false,
      uiIssuesSummary: readUiIssuesSummaryLine(),
    });
  }

  if (job.steps.writeFeishuBitable) {
    try {
      const finalStatus = flowAllOk ? "success" : "failed";
      await writeBitableReport({ summary, env: effectiveEnv, status: finalStatus });
    } catch (error) {
      console.log(
        "⚠️  飞书多维表写入失败（不影响任务流程）:",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

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

  console.log(`\n📊 任务结束：${flowAllOk ? "success" : "failed"}`);

  return {
    exitCode: flowAllOk ? 0 : 1,
    testPassed,
    comparePassed,
    compareSkipped,
    aborted: false,
    feishuDocPassed: true,
    summary,
  };
}
