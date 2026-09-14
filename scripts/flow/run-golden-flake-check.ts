#!/usr/bin/env tsx
/**
 * golden 稳定性验收：同一 golden runner 连跑 N 轮，统计 flake 率。
 *
 * 验收判据（Phase 1 事件驱动等待改造的最终标准）：默认轮数内 0 flake 才算通过。
 * 默认 FLOW_DEBUG_FAST=1（首轮色/JSON 报告器/跳过飞书与对比报告），保证轮次节奏；
 * 需要全角色全报告的正式验收加 --full。
 *
 * 用法:
 *   npm run flow:flake-check -- --flow=request-flow --runs=10
 *   npm run flow:flake-check -- --flow=approval-flow --runs=10 --env=dev --profile=golden1
 *   npm run flow:flake-check -- --flow=request-flow --runs=10 --full --stop-on-fail
 */
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import dotenv from "dotenv";
import { getFlow, listFlowIds } from "./flow-registry.js";

dotenv.config({ path: path.join(process.cwd(), ".env") });

const require = createRequire(import.meta.url);
const { readGoldenBatch } = require("../../pw-files/lib/golden-batch.js");

type RoundRow = {
  run: number;
  ok: boolean;
  exitCode: number;
  durationSec: number;
  /** 本轮失败的角色（排除 skip） */
  failedProfiles: string[];
  /** 本轮跳过的角色及原因（数据型跳过不算 flake） */
  skippedProfiles: string[];
};

function printHelpAndExit(): never {
  console.log(
    [
      "用法: npm run flow:flake-check -- --flow=<id> [options]",
      "",
      "选项:",
      "  --flow=<id>        流程 id（默认 request-flow，可选 approval-flow 等）",
      "  --runs=<n>         循环轮数（默认 10，验收判据 0 flake）",
      "  --env=<env>        环境（默认 dev，可用 uat/stage）",
      "  --profile=<id>     只跑指定角色档案",
      "  --stop-on-fail     首轮失败即终止",
      "  --full             全量验收（默认 fast：跳过飞书/对比报告）",
      "  -h, --help         显示本帮助",
    ].join("\n"),
  );
  process.exit(0);
}

function parseArgs(argv: string[]) {
  let flowId = process.env.FLOW_FLAKE_FLOW?.trim() || "request-flow";
  let runs = 10;
  let env = process.env.PLAYWRIGHT_ENV?.trim() || "dev";
  let profile = "";
  let stopOnFail = false;
  let full = false;

  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") printHelpAndExit();
    else if (arg.startsWith("--flow=")) flowId = arg.slice(7).trim();
    else if (arg.startsWith("--runs=")) {
      const n = Number(arg.slice(7));
      if (!Number.isInteger(n) || n < 1) {
        console.error(`[flake-check] --runs 必须为 >=1 的整数，收到: "${arg.slice(7)}"`);
        process.exit(1);
      }
      runs = n;
    } else if (arg.startsWith("--env=")) env = arg.slice(6).trim();
    else if (arg.startsWith("--profile=")) profile = arg.slice(10).trim();
    else if (arg === "--stop-on-fail") stopOnFail = true;
    else if (arg === "--full") full = true;
  }

  return { flowId, runs, env, profile, stopOnFail, full };
}

function readBatchProfiles(repoRoot: string, flowId: string): {
  failedProfiles: string[];
  skippedProfiles: string[];
} {
  const batch = readGoldenBatch(repoRoot, flowId);
  const results = (batch?.results || []) as Array<{
    profileId: string;
    ok?: boolean;
    skipped?: boolean;
    reason?: string;
  }>;
  return {
    failedProfiles: results.filter((r) => !r.ok && !r.skipped).map((r) => r.profileId),
    skippedProfiles: results
      .filter((r) => r.skipped)
      .map((r) => `${r.profileId}${r.reason ? `(${r.reason})` : ""}`),
  };
}

function main(): void {
  const repoRoot = process.cwd();
  const { flowId, runs, env, profile, stopOnFail, full } = parseArgs(process.argv.slice(2));

  const flow = getFlow(flowId);
  if (!flow || !flow.goldenRunner) {
    console.error(
      `[flake-check] 未知流程或未接入 golden runner: ${flowId}。已注册: ${listFlowIds().join(" / ")}`,
    );
    process.exit(1);
  }
  const runnerAbs = path.join(repoRoot, "scripts/flow", flow.goldenRunner);
  if (!fs.existsSync(runnerAbs)) {
    console.error(`[flake-check] runner 不存在: ${runnerAbs}`);
    process.exit(1);
  }

  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  const rows: RoundRow[] = [];
  const startedAt = new Date().toISOString();

  console.log(
    `[flake-check] ${flow.label} golden 稳定性验收 · env=${env} · ${runs} 轮 · 模式=${full ? "full" : "fast"}`,
  );

  for (let i = 1; i <= runs; i += 1) {
    const args = ["tsx", `scripts/flow/${flow.goldenRunner}`, `--env=${env}`];
    if (profile) args.push(`--profile=${profile}`);

    const spawnEnv: NodeJS.ProcessEnv = { ...process.env };
    if (!full) spawnEnv.FLOW_DEBUG_FAST = "1";
    else delete spawnEnv.FLOW_DEBUG_FAST;

    const t0 = Date.now();
    const proc = spawnSync(npx, args, {
      cwd: repoRoot,
      stdio: "inherit",
      env: spawnEnv,
    });
    const durationSec = Math.round((Date.now() - t0) / 1000);
    const exitCode = proc.status ?? 1;
    const { failedProfiles, skippedProfiles } = readBatchProfiles(repoRoot, flowId);
    const ok = exitCode === 0;
    rows.push({ run: i, ok, exitCode, durationSec, failedProfiles, skippedProfiles });

    const skipHint = skippedProfiles.length ? ` · 跳过 ${skippedProfiles.length}` : "";
    console.log(
      `[flake-check] 第 ${i}/${runs} 轮 · ${ok ? "通过" : `失败（${failedProfiles.join(", ") || exitCode}）`} · ${durationSec}s${skipHint}`,
    );

    if (!ok && stopOnFail) break;
  }

  const passedRounds = rows.filter((r) => r.ok).length;
  const failedRounds = rows.length - passedRounds;
  const flakeRate = rows.length ? failedRounds / rows.length : 1;
  const report = {
    gate: `${flowId}-golden`,
    flowId,
    env,
    profile: profile || "all-golden-profiles",
    mode: full ? "full" : "fast",
    runs,
    executedRounds: rows.length,
    passedRounds,
    failedRounds,
    flakeRate: Number(flakeRate.toFixed(4)),
    verdict: failedRounds === 0 ? "pass（0 flake）" : "fail（存在 flake）",
    startedAt,
    finishedAt: new Date().toISOString(),
    rows,
  };

  const outDir = path.join(repoRoot, "results", "flake-check");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `${flowId}-golden-${startedAt.replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(outFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  if (failedRounds === 0) {
    console.log(
      `[flake-check] ✅ 验收通过: ${rows.length}/${runs} 轮 0 flake · ${path.relative(repoRoot, outFile)}`,
    );
    process.exit(0);
  }
  console.error(
    `[flake-check] ❌ 验收未通过: ${passedRounds}/${rows.length} 轮通过 · flake 率 ${(flakeRate * 100).toFixed(1)}% · ${path.relative(repoRoot, outFile)}`,
  );
  process.exit(1);
}

main();
