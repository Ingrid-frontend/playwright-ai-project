#!/usr/bin/env tsx
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import dotenv from "dotenv";
import { listKnownEnvs } from "../../src/utils/test-env-path.js";

dotenv.config({ path: path.join(process.cwd(), ".env") });

const require = createRequire(import.meta.url);
const repoEnv = require("../../pw-files/repo-env.js");
const { finalizeFlowRun, flowScriptKey } = require("../../pw-files/lib/flow-run-common.js");
const { makeRunMarker, writeRunMarkerFile } = require("../../pw-files/lib/flow-run-marker.js");
const { resolveGoldenSeed } = require("../../pw-files/lib/golden-seed.js");
const {
  parsePlaywrightResultJson,
  parsePlaywrightFailures,
  parsePlaywrightSkips,
  logConcisePlaywrightFailures,
} = require("../../pw-files/lib/failure-report.js");

const FLOW_ID = "request-flow";
const FLOW_LABEL = "申请单流程";
const CONFIG_REL = "request-flow/playwright.config.ts";
const SPEC = "request/golden-regression.spec.ts";

type RunOneResult = {
  ok: boolean;
  skipped?: boolean;
  profileId: string;
  exitCode: number;
};

function parseArgs(argv: string[]) {
  let env = process.env.PLAYWRIGHT_ENV?.trim() || "dev";
  let profile = "";
  let filterKeyword = process.env.REQUEST_FILTER_KEYWORD?.trim() || "测试";
  let allEnvs = false;
  let grep = "";

  for (const arg of argv) {
    if (arg.startsWith("--env=")) env = arg.slice(6).trim();
    else if (arg.startsWith("--profile=")) profile = arg.slice(10).trim();
    else if (arg.startsWith("--filter-keyword=")) filterKeyword = arg.slice(17).trim();
    else if (arg.startsWith("--grep=")) grep = arg.slice(7).trim();
    else if (arg === "--all-envs") allEnvs = true;
  }

  return { env, profile, filterKeyword, allEnvs, grep };
}

function resolveStorage(repoRoot: string, envId: string, profileId: string): string {
  const rel = repoEnv.resolveStorageStateRelDirect(repoRoot, envId, profileId);
  if (rel && repoEnv.storageExists(repoRoot, rel)) {
    return path.resolve(repoRoot, rel);
  }
  return "";
}

