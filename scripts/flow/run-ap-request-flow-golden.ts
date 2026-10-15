#!/usr/bin/env tsx
/**
 * 对公申请单流程 golden runner（由 npm run flow:new 生成）。
 * 结构与 run-approval-flow-golden.ts 一致——多环境 / 多档案 / 结果汇总 / 基线晋升。
 * 如需改公共行为，改 scripts/flow/flow-shared.ts 或两处一起改，别只改这一份。
 */
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import dotenv from "dotenv";

dotenv.config({ path: path.join(process.cwd(), ".env") });

const require = createRequire(import.meta.url);
const repoEnv = require("../../pw-files/repo-env.js");
const { finalizeFlowRun, flowScriptKey } = require("../../pw-files/lib/flow-run-common.js");
const { makeRunMarker, writeRunMarkerFile } = require("../../pw-files/lib/flow-run-marker.js");
const { resolveFlowGoldenSeed } = require("../../pw-files/lib/flow-golden-seed.js");
const { logConcisePlaywrightFailures } = require("../../pw-files/lib/failure-report.js");
const { parseGoldenExecution, finalizeGoldenExecution, goldenBatchStatus, writeGoldenBatch, summarizeGoldenBatch, isUnavailable } = require("../../pw-files/lib/golden-batch.js");

const FLOW_ID = "ap-request-flow";
const FLOW_LABEL = "对公申请单流程";
const CONFIG_REL = "ap-request-flow/playwright.config.ts";
const SPEC = "ap-request/golden-regression.spec.ts";

type RunOneResult = {
  ok: boolean;
  skipped?: boolean;
  /**
   * 没有任何用例真正跑通（passed + failed === 0），全靠 skip 占位。
   * 不算 pass，期望 batch.exitCode !== 0，避免把「没单据可跑」误判成绿色门禁。
   */
  skippedOnly?: boolean;
  profileId: string;
  roleSlug: string;
  exitCode: number;
  passed?: number;
  failed?: number;
  total?: number;
  runId?: string;
  error?: string;
  reason?: string;
};

function parseArgs(argv: string[]) {
  let env = process.env.PLAYWRIGHT_ENV?.trim() || "dev";
  let profile = "";
  let grep = "";

  for (const arg of argv) {
    if (arg.startsWith("--env=")) env = arg.slice(6).trim();
    else if (arg.startsWith("--profile=")) profile = arg.slice(10).trim();
    else if (arg.startsWith("--grep=")) grep = arg.slice(7).trim();
  }

  return { env, profile, grep };
}

function resolveStorage(repoRoot: string, envId: string, profileId: string): string {
  return repoEnv.resolveValidatedStorageAbs(repoRoot, envId, profileId).abs;
}

function readApRequestSnapshotDocNo(repoRoot: string): string {
  try {
    const snapshot = JSON.parse(
      fs.readFileSync(path.join(repoRoot, "ap-request-flow/datasource/live-snapshot.json"), "utf8"),
    );
    const frame =
      snapshot?.list?.childFrames?.find((f: { tbodyRows?: number }) => (f.tbodyRows ?? 0) > 0) ||
      snapshot?.list?.childFrames?.[0] ||
      snapshot?.list;
    const apis = Array.isArray(snapshot.listApis) ? snapshot.listApis : [];
    const rows = apis[0]?.sample || snapshot.sampleRows || [];
    const first = Array.isArray(rows) ? rows[0] : null;
    const fromApi = String(first?.businessCode || first?.documentNumber || "").trim();
    if (fromApi) return fromApi;
    const m = String(frame?.firstRowText || "").match(/[A-Z]{2}\d{6,}/);
    return m?.[0] || "";
  } catch {
    return "";
  }
}

function storageSkipReason(repoRoot: string, envId: string, profileId: string): string {
  return repoEnv.resolveValidatedStorageAbs(repoRoot, envId, profileId).reason || "无有效登录态";
}

