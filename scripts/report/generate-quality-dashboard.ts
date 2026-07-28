#!/usr/bin/env tsx
import fs from 'fs';
import path from 'path';
import type { HistorySnapshot } from './ui-regression-history.js';
import type { UiIssuesReport } from './ui-issues.js';
import { formatIssuePassRate } from './compare-report-viz.js';

const HISTORY_DIR = path.join('results', 'history');
const ISSUES_FILE = 'results/ui-issues.json';
const BITABLE_FILE = 'results/feishu-bitable-record.json';
const DEFAULT_OUT = 'results/quality-dashboard.html';

type TrendPoint = { date: string; blocker: number; warning: number; total: number };

type DashboardPayload = {
  generatedAt: string;
  env: string;
  current: HistorySnapshot | null;
  trend: TrendPoint[];
  previous: TrendPoint | null;
  byScript: HistorySnapshot['byScript'];
  byRoute: Record<string, number>;
  byCompareKind: Record<string, number>;
  bitable: { runRecordUrl?: string; dashboardUrl?: string };
};

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;');
}

function readJson<T>(file: string): T | null {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as T;
  } catch {
    return null;
  }
}

function loadHistory(): HistorySnapshot[] {
  if (!fs.existsSync(HISTORY_DIR)) return [];
  return fs
    .readdirSync(HISTORY_DIR)
    .filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name))
    .sort()
    .map((name) => readJson<HistorySnapshot>(path.join(HISTORY_DIR, name)))
    .filter((item): item is HistorySnapshot => Boolean(item?.date && item.summary));
}

function buildPayload(): DashboardPayload {
  const issues = readJson<UiIssuesReport>(ISSUES_FILE);
  const history = loadHistory();
  const trend = history.map((item) => ({
    date: item.date,
    blocker: item.summary.blocker,
    warning: item.summary.warning,
    total: item.summary.total,
  }));
  const latest = history[history.length - 1] ?? null;
  const previous = trend.length > 1 ? trend[trend.length - 2]! : null;
  const bitable = readJson<{ runRecordUrl?: string; dashboardUrl?: string }>(BITABLE_FILE) ?? {};

  const currentFromIssues: HistorySnapshot | null = issues
    ? {
        date: issues.generatedAt.slice(0, 10),
        generatedAt: issues.generatedAt,
        summary: issues.summary,
        byScript: buildScriptMap(issues),
      }
    : null;

  const current = currentFromIssues ?? latest;
  const byRoute = current?.summary.byRoute ?? issues?.summary.byRoute ?? {};
  const byCompareKind = current?.summary.byCompareKind ?? issues?.summary.byCompareKind ?? {};
  const byScript = current?.byScript ?? currentFromIssues?.byScript ?? {};

  return {
    generatedAt: issues?.generatedAt || latest?.generatedAt || new Date().toISOString(),
    env: process.env.PLAYWRIGHT_ENV || 'stage',
    current,
    trend,
    previous,
    byScript,
    byRoute,
    byCompareKind,
    bitable: {
      runRecordUrl: bitable.runRecordUrl,
      dashboardUrl: bitable.dashboardUrl,
    },
  };
}

function buildScriptMap(report: UiIssuesReport): HistorySnapshot['byScript'] {
  const buckets = new Map<string, { blocker: number; warning: number; diffs: number[] }>();
  for (const issue of report.issues) {
    const bucket = buckets.get(issue.scriptKey) ?? { blocker: 0, warning: 0, diffs: [] };
    if (issue.severity === 'blocker') bucket.blocker++;
    if (issue.severity === 'warning') bucket.warning++;
    bucket.diffs.push(issue.difference);
    buckets.set(issue.scriptKey, bucket);
  }
  const result: HistorySnapshot['byScript'] = {};
  for (const [scriptKey, bucket] of buckets) {
    const avgDifference = bucket.diffs.length
      ? bucket.diffs.reduce((sum, item) => sum + item, 0) / bucket.diffs.length
      : 0;
    result[scriptKey] = { blocker: bucket.blocker, warning: bucket.warning, avgDifference };
  }
  return result;
}

