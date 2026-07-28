import type { ImageComparison } from './image-diff.js';
import { formatDifference, getDifferenceColor, getDifferenceLabel } from './image-diff.js';
import type { UiIssue, UiIssueSeverity } from './ui-issues.js';
import type { StepTrendPoint } from './ui-regression-history.js';

export type DiffCardCtx = {
  scriptKey?: string;
  stepNumber?: number;
  stepName?: string;
  trendPoints?: StepTrendPoint[];
};

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;');
}

export function sparklineSvg(points: StepTrendPoint[], width = 88, height = 22): string {
  if (!points.length) {
    return `<svg class="diff-sparkline empty" width="${width}" height="${height}" aria-hidden="true"></svg>`;
  }
  const vals = points.map((p) => p.v);
  const max = Math.max(...vals, 0.0001);
  const min = Math.min(...vals, 0);
  const range = max - min || max;
  const step = vals.length > 1 ? width / (vals.length - 1) : 0;
  const coords = vals
    .map((v, i) => {
      const x = vals.length > 1 ? i * step : width / 2;
      const y = height - 2 - ((v - min) / range) * (height - 4);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const last = vals[vals.length - 1]!;
  const color = last >= 0.005 ? '#dc3545' : last >= 0.001 ? '#ffc107' : '#28a745';
  return `<svg class="diff-sparkline" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-hidden="true"><polyline fill="none" stroke="${color}" stroke-width="1.5" points="${coords}"/></svg>`;
}

export function buildDiffCardHtml(
  comparison: ImageComparison,
  opts: {
    image1Label: string;
    image2Label: string;
    browser: string;
    isCross: boolean;
    pairLabelHint: string;
    browserPairHint: string;
    sizeHint: string;
    ctx?: DiffCardCtx;
  },
): string {
  const diffColor = getDifferenceColor(comparison.difference);
  const diffLabel = getDifferenceLabel(comparison.difference);
  const isCross = opts.isCross;
  const browser = opts.browser;
  const cardId = `dc-${Math.random().toString(36).slice(2, 9)}`;

  const overlayRel = comparison.overlayImagePath
    ? comparison.overlayImagePath.replace(/\\/g, '/')
    : comparison.diffImagePath
      ? comparison.diffImagePath.replace(/\.png$/i, '-overlay.png').replace(/\\/g, '/')
      : '';

  const trendHtml =
    opts.ctx?.trendPoints && opts.ctx.trendPoints.length > 1
      ? `<span class="diff-trend-wrap" title="最近 ${opts.ctx.trendPoints.length} 次 golden diff 趋势">${sparklineSvg(opts.ctx.trendPoints)}</span>`
      : '';

  const sideBySide = `
      <div class="diff-images diff-view-side">
        <div class="diff-image-container">
          <div class="diff-image-label">${opts.image1Label}</div>
          <img src="${comparison.image1Path}" alt="${esc(opts.image1Label)}" loading="lazy">
        </div>
        <div class="diff-image-container">
          <div class="diff-image-label">${opts.image2Label}</div>
          <img src="${comparison.image2Path}" alt="${esc(opts.image2Label)}" loading="lazy">
        </div>
        <div class="diff-image-container">
          <div class="diff-image-label">像素 diff</div>
          ${
            comparison.diffImagePath
              ? `<img src="${comparison.diffImagePath}" alt="差异" loading="lazy">`
              : `<div class="diff-no-visual">无像素差异</div>`
          }
        </div>
      </div>`;

  return `
  <div class="diff-card diff-browser-content" data-browser="${browser}" data-compare-kind="${isCross ? 'cross-browser' : 'same-browser'}" data-severity="${comparison.difference >= 0.005 ? 'blocker' : comparison.difference >= 0.001 ? 'warning' : 'noise'}" data-diff-card tabindex="0" id="${cardId}">
    <div class="diff-header">
      <span class="diff-badge" style="background-color: ${diffColor};">${diffLabel}</span>
      <span class="diff-percentage">${formatDifference(comparison.difference)}</span>
      <div class="diff-bar-wrap" title="差异比例：${formatDifference(comparison.difference)}">
        <div class="diff-bar-fill" style="width:${Math.min(comparison.difference * 10000, 100).toFixed(1)}%;background:${diffColor};"></div>
      </div>
      ${trendHtml}
      ${opts.browserPairHint}
      ${opts.sizeHint}
    </div>
    ${opts.pairLabelHint ? `<div class="diff-pair-row">${opts.pairLabelHint}</div>` : ''}
    <div class="diff-view-toolbar">
      <button type="button" class="diff-view-btn active" data-view="slider">滑块</button>
      <button type="button" class="diff-view-btn" data-view="blink">闪烁</button>
      <button type="button" class="diff-view-btn" data-view="overlay">标注</button>
      <button type="button" class="diff-view-btn" data-view="side">并排</button>
      <button type="button" class="diff-view-btn diff-expand-btn" title="完整视图">⤢</button>
    </div>
    <div class="diff-view-panels">
      <div class="slider-compare diff-view-panel active" data-before="${comparison.image1Path}" data-after="${comparison.image2Path}">
        <img class="slider-img slider-before" src="${comparison.image1Path}" alt="基线" loading="lazy">
        <div class="slider-after-clip"><img class="slider-img slider-after" src="${comparison.image2Path}" alt="当前" loading="lazy"></div>
        <input type="range" class="slider-range" min="0" max="100" value="50" aria-label="对比滑块">
        <div class="slider-handle-line"></div>
      </div>
      <div class="blink-compare diff-view-panel" data-before="${comparison.image1Path}" data-after="${comparison.image2Path}">
        <img class="blink-img blink-a" src="${comparison.image1Path}" alt="基线" loading="lazy">
        <img class="blink-img blink-b" src="${comparison.image2Path}" alt="当前" loading="lazy">
        <div class="blink-hint">点击切换闪烁对比</div>
      </div>
      <div class="overlay-compare diff-view-panel">
        ${
          overlayRel
            ? `<img class="overlay-img" src="${overlayRel}" alt="标注叠加" loading="lazy" onerror="this.src='${comparison.image2Path}'">`
            : `<img class="overlay-img" src="${comparison.image2Path}" alt="当前" loading="lazy">`
        }
        <div class="overlay-caption">当前页 + 红色高亮差异区</div>
      </div>
      ${sideBySide}
    </div>
  </div>`;
}

const SEV_RANK: Record<UiIssueSeverity, number> = { blocker: 3, warning: 2, noise: 1 };
const SEV_CELL: Record<UiIssueSeverity, string> = {
  blocker: 'hm-red',
  warning: 'hm-yellow',
  noise: 'hm-green',
};

export function generateHeatmapTabHtml(issues: UiIssue[]): string {
  if (!issues.length) {
    return '<div class="empty-state"><div class="empty-state-title">暂无数据</div></div>';
  }

  const goldenLike = issues.filter((i) => i.compareKind === 'golden' || i.compareKind === 'last-green');
  const src = goldenLike.length ? goldenLike : issues;

  const scripts = [...new Set(src.map((i) => i.scriptKey))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
  const stepMap = new Map<string, { num: number; name: string }>();
  for (const i of src) {
    const label = i.stepName.replace(/-before$/i, '').replace(/-after$/i, '');
    stepMap.set(`${i.stepNumber}|${label}`, { num: i.stepNumber, name: label });
  }
  const steps = [...stepMap.entries()]
    .sort((a, b) => a[1].num - b[1].num || a[1].name.localeCompare(b[1].name, 'zh-CN'))
    .map(([, v]) => v);

  const cell = new Map<string, UiIssueSeverity>();
  for (const i of src) {
    const label = i.stepName.replace(/-before$/i, '').replace(/-after$/i, '');
    const k = `${i.scriptKey}|${i.stepNumber}|${label}`;
    const prev = cell.get(k);
    if (!prev || SEV_RANK[i.severity] > SEV_RANK[prev]) cell.set(k, i.severity);
  }

  const head = steps.map((s) => `<th title="step-${s.num}">${esc(s.name.length > 8 ? s.name.slice(0, 8) + '…' : s.name)}</th>`).join('');
  const rows = scripts
    .map((script) => {
      const short = script.includes('/') ? script.split('/').slice(-1)[0]! : script;
      const tds = steps
        .map((s) => {
          const sev = cell.get(`${script}|${s.num}|${s.name}`) || 'noise';
          const pct = src.find(
            (i) => i.scriptKey === script && i.stepNumber === s.num && i.stepName.includes(s.name),
          );
          const title = pct ? `${formatDifference(pct.difference)} · ${pct.compareKind}` : '无差异';
          const valText = pct ? formatDifference(pct.difference) : '';
          return `<td class="hm-cell ${SEV_CELL[sev]}" title="${esc(title)}">${valText ? `<span class="hm-val">${valText}</span>` : ''}</td>`;
        })
        .join('');
      return `<tr><th class="hm-script" title="${esc(script)}">${esc(short.length > 14 ? short.slice(0, 14) + '…' : short)}</th>${tds}</tr>`;
    })
    .join('');

  return `
  <div class="heatmap-wrap">
    <p class="heatmap-legend"><span class="hm-cell hm-red"></span> blocker <span class="hm-cell hm-yellow"></span> warning <span class="hm-cell hm-green"></span> 通过/noise</p>
    <div class="heatmap-scroll">
      <table class="heatmap-table"><thead><tr><th>脚本 \\ 步骤</th>${head}</tr></thead><tbody>${rows}</tbody></table>
    </div>
  </div>`;
}

export function generateDashboardHtml(summary: {
  blocker: number;
  warning: number;
  noise: number;
  total: number;
}): string {
  const total = summary.total || 1;
  const bPct = ((summary.blocker / total) * 100).toFixed(0);
  const wPct = ((summary.warning / total) * 100).toFixed(0);
  return `
  <div class="viz-dashboard">
    <div class="viz-stat"><span class="viz-num viz-red">${summary.blocker}</span><span class="viz-label">Blocker</span><span class="viz-pct">${bPct}%</span></div>
    <div class="viz-stat"><span class="viz-num viz-yellow">${summary.warning}</span><span class="viz-label">Warning</span><span class="viz-pct">${wPct}%</span></div>
    <div class="viz-stat"><span class="viz-num viz-green">${summary.total - summary.blocker - summary.warning}</span><span class="viz-label">其他</span></div>
    <div class="viz-stat"><span class="viz-num">${summary.total}</span><span class="viz-label">问题条目</span></div>
  </div>`;
}

export interface OverviewData {
  total: number;
  blocker: number;
  warning: number;
  noise: number;
  totalSteps: number;
  totalScreenshots: number;
  totalExecutions: number;
  maxDiff: { pct: string; location: string } | null;
  avgDiff: string;
  distribution: { range: string; count: number; pct: number }[];
  generatedAt: string;
}

export function formatIssuePassRate(summary: {
  total: number;
  blocker: number;
  warning: number;
  noise: number;
}): { passPct: string; passCount: number; blockPct: string; warnPct: string } {
  const { total, blocker, warning } = summary;
  if (total <= 0) {
    return { passPct: '100.0', passCount: 0, blockPct: '0.0', warnPct: '0.0' };
  }
  // 通过 = 全部对比中未达 warning/blocker 的项（含无差异与 noise），不用 noise/问题条数
  const passCount = Math.max(0, total - blocker - warning);
  return {
    passPct: ((passCount / total) * 100).toFixed(1),
    passCount,
    blockPct: ((blocker / total) * 100).toFixed(1),
    warnPct: ((warning / total) * 100).toFixed(1),
  };
}

export function generateOverviewPanel(data: OverviewData): string {
  const { passPct, passCount, blockPct, warnPct } = formatIssuePassRate(data);
  const total = data.total;

  // Ring chart via conic-gradient
  const blockDeg = total > 0 ? (data.blocker / total) * 360 : 0;
  const warnDeg = total > 0 ? (data.warning / total) * 360 : 0;
  const ringBg = data.total === 0
    ? '#28a745'
    : `conic-gradient(#dc3545 0deg ${blockDeg}deg, #ffc107 ${blockDeg}deg ${blockDeg + warnDeg}deg, #28a745 ${blockDeg + warnDeg}deg 360deg)`;

  const distRows = data.distribution
    .map(
      (d) => `
    <div class="ov-dist-row">
      <span class="ov-dist-label">${d.range}</span>
      <div class="ov-dist-track"><div class="ov-dist-fill" style="width:${d.pct}%;background:${d.count > 0 ? (d.range.includes('>1') || d.range.includes('0.5-1') ? '#dc3545' : d.range.includes('0.1-0.5') ? '#ffc107' : '#28a745') : '#e8e8e8'}"></div></div>
      <span class="ov-dist-count">${d.count}</span>
    </div>`,
    )
    .join('');

  const maxDiffHtml = data.maxDiff
    ? `<span class="ov-meta-val" style="color:#dc3545">${data.maxDiff.pct}</span> <span class="ov-meta-loc">${esc(data.maxDiff.location)}</span>`
    : '<span class="ov-meta-val" style="color:#28a745">0%</span>';

  return `
  <div class="ov-panel">
    <div class="ov-left">
      <div class="ov-ring-wrap" title="通过 ${passPct}% · Blocker ${blockPct}% · Warning ${warnPct}%">
        <div class="ov-ring" style="background:${ringBg}">
          <span class="ov-ring-pct">${passPct}%</span>
          <span class="ov-ring-label">通过率</span>
        </div>
      </div>
      <div class="ov-stat-grid">
        <div class="ov-stat"><span class="ov-stat-num ov-red">${data.blocker}</span><span class="ov-stat-lbl">Blocker</span><span class="ov-stat-sub">${blockPct}%</span></div>
        <div class="ov-stat"><span class="ov-stat-num ov-yellow">${data.warning}</span><span class="ov-stat-lbl">Warning</span><span class="ov-stat-sub">${warnPct}%</span></div>
        <div class="ov-stat"><span class="ov-stat-num ov-green">${passCount}</span><span class="ov-stat-lbl">通过</span><span class="ov-stat-sub">${passPct}%</span></div>
        <div class="ov-stat"><span class="ov-stat-num">${data.total}</span><span class="ov-stat-lbl">总对比</span></div>
      </div>
    </div>
    <div class="ov-right">
      <div class="ov-dist-section">
        <div class="ov-dist-heading">差异分布</div>
        ${distRows}
      </div>
      <div class="ov-meta-row">
        <div class="ov-meta-item">
          <span class="ov-meta-key">最大差异</span>
          ${maxDiffHtml}
        </div>
        <div class="ov-meta-item">
          <span class="ov-meta-key">平均差异</span>
          <span class="ov-meta-val">${data.avgDiff}</span>
        </div>
        <div class="ov-meta-item">
          <span class="ov-meta-key">步骤/截图/执行</span>
          <span class="ov-meta-val">${data.totalSteps} / ${data.totalScreenshots} / ${data.totalExecutions}</span>
        </div>
        <div class="ov-meta-item">
          <span class="ov-meta-key">生成时间</span>
          <span class="ov-meta-val">${esc(data.generatedAt)}</span>
        </div>
      </div>
    </div>
  </div>`;
}

export interface SummaryRow {
  script: string;
  step: number;
  stepName: string;
  browser: string;
  compareKind: string;
  difference: number;
  severity: string;
  cardId?: string;
}

export function generateSummaryTableHtml(rows: SummaryRow[]): string {
  if (!rows.length) {
    return '<div class="empty-state"><div class="empty-state-title">暂无对比数据</div></div>';
  }
  const sorted = [...rows].sort((a, b) => b.difference - a.difference);
  const bodyRows = sorted
    .map(
      (r) => {
        const pct = (r.difference * 100).toFixed(3);
        const barW = Math.min(r.difference * 10000, 100).toFixed(1);
        const barColor = r.severity === 'blocker' ? '#dc3545' : r.severity === 'warning' ? '#ffc107' : '#28a745';
        const sevClass = r.severity === 'blocker' ? 'severity-blocker' : r.severity === 'warning' ? 'severity-warning' : 'severity-noise';
        const jumpAttr = r.cardId ? ` onclick="document.getElementById('${r.cardId}')?.scrollIntoView({behavior:'smooth',block:'center'})"` : '';
        return `<tr data-sort-diff="${r.difference}" data-sort-severity="${r.severity}" data-sort-script="${esc(r.script)}" data-sort-step="${r.step}" data-sort-browser="${esc(r.browser)}" data-sort-kind="${esc(r.compareKind)}"${jumpAttr}>
          <td>${esc(r.script)}</td>
          <td>${r.step}</td>
          <td>${esc(r.stepName)}</td>
          <td>${esc(r.browser)}</td>
          <td>${esc(r.compareKind)}</td>
          <td>${pct}%<div class="st-bar-wrap"><div class="st-bar-fill" style="width:${barW}%;background:${barColor}"></div></div></td>
          <td><span class="severity-badge ${sevClass}">${r.severity}</span></td>
        </tr>`;
      },
    )
    .join('');

  return `
  <div class="summary-wrap">
    <div class="summary-toolbar">
      <select id="summaryFilterSev" onchange="filterSummaryTable()">
        <option value="all">全部级别</option><option value="blocker">Blocker</option><option value="warning">Warning</option><option value="noise">Noise</option>
      </select>
      <select id="summaryFilterKind" onchange="filterSummaryTable()">
        <option value="all">全部类型</option><option value="same-browser">同浏览器</option><option value="cross-browser">跨浏览器</option>
      </select>
      <input type="search" id="summarySearch" placeholder="搜索脚本/步骤…" oninput="filterSummaryTable()" />
      <span class="summary-hint">点击表头排序 · 点击行跳转到对应卡片</span>
    </div>
    <div class="summary-scroll">
      <table class="summary-table" id="summary-table">
        <thead><tr>
          <th data-col="script" onclick="sortSummaryTable('script')">脚本<span class="sort-arrow">↕</span></th>
          <th data-col="step" onclick="sortSummaryTable('step')">步骤<span class="sort-arrow">↕</span></th>
          <th data-col="stepName" onclick="sortSummaryTable('stepName')">步骤名<span class="sort-arrow">↕</span></th>
          <th data-col="browser" onclick="sortSummaryTable('browser')">浏览器<span class="sort-arrow">↕</span></th>
          <th data-col="kind" onclick="sortSummaryTable('kind')">对比类型<span class="sort-arrow">↕</span></th>
          <th data-col="diff" onclick="sortSummaryTable('diff')">差异率<span class="sort-arrow active">↓</span></th>
          <th data-col="severity" onclick="sortSummaryTable('severity')">严重度<span class="sort-arrow">↕</span></th>
        </tr></thead>
        <tbody>${bodyRows}</tbody>
      </table>
    </div>
  </div>`;
}

export function compareReportVizCss(): string {
  return `
    .viz-dashboard { display: flex; gap: 16px; flex-wrap: wrap; margin: 12px 0 20px; }
    .viz-stat { background: #fff; border: 1px solid #e8e8e8; border-radius: 8px; padding: 12px 20px; min-width: 100px; text-align: center; }
    .viz-num { display: block; font-size: 22px; font-weight: 600; }
    .viz-num.viz-red { color: #dc3545; }
    .viz-num.viz-yellow { color: #d97706; }
    .viz-num.viz-green { color: #28a745; }
    .viz-label { font-size: 12px; color: #86909c; }
    .viz-pct { font-size: 11px; color: #adb5bd; }

    /* ─── Overview panel (Plan 1) ─── */
    .ov-panel { display: flex; gap: 24px; flex-wrap: wrap; background: #fff; border: 1px solid #e8e8e8; border-radius: 10px; padding: 20px 24px; margin-bottom: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.06); }
    .ov-left { display: flex; gap: 20px; align-items: center; flex-shrink: 0; }
    .ov-ring-wrap { flex-shrink: 0; }
    .ov-ring { width: 80px; height: 80px; border-radius: 50%; display: flex; flex-direction: column; align-items: center; justify-content: center; position: relative; }
    .ov-ring::after { content: ''; position: absolute; width: 48px; height: 48px; background: #fff; border-radius: 50%; }
    .ov-ring-pct { font-size: 15px; font-weight: 700; color: #1d2129; z-index: 1; line-height: 1; }
    .ov-ring-label { font-size: 10px; color: #86909c; z-index: 1; margin-top: 2px; }
    .ov-stat-grid { display: flex; gap: 16px; }
    .ov-stat { text-align: center; min-width: 56px; }
    .ov-stat-num { display: block; font-size: 20px; font-weight: 700; color: #1d2129; }
    .ov-stat-num.ov-red { color: #dc3545; }
    .ov-stat-num.ov-yellow { color: #d97706; }
    .ov-stat-num.ov-green { color: #28a745; }
    .ov-stat-lbl { font-size: 11px; color: #86909c; display: block; }
    .ov-stat-sub { font-size: 10px; color: #adb5bd; }
    .ov-right { flex: 1; min-width: 280px; display: flex; flex-direction: column; gap: 12px; }
    .ov-dist-section { display: flex; flex-direction: column; gap: 6px; }
    .ov-dist-heading { font-size: 12px; font-weight: 600; color: #4e5969; margin-bottom: 2px; }
    .ov-dist-row { display: flex; align-items: center; gap: 8px; font-size: 12px; }
    .ov-dist-label { width: 64px; text-align: right; color: #4e5969; flex-shrink: 0; }
    .ov-dist-track { flex: 1; height: 10px; background: #f0f0f0; border-radius: 5px; overflow: hidden; }
    .ov-dist-fill { height: 100%; border-radius: 5px; transition: width 0.4s ease; min-width: 0; }
    .ov-dist-count { width: 32px; text-align: left; color: #86909c; font-weight: 600; }
    .ov-meta-row { display: flex; gap: 16px; flex-wrap: wrap; padding-top: 8px; border-top: 1px solid #f0f0f0; }
    .ov-meta-item { display: flex; gap: 6px; align-items: center; font-size: 12px; }
    .ov-meta-key { color: #86909c; }
    .ov-meta-val { font-weight: 600; color: #1d2129; }
    .ov-meta-loc { color: #4e5969; }

    /* ─── Diff bar in diff-card header (Plan 2) ─── */
    .diff-bar-wrap { flex: 1; min-width: 60px; height: 6px; background: #f0f0f0; border-radius: 3px; overflow: hidden; margin-left: 4px; }
    .diff-bar-fill { height: 100%; border-radius: 3px; transition: width 0.3s ease; min-width: 0; }

    /* ─── Heatmap cell values (Plan 4) ─── */
    .hm-cell .hm-val { font-size: 10px; font-weight: 600; color: rgba(0,0,0,0.6); }
    .hm-cell.hm-red .hm-val { color: #991b1b; }
    .hm-cell.hm-yellow .hm-val { color: #92400e; }
    .hm-summary-cell { font-weight: 600; font-size: 11px; background: #f9fafb; color: #374151; }

    /* ─── Summary table (Plan 5) ─── */
    .summary-wrap { background: #fff; border: 1px solid #e8e8e8; border-radius: 8px; overflow: hidden; }
    .summary-toolbar { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; padding: 10px 16px; border-bottom: 1px solid #e8e8e8; background: #fafafa; }
    .summary-toolbar select, .summary-toolbar input { padding: 5px 10px; border: 1px solid #d6d8db; border-radius: 4px; font-size: 13px; }
    .summary-toolbar .summary-hint { font-size: 12px; color: #86909c; margin-left: auto; }
    .summary-table { width: 100%; border-collapse: collapse; font-size: 13px; }
    .summary-table th, .summary-table td { border: 1px solid #e8e8e8; padding: 7px 10px; text-align: left; white-space: nowrap; }
    .summary-table th { background: #f9fafb; cursor: pointer; user-select: none; position: sticky; top: 0; z-index: 1; }
    .summary-table th:hover { background: #e6f4ff; }
    .summary-table th .sort-arrow { font-size: 10px; margin-left: 3px; color: #adb5bd; }
    .summary-table th .sort-arrow.active { color: #1677ff; }
    .summary-table tbody tr { cursor: pointer; transition: background 0.15s ease; }
    .summary-table tbody tr:hover { background: #f0f7ff; }
    .summary-table .st-bar-wrap { display: inline-block; width: 60px; height: 5px; background: #f0f0f0; border-radius: 3px; overflow: hidden; vertical-align: middle; margin-left: 6px; }
    .summary-table .st-bar-fill { height: 100%; border-radius: 3px; }
    .summary-scroll { max-height: 70vh; overflow: auto; }
    .diff-view-toolbar { display: flex; gap: 6px; margin: 8px 0; flex-wrap: wrap; }
    .diff-view-btn { font-size: 12px; padding: 4px 10px; border: 1px solid #d6d8db; background: #fff; border-radius: 4px; cursor: pointer; }
    .diff-view-btn.active { background: #1677ff; color: #fff; border-color: #1677ff; }
    .diff-view-panels { position: relative; min-height: 120px; }
    .diff-view-panel { display: none; }
    .diff-view-panel.active { display: block; }
    .diff-view-side { display: none; grid-template-columns: repeat(3, 1fr); gap: 8px; }
    .diff-view-side.active { display: grid; }
    .slider-compare { position: relative; width: 100%; max-width: 960px; margin: 0 auto; user-select: none; overflow: hidden; border-radius: 8px; border: 1px solid #e8e8e8; }
    .slider-img { display: block; width: 100%; height: auto; vertical-align: top; }
    .slider-before { position: relative; z-index: 1; }
    .slider-after-clip { position: absolute; top: 0; left: 0; height: 100%; width: 50%; overflow: hidden; z-index: 2; border-right: 2px solid #1677ff; }
    .slider-after-clip .slider-after { width: 100%; max-width: none; height: 100%; object-fit: cover; object-position: left top; }
    .slider-range { position: absolute; bottom: 8px; left: 8%; width: 84%; z-index: 5; opacity: 0.85; }
    .blink-compare { position: relative; max-width: 960px; margin: 0 auto; cursor: pointer; border: 1px solid #e8e8e8; border-radius: 8px; overflow: hidden; }
    .blink-img { display: block; width: 100%; height: auto; }
    .blink-b { display: none; }
    .blink-compare.blink-on .blink-a { display: none; }
    .blink-compare.blink-on .blink-b { display: block; }
    .blink-hint { position: absolute; bottom: 8px; right: 8px; background: rgba(0,0,0,.55); color: #fff; font-size: 11px; padding: 2px 8px; border-radius: 4px; }
    .overlay-compare { max-width: 960px; margin: 0 auto; }
    .overlay-img { width: 100%; height: auto; border: 1px solid #e8e8e8; border-radius: 8px; }
    .overlay-caption { font-size: 12px; color: #86909c; text-align: center; margin-top: 4px; }
    .diff-trend-wrap { margin-left: 8px; vertical-align: middle; }
    .diff-sparkline { vertical-align: middle; }
    .heatmap-wrap { padding: 8px 0; }
    .heatmap-legend { font-size: 13px; margin-bottom: 12px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .heatmap-scroll { overflow: auto; max-height: 70vh; }
    .heatmap-table { border-collapse: collapse; font-size: 12px; min-width: 100%; }
    .heatmap-table th, .heatmap-table td { border: 1px solid #e8e8e8; padding: 8px 10px; text-align: center; }
    .heatmap-table th.hm-script { text-align: left; white-space: nowrap; max-width: 160px; }
    .hm-cell { width: 36px; height: 28px; border-radius: 4px; display: inline-block; }
    .hm-cell.hm-red, td.hm-red { background: #fecaca; }
    .hm-cell.hm-yellow, td.hm-yellow { background: #fef3c7; }
    .hm-cell.hm-green, td.hm-green { background: #d1fae5; }
    .diff-card:focus { outline: 2px solid #1677ff; outline-offset: 2px; }
    .viz-filter-row { display: flex; gap: 8px; flex-wrap: wrap; margin: 8px 0 16px; align-items: center; }
    .viz-filter-row select, .viz-filter-row input { padding: 6px 10px; border: 1px solid #d6d8db; border-radius: 4px; font-size: 13px; }
    .compare-modal { display: none; position: fixed; inset: 0; z-index: 2000; background: rgba(0,0,0,.85); flex-direction: column; }
    .compare-modal.active { display: flex; }
    .compare-modal-bar { display: flex; gap: 8px; padding: 12px 16px; background: #1d2129; color: #fff; align-items: center; }
    .compare-modal-body { flex: 1; overflow: auto; display: flex; gap: 8px; padding: 16px; }
    .compare-modal-pane { flex: 1; overflow: auto; background: #fff; border-radius: 8px; padding: 8px; }
    .compare-modal-pane img { width: 100%; height: auto; }
  `;
}

export function compareReportVizJs(): string {
  return `
    function initDiffCards(root) {
      (root || document).querySelectorAll('[data-diff-card]').forEach(function(card) {
        if (card.dataset.vizInit) return;
        card.dataset.vizInit = '1';
        var toolbar = card.querySelector('.diff-view-toolbar');
        var panels = card.querySelectorAll('.diff-view-panel, .diff-view-side');
        toolbar.querySelectorAll('.diff-view-btn').forEach(function(btn) {
          if (btn.classList.contains('diff-expand-btn')) return;
          btn.addEventListener('click', function() {
            var view = btn.getAttribute('data-view');
            toolbar.querySelectorAll('.diff-view-btn').forEach(function(b) { b.classList.remove('active'); });
            btn.classList.add('active');
            panels.forEach(function(p) { p.classList.remove('active'); });
            var target = view === 'side' ? card.querySelector('.diff-view-side') : card.querySelector('.' + view + '-compare');
            if (target) target.classList.add('active');
          });
        });
        var slider = card.querySelector('.slider-compare');
        if (slider) {
          var range = slider.querySelector('.slider-range');
          var clip = slider.querySelector('.slider-after-clip');
          var afterImg = slider.querySelector('.slider-after');
          function syncSlider() {
            var pct = Number(range.value);
            clip.style.width = pct + '%';
            if (afterImg && slider.offsetWidth) {
              afterImg.style.width = slider.offsetWidth + 'px';
            }
          }
          range.addEventListener('input', syncSlider);
          window.addEventListener('resize', syncSlider);
          syncSlider();
        }
        var blink = card.querySelector('.blink-compare');
        if (blink) {
          var timer = null;
          blink.addEventListener('click', function() {
            if (timer) { clearInterval(timer); timer = null; blink.classList.remove('blink-on'); return; }
            timer = setInterval(function() { blink.classList.toggle('blink-on'); }, 500);
          });
        }
        var expandBtn = card.querySelector('.diff-expand-btn');
        if (expandBtn) {
          expandBtn.addEventListener('click', function() {
            openCompareModal(card.querySelector('.slider-before')?.src, card.querySelector('.slider-after')?.src);
          });
        }
      });
    }
    function openCompareModal(beforeSrc, afterSrc) {
      var m = document.getElementById('compareModal');
      if (!m) return;
      m.querySelector('.cm-before').src = beforeSrc || '';
      m.querySelector('.cm-after').src = afterSrc || '';
      m.classList.add('active');
    }
    function closeCompareModal() {
      var m = document.getElementById('compareModal');
      if (m) m.classList.remove('active');
    }
    function syncModalScroll(el) {
      var panes = document.querySelectorAll('#compareModal .compare-modal-pane');
      if (panes.length < 2) return;
      panes.forEach(function(p) {
        if (p !== el) p.scrollTop = el.scrollTop;
      });
    }
    function applyVizFilters() {
      var sev = document.getElementById('vizFilterSeverity')?.value || 'all';
      var kind = document.getElementById('vizFilterKind')?.value || 'all';
      var q = (document.getElementById('vizFilterSearch')?.value || '').toLowerCase();
      document.querySelectorAll('[data-diff-card]').forEach(function(card) {
        var ok = true;
        if (sev !== 'all' && card.getAttribute('data-severity') !== sev) ok = false;
        if (kind !== 'all' && card.getAttribute('data-compare-kind') !== kind) ok = false;
        if (q && !card.textContent.toLowerCase().includes(q)) ok = false;
        card.style.display = ok ? '' : 'none';
      });
    }
    var vizCardList = [];
    function refreshVizCardList() {
      vizCardList = Array.from(document.querySelectorAll('[data-diff-card]')).filter(function(c) { return c.offsetParent !== null; });
    }
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') closeCompareModal();
      if (e.key === 'b' && document.getElementById('compareModal')?.classList.contains('active')) {
        var blink = document.querySelector('#compareModal .blink-compare');
        if (blink) blink.click();
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        var active = document.activeElement;
        if (!active?.matches?.('[data-diff-card]')) return;
        refreshVizCardList();
        var idx = vizCardList.indexOf(active);
        if (idx < 0) return;
        var next = e.key === 'ArrowRight' ? idx + 1 : idx - 1;
        if (vizCardList[next]) { vizCardList[next].focus(); vizCardList[next].scrollIntoView({ behavior: 'smooth', block: 'center' }); }
      }
    });
    document.addEventListener('DOMContentLoaded', function() {
      initDiffCards(document);
      ['vizFilterSeverity', 'vizFilterKind', 'vizFilterSearch'].forEach(function(id) {
        var el = document.getElementById(id);
        if (el) el.addEventListener('input', applyVizFilters);
        if (el) el.addEventListener('change', applyVizFilters);
      });
    });

    /* ─── Summary table sort & filter (Plan 5) ─── */
    var summarySortCol = 'diff';
    var summarySortDesc = true;
    function sortSummaryTable(col) {
      if (summarySortCol === col) { summarySortDesc = !summarySortDesc; } else { summarySortCol = col; summarySortDesc = true; }
      var tbody = document.querySelector('#summary-table tbody');
      if (!tbody) return;
      var rows = Array.prototype.slice.call(tbody.querySelectorAll('tr'));
      rows.sort(function(a, b) {
        var va = a.getAttribute('data-sort-' + col) || '';
        var vb = b.getAttribute('data-sort-' + col) || '';
        var na = parseFloat(va), nb = parseFloat(vb);
        var cmp = (!isNaN(na) && !isNaN(nb)) ? na - nb : va.localeCompare(vb, 'zh-CN');
        return summarySortDesc ? -cmp : cmp;
      });
      rows.forEach(function(r) { tbody.appendChild(r); });
      document.querySelectorAll('#summary-table th .sort-arrow').forEach(function(s) { s.className = 'sort-arrow'; });
      var th = document.querySelector('#summary-table th[data-col="' + col + '"] .sort-arrow');
      if (th) { th.className = 'sort-arrow active'; th.textContent = summarySortDesc ? '↓' : '↑'; }
    }
    function filterSummaryTable() {
      var sev = (document.getElementById('summaryFilterSev') || {}).value || 'all';
      var kind = (document.getElementById('summaryFilterKind') || {}).value || 'all';
      var q = ((document.getElementById('summarySearch') || {}).value || '').toLowerCase();
      document.querySelectorAll('#summary-table tbody tr').forEach(function(r) {
        var ok = true;
        if (sev !== 'all' && r.getAttribute('data-sort-severity') !== sev) ok = false;
        if (kind !== 'all' && r.getAttribute('data-sort-kind') !== kind) ok = false;
        if (q && r.textContent.toLowerCase().indexOf(q) < 0) ok = false;
        r.style.display = ok ? '' : 'none';
      });
    }

    /* ─── Issues table sort (Plan 6) ─── */
    var issuesSortCol = 'severity';
    var issuesSortDesc = true;
    function sortIssues(col) {
      if (issuesSortCol === col) { issuesSortDesc = !issuesSortDesc; } else { issuesSortCol = col; issuesSortDesc = true; }
      var tbody = document.querySelector('#issues-table tbody');
      if (!tbody) return;
      var rows = Array.prototype.slice.call(tbody.querySelectorAll('tr'));
      rows.sort(function(a, b) {
        var va = a.getAttribute('data-sort-' + col) || '';
        var vb = b.getAttribute('data-sort-' + col) || '';
        var na = parseFloat(va), nb = parseFloat(vb);
        var cmp = (!isNaN(na) && !isNaN(nb)) ? na - nb : va.localeCompare(vb, 'zh-CN');
        return issuesSortDesc ? -cmp : cmp;
      });
      rows.forEach(function(r) { tbody.appendChild(r); });
      document.querySelectorAll('#issues-table th .sort-arrow').forEach(function(s) { s.className = 'sort-arrow'; });
      var th = document.querySelector('#issues-table th[data-sort="' + col + '"] .sort-arrow');
      if (th) { th.className = 'sort-arrow active'; th.textContent = issuesSortDesc ? '↓' : '↑'; }
    }
  `;
}
