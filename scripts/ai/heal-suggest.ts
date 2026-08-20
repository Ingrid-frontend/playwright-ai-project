#!/usr/bin/env tsx
import fs from 'fs';
import path from 'path';
import {
  applyHealSuggestToIntentYaml,
  buildHealSuggestReport,
  formatHealSuggestMarkdown,
  readHealSuggest,
  writeHealSuggestArtifacts,
  type HealSuggestReport,
} from '../../src/runtime/heal-suggest.js';
import { readFailureBundle, type HealLogEntry } from '../../src/runtime/failure-bundle.js';

function getArgValue(name: string): string | undefined {
  const args = process.argv.slice(2);
  const prefix = `--${name}=`;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === `--${name}` && i + 1 < args.length) return args[i + 1];
    if (arg.startsWith(prefix)) return arg.slice(prefix.length);
  }
  return undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.slice(2).some((arg) => arg === `--${name}`);
}

function printHelp(): void {
  console.log(`用法: npm run heal:suggest -- --run=<dir> [选项]

从 intent 运行产物生成自愈建议补丁（不改 assert）。

选项:
  --run=<dir>       results/intent-runs/... 目录
  --intent=<path>   目标 Intent YAML（--apply 必填）
  --apply           人确认后写回非 assert 字段（默认只写已采纳）
  --include-rejected  --apply 时也写未采纳建议
  -h, --help
`);
}

function loadHealLogs(runDir: string): HealLogEntry[] {
  const bundle = readFailureBundle(runDir);
  if (bundle?.healLogs?.length) return bundle.healLogs;

  const healDir = path.join(runDir, 'heal');
  if (!fs.existsSync(healDir)) return [];
  return fs
    .readdirSync(healDir)
    .filter((n) => n.endsWith('.json'))
    .sort()
    .map((n) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(healDir, n), 'utf-8')) as HealLogEntry;
      } catch {
        return null;
      }
    })
    .filter((x): x is HealLogEntry => Boolean(x?.stepId));
}

function main(): void {
  if (hasFlag('help') || hasFlag('h')) {
    printHelp();
    return;
  }

  const runRel = getArgValue('run');
  if (!runRel) {
    printHelp();
    process.exit(1);
  }
  const runDir = path.resolve(runRel);
  if (!fs.existsSync(runDir)) {
    console.error(`❌ 目录不存在: ${runRel}`);
    process.exit(1);
  }

  const intentPath = getArgValue('intent');
  let report: HealSuggestReport | null = readHealSuggest(runDir);

  if (!report) {
    const logs = loadHealLogs(runDir);
    if (!logs.length) {
      console.error('❌ 未找到 heal 日志或 heal-suggest.json');
      process.exit(1);
    }
    const written = writeHealSuggestArtifacts(runDir, logs, { intentPath });
    report = written?.report || buildHealSuggestReport(logs, { intentPath });
    console.log(`📝 已生成: ${path.join(runDir, 'heal-suggest.md')}`);
  } else {
    console.log(formatHealSuggestMarkdown(report));
  }

  console.log(`补丁 ${report.patches.length} 条 · 跳过 ${report.skipped.length} 条`);

  if (!hasFlag('apply')) {
    if (report.patches.length) {
      console.log('提示: 加 --intent=... --apply 可写回 YAML（人审后）');
    }
    return;
  }

  if (!intentPath) {
    console.error('❌ --apply 需要 --intent=<yaml>');
    process.exit(1);
  }

  const result = applyHealSuggestToIntentYaml(intentPath, report, {
    onlyAccepted: !hasFlag('include-rejected'),
  });
  console.log(`✅ 已写回: ${result.updated.join(', ') || '（无）'}`);
  if (result.skipped.length) {
    console.log(`⏭️ 跳过: ${result.skipped.join('; ')}`);
  }
}

main();