function deltaText(current: number, previous: number | undefined): string {
  if (previous === undefined) return '—';
  const diff = current - previous;
  if (diff === 0) return '0';
  return diff > 0 ? `+${diff}` : String(diff);
}

function deltaClass(current: number, previous: number | undefined, invert = false): string {
  if (previous === undefined) return 'delta-neutral';
  const diff = current - previous;
  if (diff === 0) return 'delta-neutral';
  const up = diff > 0;
  const bad = invert ? !up : up;
  return bad ? 'delta-bad' : 'delta-good';
}

function renderTrendChart(trend: TrendPoint[]): string {
  if (!trend.length) {
    return '<p class="empty">暂无历史趋势数据</p>';
  }
  const maxTotal = Math.max(...trend.map((item) => item.total), 1);
  const width = 640;
  const height = 180;
  const pad = { top: 16, right: 12, bottom: 28, left: 36 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const barGap = 8;
  const barW = Math.max(12, (innerW - barGap * (trend.length - 1)) / trend.length);

  const bars = trend
    .map((item, index) => {
      const x = pad.left + index * (barW + barGap);
      const blockerH = (item.blocker / maxTotal) * innerH;
      const warningH = (item.warning / maxTotal) * innerH;
      const yBlocker = pad.top + innerH - blockerH - warningH;
      const yWarning = pad.top + innerH - warningH;
      const label = item.date.slice(5);
      return `
        <g class="bar-group">
          <rect x="${x}" y="${yWarning.toFixed(1)}" width="${barW}" height="${warningH.toFixed(1)}" fill="#fbbf24" rx="2" />
          <rect x="${x}" y="${yBlocker.toFixed(1)}" width="${barW}" height="${blockerH.toFixed(1)}" fill="#ef4444" rx="2" />
          <text x="${(x + barW / 2).toFixed(1)}" y="${height - 8}" text-anchor="middle" class="axis-label">${esc(label)}</text>
          <title>${esc(item.date)} · blocker ${item.blocker} · warning ${item.warning}</title>
        </g>`;
    })
    .join('');

  const yTicks = [0, Math.ceil(maxTotal / 2), maxTotal];
  const grid = yTicks
    .map((tick) => {
      const y = pad.top + innerH - (tick / maxTotal) * innerH;
      return `
        <line x1="${pad.left}" y1="${y.toFixed(1)}" x2="${width - pad.right}" y2="${y.toFixed(1)}" stroke="#e5e7eb" />
        <text x="${pad.left - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end" class="axis-label">${tick}</text>`;
    })
    .join('');

  return `
    <div class="chart-wrap">
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="近 ${trend.length} 天 blocker 与 warning 趋势">
        ${grid}
        ${bars}
      </svg>
      <div class="chart-legend">
        <span><i class="dot dot-red"></i>Blocker</span>
        <span><i class="dot dot-yellow"></i>Warning</span>
      </div>
    </div>`;
}

function renderBarList(record: Record<string, number>, limit = 8): string {
  const entries = Object.entries(record)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);
  if (!entries.length) return '<p class="empty">暂无数据</p>';
  const max = entries[0]![1] || 1;
  return entries
    .map(
      ([key, value]) => `
      <div class="bar-row">
        <span class="bar-label" title="${esc(key)}">${esc(key.length > 24 ? `${key.slice(0, 24)}…` : key)}</span>
        <div class="bar-track"><div class="bar-fill" style="width:${((value / max) * 100).toFixed(1)}%"></div></div>
        <span class="bar-val">${value}</span>
      </div>`,
    )
    .join('');
}

