#!/usr/bin/env tsx
/**
 * write runner 共享实现（原 run-{request,approval,expense}-flow-write.ts 三份复制的收敛版）。
 *
 * 保留原文件名入口作为薄封装：flow-registry.goldenRunner/writeRunner、CI workflow、
 * npm scripts、new-flow 模板派生都依赖既有路径，文件名是对外契约，不要改。
 *
 * 合并策略 = 各流程行为超集，差异通过 config 显式声明：
 *   - enableWriteEnv：各流程自己的写开关变量（REQUEST_/APPROVAL_/EXPENSE_ENABLE_WRITE）
 *   - pipeline：approval 原实现显式传 "default"，其余流程沿用 finalizeFlowRun 的自动探测
 *   - runUiAudit/uiAuditGate：沿用 request/expense 的 FLOW_UI_AUDIT_GATE 环境变量门控，
 *     对 approval 是纯增益（环境变量未设置时行为与合并前完全一致）
 */
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import dotenv from "dotenv";
import { cleanSpecScreenshots } from "../../src/utils/clean-spec-screenshots.js";

dotenv.config({ path: path.join(process.cwd(), ".env") });

const require = createRequire(import.meta.url);
const repoEnv = require("../../pw-files/repo-env.js");
const { finalizeFlowRun } = require("../../pw-files/lib/flow-run-common.js");
const {
  parsePlaywrightResultJson,
  parsePlaywrightFailures,
  logConcisePlaywrightFailures,
} = require("../../pw-files/lib/failure-report.js");

export type FlowWriteConfig = {
  /** 流程目录名，如 request-flow */
  flowId: string;
  /** 中文标签，写入 flow-run 元数据 */
  label: string;
  /** 相对仓库根的 playwright config */
  configRel: string;
  /** 未传 --spec 时的默认用例（相对 <flowId>/tests/） */
  defaultSpecs: string[];
  /** 写开关环境变量名，如 REQUEST_ENABLE_WRITE */
  enableWriteEnv: string;
  /** 显式 pipeline（approval 传 "default"）；缺省走 finalizeFlowRun 自动探测 */
  pipeline?: string;
};

function parseArgs(argv: string[], defaultSpecs: string[]) {
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

  return { env, profile, specs: specs.length ? specs : defaultSpecs, cleanRuns, resetArtifacts };
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

export function runFlowWriteMain(cfg: FlowWriteConfig, argv = process.argv.slice(2)): void {
  const FLOW_ID = cfg.flowId;
  const FLOW_LABEL = cfg.label;
  const CONFIG_REL = cfg.configRel;
  const DEFAULT_SPECS = cfg.defaultSpecs;
  const LOG = `[${FLOW_ID}:write]`;

  const repoRoot = process.cwd();
  if (!fs.existsSync(path.join(repoRoot, CONFIG_REL))) {
    console.error(`未找到 ${CONFIG_REL}`);
    process.exit(1);
  }

  const { env, profile, specs, cleanRuns, resetArtifacts } = parseArgs(argv, DEFAULT_SPECS);
  const profileId = pickWriteProfile(repoRoot, env, profile || undefined);
  if (!profileId) {
    console.error(`${LOG} 无已登录 write 档案（env=${env}）`);
    process.exit(1);
  }

  const storageRel = repoEnv.resolveStorageStateRelDirect(repoRoot, env, profileId);
  const storageCheck = repoEnv.validateStorageForRun(repoRoot, storageRel);
  if (!storageCheck.ok) {
    console.error(`${LOG} ${storageCheck.reason}`);
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
  spawnEnv[cfg.enableWriteEnv] = "1";
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

  console.log(`${LOG} 角色 ${entry.roleLabel || profileId} (${profileId}) · env=${env} · ${specs.length} 个 spec`);

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
        console.log(`${LOG} 清理 ${specRel} · ${r.removed.length} 项`);
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
    failures = parsePlaywrightFailures(result, null, exitCode).map(
      (item: { title?: string; message?: string }) => ({
        title: item.title,
        message: item.message,
      }),
    );
  } catch {
    passed = exitCode === 0 ? 1 : 0;
    failed = exitCode === 0 ? 0 : 1;
    total = 1;
  }

  const ok = exitCode === 0 && failed === 0;
  if (ok) {
    console.log(`${LOG} 通过 ${passed}/${total} · ${duration}s`);
  } else {
    console.error(`${LOG} 失败 ${failed}/${total || 1} · ${duration}s · ${specArg}`);
    logConcisePlaywrightFailures(`${LOG} · `, failures, { limit: 3 });
    if (stderr.trim()) {
      const hint = stderr
        .split("\n")
        .map((line) => line.trim())
        .find((line) => line && !line.startsWith("["));
      if (hint) console.error(`${LOG} · ${hint.slice(0, 160)}`);
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
    playwrightReportDir: `${FLOW_ID}/playwright-report`,
    reportHint: `${FLOW_ID}/playwright-report/index.html`,
    ...(cfg.pipeline ? { pipeline: cfg.pipeline } : {}),
    accountProfile: profileId,
    roleSlug,
    runUiAudit: process.env.FLOW_UI_AUDIT_GATE === '1',
    uiAuditGate: process.env.FLOW_UI_AUDIT_GATE === '1',
  });

  process.exit(ok ? 0 : 1);
}
