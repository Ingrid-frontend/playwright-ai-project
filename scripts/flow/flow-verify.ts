#!/usr/bin/env tsx
/**
 * debug-fast 通过后自动跑 golden + compare（不 promote）。
 *
 * 用法:
 *   npm run flow:verify -- --flow=request-flow --grep=按单号搜索
 *   npm run flow:verify -- --flow=approval-flow --grep=审批列表
 */
import { spawnSync } from "child_process";
import { listFlows, requireFlow } from "./flow-registry.js";

type Args = {
  flowId: string;
  grep: string;
  env: string;
  profile: string;
  help: boolean;
  list: boolean;
};

function printHelp(): void {
  const flows = listFlows()
    .map((f) => `    ${f.id.padEnd(16)} ${f.label}`)
    .join("\n");
  process.stdout.write(`flow:verify — debug-fast 通过后跑 golden + compare（不 promote）

用法
  npm run flow:verify -- --flow=<id> [选项]

选项
  --flow=<id>       必填
  --grep=<text>     建议指定，缩小范围
  --env=<env>       默认 dev
  --profile=<id>    限定 golden 档案
  --list            列出已注册流程
  --help

流程
  1. flow:debug-fast（快速验证选择器/步骤）
  2. golden runner 全量跑（截图 + compare --gate，不 promote）

已注册流程
${flows}
`);
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    flowId: "",
    grep: "",
    env: process.env.PLAYWRIGHT_ENV?.trim() || "dev",
    profile: "",
    help: false,
    list: false,
  };
  for (const arg of argv) {
    if (arg.startsWith("--flow=")) args.flowId = arg.slice(7).trim();
    else if (arg.startsWith("--grep=")) args.grep = arg.slice(7).trim();
    else if (arg.startsWith("--env=")) args.env = arg.slice(6).trim();
    else if (arg.startsWith("--profile=")) args.profile = arg.slice(10).trim();
    else if (arg === "--list") args.list = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
  }
  return args;
}

function runNpm(script: string, extraArgs: string[], env: NodeJS.ProcessEnv): number {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const proc = spawnSync(npm, ["run", script, "--", ...extraArgs], {
    cwd: process.cwd(),
    stdio: "inherit",
    env,
  });
  return proc.status ?? 1;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  if (args.list) {
    for (const f of listFlows()) {
      process.stdout.write(`${f.id.padEnd(16)} ${f.label}\n`);
    }
    return;
  }
  if (!args.flowId) {
    process.stderr.write("缺少 --flow=<id>。--help 看用法。\n");
    process.exit(1);
  }

  const flow = requireFlow(args.flowId);
  if (!flow.goldenRunner) {
    process.stderr.write(`流程「${flow.id}」未注册 golden runner。\n`);
    process.exit(1);
  }

  const debugArgs = [`--flow=${flow.id}`, `--env=${args.env}`];
  if (args.grep) debugArgs.push(`--grep=${args.grep}`);
  if (args.profile) debugArgs.push(`--profile=${args.profile}`);

  process.stdout.write(`[flow:verify] 第 1 步 · debug-fast · ${flow.label}\n`);
  const debugCode = runNpm("flow:debug-fast", debugArgs, process.env);
  if (debugCode !== 0) {
    process.stderr.write("[flow:verify] debug-fast 未通过，跳过 golden 验证。\n");
    process.exit(debugCode);
  }

  const goldenScript = `${flow.id}:golden`;
  const goldenArgs = [`--env=${args.env}`];
  if (args.grep) goldenArgs.push(`--grep=${args.grep}`);
  if (args.profile) goldenArgs.push(`--profile=${args.profile}`);

  process.stdout.write(`[flow:verify] 第 2 步 · golden + compare（不 promote）· ${flow.label}\n`);
  const goldenEnv: NodeJS.ProcessEnv = {
    ...process.env,
    FLOW_PROMOTE_IF_CLEAN: "0",
    AUTO_PROMOTE_BASELINE: "0",
  };
  delete goldenEnv.FLOW_DEBUG_FAST;

  const goldenCode = runNpm(goldenScript, goldenArgs, goldenEnv);
  if (goldenCode !== 0) {
    process.stderr.write("[flow:verify] golden 或 compare gate 未通过。\n");
    process.exit(goldenCode);
  }

  process.stdout.write(`[flow:verify] 通过 · ${flow.label}\n`);
}

main();