function renderScriptTable(byScript: HistorySnapshot['byScript']): string {
  const rows = Object.entries(byScript)
    .sort((a, b) => b[1].blocker - a[1].blocker || b[1].warning - a[1].warning)
    .slice(0, 12);
  if (!rows.length) return '<p class="empty">暂无脚本维度数据</p>';
  return `
    <table class="data-table">
      <thead><tr><th>脚本</th><th>Blocker</th><th>Warning</th><th>平均差异</th></tr></thead>
      <tbody>
        ${rows
          .map(
            ([script, item]) => `
          <tr>
            <td title="${esc(script)}">${esc(script)}</td>
            <td class="num red">${item.blocker}</td>
            <td class="num yellow">${item.warning}</td>
            <td class="num">${(item.avgDifference * 100).toFixed(2)}%</td>
          </tr>`,
          )
          .join('')}
      </tbody>
    </table>`;
}

export function generateQualityDashboardHtml(payload: DashboardPayload): string {
  const summary = payload.current?.summary;
  const blocker = summary?.comparisonBlocker ?? summary?.blocker ?? 0;
  const warning = summary?.comparisonWarning ?? summary?.warning ?? 0;
  const total = summary?.comparisonTotal ?? summary?.total ?? 0;
  const passCount = summary?.comparisonNoise ?? summary?.noise ?? Math.max(total - blocker - warning, 0);
  const passPct = formatIssuePassRate({
    total,
    blocker,
    warning,
    noise: passCount,
  }).passPct;
  const prev = payload.previous;

  const links = [
    { href: './ui-regression/index.html', label: 'UI 截图对比报告' },
    { href: './playwright-report/index.html', label: 'Playwright HTML 报告' },
  ];
  if (payload.bitable.runRecordUrl) {
    links.push({ href: payload.bitable.runRecordUrl, label: '飞书多维表 · 本次执行' });
  }
  if (payload.bitable.dashboardUrl) {
    links.push({ href: payload.bitable.dashboardUrl, label: '飞书多维表 · 质量看板' });
  }

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>UI 质量仪表盘</title>
  <style>
    * { box-sizing: content-box; }
    body { margin: 0; font-family: system-ui, -apple-system, sans-serif; background: #f4f6f8; color: #1d2129; }
    .page { max-width: 1080px; margin: 0 auto; padding: 24px 16px 48px; }
    h1 { margin: 0 0 6px; font-size: 1.5rem; }
    .sub { color: #86909c; font-size: 14px; margin-bottom: 20px; }
    .links { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 20px; }
    .links a { padding: 8px 12px; border: 1px solid #d6d8db; border-radius: 8px; background: #fff; color: #1677ff; text-decoration: none; font-size: 13px; }
    .links a:hover { background: #f5f7fa; }
    .kpi-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 16px; }
    .kpi { background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 16px; }
    .kpi-num { font-size: 28px; font-weight: 700; line-height: 1.1; }
    .kpi-label { font-size: 12px; color: #86909c; margin-top: 6px; }
    .kpi-delta { font-size: 12px; margin-top: 8px; }
    .red { color: #dc2626; }
    .yellow { color: #d97706; }
    .green { color: #16a34a; }
    .delta-bad { color: #dc2626; }
    .delta-good { color: #16a34a; }
    .delta-neutral { color: #86909c; }
    .panel-grid { display: grid; grid-template-columns: 1.4fr 1fr; gap: 16px; }
    .panel { background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 16px; margin-bottom: 16px; }
    .panel h2 { margin: 0 0 12px; font-size: 15px; }
    .chart-wrap svg { width: 100%; height: auto; display: block; }
    .axis-label { font-size: 11px; fill: #86909c; }
    .chart-legend { display: flex; gap: 16px; font-size: 12px; color: #4e5969; margin-top: 8px; }
    .dot { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 6px; vertical-align: -1px; }
    .dot-red { background: #ef4444; }
    .dot-yellow { background: #fbbf24; }
    .bar-row { display: flex; align-items: center; gap: 8px; margin: 8px 0; font-size: 13px; }
    .bar-label { width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #4e5969; }
    .bar-track { flex: 1; height: 8px; background: #eef0f3; border-radius: 4px; overflow: hidden; }
    .bar-fill { height: 8px; background: #1677ff; border-radius: 4px; }
    .bar-val { width: 32px; text-align: right; color: #1d2129; }
    .data-table { width: 100%; border-collapse: collapse; font-size: 13px; }
    .data-table th, .data-table td { padding: 8px 10px; border-bottom: 1px solid #eef0f3; text-align: left; }
    .data-table th { color: #86909c; font-weight: 600; }
    .data-table .num { text-align: right; font-variant-numeric: tabular-nums; }
    .ring-wrap { display: flex; align-items: center; gap: 20px; }
    .ring { width: 88px; height: 88px; border-radius: 50%; display: flex; flex-direction: column; align-items: center; justify-content: center; position: relative; }
    .ring::after { content: ''; position: absolute; width: 56px; height: 56px; background: #fff; border-radius: 50%; }
    .ring-pct { font-size: 18px; font-weight: 700; z-index: 1; line-height: 1; }
    .ring-label { font-size: 11px; color: #86909c; z-index: 1; margin-top: 4px; }
    .empty { color: #86909c; font-size: 13px; margin: 0; }
    @media (max-width: 860px) {
      .kpi-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .panel-grid { grid-template-columns: 1fr; }
      .bar-label { width: 96px; }
    }
  </style>
</head>
<body>
  <div class="page">
    <h1>UI 质量仪表盘</h1>
    <p class="sub">环境 ${esc(payload.env)} · 数据时间 ${esc(payload.generatedAt)} · 历史 ${payload.trend.length} 天</p>
    <div class="links">
      ${links.map((item) => `<a href="${esc(item.href)}"${item.href.startsWith('http') ? ' target="_blank" rel="noopener"' : ''}>${esc(item.label)}</a>`).join('')}
    </div>

    <div class="kpi-grid">
      <div class="kpi">
        <div class="kpi-num red">${blocker}</div>
        <div class="kpi-label">Blocker</div>
        <div class="kpi-delta ${deltaClass(blocker, prev?.blocker)}">较上日 ${deltaText(blocker, prev?.blocker)}</div>
      </div>
      <div class="kpi">
        <div class="kpi-num yellow">${warning}</div>
        <div class="kpi-label">Warning</div>
        <div class="kpi-delta ${deltaClass(warning, prev?.warning)}">较上日 ${deltaText(warning, prev?.warning)}</div>
      </div>
      <div class="kpi">
        <div class="kpi-num">${total}</div>
        <div class="kpi-label">问题条目</div>
        <div class="kpi-delta ${deltaClass(total, prev?.total)}">较上日 ${deltaText(total, prev?.total)}</div>
      </div>
      <div class="kpi">
        <div class="kpi-num green">${passPct}%</div>
        <div class="kpi-label">通过率</div>
        <div class="kpi-delta delta-neutral">${passCount} 条 noise</div>
      </div>
    </div>

    <div class="panel">
      <h2>历史趋势</h2>
      ${renderTrendChart(payload.trend)}
    </div>

    <div class="panel-grid">
      <div class="panel">
        <h2>脚本问题排行</h2>
        ${renderScriptTable(payload.byScript)}
      </div>
      <div class="panel">
        <h2>路由分布</h2>
        ${renderBarList(payload.byRoute)}
        <h2 style="margin-top:20px">对比类型</h2>
        ${renderBarList(payload.byCompareKind, 6)}
      </div>
    </div>
  </div>
</body>
</html>`;
}

export function writeQualityDashboard(outFile = DEFAULT_OUT): string {
  const payload = buildPayload();
  const html = generateQualityDashboardHtml(payload);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, html, 'utf-8');
  return outFile;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = process.argv.find((item) => item.startsWith('--out='))?.slice('--out='.length) || DEFAULT_OUT;
  const file = writeQualityDashboard(out);
  console.log(`✅ 质量仪表盘已生成: ${file}`);
}
