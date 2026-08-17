import { buildScriptTabs, getBrowserFilterLabel } from './compare-screenshots-render.js';
import { compareReportCss, compareReportClientJs } from './compare-screenshots-report-assets.js';

export function getBrowserIcon(browser: string): string {
  const icons: Record<string, string> = {
    chrome: '🌐',
    firefox: '🦊',
    webkit: '🍎',
    safari: '🍎',
    edge: '📦',
    cross: '⇄',
  };
  return icons[browser] || '🌍';
}

export function buildIterationTabs(iterations: string[]): string {
  return iterations
    .map(
      (iter, index) => `
    <button class="iteration-tab ${index === 0 ? 'active' : ''}" data-iteration="${iter}" onclick="switchIteration('${iter}')">
      <span>${iter}</span>
    </button>
  `,
    )
    .join('');
}

export function buildIterationPanes(
  iterations: string[],
  renderInner: (iter: string) => string,
): string {
  return iterations
    .map(
      (iter, index) => `
    <div class="iteration-content" data-iteration="${iter}" ${index === 0 ? '' : 'style="display: none;"'}>
      ${renderInner(iter)}
    </div>
  `,
    )
    .join('');
}

export function buildScriptTabRows<T extends { testDir: string }>(
  iterations: string[],
  firstIteration: string | undefined,
  iterationMap: Map<string, T[]>,
): string {
  return iterations
    .map(
      (iter) => `<div class="script-tabs-iteration" data-iteration="${iter}" ${
        iter === firstIteration ? '' : 'style="display: none;"'
      }>${buildScriptTabs(iter, iterationMap)}</div>`,
    )
    .join('');
}

export function collectBrowserFilterList(
  allComparisons: Array<{
    optimizedScreenshots: Array<{ browser?: string }>;
  }>,
  hasCrossBrowserData: boolean,
): string[] {
  const allBrowsers = new Set<string>();
  allComparisons.forEach((comp) => {
    comp.optimizedScreenshots.forEach((s) => {
      if (s.browser && s.browser !== 'firefox') {
        allBrowsers.add(s.browser);
      }
    });
  });
  const browserListRaw = Array.from(allBrowsers).sort();
  const browserFilterOrder = ['chrome', 'webkit', 'cross'];
  return browserFilterOrder.filter((b) =>
    b === 'cross' ? hasCrossBrowserData : browserListRaw.includes(b),
  );
}

export function buildBrowserFilterRow(browserList: string[]): string {
  if (browserList.length === 0) return '';
  return `
      <div class="filter-row">
        <span class="filter-label">浏览器：</span>
        <div class="global-browser-buttons">
          ${browserList
            .map(
              (browser, index) => `
          <button class="global-browser-tab ${index === 0 ? 'active' : ''}" data-browser="${browser}" onclick="switchGlobalBrowser('${browser}')" title="${browser === 'cross' ? 'Chrome 基线 vs WebKit 同步骤对比' : ''}">
            ${getBrowserIcon(browser)}
            <span>${getBrowserFilterLabel(browser)}</span>
          </button>
          `,
            )
            .join('')}
        </div>
      </div>`;
}

export interface CompareReportHtmlSlots {
  overviewHtml: string;
  iterationTabs: string;
  scriptTabRows: string;
  browserFilterRow: string;
  crossBrowserOn: boolean;
  optimizedByIteration: string;
  optimizedDiffByIteration: string;
  diffOnlyByIteration: string;
  heatmapHtml: string;
  summaryHtml: string;
  analysisHtml: string;
  issuesHtml: string;
  visualReviewHtml: string;
}

