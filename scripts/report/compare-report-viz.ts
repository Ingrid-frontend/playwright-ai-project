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

function regionBlock(comparison: ImageComparison): { listHtml: string; boxesHtml: string } {
  const regions = comparison.regions;
  if (!regions?.length) return { listHtml: '', boxesHtml: '' };
  const width = comparison.width;
  const height = comparison.height;
  const highMed = regions.filter((r) => r.severity !== 'low');
  const low = regions.filter((r) => r.severity === 'low');
  const rows = [...highMed, ...low]
    .map((r) => {
      const label = r.severity === 'high' ? 'High' : r.severity === 'medium' ? 'Medium' : 'Low';
      const hidden = r.severity === 'low' ? ' data-low="1" style="display:none"' : '';
      return `<li class="vr-region-item vr-${r.severity}" data-severity="${r.severity}"${hidden}>${label} · x:${r.x} y:${r.y} w:${r.w} h:${r.h} · ${(r.ratio * 100).toFixed(3)}%</li>`;
    })
    .join('');
  const boxes =
    width && height
      ? highMed
          .map((r) => {
            const left = ((r.x / width) * 100).toFixed(2);
            const top = ((r.y / height) * 100).toFixed(2);
            const w = ((r.w / width) * 100).toFixed(2);
            const hPct = ((r.h / height) * 100).toFixed(2);
            return `<span class="vr-box vr-${r.severity}" style="left:${left}%;top:${top}%;width:${w}%;height:${hPct}%"></span>`;
          })
          .join('')
      : '';
  const toggle = low.length
    ? `<button type="button" class="vr-toggle-low">显示 ${low.length} 个 Low</button>`
    : '';
  return {
    listHtml: `<div class="vr-regions"><div class="vr-regions-title">${regions.length} visual changes</div><ul class="vr-region-list">${rows}</ul>${toggle}</div>`,
    boxesHtml: boxes,
  };
}

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

  const regions = regionBlock(comparison);

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
        <div class="vr-overlay-wrap">
        ${
          overlayRel
            ? `<img class="overlay-img" src="${overlayRel}" alt="标注叠加" loading="lazy" onerror="this.src='${comparison.image2Path}'">`
            : `<img class="overlay-img" src="${comparison.image2Path}" alt="当前" loading="lazy">`
        }
        ${regions.boxesHtml}
        </div>
        <div class="overlay-caption">当前页 + 红色高亮差异区</div>
      </div>
      ${sideBySide}
    </div>
    ${regions.listHtml}
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

export function generateVisualReviewTabHtml(issues: UiIssue[]): string {
  const src = issues.filter(
    (i) =>
      (i.compareKind === 'golden' || i.compareKind === 'last-green') &&
      i.difference > 0,
  );
  if (!src.length) {
    return `
    <div class="empty-state">
      <div class="empty-state-icon">✅</div>
      <div class="empty-state-title">暂无需要 Visual Review 的变化</div>
      <div class="empty-state-description">相对 Golden / last-green 无像素差异。</div>
    </div>`;
  }

  const items = src
    .map((issue, idx) => {
      const title = issue.snapshotName
        ? `${esc(issue.snapshotName)} · ${esc(issue.state || 'default')}`
        : esc(issue.stepName);
      const regionCount = issue.regions?.length || 0;
      const cli = `npm run visual-review -- --verdict=approved --script=${issue.scriptKey} --run=${issue.runTimestamp || ''} --step=${issue.stepFileName || ''} --browser=${issue.browser}`;
      const card = buildDiffCardHtml(
        {
          image1Path: issue.baselinePath,
          image2Path: issue.currentPath,
          difference: issue.difference,
          diffImagePath: issue.diffImagePath,
          overlayImagePath: issue.overlayImagePath,
          browser: issue.browser,
          compareKind: issue.compareKind === 'last-green' ? 'last-green' : 'golden',
          regions: issue.regions,
          width: issue.width,
          height: issue.height,
        },
        {
          image1Label: 'Baseline',
          image2Label: 'Current',
          browser: issue.browser,
          isCross: false,
          pairLabelHint: '',
          browserPairHint: '',
          sizeHint: issue.sizeMismatch
            ? '<span class="diff-size-hint">尺寸不一致</span>'
            : '',
        },
      );
      return `
      <article class="vr-item" data-vr-idx="${idx}" data-issue-id="${esc(issue.issueId)}" data-script="${esc(issue.scriptKey)}" data-run="${esc(issue.runTimestamp || '')}" data-step="${esc(issue.stepFileName || '')}" data-browser="${esc(issue.browser)}">
        <header class="vr-item-head">
          <div>
            <strong>${title}</strong>
            <span class="vr-meta">${esc(issue.scriptKey)} · step ${issue.stepNumber} · ${esc(issue.browser)} · ${regionCount} regions · ${issue.severity}</span>
          </div>
          <div class="vr-actions">
            <button type="button" class="vr-btn vr-approve" data-verdict="approved">Approve</button>
            <button type="button" class="vr-btn vr-reject" data-verdict="rejected">Reject</button>
          </div>
        </header>
        ${card}
        <p class="vr-cli"><code>${esc(cli)}</code> <button type="button" class="vr-copy-cli">复制 CLI</button></p>
      </article>`;
    })
    .join('');

  return `
  <div class="vr-banner">静态报告无法直接写入 Golden。在 Studio 打开本页时 Approve 会调用本地接口；否则请复制 CLI。</div>
  <div class="vr-list">${items}</div>`;
}

export { compareReportVizCss, compareReportVizJs } from './compare-report-viz-assets.js';