function listIgnoredProfiles(repoRoot: string, envId: string, profile?: string) {
  if (profile) return [];
  const all = repoEnv
    .listGoldenProfileIds(repoRoot, envId)
    .filter((id: string) => repoEnv.isGoldenProfileId(id));
  const runnable = new Set(listProfiles(repoRoot, envId));
  return all
    .filter((id: string) => !runnable.has(id))
    .map((id: string) => ({
      profileId: id,
      roleSlug: repoEnv.resolveFlowRoleSlug(repoRoot, envId, id) || "",
      reason: storageSkipReason(repoRoot, envId, id),
    }));
}

function listProfiles(repoRoot: string, envId: string, profile?: string): string[] {
  const ids = profile
    ? [profile]
    : repoEnv.listGoldenProfileIds(repoRoot, envId).filter((id: string) => repoEnv.isGoldenProfileId(id));
  if (profile) return ids;
  return ids.filter((id: string) => {
    const storage = resolveStorage(repoRoot, envId, id);
    if (storage) return true;
    console.warn(`[ap-request-flow:golden] 忽略 ${id}: ${storageSkipReason(repoRoot, envId, id)}`);
    return false;
  });
}

function writeDebugPlaywrightResult(
  repoRoot: string,
  runId: string,
  result: unknown,
): string {
  const runDir = path.join(repoRoot, "results", "flow-runs", FLOW_ID, runId);
  fs.mkdirSync(runDir, { recursive: true });
  const resultPath = path.join(runDir, "playwright-result.json");
  fs.writeFileSync(resultPath, JSON.stringify(result, null, 2), "utf8");
  return path.relative(repoRoot, resultPath).replace(/\\/g, "/");
}