function listProfiles(repoRoot: string, envId: string, profile?: string): string[] {
  const ids = profile
    ? [profile]
    : repoEnv.listGoldenProfileIds(repoRoot, envId).filter((id: string) => repoEnv.isGoldenProfileId(id));
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

function runOne(
  repoRoot: string,
  envId: string,
  profileId: string,
  filterKeyword: string,
  grep: string,
): RunOneResult {
  const storage = resolveStorage(repoRoot, envId, profileId);
  if (!storage) {
    console.error(`[request-flow:golden] 跳过 ${profileId}: 无登录态`);
    return { ok: false, skipped: true, profileId, exitCode: 0 };
  }

  const base = repoEnv.getBaseEnvConfig(repoRoot, envId);
  const creds = repoEnv.resolveAccountCredentials(repoRoot, envId, profileId);
  const profileDefaults = repoEnv.resolveProfileFlowDefaults(repoRoot, envId, profileId);
  const roleSlug = repoEnv.resolveFlowRoleSlug(repoRoot, envId, profileId);
  const goldenSeed = resolveGoldenSeed(repoRoot, envId, roleSlug);
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
  spawnEnv.REQUEST_FILTER_KEYWORD = filterKeyword || profileDefaults.requestFilterKeyword || goldenSeed.requestFilterKeyword || "测试";
  const docNo = String(process.env.REQUEST_DOC_NO || profileDefaults.requestDocNo || goldenSeed.requestDocNo || "").trim();
  if (docNo) spawnEnv.REQUEST_DOC_NO = docNo;
  else delete spawnEnv.REQUEST_DOC_NO;
  if (roleSlug) spawnEnv.FLOW_ACCOUNT_SLUG = roleSlug;
  else delete spawnEnv.FLOW_ACCOUNT_SLUG;
  spawnEnv.PLAYWRIGHT_RETRIES = "0";
  if (creds) {
    spawnEnv.LOGIN_USERNAME = creds.username;
    spawnEnv.LOGIN_PASSWORD = creds.password;
  }

  console.log(
    `[request-flow:golden] 角色 ${entry.roleLabel || profileId} (${profileId}) · env=${envId} · filter=${filterKeyword}${
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

  let passed = 0;
  let failed = 0;
  let total = 0;
  let skipped = 0;
  let skips: Array<{ title?: string; reason?: string }> = [];
  let failures: Array<{ title?: string; message?: string }> = [];
  let parsedResult: unknown | null = null;

  try {
    const result = parsePlaywrightResultJson(stdout);
    parsedResult = result;
    const s = result.stats || {};
    const expected = Number(s.expected) || 0;
    const unexpected = Number(s.unexpected) || 0;
    skipped = Number(s.skipped) || 0;
    const flaky = Number(s.flaky) || 0;
    passed = expected + flaky;
    failed = unexpected;
    total = expected + unexpected + skipped + flaky;
    skips = parsePlaywrightSkips(result);
    failures = parsePlaywrightFailures(result, null, exitCode).map((item: { title?: string; message?: string }) => ({
      title: item.title,
      message: item.message,
    }));
  } catch {
    passed = exitCode === 0 ? 1 : 0;
    failed = exitCode === 0 ? 0 : 1;
    total = 1;
  }

  const ok = exitCode === 0 && failed === 0 && (total <= 0 || passed === total);
  if (ok) {
    const skipHint = skipped > 0 ? `，跳过 ${skipped}` : "";
    console.log(`[request-flow:golden] 通过 ${passed}/${total}${skipHint} · ${duration}s`);
    for (const item of skips.slice(0, 5)) {
      console.warn(`[request-flow:golden] 跳过 · ${item.title} — ${item.reason}`);
    }
  } else {
    console.error(`[request-flow:golden] 失败 ${failed}/${total || 1} · ${duration}s`);
    logConcisePlaywrightFailures("[request-flow:golden] · ", failures, { limit: 3 });
    if (stderr.trim()) {
      const hint = stderr
        .split("\n")
        .map((line) => line.trim())
        .find((line) => line && !line.startsWith("["));
      if (hint) console.error(`[request-flow:golden] · ${hint.slice(0, 160)}`);
    }
  }
  const finalized = finalizeFlowRun(repoRoot, FLOW_ID, FLOW_LABEL, {
    ok,
    exitCode,
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
    playwrightReportDir: "request-flow/playwright-report",
    reportHint: "request-flow/playwright-report/index.html",
    pipeline: "golden",
    accountProfile: profileId,
    roleSlug,
    runMarker,
  });

  return { ok: Boolean(finalized.ok), profileId, exitCode: finalized.ok ? exitCode : exitCode || 1 };
}

function runNpmScript(script: string, extraArgs: string[] = []): void {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  spawnSync(npm, ["run", script, "--", ...extraArgs], {
    cwd: process.cwd(),
    stdio: "inherit",
    env: process.env,
  });
}

function runEnv(
  repoRoot: string,
  envId: string,
  profile: string,
  filterKeyword: string,
  grep: string,
): { ok: boolean; ran: boolean } {
  let profiles = listProfiles(repoRoot, envId, profile || undefined);
  if (!profiles.length) {
    console.warn(`[request-flow:golden] 跳过 env=${envId}: 无已登录 golden* 档案`);
    return { ok: true, ran: false };
  }
  if (process.env.FLOW_DEBUG_FAST === "1" && profiles.length > 1) {
    console.log(`[request-flow:golden] debug-fast 仅运行第一个角色: ${profiles[0]}`);
    profiles = [profiles[0]];
  }

  console.log(`[request-flow:golden] 开始 · env=${envId} · ${profiles.length} 个角色 · ${SPEC}`);

  let ok = true;
  for (const profileId of profiles) {
    const result = runOne(repoRoot, envId, profileId, filterKeyword, grep);
    if (!result.ok && !result.skipped) ok = false;
  }
  return { ok, ran: true };
}

function main(): void {
  const repoRoot = process.cwd();
  const configAbs = path.join(repoRoot, CONFIG_REL);
  if (!fs.existsSync(configAbs)) {
    console.error(`未找到 ${CONFIG_REL}`);
    process.exit(1);
  }

  const { env, profile, filterKeyword, allEnvs, grep } = parseArgs(process.argv.slice(2));
  const envs = allEnvs ? listKnownEnvs(repoRoot) : [env];

  let allOk = true;
  let ranAny = false;
  for (const envId of envs) {
    const result = runEnv(repoRoot, envId, profile, filterKeyword, grep);
    if (result.ran) ranAny = true;
    if (!result.ok) allOk = false;
  }

  if (!ranAny) {
    console.error(`[request-flow:golden] 无已登录 golden* 档案（env=${allEnvs ? "all" : env}）`);
    process.exit(1);
  }

  if (process.env.FLOW_DEBUG_FAST !== "1") {
    runNpmScript("feishu:flow-weekly-doc", [`--flow=${FLOW_ID}`]);
    runNpmScript("feishu:flow-notify", [`--flow=${FLOW_ID}`]);
  }

  process.exit(allOk ? 0 : 1);
}

main();
