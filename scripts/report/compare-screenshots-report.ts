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
  browserFilterRow: string;
  summaryHtml: string;
  analysisHtml: string;
  issuesHtml: string;
}

export function renderCompareReportHtml(slots: CompareReportHtmlSlots): string {
  const {
    overviewHtml,
    browserFilterRow,
    summaryHtml,
    analysisHtml,
    issuesHtml,
  } = slots;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>截图对比报告（工程师）</title>
  <style>
${compareReportCss()}
  </style>
</head>
<body>
  <div class="header">
    <h1>截图对比报告（工程师）</h1>
    <p style="margin:8px 0 0;opacity:.85;font-size:13px">调试用：对比一览 / 分析摘要 / 问题明细。客户交付请用 <code>npm run report:customer</code>。</p>
  </div>

  ${overviewHtml}

  <div class="controls-row">
    <div class="filter-panel" role="region" aria-label="筛选">
      ${browserFilterRow}
    </div>
  </div>

  <div class="tabs">
    <button class="tab active" data-report-tab="summary" onclick="switchTab('summary')">对比一览</button>
    <button class="tab" data-report-tab="analysis" onclick="switchTab('analysis')">分析摘要</button>
    <button class="tab" data-report-tab="issues" onclick="switchTab('issues')">问题明细</button>
  </div>

  <div id="summary-content" class="tab-content active">
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
