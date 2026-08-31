#!/usr/bin/env tsx
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import dotenv from "dotenv";

dotenv.config({ path: path.join(process.cwd(), ".env") });

const require = createRequire(import.meta.url);
const repoEnv = require("../../pw-files/repo-env.js");
const { finalizeFlowRun } = require("../../pw-files/lib/flow-run-common.js");
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

  for (const arg of argv) {
    if (arg.startsWith("--env=")) env = arg.slice(6).trim();
    else if (arg.startsWith("--profile=")) profile = arg.slice(10).trim();
    else if (arg.startsWith("--filter-keyword=")) filterKeyword = arg.slice(17).trim();
  }

  return { env, profile, filterKeyword };
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

function runOne(
  repoRoot: string,
  envId: string,
  profileId: string,
  filterKeyword: string,
): RunOneResult {
  const storage = resolveStorage(repoRoot, envId, profileId);
  if (!storage) {
    console.error(`[request-flow:golden] 跳过 ${profileId}: 无登录态`);
    return { ok: false, skipped: true, profileId, exitCode: 0 };
  }

  const base = repoEnv.getBaseEnvConfig(repoRoot, envId);
  const creds = repoEnv.resolveAccountCredentials(repoRoot, envId, profileId);
  const profileDefaults = repoEnv.resolveProfileFlowDefaults(repoRoot, envId, profileId);
  const goldenSeed = resolveGoldenSeed(repoRoot, envId, roleSlug);
  const roleSlug = repoEnv.resolveFlowRoleSlug(repoRoot, envId, profileId);
  const entry = repoEnv.enrichProfileStorageEntry(repoRoot, envId, profileId);

  const startTime = Date.now();
  const startedAt = new Date(startTime).toISOString();
  const runId = startedAt.replace(/[:.]/g, "-");

  const spawnEnv: NodeJS.ProcessEnv = { ...process.env };
  spawnEnv.PLAYWRIGHT_ENV = envId;
  spawnEnv.PLAYWRIGHT_ACCOUNT = profileId;
  spawnEnv.BASE_URL = String(base?.baseURL || spawnEnv.BASE_URL || "https://dev.huilianyi.com").trim();
  spawnEnv.STORAGE_STATE = storage;
  spawnEnv.FLOW_SPEC = SPEC;
  spawnEnv.FLOW_RUN_MODE = "headless";
  spawnEnv.FLOW_RUN_ID = runId;
  spawnEnv.FLOW_RUN_STARTED_AT = startedAt;
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
    `[request-flow:golden] 角色 ${entry.roleLabel || profileId} (${profileId}) · env=${envId} · filter=${filterKeyword}`,
  );

  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  const proc = spawnSync(
    npx,
    ["playwright", "test", "--config", CONFIG_REL, SPEC, "--reporter=json,html", "--retries=0"],
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

  try {
    const result = parsePlaywrightResultJson(stdout);
    const s = result.stats || {};
    const expected = Number(s.expected) || 0;
    const unexpected = Number(s.unexpected) || 0;
    skipped = Number(s.skipped) || 0;
    const flaky = Number(s.flaky) || 0;
    passed = expected + flaky;
    failed = unexpected;
    total = expected + unexpected + skipped + flaky;
    skips = parsePlaywrightSkips(result);
    failures = parsePlaywrightFailures(result, null, exitCode).map((item) => ({
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
    grep: "",
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
    playwrightReportDir: "request-flow/playwright-report",
    reportHint: "request-flow/playwright-report/index.html",
    pipeline: "golden",
    accountProfile: profileId,
    roleSlug,
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

function main(): void {
  const repoRoot = process.cwd();
  const configAbs = path.join(repoRoot, CONFIG_REL);
  if (!fs.existsSync(configAbs)) {
    console.error(`未找到 ${CONFIG_REL}`);
    process.exit(1);
  }

  const { env, profile, filterKeyword } = parseArgs(process.argv.slice(2));
  const profiles = listProfiles(repoRoot, env, profile || undefined);
  if (!profiles.length) {
    console.error(`[request-flow:golden] 无已登录 golden* 档案（env=${env}）`);
    process.exit(1);
  }

  console.log(`[request-flow:golden] 开始 · env=${env} · ${profiles.length} 个角色 · ${SPEC}`);

  let allOk = true;
  for (const profileId of profiles) {
    const result = runOne(repoRoot, env, profileId, filterKeyword);
    if (!result.ok && !result.skipped) allOk = false;
  }

  runNpmScript("feishu:flow-weekly-doc", [`--flow=${FLOW_ID}`]);
  runNpmScript("feishu:flow-notify", [`--flow=${FLOW_ID}`]);

  process.exit(allOk ? 0 : 1);
}

main();
