#!/usr/bin/env tsx
/**
 * 报销流程 golden runner（由 npm run flow:new 生成）。
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
const { parseGoldenExecution, finalizeGoldenExecution, goldenBatchStatus, writeGoldenBatch } = require("../../pw-files/lib/golden-batch.js");

const FLOW_ID = "expense-flow";
const FLOW_LABEL = "报销流程";
const CONFIG_REL = "expense-flow/playwright.config.ts";
const SPEC = "expense/golden-regression.spec.ts";

type RunOneResult = {
  ok: boolean;
  skipped?: boolean;
  skippedOnly?: boolean;
  profileId: string;
  roleSlug?: string;
  exitCode: number;
  passed?: number;
  failed?: number;
  total?: number;
  runId?: string;
  reason?: string;
  error?: string;
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

function listProfiles(repoRoot: string, envId: string, profile?: string): string[] {
  const ids = profile
    ? [profile]
    : repoEnv.listGoldenProfileIds(repoRoot, envId).filter((id: string) => repoEnv.isGoldenProfileId(id));
  if (profile) return ids;
  return ids.filter((id: string) => resolveStorage(repoRoot, envId, id));
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
  const storage = resolveStorage(repoRoot, envId, profileId);
  if (!storage) {
    const reason = repoEnv.resolveValidatedStorageAbs(repoRoot, envId, profileId).reason || "无有效登录态";
    console.error(`[expense-flow:golden] 跳过 ${profileId}: ${reason}`);
    return { ok: false, skipped: true, skippedOnly: true, profileId, exitCode: 2, reason };
  }

  const base = repoEnv.getBaseEnvConfig(repoRoot, envId);
  const creds = repoEnv.resolveAccountCredentials(repoRoot, envId, profileId);
  const profileDefaults = repoEnv.resolveProfileFlowDefaults(repoRoot, envId, profileId);
  const roleSlug = repoEnv.resolveFlowRoleSlug(repoRoot, envId, profileId);
  const goldenSeed = resolveFlowGoldenSeed(repoRoot, FLOW_ID, envId, roleSlug, ["expenseDocNo"]);
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
  const docNo = String(process.env.EXPENSE_DOC_NO || profileDefaults.expenseDocNo || goldenSeed.expenseDocNo || "").trim();
  if (docNo) spawnEnv.EXPENSE_DOC_NO = docNo;
  else delete spawnEnv.EXPENSE_DOC_NO;
  if (roleSlug) spawnEnv.FLOW_ACCOUNT_SLUG = roleSlug;
  else delete spawnEnv.FLOW_ACCOUNT_SLUG;
  spawnEnv.PLAYWRIGHT_RETRIES = "0";
  if (creds) {
    spawnEnv.LOGIN_USERNAME = creds.username;
    spawnEnv.LOGIN_PASSWORD = creds.password;
  }

  console.log(
    `[expense-flow:golden] 角色 ${entry.roleLabel || profileId} (${profileId}) · env=${envId}${
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
  const { passed, failed, total, skipped, skips, failures, parsedResult, allSkipped } = execution;
  // 报销 Golden 保持全用例通过的要求，部分跳过也不放宽。
  execution.ok = execution.ok && passed === total;
  const ok = execution.ok;
  if (ok) {
    const skipHint = skipped > 0 ? `，跳过 ${skipped}` : "";
    console.log(`[expense-flow:golden] 通过 ${passed}/${total}${skipHint} · ${duration}s`);
    for (const item of skips.slice(0, 5)) {
      console.warn(`[expense-flow:golden] 跳过 · ${item.title} — ${item.reason}`);
    }
  } else {
    console.error(`[expense-flow:golden] 失败 ${failed}/${total || 1} · ${duration}s`);
    logConcisePlaywrightFailures("[expense-flow:golden] · ", failures, { limit: 3 });
    if (stderr.trim()) {
      const hint = stderr
        .split("\n")
        .map((line) => line.trim())
        .find((line) => line && !line.startsWith("["));
      if (hint) console.error(`[expense-flow:golden] · ${hint.slice(0, 160)}`);
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
    playwrightReportDir: "expense-flow/playwright-report",
    reportHint: "expense-flow/playwright-report/index.html",
    pipeline: "golden",
    accountProfile: profileId,
    roleSlug,
    runMarker,
  });

  return { ...finalizeGoldenExecution(execution, finalized), profileId, roleSlug, passed, failed, total, runId };
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
    console.error(`[expense-flow:golden] 无已登录 golden* 档案（env=${env}）`);
    writeGoldenBatch(repoRoot, FLOW_ID, {
      flowId: FLOW_ID, env, finishedAt: new Date().toISOString(), ...goldenBatchStatus([]), results: [],
    });
    process.exit(1);
  }
  if (
    (process.env.FLOW_DEBUG_FAST === "1" || process.env.FLOW_CONFIG_TRY_RUN === "1") &&
    profiles.length > 1
  ) {
    console.log(`[expense-flow:golden] debug-fast 仅运行第一个角色: ${profiles[0]}`);
    profiles = [profiles[0]];
  }

  console.log(`[expense-flow:golden] 开始 · env=${env} · ${profiles.length} 个角色 · ${SPEC}`);

  const results: RunOneResult[] = [];
  for (const profileId of profiles) {
    results.push(runOne(repoRoot, env, profileId, grep));
  }
  const batchStatus = goldenBatchStatus(results);
  writeGoldenBatch(repoRoot, FLOW_ID, {
    flowId: FLOW_ID, env, finishedAt: new Date().toISOString(), ...batchStatus, results,
  });

  if (process.env.FLOW_DEBUG_FAST !== "1") {
    runNpmScript("feishu:flow-weekly-doc", [`--flow=${FLOW_ID}`]);
    runNpmScript("feishu:flow-notify", [`--flow=${FLOW_ID}`]);
  }

  process.exit(batchStatus.exitCode);
}

main();
