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
const {
  parsePlaywrightResultJson,
  parsePlaywrightFailures,
  logConcisePlaywrightFailures,
} = require("../../pw-files/lib/failure-report.js");
const { cleanSpecScreenshots } = require("../../src/utils/clean-spec-screenshots.cjs");

const FLOW_ID = "request-flow";
const FLOW_LABEL = "申请单流程";
const CONFIG_REL = "request-flow/playwright.config.ts";
const DEFAULT_SPECS = ["request/travel-submit.spec.ts", "request/full-flow.spec.ts"];

function parseArgs(argv: string[]) {
  let env = process.env.PLAYWRIGHT_ENV?.trim() || "dev";
  let profile = "";
  let cleanRuns = false;
  let resetArtifacts = false;
  const specs: string[] = [];

  for (const arg of argv) {
    if (arg.startsWith("--env=")) env = arg.slice(6).trim();
    else if (arg.startsWith("--profile=")) profile = arg.slice(10).trim();
    else if (arg.startsWith("--spec=")) specs.push(arg.slice(7).trim());
    else if (arg === "--clean-runs") cleanRuns = true;
    else if (arg === "--reset-artifacts") resetArtifacts = true;
  }

  return { env, profile, specs: specs.length ? specs : DEFAULT_SPECS, cleanRuns, resetArtifacts };
}

function resolveStorage(repoRoot: string, envId: string, profileId: string): string {
  const rel = repoEnv.resolveStorageStateRelDirect(repoRoot, envId, profileId);
  if (rel && repoEnv.storageExists(repoRoot, rel)) {
    return path.resolve(repoRoot, rel);
  }
  return "";
}

function pickWriteProfile(repoRoot: string, envId: string, profile?: string): string {
  if (profile) return profile;
  const ids = repoEnv.listWriteProfileIds(repoRoot, envId).filter((id: string) =>
    repoEnv.isWriteProfileId(id),
  );
  for (const id of ids) {
    if (resolveStorage(repoRoot, envId, id)) return id;
  }
  if (resolveStorage(repoRoot, envId, "write")) return "write";
  return "";
}

