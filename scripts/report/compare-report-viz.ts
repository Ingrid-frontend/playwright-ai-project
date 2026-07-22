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
          return `<td class="hm-cell ${SEV_CELL[sev]}" title="${esc(title)}"></td>`;
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
  `;
}
