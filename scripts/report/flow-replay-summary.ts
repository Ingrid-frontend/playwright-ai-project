#!/usr/bin/env tsx
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { collectReplaySummaryRows } = require('../../pw-files/lib/flow-replay-list.js') as {
  collectReplaySummaryRows: (
    repoRoot: string,
    opts?: { lookback?: number },
  ) => ReplayRow[];
};

type ReplayRow = {
  engine?: string;
  title?: string;
  passed?: boolean | null;
  replayRel?: string;
  outRel?: string;
  mtime?: number;
  stepCount?: number | null;
  failedStepLabel?: string;
  hasVideo?: boolean;
  startedAt?: string;
  finishedAt?: string;
  scriptRel?: string;
  entry?: string;
  env?: string;
};

const DEFAULT_HTML = 'results/flow-replay-summary.html';
const DEFAULT_MD = 'results/flow-replay-summary.md';
const DEFAULT_LOOKBACK = 20;

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function parseArgs(argv: string[]): { lookback: number; htmlOut: string; mdOut: string } {
  let lookback = DEFAULT_LOOKBACK;
  let htmlOut = DEFAULT_HTML;
  let mdOut = DEFAULT_MD;
  for (const arg of argv) {
    if (arg.startsWith('--lookback=')) {
      const n = Number(arg.slice('--lookback='.length));
      if (!Number.isNaN(n) && n > 0) lookback = Math.floor(n);
    } else if (arg.startsWith('--out=')) {
      htmlOut = arg.slice('--out='.length).trim() || DEFAULT_HTML;
      mdOut = htmlOut.replace(/\.html?$/i, '.md');
      if (mdOut === htmlOut) mdOut = `${htmlOut}.md`;
    } else if (arg.startsWith('--md=')) {
      mdOut = arg.slice('--md='.length).trim() || DEFAULT_MD;
    }
  }
  return { lookback, htmlOut, mdOut };
}

function statusLabel(passed: boolean | null | undefined): string {
  if (passed === true) return '通过';
  if (passed === false) return '失败';
  return '-';
}

function formatTime(row: ReplayRow): string {
  if (row.startedAt) {
    const d = new Date(row.startedAt);
    if (!Number.isNaN(d.getTime())) return d.toLocaleString('zh-CN', { hour12: false });
  }
  if (row.mtime) {
    return new Date(row.mtime).toLocaleString('zh-CN', { hour12: false });
  }
  return '-';
}

function failTop(rows: ReplayRow[], limit = 8): Array<{ label: string; count: number }> {
  const map = new Map<string, number>();
  for (const row of rows) {
    if (row.passed !== false) continue;
    const label = String(row.failedStepLabel || row.title || 'unknown').trim() || 'unknown';
    map.set(label, (map.get(label) || 0) + 1);
  }
  return [...map.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'zh-CN'))
    .slice(0, limit);
}

function buildMarkdown(rows: ReplayRow[], generatedAt: string, lookback: number): string {
  const total = rows.length;
  const passed = rows.filter((r) => r.passed === true).length;
  const failed = rows.filter((r) => r.passed === false).length;
  const unknown = total - passed - failed;
  const rate = total ? `${((passed / total) * 100).toFixed(1)}%` : '-';
  const top = failTop(rows);

  const lines: string[] = [
    '# 流程回放汇总',
    '',
    `生成时间：${generatedAt}`,
    `统计范围：最近 ${lookback} 条（实际 ${total} 条）`,
    '',
    '## 总览',
    '',
    '| 指标 | 数值 |',
    '|------|------|',
    `| 回放数 | ${total} |`,
    `| 通过 | ${passed} |`,
    `| 失败 | ${failed} |`,
    `| 未知 | ${unknown} |`,
    `| 通过率 | ${rate} |`,
    '',
  ];

  if (top.length) {
    lines.push('## 失败步骤 Top', '');
    lines.push('| 步骤 / 标题 | 次数 |');
    lines.push('|-------------|------|');
    for (const t of top) {
      lines.push(`| ${t.label} | ${t.count} |`);
    }
    lines.push('');
  }

  lines.push('## 最近回放', '');
  lines.push('| 时间 | 标题 | 引擎 | 结果 | 步骤数 | 失败步骤 | 视频 | 回放 |');
  lines.push('|------|------|------|------|--------|----------|------|------|');
  for (const row of rows) {
    const video = row.hasVideo ? '有' : '-';
    const replay = row.replayRel || '-';
    lines.push(
      `| ${formatTime(row)} | ${row.title || '-'} | ${row.engine || '-'} | ${statusLabel(row.passed)} | ${
        row.stepCount ?? '-'
      } | ${row.failedStepLabel || '-'} | ${video} | ${replay} |`,
    );
  }
  lines.push('');
  return lines.join('\n');
}