export function renderCompareReportHtml(slots: CompareReportHtmlSlots): string {
  const {
    overviewHtml,
    iterationTabs,
    scriptTabRows,
    browserFilterRow,
    crossBrowserOn,
    optimizedByIteration,
    optimizedDiffByIteration,
    diffOnlyByIteration,
    heatmapHtml,
    summaryHtml,
    analysisHtml,
    issuesHtml,
    visualReviewHtml,
  } = slots;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>截图对比报告</title>
  <style>
${compareReportCss()}
  </style>
</head>
<body>
  <div class="header">
    <h1>📸 截图对比报告</h1>
  </div>

  ${overviewHtml}

  <div class="controls-row">
    <div class="controls-right">
      <div class="controls-right-tools">
        <input class="control-input" id="scriptSearch" placeholder="搜索脚本：展示名、完整路径（如 260515/我的审批_… 或关键词）" oninput="filterScripts(this.value)" />
        <button class="control-button" onclick="collapseAll(true)">折叠全部</button>
        <button class="control-button" onclick="collapseAll(false)">展开全部</button>
      </div>
      <span class="script-search-feedback" id="scriptSearchFeedback" role="status" aria-live="polite"></span>
    </div>

    <div class="filter-panel" role="region" aria-label="筛选">
      <div class="filter-row filter-row-tools">
        <span class="filter-label">Diff 筛选：</span>
        <select id="vizFilterSeverity" style="padding:5px 10px;border:1px solid #d6d8db;border-radius:4px;font-size:13px"><option value="all">全部级别</option><option value="blocker">Blocker</option><option value="warning">Warning</option><option value="noise">Noise</option></select>
        <select id="vizFilterKind" style="padding:5px 10px;border:1px solid #d6d8db;border-radius:4px;font-size:13px"><option value="all">全部类型</option><option value="same-browser">同浏览器</option>${crossBrowserOn ? '<option value="cross-browser">跨浏览器</option>' : ''}</select>
        <input type="search" id="vizFilterSearch" placeholder="步骤名…" style="padding:5px 10px;border:1px solid #d6d8db;border-radius:4px;font-size:13px;min-width:160px" />
        <span style="font-size:12px;color:#86909c">方向键切换 diff 卡片 · 卡片默认滑块对比</span>
      </div>
      <div class="filter-row">
        <span class="filter-label">迭代：</span>
        <div class="iteration-tabs-container">
          ${iterationTabs}
        </div>
      </div>
      <div class="filter-row filter-row-scripts">
        <span class="filter-label">脚本：</span>
        <div class="script-tabs-container">
          ${scriptTabRows}
        </div>
      </div>
      ${browserFilterRow}
    </div>
  </div>
  
  <div class="tabs">
    <button class="tab active" data-report-tab="optimized" onclick="switchTab('optimized')">Optimized 版本</button>
    <button class="tab" data-report-tab="optimized-diff" onclick="switchTab('optimized-diff')">Optimized 差异</button>
    <button class="tab" data-report-tab="diff-only" onclick="switchTab('diff-only')">有差异</button>
    <button class="tab" data-report-tab="visual-review" onclick="switchTab('visual-review')">Visual Review</button>
    <button class="tab" data-report-tab="heatmap" onclick="switchTab('heatmap')">热力图</button>
    <button class="tab" data-report-tab="summary" onclick="switchTab('summary')">对比一览</button>
    <button class="tab" data-report-tab="analysis" onclick="switchTab('analysis')">分析摘要</button>
    <button class="tab" data-report-tab="issues" onclick="switchTab('issues')">问题明细</button>
  </div>
  
  <div id="optimized-content" class="tab-content active">
    ${optimizedByIteration}
  </div>
  
  <div id="optimized-diff-content" class="tab-content">
    <div class="empty-state" id="optimized-diff-empty" style="display: none;">
      <div class="empty-state-icon">📋</div>
      <div class="empty-state-title">暂无可展示的对比</div>
      <div class="empty-state-description">
        <ul class="empty-state-hint">
          <li>本 Tab 展示<strong>同浏览器两次运行</strong>的差异${crossBrowserOn ? '，以及<strong>Chrome ↔ WebKit 跨浏览器</strong>对比' : ''}；不含 Golden 基线对比（见「问题明细」）。</li>
          <li>同一浏览器若只有一次运行，不会出现运行间对比。</li>
          ${crossBrowserOn ? '<li>跨浏览器需同时存在 run-chromium-optimized 与 run-webkit-optimized 下的同步骤截图。</li>' : ''}
        </ul>
      </div>
    </div>
    ${optimizedDiffByIteration}
  </div>

  <div id="diff-only-content" class="tab-content">
    <div class="empty-state" id="diff-only-empty" style="display: none;">
      <div class="empty-state-icon">📋</div>
      <div class="empty-state-title">暂无需要单独关注的差异</div>
      <div class="empty-state-description">
        <ul class="empty-state-hint">
          <li>本 Tab 展示 Golden / 运行间${crossBrowserOn ? ' / 跨浏览器' : ''}中<strong>超过阈值</strong>的差异；Golden 明细见「问题明细」。</li>
          <li>若预期应有项却为空，可切换「浏览器」${crossBrowserOn ? '（含跨浏览器）' : ''}，或确认是否只有单次运行。</li>
          <li>需要在本 Tab 看到更多项时，可调低生成报告时的「有差异」收录比例。</li>
        </ul>
      </div>
    </div>
    ${diffOnlyByIteration}
  </div>

  <div id="visual-review-content" class="tab-content">
    ${visualReviewHtml || '<div class="empty-state"><div class="empty-state-title">暂无 Visual Review</div></div>'}
  </div>

  <div id="heatmap-content" class="tab-content">
    ${heatmapHtml}
  </div>

  <div id="summary-content" class="tab-content">
    ${summaryHtml}
  </div>

  <div id="analysis-content" class="tab-content">
    ${analysisHtml || '<div class="empty-state"><div class="empty-state-title">暂无分析</div></div>'}
  </div>

  <div id="issues-content" class="tab-content">
    ${issuesHtml}
  </div>
  
  <div class="modal" id="modal" onclick="if (event.target === this) closeModal()">
    <button class="modal-close" onclick="closeModal()">&times;</button>
    <div class="modal-content">
      <img class="modal-image" id="modalImage" src="" alt="截图预览">
    </div>
  </div>

  <div class="compare-modal" id="compareModal">
    <div class="compare-modal-bar">
      <span>完整对比（同步滚动）</span>
      <button type="button" class="control-button" onclick="closeCompareModal()">关闭 Esc</button>
    </div>
    <div class="compare-modal-body">
      <div class="compare-modal-pane" onscroll="syncModalScroll(this)"><div class="diff-image-label">基线</div><img class="cm-before" src="" alt="基线"></div>
      <div class="compare-modal-pane" onscroll="syncModalScroll(this)"><div class="diff-image-label">当前</div><img class="cm-after" src="" alt="当前"></div>
    </div>
  </div>
  
  <script>
${compareReportClientJs()}
  </script>
</body>
</html>`;
}
