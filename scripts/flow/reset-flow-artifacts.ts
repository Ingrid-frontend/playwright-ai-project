#!/usr/bin/env tsx
/**
 * 清理 request-flow 跑轮产物（不动 screenshots-baseline / results/jobs）
 *
 * 用法: npm run reset:flow-artifacts
 * 选项: --flow=request-flow  默认 request-flow
 */
import fs from "fs";
import path from "path";

const DEFAULT_FLOW = "request-flow";

function rmDirContents(dir: string): number {
  if (!fs.existsSync(dir)) return 0;
  let count = 0;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === ".gitkeep") continue;
    fs.rmSync(path.join(dir, ent.name), { recursive: true, force: true });
    count++;
  }
  return count;
}

function parseFlowId(argv: string[]): string {
  for (const arg of argv) {
    if (arg.startsWith("--flow=")) return arg.slice(7).trim() || DEFAULT_FLOW;
  }
  return DEFAULT_FLOW;
}

function main(): void {
  const flowId = parseFlowId(process.argv.slice(2));
  const repoRoot = process.cwd();
  const targets = [
    path.join(repoRoot, "screenshots", "flows", flowId),
    path.join(repoRoot, "results", "flow-runs", flowId),
    path.join(repoRoot, flowId, "playwright-report"),
    path.join(repoRoot, flowId, "test-results"),
  ];

  console.log(`\n🧹 清理 ${flowId} 跑轮产物（保留 baseline）\n`);
  let total = 0;
  for (const dir of targets) {
    const rel = path.relative(repoRoot, dir);
    const n = rmDirContents(dir);
    if (n) {
      console.log(`✅ ${rel}/ (${n} 项)`);
      total += n;
    }
  }
  if (!total) console.log("ℹ️  无需清理");
  console.log("");
}

main();