function buildHtml(rows: ReplayRow[], generatedAt: string, lookback: number): string {
  const total = rows.length;
  const passed = rows.filter((r) => r.passed === true).length;
  const failed = rows.filter((r) => r.passed === false).length;
  const unknown = total - passed - failed;
  const rate = total ? `${((passed / total) * 100).toFixed(1)}%` : '-';
  const top = failTop(rows);

  const topHtml = top.length
    ? `<h2>失败步骤 Top</h2>
<table><thead><tr><th>步骤 / 标题</th><th>次数</th></tr></thead><tbody>
${top.map((t) => `<tr><td>${esc(t.label)}</td><td>${t.count}</td></tr>`).join('\n')}
</tbody></table>`
    : '';

  const rowsHtml = rows
    .map((row) => {
      const cls =
        row.passed === true ? 'ok' : row.passed === false ? 'fail' : 'unk';
      const replayHref = row.replayRel ? `/${esc(row.replayRel)}` : '';
      const replayCell = replayHref
        ? `<a href="${replayHref}" target="_blank" rel="noopener">打开</a>`
        : '-';
      return `<tr class="${cls}">
<td>${esc(formatTime(row))}</td>
<td>${esc(row.title || '-')}</td>
<td>${esc(row.engine || '-')}</td>
<td>${esc(statusLabel(row.passed))}</td>
<td>${row.stepCount ?? '-'}</td>
<td>${esc(row.failedStepLabel || '-')}</td>
<td>${row.hasVideo ? '有' : '-'}</td>
<td>${replayCell}</td>
</tr>`;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>流程回放汇总</title>
<style>
body{font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;margin:24px;color:#1a1a1a;background:#f7f8fa}
h1{font-size:22px;margin:0 0 8px}
.meta{color:#666;font-size:13px;margin-bottom:20px}
.cards{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:20px}
.card{background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:12px 16px;min-width:100px}
.card b{display:block;font-size:20px;margin-top:4px}
table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;font-size:13px}
th,td{padding:8px 10px;border-bottom:1px solid #eee;text-align:left}
th{background:#f3f4f6;font-weight:600}
tr.ok td:nth-child(4){color:#15803d}
tr.fail td:nth-child(4){color:#b91c1c}
tr.unk td:nth-child(4){color:#6b7280}
a{color:#2563eb}
h2{font-size:16px;margin:24px 0 10px}
</style>
</head>
<body>
<h1>流程回放汇总</h1>
<div class="meta">生成时间：${esc(generatedAt)} · 最近 ${lookback} 条（实际 ${total} 条）</div>
<div class="cards">
  <div class="card">回放数<b>${total}</b></div>
  <div class="card">通过<b>${passed}</b></div>
  <div class="card">失败<b>${failed}</b></div>
  <div class="card">未知<b>${unknown}</b></div>
  <div class="card">通过率<b>${esc(rate)}</b></div>
</div>
${topHtml}
<h2>最近回放</h2>
<table>
<thead><tr><th>时间</th><th>标题</th><th>引擎</th><th>结果</th><th>步骤数</th><th>失败步骤</th><th>视频</th><th>回放</th></tr></thead>
<tbody>
${rowsHtml || '<tr><td colspan="8">暂无回放</td></tr>'}
</tbody>
</table>
</body>
</html>
`;
}

function main(): void {
  const { lookback, htmlOut, mdOut } = parseArgs(process.argv.slice(2));
  const repoRoot = process.cwd();
  const rows = collectReplaySummaryRows(repoRoot, { lookback });
  const generatedAt = new Date().toISOString();

  const html = buildHtml(rows, generatedAt, lookback);
  const md = buildMarkdown(rows, generatedAt, lookback);

  fs.mkdirSync(path.dirname(path.resolve(htmlOut)), { recursive: true });
  fs.mkdirSync(path.dirname(path.resolve(mdOut)), { recursive: true });
  fs.writeFileSync(htmlOut, html, 'utf-8');
  fs.writeFileSync(mdOut, md, 'utf-8');

  const passed = rows.filter((r) => r.passed === true).length;
  const failed = rows.filter((r) => r.passed === false).length;
  console.log(`✅ 回放汇总已生成: ${htmlOut}`);
  console.log(`   Markdown: ${mdOut}`);
  console.log(`   条目 ${rows.length} · 通过 ${passed} · 失败 ${failed}`);
}

main();
