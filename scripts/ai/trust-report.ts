#!/usr/bin/env tsx
import fs from 'fs';
import path from 'path';
import {
  formatTrustReportMarkdown,
  listIntentTrustRecords,
} from '../../src/runtime/intent-trust.js';

function hasFlag(name: string): boolean {
  return process.argv.slice(2).some((arg) => arg === `--${name}`);
}

function main(): void {
  if (hasFlag('help') || hasFlag('h')) {
    console.log(`用法: npm run trust:report [-- --watch]

列出 results/history/intent-trust/ 下的可信度记录。
  --watch   仅输出 suggestedTrustLevel=watch 或有告警的项；若有则 exit 1
`);
    return;
  }

  const records = listIntentTrustRecords();
  const md = formatTrustReportMarkdown(records);
  console.log(md);

  const outDir = path.join('results', 'history', 'intent-trust');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, '_report.md');
  fs.writeFileSync(outFile, `${md}\n`, 'utf-8');
  console.log(`\n📁 ${outFile}`);

  if (hasFlag('watch')) {
    const bad = records.filter((r) => r.suggestedTrustLevel === 'watch' || r.alerts.length > 0);
    if (bad.length) {
      console.error(`\n❌ ${bad.length} 条需关注`);
      process.exit(1);
    }
    console.log('\n✅ 无 watch/告警');
  }
}

main();
