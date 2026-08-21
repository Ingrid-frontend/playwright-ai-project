import type {
  CustomerBrowserCard,
  CustomerIssueGroup,
  CustomerPageCard,
  CustomerReportModel,
} from './customer-report-model.js';
import { customerReportCss, customerReportClientJs } from './customer-report-assets.js';
import { friendlyScriptLabel, friendlyStepLabel } from './customer-report-naming.js';

function esc(s: string): string {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function badgeClass(v: CustomerBrowserCard['verdict']): string {
  if (v === 'pass') return 'badge-pass';
  if (v === 'minor') return 'badge-minor';
  if (v === 'regress') return 'badge-regress';
  return 'badge-uncovered';
}

function renderSlider(card: CustomerBrowserCard): string {
  if (!card.currentPath && !card.baselinePath) {
    return `<div class="empty" style="padding:16px;font-size:13px">缺少基线或当前截图，无法对比</div>`;
  }
  // 未建验收基线：仍展示当前截图，避免「未检测」卡片空白
  if (!card.baselinePath && card.currentPath) {
    return `
    <div class="diff-view-panel active" data-view="current">
      <div class="slider-compare" style="--pos:100%">
        <img class="slider-img" src="${esc(card.currentPath)}" alt="当前截图" loading="lazy"
          onerror="this.closest('.diff-view-panel').innerHTML='<div class=&quot;empty&quot; style=&quot;padding:16px;font-size:13px&quot;>当前截图加载失败</div>'">
      </div>
    </div>`;
  }
  if (!card.currentPath && card.baselinePath) {
    return `
    <div class="diff-view-panel active" data-view="baseline">
      <div class="slider-compare" style="--pos:100%">
        <img class="slider-img" src="${esc(card.baselinePath)}" alt="验收基线" loading="lazy">
      </div>
    </div>`;
  }
  return `
    <div class="view-btns">
      <button type="button" class="view-btn active" data-view="marked">标注变化</button>
      <button type="button" class="view-btn" data-view="slider">拖动对比</button>
      <button type="button" class="view-btn" data-view="overlay">像素差异</button>
    </div>
    <div class="diff-view-panel active" data-view="marked">
      ${renderMarkedView(card)}
    </div>
    <div class="diff-view-panel" data-view="slider">
      <div class="slider-compare">
        <img class="slider-img slider-before" src="${esc(card.baselinePath!)}" alt="验收基线" loading="lazy">
        <div class="slider-after-clip">
          <img class="slider-img slider-after" src="${esc(card.currentPath!)}" alt="当前" loading="lazy">
        </div>
        <input type="range" class="slider-range" min="0" max="100" value="50" aria-label="对比滑块">
        <div class="slider-handle-line"></div>
      </div>
      <div class="view-hint">左侧为验收基线，右侧为本次结果</div>
    </div>
    <div class="diff-view-panel" data-view="overlay">${renderOverlayView(card)}</div>
  `;
}

/** 在当前截图上叠加差异区定位框：客户不必逐像素找红点 */
function renderMarkedView(card: CustomerBrowserCard): string {
  const w = card.imageWidth || 0;
  const h = card.imageHeight || 0;
  // 「轻微变化」按分级口径就是无需处理，卡内不允许出现红框，否则与结论自相矛盾。
  const suppressReal = card.verdict !== 'regress';
  const boxes =
    w > 0 && h > 0
      ? card.regions
          .map((r, i) => {
            const style = [
              `left:${((r.x / w) * 100).toFixed(3)}%`,
              `top:${((r.y / h) * 100).toFixed(3)}%`,
              `width:${((r.w / w) * 100).toFixed(3)}%`,
              `height:${((r.h / h) * 100).toFixed(3)}%`,
            ].join(';');
            const kind = r.actionable && !suppressReal ? 'mark-real' : 'mark-benign';
            return `<div class="mark-box ${kind}" style="${style}" title="${esc(r.natureLabel)} ${esc(r.label)}"><span class="mark-tag">${i + 1}</span></div>`;
          })
          .join('')
      : '';
  const empty = boxes ? '' : `<div class="mark-empty">未定位到成块变化区</div>`;
  const realCount = suppressReal ? 0 : card.actionableRegions;
  const benignCount = card.regions.length - realCount;
  const legend =
    card.regions.length > 0
      ? `<div class="mark-legend">
           ${realCount > 0 ? `<span class="lg lg-real">实质变化 ${realCount} 处</span>` : ''}
           ${benignCount > 0 ? `<span class="lg lg-benign">${suppressReal ? `细微差异 ${benignCount} 处` : `位移/渲染差异 ${benignCount} 处（内容一致）`}</span>` : ''}
         </div>`
      : '';
  return `
    <div class="mark-wrap">
      <img class="mark-img" src="${esc(card.currentPath!)}" alt="本次结果与变化标注" loading="lazy">
      ${boxes}
      ${empty}
    </div>
    ${legend}
  `;
}

function renderOverlayView(card: CustomerBrowserCard): string {
  if (!card.overlayPath) {
    return `<img class="overlay-img" src="${esc(card.currentPath!)}" alt="当前" loading="lazy">`;
  }
  return `
    <img class="overlay-img" src="${esc(card.overlayPath)}" alt="差异标注" loading="lazy" onerror="this.style.display='none'">
    <div class="view-hint">红色为逐像素差异点</div>`;
}

function renderBrowserCard(card: CustomerBrowserCard): string {
  return `
  <div class="browser-card ${esc(card.verdict)}">
    <div class="bc-head">
      <strong>${esc(card.browserLabel)}</strong>
      <span class="badge ${badgeClass(card.verdict)}">${esc(card.verdictLabel)} · ${esc(card.differenceLabel)}</span>
    </div>
    ${renderSlider(card)}
    <div class="plain">${esc(card.plainText)}</div>
  </div>`;
}

function renderPageCard(page: CustomerPageCard, opts?: { compact?: boolean }): string {
  return `
  <section class="page-card ${opts?.compact ? 'compact' : ''}" data-status="${esc(page.worstStatus)}">
    <div class="page-head">
      <div>
        <div class="page-title">${esc(page.pageTitle)}${page.processOnly ? '<span class="tag-process">过程截图</span>' : ''}</div>
        <div class="page-sub">${esc(page.scriptLabel)} · 第 ${page.stepNumber} 步</div>
      </div>
    </div>
    <div class="browser-grid">
      ${page.browsers.map(renderBrowserCard).join('')}
    </div>
  </section>`;
}

/** 一个根因一张卡：代表页给出证据，同源步骤折叠在下方 */
function renderIssueGroup(group: CustomerIssueGroup, index: number): string {
  const statusLabel = group.status === 'regress' ? '明显衰退' : '轻微变化';
  const others =
    group.others.length > 0
      ? `<details class="group-others">
           <summary>同一变化还影响 ${group.others.length} 个步骤</summary>
           ${group.others.map((p) => renderPageCard(p, { compact: true })).join('')}
         </details>`
      : '';
  return `
  <article class="issue-group ${esc(group.status)}" id="${esc(group.anchorId)}">
    <header class="ig-head">
      <div class="ig-index">${index + 1}</div>
      <div class="ig-main">
        <div class="ig-title">${esc(group.title)}</div>
        <div class="ig-reason">${esc(group.reason || '检测到与验收基线的差异')}</div>
        <div class="ig-meta">
          <span class="badge ${group.status === 'regress' ? 'badge-regress' : 'badge-minor'}">${statusLabel}</span>
          <span>最大差异 ${esc(group.maxDifferenceLabel)}</span>
          <span>影响 ${group.affectedSteps} 个步骤</span>
          <span>${esc(group.scriptLabels.join('、'))}</span>
        </div>
      </div>
    </header>
    ${renderPageCard(group.representative)}
    ${others}
  </article>`;
}

/**
 * 首屏速览行：不放大图，只用一行说清「哪个页面、什么问题、影响多少步」。
 * 客户扫完这份清单就知道全部结论，需要看图再点进明细。
 */
function renderIssueBrief(group: CustomerIssueGroup, index: number): string {
  const scope =
    group.affectedSteps > 1 ? `影响 ${group.affectedSteps} 个步骤` : '影响 1 个步骤';
  return `
  <li class="brief ${esc(group.status)}">
    <span class="brief-no">${index + 1}</span>
    <span class="brief-main">
      <span class="brief-title">${esc(group.title)}</span>
      <span class="brief-reason">${esc(group.reason || '检测到与验收基线的差异')}</span>
    </span>
    <span class="brief-meta">
      <span class="brief-diff">${esc(group.maxDifferenceLabel)}</span>
      <span class="brief-scope">${esc(scope)}</span>
    </span>
    <a class="brief-link" href="#${esc(group.anchorId)}" onclick="openCustomerIssue('${esc(group.anchorId)}')">看对比图</a>
  </li>`;
}

function renderScopeTable(model: CustomerReportModel): string {
  const rows = model.coverage.slots
    .map((s) => {
      const status =
        s.status === 'pass'
          ? '通过'
          : s.status === 'minor'
            ? '轻微变化'
            : s.status === 'regress'
              ? '明显衰退'
              : '未检测（无验收基线）';
      const kind =
        s.compareKind === 'golden' ? '验收基线' : s.compareKind === 'last-green' ? '最近通过' : '—';
      return `<tr>
        <td>${esc(friendlyStepLabel(s.pageTitle))}</td>
        <td>${esc(friendlyScriptLabel(s.scriptKey))}</td>
        <td>${esc(friendlyStepLabel(s.stepName))}${s.processOnly ? '<span class="tag-process">过程</span>' : ''}</td>
        <td>${s.difference != null ? `${(s.difference * 100).toFixed(2)}%` : '—'}</td>
        <td>${esc(kind)}</td>
        <td class="st-${esc(s.status)}">${esc(status)}</td>
      </tr>`;
    })
    .join('');
  return `
  <table class="scope-table">
    <thead>
      <tr>
        <th>页面</th>
        <th>业务流程</th>
        <th>步骤</th>
        <th>差异</th>
        <th>基线来源</th>
        <th>状态</th>
      </tr>
    </thead>
    <tbody>${rows || '<tr><td colspan="6">无检测项</td></tr>'}</tbody>
  </table>`;
}

function renderUncoveredSummary(model: CustomerReportModel): string {
  const n = model.uncovered.length;
  if (n === 0) return '';
  const scripts = [...new Set(model.uncovered.map((p) => p.scriptKey))];
  const noise = model.uncovered.filter((p) => p.processOnly).length;
  const meaningful = model.uncovered.filter((p) => !p.processOnly);
  const preview = meaningful.slice(0, 8);
  const more = Math.max(0, meaningful.length - preview.length);
  const rows = preview
    .map(
      (p) =>
        `<li><span class="uc-title">${esc(p.pageTitle)}</span><span class="uc-sub">${esc(p.scriptLabel)}</span></li>`,
    )
    .join('');
  return `
  <div class="uncovered-summary">
    <div class="uncovered-summary-title">另有 ${n} 步未建验收基线（未计入通过率）</div>
    <p class="uncovered-summary-meta">涉及 ${scripts.length} 个脚本${noise > 0 ? ` · 其中 ${noise} 步为 before/skipped 过程截图` : ''}。详情见「检测范围」，promote 基线后才会出现在上方对比中。</p>
    ${preview.length > 0 ? `<ul class="uncovered-preview">${rows}${more > 0 ? `<li class="uc-more">… 还有 ${more} 项</li>` : ''}</ul>` : ''}
    <button type="button" class="link-btn" onclick="switchCustomerTab('scope')">查看检测范围</button>
  </div>`;
}

function renderConclusionBody(model: CustomerReportModel): string {
  if (model.coverage.comparedSteps === 0) {
    return `
      <div class="empty">尚无已对比步骤。请先为关键页面建立验收基线，再重新生成报告。</div>
      ${renderUncoveredSummary(model)}`;
  }

  const focus =
    model.regressionGroups.length > 0
      ? `<h3 class="sec-title sec-regress">需要处理 · ${model.regressionGroups.length} 个问题</h3>
         <p class="sec-lead">按根因归并，同一变化影响多个步骤只算一个问题。点「看对比图」查看证据。</p>
         <ol class="brief-list">${model.regressionGroups.map((g, i) => renderIssueBrief(g, i)).join('')}</ol>`
      : `<div class="empty ok">本次未发现需要处理的 UI 衰退</div>`;

  const minorBlock =
    model.minorGroups.length > 0
      ? `<details class="minor-block">
           <summary>
             <span class="badge badge-minor">无需处理</span>
             ${model.minorGroups.length} 项轻微变化（共 ${model.minors.length} 个步骤）· 内容与基线一致，仅位置偏移或字体渲染差异
           </summary>
           <ol class="brief-list">${model.minorGroups.map((g, i) => renderIssueBrief(g, i)).join('')}</ol>
         </details>`
      : '';

  return `
    ${focus}
    ${minorBlock}
    ${renderUncoveredSummary(model)}
  `;
}

export function renderCustomerReportHtml(model: CustomerReportModel): string {
  const c = model.coverage;
  const passPct = (c.passRate * 100).toFixed(1);
  const regressList =
    model.regressionGroups.length > 0
      ? `<h3 class="sec-title sec-regress">需要处理 · ${model.regressionGroups.length} 个问题</h3>
         ${model.regressionGroups.map((g, i) => renderIssueGroup(g, i)).join('')}`
      : `<div class="empty">本次未发现需要处理的 UI 衰退</div>`;
  const minorList =
    model.minorGroups.length > 0
      ? `<h3 class="sec-title sec-minor">无需处理 · ${model.minorGroups.length} 项轻微变化</h3>
         <p class="sec-lead">以下差异范围很小，多为位置偏移或字体渲染不同，不影响功能，可不处理。</p>
         ${model.minorGroups.map((g, i) => renderIssueGroup(g, i)).join('')}`
      : '';
  const verdictClass =
    c.regressSteps > 0 ? 'bad' : c.minorSteps > 0 ? 'watch' : c.comparedSteps === 0 ? 'unknown' : 'good';
  const headline =
    c.regressSteps > 0
      ? `发现 ${model.regressionGroups.length} 个 UI 问题需要处理`
      : c.minorSteps > 0
        ? `存在 ${c.minorSteps} 处轻微变化，建议人工确认`
        : c.comparedSteps === 0
          ? '本次无有效对比，无法给出结论'
          : '本次未发现 UI 衰退';
  const subline =
    c.regressSteps > 0
      ? `影响 ${c.regressSteps} 个检测步骤${c.minorSteps > 0 ? `；另有 ${c.minorSteps} 步为位置偏移等无害差异，无需处理` : ''}`
      : c.minorSteps > 0
        ? `${c.minorSteps} 步存在位置偏移或字体渲染差异，已逐像素核对内容一致，建议人工确认是否接受`
        : `已对比 ${c.comparedSteps} 个步骤，与验收基线一致`;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>UI 衰退检测报告</title>
  <style>${customerReportCss()}</style>
</head>
<body>
  <div class="header">
    <h1>UI 衰退检测报告</h1>
    <div class="sub">生成时间 ${esc(model.generatedAt)} · 与验收基线逐像素比对</div>
  </div>
  <div class="wrap">
    <div class="verdict ${verdictClass}">
      <div class="verdict-title">${esc(headline)}</div>
      <div class="verdict-meta">${esc(subline)}</div>
      <div class="stats">
        <div class="stat"><span class="n n-red">${c.regressSteps}</span><span class="l">明显衰退</span><span class="h">步骤级，需修复</span></div>
        <div class="stat"><span class="n n-amber">${c.minorSteps}</span><span class="l">轻微变化</span><span class="h">内容一致，无需处理</span></div>
        <div class="stat"><span class="n n-green">${c.passSteps}</span><span class="l">完全一致</span><span class="h">与基线零差异</span></div>
        <div class="stat"><span class="n">${c.comparedSteps}</span><span class="l">已对比步骤</span><span class="h">共 ${c.expectedSteps} 步截图</span></div>
      </div>
      <div class="verdict-foot">合格率 ${passPct}%（已对比步骤中无明显衰退的占比）${c.uncoveredSteps > 0 ? ` · ${c.uncoveredSteps} 步尚无验收基线，未参与判定` : ''}</div>
    </div>

    <div class="tabs">
      <button class="tab active" data-tab="conclusion" onclick="switchCustomerTab('conclusion')">结论</button>
      <button class="tab" data-tab="regress" onclick="switchCustomerTab('regress')">对比明细${model.regressionGroups.length > 0 ? ` (${model.regressionGroups.length})` : ''}</button>
      <button class="tab" data-tab="scope" onclick="switchCustomerTab('scope')">检测范围</button>
    </div>

    <div id="panel-conclusion" class="panel active">
      ${renderConclusionBody(model)}
    </div>
    <div id="panel-regress" class="panel">
      ${regressList}
      ${minorList}
    </div>
    <div id="panel-scope" class="panel">
      <p class="sec-lead">下表为本次全部检测项。「未检测」表示该步骤有截图但尚无可配对的验收基线；标记「过程」的是操作中间态截图，不作为验收结论。</p>
      ${renderScopeTable(model)}
    </div>
  </div>
  <script>${customerReportClientJs()}</script>
</body>
</html>`;
}