function runOne(repoRoot: string, envId: string, profileId: string, grep: string): RunOneResult {
  const roleSlug = repoEnv.resolveFlowRoleSlug(repoRoot, envId, profileId) || "";
  const storage = resolveStorage(repoRoot, envId, profileId);
  if (!storage) {
    const reason = storageSkipReason(repoRoot, envId, profileId);
    console.warn(`[ap-request-flow:golden] 跳过 ${profileId}: ${reason}`);
    return { ok: false, skipped: true, skippedOnly: true, profileId, roleSlug, exitCode: 2, reason };
  }

  const base = repoEnv.getBaseEnvConfig(repoRoot, envId);
  const creds = repoEnv.resolveAccountCredentials(repoRoot, envId, profileId);
  const profileDefaults = repoEnv.resolveProfileFlowDefaults(repoRoot, envId, profileId);
  const goldenSeed = resolveFlowGoldenSeed(repoRoot, FLOW_ID, envId, roleSlug, ["apRequestDocNo"]);
  const snapshotDocNo = readApRequestSnapshotDocNo(repoRoot);
  const entry = repoEnv.enrichProfileStorageEntry(repoRoot, envId, profileId);

  const startTime = Date.now();
  const startedAt = new Date(startTime).toISOString();
  const runId = startedAt.replace(/[:.]/g, "-");
  const runMarker = makeRunMarker({
    custom: process.env.FLOW_RUN_MARKER,
    roleSlug,
    env: envId,
    spec: SPEC,
    startedAt,
  });

  const spawnEnv: NodeJS.ProcessEnv = { ...process.env };
  spawnEnv.PLAYWRIGHT_ENV = envId;
  spawnEnv.PLAYWRIGHT_ACCOUNT = profileId;
  spawnEnv.BASE_URL = String(base?.baseURL || spawnEnv.BASE_URL || "https://dev.huilianyi.com").trim();
  spawnEnv.STORAGE_STATE = storage;
  spawnEnv.FLOW_SPEC = SPEC;
  spawnEnv.FLOW_RUN_MODE = "headless";
  spawnEnv.FLOW_RUN_ID = runId;
  spawnEnv.FLOW_RUN_STARTED_AT = startedAt;
  spawnEnv.FLOW_RUN_MARKER = runMarker;
  if (grep) spawnEnv.FLOW_GREP = grep;
  else delete spawnEnv.FLOW_GREP;
  const scriptKey = flowScriptKey(FLOW_ID, envId, SPEC, roleSlug);
  writeRunMarkerFile(
    path.join(repoRoot, "screenshots", scriptKey, "run-chromium-flow", runId),
    runMarker,
    { runId, flowId: FLOW_ID, scriptKey, startedAt },
  );
  const docNo = String(
    process.env.AP_REQUEST_DOC_NO ||
      profileDefaults.apRequestDocNo ||
      goldenSeed.apRequestDocNo ||
      snapshotDocNo ||
      "",
  ).trim();
  if (docNo) spawnEnv.AP_REQUEST_DOC_NO = docNo;
  else {
    delete spawnEnv.AP_REQUEST_DOC_NO;
    console.warn(
      `[ap-request-flow:golden] 未配置 apRequestDocNo（AP_REQUEST_DOC_NO / accounts.json / ap-request-flow/datasource/golden-seeds.json），将尝试从对公申请单列表现场读取`,
    );
  }
  if (roleSlug) spawnEnv.FLOW_ACCOUNT_SLUG = roleSlug;
  else delete spawnEnv.FLOW_ACCOUNT_SLUG;
  spawnEnv.PLAYWRIGHT_RETRIES = "0";
  if (creds) {
    spawnEnv.LOGIN_USERNAME = creds.username;
    spawnEnv.LOGIN_PASSWORD = creds.password;
  }

  console.log(
    `[ap-request-flow:golden] 角色 ${entry.roleLabel || profileId} (${profileId}) · env=${envId}${
      grep ? ` · grep=${grep}` : ""
    } · marker=${runMarker}`,
  );

  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  const reporter = process.env.FLOW_DEBUG_FAST === "1" ? "json" : "json,html";
  const pwArgs = [
    "playwright",
    "test",
    "--config",
    CONFIG_REL,
    SPEC,
    `--reporter=${reporter}`,
    "--retries=0",
  ];
  if (grep) pwArgs.push(`--grep=${grep}`);
  const proc = spawnSync(
    npx,
    pwArgs,
    {
      cwd: repoRoot,
      env: spawnEnv,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      stdio: ["inherit", "pipe", "pipe"],
    },
  );

  const stdout = proc.stdout || "";
  const stderr = proc.stderr || "";
  const exitCode = proc.status ?? 1;
  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  const specRelative = path.join(FLOW_ID, "tests", SPEC).replace(/\\/g, "/");

  const execution = parseGoldenExecution(stdout, exitCode);
  const { passed, failed, total, skipped, skips, failures, parsedResult, allSkipped, ok } = execution;
  if (allSkipped) {
    console.warn(`[ap-request-flow:golden] 跳过 ${skipped}/${total} · ${duration}s`);
    for (const item of skips.slice(0, 5)) {
      console.warn(`[ap-request-flow:golden] 跳过 · ${item.title} — ${item.reason}`);
    }
  } else if (ok) {
    const skipHint = skipped > 0 ? `，跳过 ${skipped}` : "";
    console.log(`[ap-request-flow:golden] 通过 ${passed}/${total}${skipHint} · ${duration}s`);
    for (const item of skips.slice(0, 5)) {
      console.warn(`[ap-request-flow:golden] 跳过 · ${item.title} — ${item.reason}`);
    }
  } else {
    console.error(`[ap-request-flow:golden] 失败 ${failed}/${total || 1} · ${duration}s`);
    logConcisePlaywrightFailures("[ap-request-flow:golden] · ", failures, { limit: 3 });
    if (stderr.trim()) {
      const hint = stderr
        .split("\n")
        .map((line) => line.trim())
        .find((line) => line && !line.startsWith("["));
      if (hint) console.error(`[ap-request-flow:golden] · ${hint.slice(0, 160)}`);
    }
  }
  const finalized = finalizeFlowRun(repoRoot, FLOW_ID, FLOW_LABEL, {
    ok,
    exitCode: ok ? 0 : allSkipped ? 2 : exitCode || 1,
    cancelled: false,
    mode: "headless",
    spec: SPEC,
    grep,
    env: envId,
    passed,
    failed,
    total,
    skipped,
    skips,
    duration,
    runId,
    startedAt,
    finishedAt: new Date().toISOString(),
    failures,
    specRelative,
    runMode: "headless",
    playwrightReportRel:
      process.env.FLOW_DEBUG_FAST === "1" && parsedResult
        ? writeDebugPlaywrightResult(repoRoot, runId, parsedResult)
        : undefined,
    playwrightReportDir: "ap-request-flow/playwright-report",
    reportHint: "ap-request-flow/playwright-report/index.html",
    pipeline: "golden",
    accountProfile: profileId,
    roleSlug,
    runMarker,
  });

  return {
    ...finalizeGoldenExecution(execution, finalized),
    profileId,
    roleSlug,
    passed,
    failed,
    total,
    runId,
  };
}

