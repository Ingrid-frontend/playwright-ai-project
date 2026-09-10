#!/usr/bin/env tsx
import {
  deleteFlowRunsByMarker,
  searchFlowRuns,
} from '../../pw-files/lib/flow-run-marker.js';

const repoRoot = process.cwd();

function usage() {
  console.log(`用法:
  npm run flow:delete-runs -- --search=<关键词>          # 列出匹配的 run（多个 runId 用空格隔开）
  npm run flow:delete-runs -- --marker=<标记> --delete   # 按标记删除（支持模糊匹配）
  npm run flow:delete-runs -- --marker=<标记> --delete --dry-run

标记写入：每次 Golden / 流程跑完自动写入 manifest.runMarker 与截图目录 ${'.run-marker.json'}。
也可手动指定：FLOW_RUN_MARKER=my-tag npm run request-flow:golden -- --env=dev --profile=golden
`);
}

function printHits(hits: ReturnType<typeof searchFlowRuns>) {
  if (!hits.length) {
    console.log('未找到匹配的 run');
    return;
  }
  console.log(`共 ${hits.length} 条：\n`);
  for (const h of hits) {
    const start = h.startedAt ? new Date(h.startedAt).toLocaleString('zh-CN', { hour12: false }) : '—';
    console.log(`  标记: ${h.runMarker || '—'}`);
    console.log(`  runId: ${h.runId}`);
    console.log(`  脚本: ${h.scriptKey}`);
    console.log(`  时间: ${start} · ${h.ok === false ? '失败' : h.ok ? '通过' : '—'}`);
    console.log('');
  }
}

function main() {
  const args = process.argv.slice(2);
  let search = '';
  let marker = '';
  let del = false;
  let dryRun = false;

  for (const arg of args) {
    if (arg === '--delete') del = true;
    else if (arg === '--dry-run') dryRun = true;
    else if (arg.startsWith('--search=')) search = arg.slice(9).trim();
    else if (arg.startsWith('--marker=')) marker = arg.slice(9).trim();
    else if (arg === '--help' || arg === '-h') {
      usage();
      return;
    }
  }

  const query = marker || search;
  if (!query) {
    usage();
    process.exit(1);
  }

  if (!del) {
    printHits(searchFlowRuns(repoRoot, query));
    console.log('删除请加 --delete，例如: npm run flow:delete-runs -- --marker=' + query + ' --delete');
    return;
  }

  const result = deleteFlowRunsByMarker(repoRoot, query, { dryRun });
  printHits(result.deleted);
  if (result.skipped.length) {
    console.log(`跳过 ${result.skipped.length} 条`);
  }
  const verb = dryRun ? '将删除' : '已删除';
  console.log(`${verb} ${result.deleted.length} 条 run（匹配 ${result.total} 条）`);
  if (!dryRun && result.deleted.length) {
    console.log('建议重新生成报告: npm run report:flow-customer');
  }
}

main();
