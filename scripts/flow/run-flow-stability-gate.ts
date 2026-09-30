#!/usr/bin/env tsx
/**
 * write 稳定性 gate 共享实现（原 run-{request,approval,expense}-flow-stability-gate.ts 三份复制的收敛版）。
 *
 * 保留原文件名入口作为薄封装：CI workflow（request/approval-flow-stability-gate.yml）与
 * npm scripts 依赖既有路径，文件名是对外契约，不要改。
 *
 * 合并策略 = 行为超集：连跑 N 次对应流程的 write runner，任一轮失败立即中断并 exit 1；
 * 报告落盘 results/stability-gate/<flowId>-write-<startedAt>.json（与原三份一致）。
 * 输出格式取 request/expense 版（approval 原版仅少一行 ✅/❌ 摘要，无行为差异）。
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

export type FlowStabilityGateConfig = {
  /** 流程目录名，如 request-flow（用于日志、报告 gate 名与文件名） */
  flowId: string;
  /** 对应 write runner 的相对脚本路径，如 scripts/flow/run-request-flow-write.ts */
  writeScriptRel: string;
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

export function runFlowStabilityGateMain(cfg: FlowStabilityGateConfig, argv = process.argv.slice(2)): void {
  const repoRoot = process.cwd();
  const { runs, env, profile } = parseArgs(argv);
  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  const rows: RunRow[] = [];
  const startedAt = new Date().toISOString();

  console.log(`[stability-gate] ${cfg.flowId} write · env=${env} · ${runs} 轮连跑`);

  for (let i = 1; i <= runs; i += 1) {
    const args = ["tsx", cfg.writeScriptRel, `--env=${env}`];
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
    gate: `${cfg.flowId}-write`,
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
  const outFile = path.join(outDir, `${cfg.flowId}-write-${startedAt.replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(outFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  if (passed === runs) {
    console.log(`[stability-gate] ✅ ${runs}/${runs} 轮通过 · ${path.relative(repoRoot, outFile)}`);
    process.exit(0);
  }

  console.error(`[stability-gate] ❌ ${passed}/${runs} 轮通过 · ${path.relative(repoRoot, outFile)}`);
  process.exit(1);
}