function runNpmScript(script: string, extraArgs: string[] = []): void {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  spawnSync(npm, ["run", script, "--", ...extraArgs], {
    cwd: process.cwd(),
    stdio: "inherit",
    env: process.env,
  });
}

function main(): void {
  const repoRoot = process.cwd();
  const configAbs = path.join(repoRoot, CONFIG_REL);
  if (!fs.existsSync(configAbs)) {
    console.error(`未找到 ${CONFIG_REL}`);
    process.exit(1);
  }

  const { env, profile, grep } = parseArgs(process.argv.slice(2));
  let profiles = listProfiles(repoRoot, env, profile || undefined);
  if (!profiles.length) {
    console.error(`[ap-request-flow:golden] 无已登录 golden* 档案（env=${env}）`);
    writeGoldenBatch(repoRoot, FLOW_ID, {
      flowId: FLOW_ID, env, finishedAt: new Date().toISOString(),
      ...goldenBatchStatus([]), results: [], ignored: listIgnoredProfiles(repoRoot, env),
    });
    process.exit(1);
  }
  if (
    (process.env.FLOW_DEBUG_FAST === "1" || process.env.FLOW_CONFIG_TRY_RUN === "1") &&
    profiles.length > 1
  ) {
    console.log(`[ap-request-flow:golden] debug-fast 仅运行第一个角色: ${profiles[0]}`);
    profiles = [profiles[0]];
  }

  console.log(`[ap-request-flow:golden] 开始 · env=${env} · ${profiles.length} 个角色 · ${SPEC}`);

  const ignored = listIgnoredProfiles(repoRoot, env, profile || undefined);
  const results: RunOneResult[] = [];
  for (const profileId of profiles) {
    const result = runOne(repoRoot, env, profileId, grep);
    results.push(result);
    if (isUnavailable(result)) {
      console.warn(`[ap-request-flow:golden] 环境 503，跳过其余角色`);
      break;
    }
  }

  const batchStatus = goldenBatchStatus(results);
  const batchExitCode = batchStatus.exitCode;
  const batch = {
    flowId: FLOW_ID,
    env,
    finishedAt: new Date().toISOString(),
    ...batchStatus,
    ignored,
    results,
  };
  writeGoldenBatch(repoRoot, FLOW_ID, batch);
  const summary = summarizeGoldenBatch(batch);
  console.log(`[ap-request-flow:golden] ${summary.headline}`);
  for (const line of summary.lines) {
    const logFn = line.startsWith("失败") ? console.error : console.log;
    logFn(`[ap-request-flow:golden]   ${line}`);
  }
  if (summary.skippedOnly) console.warn(`[ap-request-flow:golden]  软跳：${summary.headline}`);

  if (process.env.FLOW_DEBUG_FAST !== "1") {
    runNpmScript("feishu:flow-weekly-doc", [`--flow=${FLOW_ID}`]);
    runNpmScript("feishu:flow-notify", [`--flow=${FLOW_ID}`]);
  }

  if (batch.skippedOnly) {
    console.warn(
      `[ap-request-flow:golden] 无任何用例真正执行（全部 skip），请检查账号登录态与待审批单号`,
    );
  }
  process.exit(batchExitCode);
}

main();
