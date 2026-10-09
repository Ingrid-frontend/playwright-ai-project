/**
 * Smoke 巡检 HTML 汇总报告：扫描 results/smoke/ 下各次运行的 smoke-report.json，
 * 渲染最近 N 次运行的通过率、失败页与 console 错误 top。
 *
 * 用法：npm run report:smoke    （产出 results/smoke/report.html）
 */
import fs from 'fs';
import path from 'path';

const MAX_RUNS = 10;

type SmokePage = {
  pageId: string;
  label: string;
  route: string;
  status: string;
  durationMs: number;
  checks: Array<{ key: string; label: string; passed: boolean; suspicious?: boolean; detail?: string }>;
  consoleErrors: Array<{ text: string; url?: string }>;
};

type SmokeReport = {
  version: number;
  runId: string;
  env: string;
  startedAt: string;
  finishedAt?: string;
  totals: { pages: number; passed: number; suspicious: number; failed: number; consoleErrors: number };
  pages: SmokePage[];
};

function esc(s: string): string {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function statusBadge(status: string): string {
  const map: Record<string, string> = {
    passed: 'background:#e6f7e9;color:#116329',
    suspicious: 'background:#fff4d6;color:#7a5800',
    failed: 'background:#fde8e8;color:#a12622',
    skipped: 'background:#eceff1;color:#455a64',
  };
  const style = map[status] || map.skipped;
  return `<span style="padding:2px 8px;border-radius:10px;font-size:12px;${style}">${esc(status)}</span>`;
}

function renderRun(run: SmokeReport): string {
  const { totals } = run;
  const rate = totals.pages ? Math.round(((totals.passed + totals.suspicious) / totals.pages) * 100) : 0;
  const rows = run.pages
    .map((p) => {
      const problem = p.checks.find((c) => (!c.passed && !c.suspicious) || c.suspicious);
      const consoleTop = p.consoleErrors
        .slice(0, 2)
        .map((e) => `<div style="color:#a12622;font-size:12px">${esc(e.text.slice(0, 140))}</div>`)
        .join('');
      return `<tr>
  <td style="padding:6px 10px;border-bottom:1px solid #eee">${esc(p.pageId)}<div style="color:#888;font-size:12px">${esc(p.label)}</div></td>
  <td style="padding:6px 10px;border-bottom:1px solid #eee;font-size:12px">${esc(p.route)}</td>
  <td style="padding:6px 10px;border-bottom:1px solid #eee">${statusBadge(p.status)}</td>
  <td style="padding:6px 10px;border-bottom:1px solid #eee;font-size:12px">${esc(problem?.detail || '-')}${consoleTop}</td>
  <td style="padding:6px 10px;border-bottom:1px solid #eee;font-size:12px">${(p.durationMs / 1000).toFixed(1)}s</td>
</tr>`;
    })
    .join('\n');

  return `<section style="margin:24px 0">
  <h2 style="font-size:16px;margin:0 0 8px">${esc(run.env)} · run ${esc(run.runId)}
    <span style="font-weight:normal;color:#666;font-size:13px">${esc(run.startedAt)} · 通过率 ${rate}% ·
    通过 ${totals.passed} / 可疑 ${totals.suspicious} / 失败 ${totals.failed} · console ${totals.consoleErrors} 条</span></h2>
  <table style="border-collapse:collapse;width:100%;background:#fff;font-size:13px">
    <thead><tr style="text-align:left;color:#666">
      <th style="padding:6px 10px;border-bottom:2px solid #ddd">页面</th>
      <th style="padding:6px 10px;border-bottom:2px solid #ddd">路由</th>
      <th style="padding:6px 10px;border-bottom:2px solid #ddd">状态</th>
      <th style="padding:6px 10px;border-bottom:2px solid #ddd">问题 / console</th>
      <th style="padding:6px 10px;border-bottom:2px solid #ddd">耗时</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>
</section>`;
}

function main(): string {
  const root = process.cwd();
  const dir = path.resolve(root, 'results/smoke');
  if (!fs.existsSync(dir)) {
    console.log('无巡检产物（results/smoke/ 不存在）。先跑 npm run smoke:patrol');
    return '';
  }
  const reports = fs
    .readdirSync(dir)
    .map((name) => path.join(dir, name, 'smoke-report.json'))
    .filter((p) => fs.existsSync(p))
    .map((p) => JSON.parse(fs.readFileSync(p, 'utf8')) as SmokeReport)
    .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))
    .slice(0, MAX_RUNS);

  if (!reports.length) {
    console.log('无巡检产物（results/smoke/ 下无 smoke-report.json）');
    return '';
  }

  const html = `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<title>Smoke 巡检报告</title></head>
<body style="font-family:-apple-system,'PingFang SC',sans-serif;background:#f6f7f8;margin:0;padding:24px">
<h1 style="font-size:20px">Smoke 巡检报告 <span style="color:#888;font-size:13px">（最近 ${reports.length} 次运行）</span></h1>
${reports.map(renderRun).join('\n')}
</body></html>`;

  const outPath = path.join(dir, 'report.html');
  fs.writeFileSync(outPath, html, 'utf8');
  console.log(`📈 Smoke 报告: ${outPath}（${reports.length} 次运行）`);
  return outPath;
}

if (process.argv[1]?.replace(/\\/g, '/').includes('build-smoke-report')) {
  main();
}

export { main as buildSmokeReport };
