#!/usr/bin/env tsx
/**
 * 统一调试入口：关掉一切拖慢循环的东西，只跑一个用例。
 *
 * 之前每个流程各写一条 npm script（request-flow:debug-fast / approval-flow:debug-fast），
 * 新增流程就得再复制一条。这里统一成一个入口，从 flow-registry 派生。
 *
 * 用法：
 *   npm run flow:debug-fast -- --flow=request-flow
 *   npm run flow:debug-fast -- --flow=approval-flow --grep=搜索
 *   npm run flow:debug-fast -- --flow=request-flow --spec=request/full-flow.spec.ts --headed
 *   npm run flow:debug-fast -- --list
 *
 * 做了什么（实测能把单次「跑→挂→改」循环压到最短）：
 *   - FLOW_DEBUG_FAST=1   runner 侧只跑第一个角色、reporter 只留 json
 *   - SCREENSHOT_CAPTURE=0 / FLOW_TRACE=off / FLOW_DISABLE_VIDEO=1  关掉截图·trace·录像
 *   - 把 test/action/navigation/expect 四类超时砍到 90s/10s/20s/8s，失败快速返回而不是干等
 *   - PLAYWRIGHT_RETRIES=0  失败立刻暴露，不靠重试掩盖 flaky
 */
import { spawnSync } from 'child_process';
import path from 'path';
import { listFlows, requireFlow } from './flow-registry.js';

type Args = {
  flowId: string;
  grep: string;
  spec: string;
  env: string;
  profile: string;
  headed: boolean;
  list: boolean;
  ui: boolean;
  help: boolean;
};

const DEBUG_ENV: Record<string, string> = {
  FLOW_DEBUG_FAST: '1',
  SCREENSHOT_CAPTURE: '0',
  FLOW_TRACE: 'off',
  FLOW_DISABLE_VIDEO: '1',
  PW_TEST_TIMEOUT: '90000',
  PW_ACTION_TIMEOUT: '10000',
  PW_NAVIGATION_TIMEOUT: '20000',
  PW_EXPECT_TIMEOUT: '8000',
  PLAYWRIGHT_RETRIES: '0',
};

function printHelp(): void {
  const flows = listFlows()
    .map((f) => `    ${f.id.padEnd(16)} ${f.label}  (${f.entry})`)
    .join('\n');
  process.stdout.write(`flow:debug-fast — 单流程快速调试

用法
  npm run flow:debug-fast -- --flow=<id> [选项]

选项
  --flow=<id>       必填，流程 ID
  --grep=<text>     只跑匹配的用例（强烈建议，能把一轮压到几十秒）
  --spec=<path>     覆盖 spec（默认该流程的 golden spec）
  --env=<env>       dev / uat / stage（默认 dev）
  --profile=<id>    只跑指定 golden 档案
  --headed          有头模式，肉眼观察
  --ui              打开 Playwright UI 模式（调试选择器最省时间）
  --list            列出已注册流程
  --help

已注册流程
${flows}

典型循环
  1. npm run flow:debug-fast -- --flow=approval-flow --grep=审批列表
  2. 挂了 → npm run trace:show  或  npm run flow:debug-fast -- --flow=approval-flow --ui
  3. 选择器漂了 → npm run ego:audit  然后  npm run selector-drift:suggest
`);
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    flowId: '',
    grep: '',
    spec: '',
    env: process.env.PLAYWRIGHT_ENV?.trim() || 'dev',
    profile: '',
    headed: false,
    list: false,
    ui: false,
    help: false,
  };

  for (const arg of argv) {
    if (arg.startsWith('--flow=')) args.flowId = arg.slice(7).trim();
    else if (arg.startsWith('--grep=')) args.grep = arg.slice(7).trim();
    else if (arg.startsWith('--spec=')) args.spec = arg.slice(7).trim();
    else if (arg.startsWith('--env=')) args.env = arg.slice(6).trim();
    else if (arg.startsWith('--profile=')) args.profile = arg.slice(10).trim();
    else if (arg === '--headed') args.headed = true;
    else if (arg === '--ui') args.ui = true;
    else if (arg === '--list') args.list = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
  }

  return args;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    return;
  }

  if (args.list) {
    for (const f of listFlows()) {
      const runners = [f.goldenRunner && 'golden', f.writeRunner && 'write'].filter(Boolean).join(' / ');
      process.stdout.write(`${f.id.padEnd(16)} ${f.label.padEnd(10)} entry=${f.entry.padEnd(16)} domain=${f.domain.padEnd(10)} runners=${runners || '—'}\n`);
    }
    return;
  }

  if (!args.flowId) {
    process.stderr.write('缺少 --flow=<id>。可用 --list 查看已注册流程，--help 看用法。\n');
    process.exit(1);
  }

  const flow = requireFlow(args.flowId);
  if (!flow.goldenRunner) {
    process.stderr.write(`流程「${flow.id}」未注册 golden runner，暂时不能用 debug-fast 调试。\n`);
    process.exit(1);
  }

  const repoRoot = process.cwd();
  const runnerPath = path.join('scripts', 'flow', flow.goldenRunner);

  if (args.ui) {
    // UI 模式：直接起 playwright ui，绕过 runner（最快的选择器调试方式）
    const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    const pwArgs = ['playwright', 'test', '--config', flow.configRel, '--ui'];
    if (args.grep) pwArgs.push(`--grep=${args.grep}`);
    process.stdout.write(`[flow:debug-fast] UI 模式 · ${flow.label} · config=${flow.configRel}\n`);
    const r = spawnSync(npx, pwArgs, {
      cwd: repoRoot,
      stdio: 'inherit',
      env: {
        ...process.env,
        ...DEBUG_ENV,
        PLAYWRIGHT_ENV: args.env,
        FLOW_SPEC: args.spec || flow.goldenSpec,
      },
    });
    process.exit(r.status ?? 1);
  }

  const spawnEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ...DEBUG_ENV,
    PLAYWRIGHT_ENV: args.env,
  };
  if (args.headed) spawnEnv.FLOW_RUN_MODE = 'headed';

  const runnerArgs: string[] = [`--env=${args.env}`];
  if (args.profile) runnerArgs.push(`--profile=${args.profile}`);
  if (args.grep) runnerArgs.push(`--grep=${args.grep}`);

  process.stdout.write(
    `[flow:debug-fast] ${flow.label} · env=${args.env} · spec=${args.spec || flow.goldenSpec}` +
      `${args.grep ? ` · grep=${args.grep}` : ''} · retries=0 · video/trace/screenshot=off\n`,
  );

  const r = spawnSync(process.execPath, [path.join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs'), runnerPath, ...runnerArgs], {
    cwd: repoRoot,
    stdio: 'inherit',
    env: spawnEnv,
  });

  if (r.status !== 0) {
    process.stdout.write(
      `\n[flow:debug-fast] 失败。下一步：\n` +
        `  · 看 trace：npm run trace:show\n` +
        `  · 看报告：open ${flow.reportDir}/index.html\n` +
        `  · 选择器问题：npm run flow:debug-fast -- --flow=${flow.id} --grep=${args.grep || '<用例名>'} --ui\n`,
    );
  }

  process.exit(r.status ?? 1);
}

main();
