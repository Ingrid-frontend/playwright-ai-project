#!/usr/bin/env tsx
/** 统一 CLI 入口：命令分组与 --help */
const groups: Record<string, { desc: string; cmds: Array<{ name: string; hint: string }> }> = {
  setup: {
    desc: '初始化',
    cmds: [{ name: 'setup', hint: '首次环境检查' }],
  },
  ai: {
    desc: 'AI 原生生成与执行',
    cmds: [
      { name: 'ai:generate', hint: '自然语言生成 Playwright 脚本' },
      { name: 'ai:run', hint: '执行生成的 Playwright 脚本' },
      { name: 'ai:plan:generate', hint: '生成语义测试计划（旧链路）' },
      { name: 'ai:plan:run', hint: '执行语义测试计划（旧链路）' },
    ],
  },
  record: {
    desc: '录制与优化',
    cmds: [
      { name: 'record', hint: 'Playwright Codegen 录制' },
      { name: 'studio', hint: 'Studio Web UI' },
      { name: 'test:pipeline', hint: '预处理 + 优化 raw' },
      { name: 'optimize:ai', hint: 'AI 优化脚本' },
    ],
  },
  test: {
    desc: '执行',
    cmds: [
      { name: 'test:ci', hint: 'CI 同款 headless 回归' },
      { name: 'auto-test', hint: '录制→pipeline→执行→对比' },
      { name: 'test:regression', hint: '配置化 Job 回归' },
      { name: 'test:optimized', hint: '仅跑 optimized 项目' },
    ],
  },
  report: {
    desc: '报告与基线',
    cmds: [
      { name: 'report', hint: '打开 Playwright HTML 报告' },
      { name: 'report:dashboard', hint: '生成 UI 质量仪表盘' },
      { name: 'report:bundle', hint: '打包 public-reports' },
      { name: 'report:bundle-ci', hint: '合并 CI 产物' },
      { name: 'screenshot-report', hint: 'UI 截图对比报告' },
      { name: 'promote-baseline', hint: '提升 Golden 基线' },
      { name: 'trace:show', hint: '打开最新 trace' },
    ],
  },
  maintain: {
    desc: '维护',
    cmds: [
      { name: 'analyze-errors', hint: '失败汇总' },
      { name: 'analyze-test', hint: '脚本质检' },
      { name: 'heal-spec', hint: '失败 selector 修复 POC' },
    ],
  },
};

function printHelp(): void {
  console.log(`Playwright AI 项目 CLI

用法: npm run cli -- [--help] [group]

分组:`);
  for (const [key, g] of Object.entries(groups)) {
    console.log(`\n  ${key} — ${g.desc}`);
    for (const c of g.cmds) {
      console.log(`    npm run ${c.name.padEnd(22)} ${c.hint}`);
    }
  }
  console.log(`
示例:
  npm run setup
  npm run cli -- test
  npm run test:ci
`);
}

function main(): void {
  const arg = process.argv[2];
  if (!arg || arg === '--help' || arg === '-h') {
    printHelp();
    return;
  }
  const g = groups[arg];
  if (!g) {
    console.error(`未知分组: ${arg}`);
    printHelp();
    process.exit(1);
  }
  console.log(`\n${g.desc}:\n`);
  for (const c of g.cmds) {
    console.log(`  npm run ${c.name.padEnd(22)} ${c.hint}`);
  }
}

main();
