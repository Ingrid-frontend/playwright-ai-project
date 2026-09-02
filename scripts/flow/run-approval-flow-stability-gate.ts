#!/usr/bin/env tsx
/**
 * approval-flow write 稳定性 gate：连跑 N 次，任一轮失败则 exit 1
 *
 * 用法:
 *   npm run approval-flow:stability-gate
 *   npm run approval-flow:stability-gate -- --runs=5 --env=dev --profile=write
 */
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";

type RunRow = {
  run: number;
  ok: boolean;
  exitCode: number;
  durationSec: number;
};

function parseArgs(argv: string[]) {
  let runs = 5;
  let env = process.env.PLAYWRIGHT_ENV?.trim() || "dev";
  let profile = "";

  for (const arg of argv) {
    if (arg.startsWith("--runs=")) runs = Math.max(1, Number(arg.slice(7)) || 5);
    else if (arg.startsWith("--env=")) env = arg.slice(6).trim();
    else if (arg.startsWith("--profile=")) profile = arg.slice(10).trim();
  }

  return { runs, env, profile };
}

function main(): void {
  const repoRoot = process.cwd();
  const { runs, env, profile } = parseArgs(process.argv.slice(2));
  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  const rows: RunRow[] = [];
  const startedAt = new Date().toISOString();

  console.log(`[stability-gate] approval-flow write · env=${env} · ${runs} 轮连跑`);

  for (let i = 1; i <= runs; i += 1) {
    const args = ["tsx", "scripts/flow/run-approval-flow-write.ts", `--env=${env}`];
    if (profile) args.push(`--profile=${profile}`);
    if (i === 1) args.push("--clean-runs");

    const t0 = Date.now();
    const proc = spawnSync(npx, args, {
      cwd: repoRoot,
      stdio: "inherit",
      env: process.env,
    });
    const durationSec = Math.round((Date.now() - t0) / 1000);
    const exitCode = proc.status ?? 1;
    const ok = exitCode === 0;
    rows.push({ run: i, ok, exitCode, durationSec });
    console.log(`[stability-gate] 第 ${i}/${runs} 轮 · ${ok ? "通过" : "失败"} · ${durationSec}s`);

    if (!ok) break;
  }

  const passed = rows.filter((r) => r.ok).length;
  const report = {
    gate: "approval-flow-write",
    env,
    profile: profile || "write",
    runs,
    passed,
    failed: rows.length - passed,
    startedAt,
    finishedAt: new Date().toISOString(),
    rows,
  };

  const outDir = path.join(repoRoot, "results/stability-gate");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `approval-flow-write-${startedAt.replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(outFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(`[stability-gate] 报告: ${path.relative(repoRoot, outFile)}`);
  process.exit(passed === runs ? 0 : 1);
}

main();