function main(): void {
  const repoRoot = process.cwd();
  if (!fs.existsSync(path.join(repoRoot, CONFIG_REL))) {
    console.error(`未找到 ${CONFIG_REL}`);
    process.exit(1);
  }

  const { env, profile, specs, cleanRuns, resetArtifacts } = parseArgs(process.argv.slice(2));
  const profileId = pickWriteProfile(repoRoot, env, profile || undefined);
  if (!profileId) {
    console.error(`[request-flow:write] 无已登录 write 档案（env=${env}）`);
    process.exit(1);
  }

  const storageRel = repoEnv.resolveStorageStateRelDirect(repoRoot, env, profileId);
  const storageCheck = repoEnv.validateStorageForRun(repoRoot, storageRel);
  if (!storageCheck.ok) {
    console.error(`[request-flow:write] ${storageCheck.reason}`);
    process.exit(1);
  }

  const storage = resolveStorage(repoRoot, env, profileId);
  const base = repoEnv.getBaseEnvConfig(repoRoot, env);
  const creds = repoEnv.resolveAccountCredentials(repoRoot, env, profileId);
  const roleSlug = repoEnv.resolveFlowRoleSlug(repoRoot, env, profileId);
  const entry = repoEnv.enrichProfileStorageEntry(repoRoot, env, profileId);

  const startTime = Date.now();
  const startedAt = new Date(startTime).toISOString();
  const runId = startedAt.replace(/[:.]/g, "-");
  const specArg = specs.join(" ");

  const spawnEnv: NodeJS.ProcessEnv = { ...process.env };
  spawnEnv.PLAYWRIGHT_ENV = env;
  spawnEnv.PLAYWRIGHT_ACCOUNT = profileId;
  spawnEnv.BASE_URL = String(base?.baseURL || spawnEnv.BASE_URL || "https://dev.huilianyi.com").trim();
  spawnEnv.STORAGE_STATE = storage;
  spawnEnv.REQUEST_ENABLE_WRITE = "1";
  spawnEnv.FLOW_SPEC = specs[0] || DEFAULT_SPECS[0]!;
  spawnEnv.FLOW_RUN_MODE = "headless";
  spawnEnv.FLOW_RUN_ID = runId;
  spawnEnv.FLOW_RUN_STARTED_AT = startedAt;
  if (roleSlug) spawnEnv.FLOW_ACCOUNT_SLUG = roleSlug;
  else delete spawnEnv.FLOW_ACCOUNT_SLUG;
  spawnEnv.PLAYWRIGHT_RETRIES = "0";
  if (creds) {
    spawnEnv.LOGIN_USERNAME = creds.username;
    spawnEnv.LOGIN_PASSWORD = creds.password;
  }

  console.log(
    `[request-flow:write] 角色 ${entry.roleLabel || profileId} (${profileId}) · env=${env} · ${specs.length} 个 spec`,
  );

  if (resetArtifacts) {
    const npx = process.platform === "win32" ? "npx.cmd" : "npx";
    spawnSync(npx, ["tsx", "scripts/flow/reset-flow-artifacts.ts", `--flow=${FLOW_ID}`], {
      cwd: repoRoot,
      stdio: "inherit",
      env: process.env,
    });
  }

  if (cleanRuns) {
    for (const spec of specs) {
      const specRel = path.join(FLOW_ID, "tests", spec).replace(/\\/g, "/");
      const r = cleanSpecScreenshots(repoRoot, specRel, { mode: "latest", cleanDiffs: true });
      if (r.removed?.length) {
        console.log(`[request-flow:write] 清理 ${specRel} · ${r.removed.length} 项`);
      }
    }
  }

  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  const proc = spawnSync(
    npx,
    ["playwright", "test", "--config", CONFIG_REL, ...specs, "--reporter=json,html", "--retries=0", "--workers=1"],
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
  const specRelative = path.join(FLOW_ID, "tests", specs[0] || DEFAULT_SPECS[0]!).replace(/\\/g, "/");

  let passed = 0;
  let failed = 0;
  let total = 0;
  let failures: Array<{ title?: string; message?: string }> = [];

  try {
    const result = parsePlaywrightResultJson(stdout);
    const s = result.stats || {};
    const expected = Number(s.expected) || 0;
    const unexpected = Number(s.unexpected) || 0;
    const skipped = Number(s.skipped) || 0;
    const flaky = Number(s.flaky) || 0;
    passed = expected + flaky;
    failed = unexpected;
    total = expected + unexpected + skipped + flaky;
    failures = parsePlaywrightFailures(result, null, exitCode).map((item) => ({
      title: item.title,
      message: item.message,
    }));
  } catch {
    passed = exitCode === 0 ? 1 : 0;
    failed = exitCode === 0 ? 0 : 1;
    total = 1;
  }

  const ok = exitCode === 0 && failed === 0;
  if (ok) {
    console.log(`[request-flow:write] 通过 ${passed}/${total} · ${duration}s`);
  } else {
    console.error(`[request-flow:write] 失败 ${failed}/${total || 1} · ${duration}s · ${specArg}`);
    logConcisePlaywrightFailures("[request-flow:write] · ", failures, { limit: 3 });
    if (stderr.trim()) {
      const hint = stderr
        .split("\n")
        .map((line) => line.trim())
        .find((line) => line && !line.startsWith("["));
      if (hint) console.error(`[request-flow:write] · ${hint.slice(0, 160)}`);
    }
  }

  finalizeFlowRun(repoRoot, FLOW_ID, FLOW_LABEL, {
    ok,
    exitCode,
    cancelled: false,
    mode: "headless",
    spec: specArg,
    grep: "",
    env,
    passed,
    failed,
    total,
    duration,
    runId,
    startedAt,
    finishedAt: new Date().toISOString(),
    failures,
    specRelative,
    runMode: "headless",
    playwrightReportDir: "request-flow/playwright-report",
    reportHint: "request-flow/playwright-report/index.html",
    pipeline: "default",
    accountProfile: profileId,
    roleSlug,
    runUiAudit: process.env.FLOW_UI_AUDIT_GATE === '1',
    uiAuditGate: process.env.FLOW_UI_AUDIT_GATE === '1',
  });

  process.exit(ok ? 0 : 1);
}

main();
