#!/usr/bin/env tsx
/**
 * 对所有已注册 flow 跑 gen-catalog --check，发现 catalog 与实机快照漂移时 exit 1。
 *
 * 用法:
 *   npm run catalog:drift-check
 *   npm run catalog:drift-check -- --flow=request-flow
 */
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { listFlows } from "./flow-registry.js";

function parseArgs(argv: string[]) {
  let flowId = "";
  for (const arg of argv) {
    if (arg.startsWith("--flow=")) flowId = arg.slice(7).trim();
  }
  return { flowId };
}

function main(): void {
  const repoRoot = process.cwd();
  const { flowId } = parseArgs(process.argv.slice(2));
  const flows = listFlows().filter((f) => !flowId || f.id === flowId);
  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  let failed = 0;
  let checked = 0;
  let skipped = 0;

  console.log(`[catalog-drift] 开始 · ${flows.length} 个流程`);

  for (const flow of flows) {
    const snap = path.join(repoRoot, flow.id, "datasource/live-snapshot.json");
    const catalog = path.join(repoRoot, flow.id, "utils", `${flow.domain}-catalog.ts`);
    if (!fs.existsSync(snap)) {
      console.warn(`[catalog-drift] 跳过 ${flow.id}: 无 live-snapshot.json`);
      skipped += 1;
      continue;
    }
    if (!fs.existsSync(catalog)) {
      console.warn(`[catalog-drift] 跳过 ${flow.id}: 无 catalog 文件`);
      skipped += 1;
      continue;
    }

    checked += 1;
    console.log(`[catalog-drift] 检查 ${flow.label} (${flow.id})`);
    const proc = spawnSync(
      npx,
      ["tsx", "scripts/flow/gen-catalog-from-probe.ts", `--flow=${flow.id}`, "--check"],
      { cwd: repoRoot, stdio: "inherit", env: process.env },
    );
    if ((proc.status ?? 1) !== 0) failed += 1;
  }

  console.log(`[catalog-drift] 完成 · 检查 ${checked} · 跳过 ${skipped} · 漂移 ${failed}`);
  if (checked === 0) {
    console.error("[catalog-drift] 无可检查流程（需先有 live-snapshot.json）");
    process.exit(1);
  }
  process.exit(failed > 0 ? 1 : 0);
}

main();
