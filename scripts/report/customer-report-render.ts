import {
  isDiffPage,
  type CustomerBrowserCard,
  type CustomerIssueGroup,
  type CustomerPageCard,
  type CustomerReportModel,
} from './customer-report-model.js';
import type { CustomerRegressionDisplayItem } from './customer-report-bundle.js';
import { customerReportCss, customerReportClientJs } from './customer-report-assets.js';
import {
  buildFeedbackRegisterDescription,
  buildHeadline,
  COVERAGE_GAP_RATIO,
  stripTechnicalNoise,
} from './customer-report-plain.js';
import { IMPACT_TIER_LABEL } from './coverage-stats.js';
import { buildDeliveryTrend } from './customer-delivery-history.js';
import { friendlyScriptLabel, friendlyStepLabel, regionZoneLabel, extractEnvId, envIdSortKey, envLabelFromId } from './customer-report-naming.js';
import { formatDurationSec, formatScriptStartedAt } from './customer-report-run-meta.js';
import type { ScriptRunHistoryEntry } from './customer-report-run-meta.js';

function esc(s: string): string {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderRunIndexCell(r: ScriptRunHistoryEntry): string {
  const latest = r.isLatest ? '<span class="tag-latest">最新</span>' : '';
  return `第 ${r.runIndex} 次${latest}`;
}

function badgeClass(v: CustomerBrowserCard['verdict']): string {
  if (v === 'pass') return 'badge-pass';
  if (v === 'minor') return 'badge-minor';
  if (v === 'regress') return 'badge-regress';
  return 'badge-uncovered';
}

function renderSlider(card: CustomerBrowserCard, opts?: { stepLabel?: string }): string {
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
      <button type="button" class="view-btn active" data-view="side">并排对比</button>
      <button type="button" class="view-btn" data-view="marked">标注变化</button>
      <button type="button" class="view-btn" data-view="slider">拖动对比</button>
      <button type="button" class="view-btn" data-view="overlay">像素差异</button>
    </div>
    <div class="diff-view-panel active" data-view="side">
      ${renderSideBySideView(card, opts?.stepLabel)}
    </div>
    <div class="diff-view-panel" data-view="marked">
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
      <div class="view-hint">左侧为「${esc(opts?.stepLabel || '本步骤')}」验收基线，右侧为同一步骤本次结果</div>
    </div>
    <div class="diff-view-panel" data-view="overlay">${renderOverlayView(card)}</div>
  `;
}

function markEmptyHtml(card: CustomerBrowserCard): string {
  if (card.difference > 0) {
    return `<div class="mark-empty">差异过于分散，请切换「像素差异」查看</div>`;
  }
  return `<div class="mark-empty">未定位到明显变化区</div>`;
}

function renderRegionBoxes(card: CustomerBrowserCard, suppressReal: boolean): string {
  const w = card.imageWidth || 0;
  const h = card.imageHeight || 0;
  if (w <= 0 || h <= 0) return '';
  return card.regions
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
    .join('');
}

/** 基线与当前并排展示，右侧叠加差异标注 */
function dataDriftWarnHtml(card: CustomerBrowserCard): string {
  if (card.stateDriftReason) {
    return `<div class="pair-warn">${esc(stripTechnicalNoise(card.stateDriftReason))}</div>`;
  }
  const natures = card.regions.map((r) => r.nature).filter(Boolean);
  const w = card.imageWidth || 1280;
  const actionable = card.regions.filter((r) => r.actionable);
  const allLeft = actionable.length > 0 && actionable.every((r) => r.x + r.w <= w * 0.28);
  if (natures.includes('appeared') && natures.includes('vanished')) {
    return `<div class="pair-warn">同一快照对比：基线与当前页面状态不一致（如有/无列表数据），多为待办数量变化或基线晋升时环境不同，请确认后重新晋升基线。</div>`;
  }
  if (allLeft && natures.includes('appeared')) {
    return `<div class="pair-warn">差异集中在左侧列表区，多为待办展开方式或条数变化，主内容未变，通常无需修复。</div>`;
  }
  return '';
}

function renderSideBySideView(card: CustomerBrowserCard, stepLabel?: string): string {
  const suppressReal = card.verdict !== 'regress';
  const boxes = renderRegionBoxes(card, suppressReal);
  const empty = boxes ? '' : markEmptyHtml(card);
  const snap = stepLabel ? esc(stepLabel) : '';
  const snapHint = snap ? `<span class="side-snap">${snap}</span>` : '';
  const dataDrift = dataDriftWarnHtml(card);
  return `
    ${dataDrift}
    <div class="side-grid">
      <div class="side-col">
        <div class="side-label">验收基线 ${snapHint}</div>
        <div class="side-img-wrap">
          <img src="${esc(card.baselinePath!)}" alt="验收基线" loading="lazy">
        </div>
      </div>
      <div class="side-col">
        <div class="side-label">本次结果 ${snapHint}</div>
        <div class="side-img-wrap mark-wrap">
          <img class="mark-img" src="${esc(card.currentPath!)}" alt="本次结果" loading="lazy">
          ${boxes}
          ${empty}
        </div>
      </div>
    </div>
    <div class="view-hint">左右均为「${snap || '本步骤'}」同一步骤的验收基线与本次结果，不是跨步骤对比；右侧红实线框为实质变化，灰虚线框为位置偏移/显示差异</div>`;
}

/** 在当前截图上叠加差异区定位框：客户不必逐像素找红点 */
function renderMarkedView(card: CustomerBrowserCard): string {
  // 「轻微变化」按分级口径就是无需处理，卡内不允许出现红框，否则与结论自相矛盾。
  const suppressReal = card.verdict !== 'regress';
  const boxes = renderRegionBoxes(card, suppressReal);
  const empty = boxes ? '' : markEmptyHtml(card);
  const realCount = suppressReal ? 0 : card.actionableRegions;
  const benignCount = card.regions.length - realCount;
  const legend =
    card.regions.length > 0
      ? `<div class="mark-legend">
           ${realCount > 0 ? `<span class="lg lg-real">实质变化 ${realCount} 处</span>` : ''}
           ${benignCount > 0 ? `<span class="lg lg-benign">${suppressReal ? `细微差异 ${benignCount} 处` : `位置偏移/显示差异 ${benignCount} 处（内容一致）`}</span>` : ''}
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
    <div class="view-hint">红色为像素差异点</div>`;
}

function renderBrowserCard(
  card: CustomerBrowserCard,
  opts?: { stepLabel?: string; scriptKey?: string; scriptLabel?: string; stepName?: string; stepNumber?: number },
): string {
  const canAnnotate = Boolean(card.currentPath) && (card.verdict === 'regress' || card.verdict === 'minor');
  const stepLabel = opts?.stepLabel || opts?.stepName || '';
  const feedbackDesc = canAnnotate
    ? buildFeedbackRegisterDescription(card, { stepLabel, browserLabel: card.browserLabel })
    : '';
  const dataAttrs = canAnnotate
    ? ` data-script-key="${esc(opts?.scriptKey || '')}" data-step-name="${esc(opts?.stepName || '')}" data-step-number="${opts?.stepNumber ?? ''}" data-screenshot="${esc(card.currentPath || '')}" data-feedback-desc="${esc(feedbackDesc)}"`
    : '';
  return `
  <div class="browser-card ${esc(card.verdict)}"${dataAttrs}>
    <div class="bc-head">
      <strong>${esc(card.browserLabel)}</strong>
      <span class="badge ${badgeClass(card.verdict)}">${esc(card.verdictLabel)} · ${esc(card.differenceLabel)}</span>
      ${canAnnotate ? '<button type="button" class="fb-annotate-btn" title="登记本条对比问题">登记问题</button>' : ''}
    </div>
    <div class="fb-shot-wrap">
      ${renderSlider(card, opts)}
    </div>
    <div class="plain">${esc(card.plainText)}</div>
  </div>`;
}

function renderPageCard(page: CustomerPageCard, opts?: { compact?: boolean }): string {
  return `
  <section class="page-card ${opts?.compact ? 'compact' : ''}" data-status="${esc(page.worstStatus)}">
    <div class="page-head">
      <div>
        <div class="page-title">${esc(page.pageTitle)}${page.processOnly ? '<span class="tag-process">过程截图</span>' : ''}</div>
        <div class="page-sub">${esc(page.scriptLabel)} · ${esc(page.stepLabel)}</div>
      </div>
    </div>
    <div class="browser-grid">
      ${page.browsers.map((b) => renderBrowserCard(b, {
        stepLabel: page.stepLabel,
        scriptKey: page.scriptKey,
        scriptLabel: page.scriptLabel,
        stepName: page.stepName,
        stepNumber: page.stepNumber,
      })).join('')}
    </div>
  </section>`;
}

/** 一个根因一张卡：代表页给出证据，同源步骤折叠在下方 */
function renderAuditInsights(group: CustomerIssueGroup): string {
  const insights = group.auditInsights || [];
  if (insights.length === 0) return '';
  const items = insights
    .slice(0, 3)
    .map(
      (i) =>
        `<li class="ai-insight sev-${esc(i.severity)}">${esc(i.description)}</li>`,
    )
    .join('');
  return `
    <div class="ai-audit-note">
      <span class="ai-audit-tag">AI 审计影响说明</span>
      <ul class="ai-audit-list">${items}</ul>
    </div>`;
}

function renderSharedBundle(
  bundle: Extract<CustomerRegressionDisplayItem, { kind: 'shared' }>,
  index: number,
): string {
  const statusLabel = IMPACT_TIER_LABEL[bundle.impactTier];
  const stepList = bundle.stepTitles.join('、');
  return `
  <article class="issue-group issue-bundle ${esc(bundle.impactTier === 'blocking' ? 'regress' : 'minor')}" data-impact-tier="${esc(bundle.impactTier)}" id="${esc(bundle.anchorId)}">
    <header class="ig-head">
      <div class="ig-index">${index + 1}</div>
      <div class="ig-main">
        <div class="ig-title">${esc(bundle.title)}</div>
        <div class="ig-reason">${esc(bundle.reason)}</div>
        <div class="ig-meta">
          <span class="badge ${bundle.impactTier === 'blocking' ? 'badge-regress' : 'badge-minor'}">${statusLabel}</span>
          <span class="ig-nature">${esc(bundle.natureLabel)}</span>
          <span title="差异率 = 差异像素 / 可比较区域像素，仅供参考，不代表严重程度">像素差异 ${esc(bundle.maxDifferenceLabel)}</span>
          <span>影响 ${bundle.affectedSteps} 个步骤：${esc(stepList)}</span>
        </div>
        <p class="bundle-note">此为同一类公共布局变化，下列各步骤分别与各自验收基线对比，不会把不同步骤的截图放在一起比较。</p>
      </div>
    </header>
    ${bundle.groups
      .map(
        (g) => `
      <section class="bundle-step" id="${esc(g.anchorId)}">
        <h4 class="bundle-step-title">${esc(g.title)}</h4>
        ${renderPageCard(g.representative)}
      </section>`,
      )
      .join('')}
  </article>`;
}

function renderRegressionDisplayItem(
  item: CustomerRegressionDisplayItem,
  index: number,
  model: CustomerReportModel,
): string {
  if (item.kind === 'shared') return renderSharedBundle(item, index);
  return renderIssueGroup(item.group, index, model);
}

function renderIssueGroup(group: CustomerIssueGroup, index: number, _model: CustomerReportModel): string {
  const statusLabel = IMPACT_TIER_LABEL[group.impactTier];
  const primary = group.representative.browsers[0];
  const regionList = primary ? renderRegionList(primary) : '';
  const auditNote = renderAuditInsights(group);
  const others =
    group.others.length > 0
      ? `<details class="group-others">
           <summary>同一变化还影响 ${group.others.length} 个步骤</summary>
           ${group.others.map((p) => renderPageCard(p, { compact: true })).join('')}
         </details>`
      : '';
  return `
  <article class="issue-group ${esc(group.status)}" data-impact-tier="${esc(group.impactTier)}" id="${esc(group.anchorId)}">
    <header class="ig-head">
      <div class="ig-index">${index + 1}</div>
      <div class="ig-main">
        <div class="ig-title">${esc(group.title)}</div>
        <div class="ig-reason">${esc(group.reason || '检测到与验收基线的差异')}</div>
        <div class="ig-meta">
          <span class="badge ${group.impactTier === 'blocking' ? 'badge-regress' : 'badge-minor'}">${statusLabel}</span>
          <span class="ig-nature">${esc(natureTagForGroup(group))}</span>
          <span title="差异率 = 差异像素 / 可比较区域像素，仅供参考，不代表严重程度">像素差异 ${esc(group.maxDifferenceLabel)}</span>
          <span>影响 ${group.affectedSteps} 个步骤</span>
          <span>${esc(group.scriptLabels.join('、'))}</span>
        </div>
        ${regionList}
        ${auditNote}
      </div>
    </header>
    ${renderPageCard(group.representative)}
    ${others}
  </article>`;
}

function renderRegionList(card: CustomerBrowserCard): string {
  if (card.regions.length === 0) return '';
  const w = card.imageWidth || 0;
  const h = card.imageHeight || 0;
  const items = card.regions
    .slice(0, 3)
    .map((r, i) => {
      const zone = regionZoneLabel(r, w, h);
      return `<li><span class="rl-no">${i + 1}</span>${esc(zone)} ${esc(r.natureLabel)}</li>`;
    })
    .join('');
  return `<ul class="region-list">${items}</ul>`;
}

/**
 * 首屏速览行：不放大图，只用一行说清「哪个页面、什么问题、影响多少步」。
 * 客户扫完这份清单就知道全部结论，需要看图再点进明细。
 */
function renderBriefThumb(card: CustomerBrowserCard): string {
  if (!card.currentPath) {
    return `<span class="brief-thumb brief-thumb-empty">无图</span>`;
  }
  const w = card.imageWidth || 0;
  const h = card.imageHeight || 0;
  const suppressReal = card.verdict !== 'regress';
  const boxes =
    w > 0 && h > 0
      ? card.regions
          .slice(0, 3)
          .map((r, i) => {
            const style = [
              `left:${((r.x / w) * 100).toFixed(3)}%`,
              `top:${((r.y / h) * 100).toFixed(3)}%`,
              `width:${((r.w / w) * 100).toFixed(3)}%`,
              `height:${((r.h / h) * 100).toFixed(3)}%`,
            ].join(';');
            const kind = r.actionable && !suppressReal ? 'mark-real' : 'mark-benign';
            return `<div class="mark-box ${kind}" style="${style}"><span class="mark-tag">${i + 1}</span></div>`;
          })
          .join('')
      : '';
  return `
    <div class="brief-thumb">
      <img src="${esc(card.currentPath)}" alt="" loading="lazy">
      ${boxes}
    </div>`;
}

/**
 * 性质标签必须与结论同源：此前这里取「第一个区域」的性质，
 * 与 reason 里「只是整体挪了约 9px」的结论可能完全不同，出现同一卡片自相矛盾。
 */
/**
 * 按业务影响拆分非阻断差异组。步骤数取自受影响步骤（与统计口径同源），
 * 不能用页面数，否则会出现「26 步」与「24 步」对不上账。
 */
function splitMinorGroups(model: CustomerReportModel): {
  degraded: CustomerIssueGroup[];
  benign: CustomerIssueGroup[];
  degradedSteps: number;
  benignSteps: number;
} {
  const degraded = model.minorGroups.filter((g) => g.impactTier === 'degraded');
  const benign = model.minorGroups.filter((g) => g.impactTier === 'benign');
  return {
    degraded,
    benign,
    degradedSteps: degraded.reduce((s, g) => s + g.affectedSteps, 0),
    benignSteps: benign.reduce((s, g) => s + g.affectedSteps, 0),
  };
}

function natureTagForGroup(group: CustomerIssueGroup): string {
  return group.natureLabel || '';
}

function renderCoverageBar(model: CustomerReportModel): string {
  const c = model.coverage;
  if (c.expectedSteps === 0) return '';
  const pct = Math.round((c.comparedSteps / c.expectedSteps) * 100);
  const level = pct < 50 ? 'low' : pct < 80 ? 'mid' : 'ok';
  const uncoveredNote =
    c.uncoveredSteps > 0
      ? `<span class="cov-note warn">${c.uncoveredSteps} 步待建基线，未参与判定</span>`
      : '';
  return `
  <div class="coverage-bar coverage-${level}">
    <div class="cov-head">
      <span class="cov-label">检测覆盖</span>
      <span class="cov-pct">${pct}%</span>
      <span class="cov-detail">已对比 ${c.comparedSteps} / 共 ${c.expectedSteps} 步</span>
    </div>
    <div class="cov-track"><div class="cov-fill" style="width:${pct}%"></div></div>
    ${uncoveredNote}
  </div>`;
}

function renderTrendPanel(model: CustomerReportModel): string {
  // 未确定单一环境时不展示趋势，不能回退到所有环境的历史。
  if (!model.envId) return '';
  const trend = buildDeliveryTrend(model.envId);
  if (trend.entries.length < 2) return '';

  const rows = trend.entries.slice(-5).map((e) => {
    const date = e.generatedAt.slice(0, 10);
    return `<tr>
      <td>${esc(date)}</td>
      <td>${e.stats.coveragePct}%</td>
      <td>${e.stats.passRate}%</td>
      <td class="${e.stats.regressSteps > 0 ? 'n-red' : ''}">${e.stats.regressSteps}</td>
      <td>${e.stats.degradedSteps + e.stats.benignSteps}</td>
    </tr>`;
  }).join('');

  let deltaLine = '';
  if (trend.previous) {
    const fmt = (d: number, suffix = ''): string => `${d > 0 ? '+' : ''}${d}${suffix}`;
    deltaLine = `<div class="trend-delta">
      较上次：覆盖率 ${fmt(trend.coverageDelta, '%')} · 通过率 ${fmt(trend.passRateDelta, '%')} · 衰退 ${fmt(trend.regressDelta)}
    </div>`;
  }

  return `
  <div class="trend-panel">
    <div class="trend-head">近期趋势（最近 ${trend.entries.length} 次交付）</div>
    <table class="trend-table">
      <thead><tr><th>日期</th><th>覆盖率</th><th>通过率</th><th>衰退</th><th>需确认</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ${deltaLine}
  </div>`;
}

function renderActionItems(model: CustomerReportModel): string {
  if (model.actionItems.length === 0) return '';
  const rows = model.actionItems.map((item, i) => `<li>${i + 1}. ${esc(item)}</li>`).join('');
  return `
  <section class="action-box">
    <h3 class="action-title">建议操作</h3>
    <ol class="action-list">${rows}</ol>
  </section>`;
}

function renderReadingGuide(): string {
  return `
  <details class="reading-guide">
    <summary>阅读指南（30 秒看懂）</summary>
    <ol>
      <li><b>一步一对比</b>：证据区每个步骤单独与各自基线对比，不会把不同步骤的截图放在一起。顶栏/侧栏等<b>公共布局</b>在多个步骤重复出现时，首屏会合并为一条，但展开后仍是逐步对比。</li>
      <li>看结论颜色：红 = 需修复后才能验收；琥珀 = 内容确实有变化但未阻断，建议修；灰 = 内容没变（只是位置或显示差异），可忽略；绿 = 完全一致。</li>
      <li><b>差异百分比不代表严重程度</b>：整体挪动几像素的差异率可能高于「少了一个按钮」。严重程度看上面三档，百分比只作参考。</li>
      <li>问题清单每行可点「看对比图」查看证据；框线含义：红实线 = 内容变化，灰虚线 = 位置或显示差异。</li>
      <li>「待建基线」不算通过，需补基线后再测。</li>
    </ol>
  </details>`;
}
function renderRegressionBrief(item: CustomerRegressionDisplayItem, index: number): string {
  if (item.kind === 'single') return renderIssueBrief(item.group, index);
  const card = item.groups[0]?.representative.browsers[0];
  const priority =
    item.impactTier === 'blocking'
      ? '<span class="brief-priority p0">需修复</span>'
      : item.impactTier === 'degraded'
        ? '<span class="brief-priority p1">建议修</span>'
        : '<span class="brief-priority p2">可忽略</span>';
  const natureTag = item.natureLabel ? `<span class="brief-nature">${esc(item.natureLabel)}</span>` : '';
  const steps = item.stepTitles.join('、');
  return `
  <li class="brief regress" data-impact-tier="${esc(item.impactTier)}">
    ${card ? renderBriefThumb(card) : ''}
    <span class="brief-no">${index + 1}</span>
    <span class="brief-main">
      <span class="brief-tags">${priority}${natureTag}</span>
      <span class="brief-title">${esc(item.title)}</span>
      <span class="brief-reason">${esc(stripTechnicalNoise(item.reason))}（涉及：${esc(steps)}）</span>
    </span>
    <span class="brief-meta">
      <span class="brief-diff" title="差异率 = 有效差异像素 / 可比较区域像素">${esc(item.maxDifferenceLabel)}</span>
      <span class="brief-scope">影响 ${item.affectedSteps} 个步骤</span>
    </span>
    <a class="brief-link" href="#${esc(item.anchorId)}" onclick="openCustomerIssue('${esc(item.anchorId)}')">看对比图</a>
  </li>`;
}

function renderIssueBrief(group: CustomerIssueGroup, index: number): string {
  const card = group.representative.browsers[0];
  const scope =
    group.affectedSteps > 1 ? `影响 ${group.affectedSteps} 个步骤` : '影响 1 个步骤';
  const natureTag = natureTagForGroup(group);
  const priority =
    group.impactTier === 'blocking'
      ? '<span class="brief-priority p0">需修复</span>'
      : group.impactTier === 'degraded'
        ? '<span class="brief-priority p1">建议修</span>'
        : '<span class="brief-priority p2">可忽略</span>';
  const scripts =
    group.scriptLabels.length > 0 ? `<span class="brief-flow">${esc(group.scriptLabels.join('、'))}</span>` : '';
  return `
  <li class="brief ${esc(group.status)}" data-impact-tier="${esc(group.impactTier)}">
    ${card ? renderBriefThumb(card) : ''}
    <span class="brief-no">${index + 1}</span>
    <span class="brief-main">
      <span class="brief-tags">
        ${priority}
        ${natureTag ? `<span class="brief-nature">${esc(natureTag)}</span>` : ''}
      </span>
      <span class="brief-title">${esc(group.title)}</span>
      <span class="brief-reason">${esc(stripTechnicalNoise(group.reason || '检测到与验收基线的差异'))}</span>
      ${group.auditInsights?.length ? `<span class="brief-ai">${esc(group.auditInsights[0]!.description)}</span>` : ''}
      ${scripts}
    </span>
    <span class="brief-meta">
      <span class="brief-diff" title="差异率 = 有效差异像素 / 可比较区域像素">${esc(group.maxDifferenceLabel)}</span>
      <span class="brief-scope">${esc(scope)}</span>
    </span>
    <a class="brief-link" href="#${esc(group.anchorId)}" onclick="openCustomerIssue('${esc(group.anchorId)}')">看对比图</a>
  </li>`;
}

function renderScopeRow(s: CustomerReportModel['coverage']['slots'][0], model: CustomerReportModel): string {
  const status =
    s.status === 'pass'
      ? '通过'
      : s.status === 'minor'
        ? '无需处理'
        : s.status === 'regress'
          ? '需要修复'
          : '待建基线';
  const kind =
    s.compareKind === 'golden' ? '验收基线' : s.compareKind === 'last-green' ? '最近通过' : '—';
  const runStart = formatScriptStartedAt(model.scriptRuns.get(s.scriptKey)?.startedAt) || '—';
  return `<tr data-status="${esc(s.status)}">
    <td>${esc(friendlyStepLabel(s.pageTitle))}</td>
    <td>${esc(friendlyStepLabel(s.stepName))}${s.processOnly ? '<span class="tag-process">过程</span>' : ''}</td>
    <td>${s.difference != null ? `${(s.difference * 100).toFixed(2)}%` : '—'}</td>
    <td>${esc(kind)}</td>
    <td>${esc(runStart)}</td>
    <td class="st-${esc(s.status)}">${esc(status)}</td>
  </tr>`;
}

function renderScopeTable(model: CustomerReportModel): string {
  const byScript = new Map<string, typeof model.coverage.slots>();
  for (const s of model.coverage.slots) {
    if (!byScript.has(s.scriptKey)) byScript.set(s.scriptKey, []);
    byScript.get(s.scriptKey)!.push(s);
  }

  const filters = `
  <div class="scope-filters">
    <span class="scope-filter-label">筛选：</span>
    <button type="button" class="scope-filter active" data-scope-filter="all" onclick="filterScopeStatus('all')">全部</button>
    <button type="button" class="scope-filter" data-scope-filter="regress" onclick="filterScopeStatus('regress')">需要修复</button>
    <button type="button" class="scope-filter" data-scope-filter="minor" onclick="filterScopeStatus('minor')">无需处理</button>
    <button type="button" class="scope-filter" data-scope-filter="pass" onclick="filterScopeStatus('pass')">通过</button>
    <button type="button" class="scope-filter" data-scope-filter="uncovered" onclick="filterScopeStatus('uncovered')">待建基线</button>
  </div>`;

  const sections = [...byScript.entries()]
    .sort(([a], [b]) => friendlyScriptLabel(a).localeCompare(friendlyScriptLabel(b), 'zh-CN'))
    .map(([scriptKey, slots]) => {
      const label = friendlyScriptLabel(scriptKey);
      const rows = slots.map((s) => renderScopeRow(s, model)).join('');
      return `
    <section class="scope-group" data-script="${esc(scriptKey)}">
      <h3 class="scope-group-title">${esc(label)} <span class="scope-group-count">${slots.length} 项</span></h3>
      <table class="scope-table">
        <thead>
          <tr>
            <th>页面</th>
            <th>步骤</th>
            <th>差异</th>
            <th>基线来源</th>
            <th>开始时间</th>
            <th>状态</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </section>`;
    })
    .join('');

  return `${filters}${sections || '<div class="empty">无检测项</div>'}`;
}

function runHistoryStatusClass(verdict: string): string {
  if (verdict === 'regress') return 'st-regress';
  if (verdict === 'minor') return 'st-minor';
  if (verdict === 'pass') return 'st-pass';
  if (verdict === 'empty' || verdict === 'uncovered') return 'st-empty';
  return 'st-uncovered';
}

function renderRunHistoryRow(r: ScriptRunHistoryEntry, opts?: { showShots?: boolean }): string {
  const start = formatScriptStartedAt(r.startedAt) || '—';
  const dur = formatDurationSec(r.durationSec) || '—';
  const diff =
    r.comparedSteps > 0 && r.maxDifference > 0
      ? `${(r.maxDifference * 100).toFixed(2)}%`
      : r.comparedSteps > 0
        ? '0.00%'
        : '—';
  const exec =
    r.screenshotCount === 0 && r.comparedSteps === 0
      ? '—'
      : r.ok === false
        ? '失败'
        : r.ok === true
          ? '通过'
          : '—';
  const shotCell = r.screenshotsPruned
    ? `${r.screenshotCount}<span class="shot-pruned-tag" title="截图已清理，数量为清理前记录">已清理</span>`
    : String(r.screenshotCount);
  const row = `<tr>
    <td>${renderRunIndexCell(r)}</td>
    <td>${esc(start)}</td>
    <td>${esc(dur)}</td>
    <td class="shot-count-cell">${shotCell}</td>
    <td>${r.comparedSteps}</td>
    <td>${diff}</td>
    <td>${esc(exec)}</td>
    <td class="${runHistoryStatusClass(r.verdict)}">${esc(r.verdictLabel)}</td>
  </tr>`;
  if (!opts?.showShots) return row;
  const shots = renderRunHistoryShotRow(r);
  return shots ? `${row}${shots}` : row;
}

function runHistoryShotStatusClass(status?: string): string {
  if (status === 'regress') return 'shot-regress';
  if (status === 'minor') return 'shot-minor';
  if (status === 'pass') return 'shot-pass';
  return 'shot-uncovered';
}

function renderRunHistoryCompareCards(pages: CustomerPageCard[]): string {
  return pages.filter(isDiffPage).map((p) => renderPageCard(p)).join('');
}

function renderRunHistoryShotRow(r: ScriptRunHistoryEntry): string {
  if (r.comparePages?.length) {
    const cards = renderRunHistoryCompareCards(r.comparePages);
    if (!cards) return '';
    return `<tr class="run-history-shots-row"><td colspan="8"><div class="run-history-compare">${cards}</div></td></tr>`;
  }
  if (r.previews?.length) {
    const items = r.previews
      .map((p) => {
        const src = p.currentPath || p.baselinePath;
        if (!src) return '';
        return `
        <figure class="run-history-shot ${runHistoryShotStatusClass(p.status)}">
          <div class="run-history-shot-img">
            <img src="${esc(src)}" alt="" loading="lazy">
          </div>
          <figcaption>${esc(p.stepLabel)}</figcaption>
        </figure>`;
      })
      .filter(Boolean)
      .join('');
    if (!items) return '';
    return `<tr class="run-history-shots-row"><td colspan="8"><div class="run-history-shot-grid">${items}</div></td></tr>`;
  }
  if (r.screenshotsPruned && r.screenshotCount > 0) {
    return `<tr class="run-history-shots-row"><td colspan="8"><div class="run-history-shot-empty">第 ${r.runIndex} 次共 ${r.screenshotCount} 张截图已清理，仅保留历史判定（.golden-match.json）</div></td></tr>`;
  }
  if (r.screenshotCount > 0) {
    return `<tr class="run-history-shots-row"><td colspan="8"><div class="run-history-shot-empty">第 ${r.runIndex} 次截图目录已清理或无法加载</div></td></tr>`;
  }
  return '';
}

type RunHistoryScriptEntry = [string, ScriptRunHistoryEntry[]];

function envAnchorId(envId: string): string {
  const slug = String(envId || 'other')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-|-$/g, '');
  return `run-env-${slug || 'other'}`;
}

function groupRunHistoryByEnv(entries: RunHistoryScriptEntry[]): Map<string, RunHistoryScriptEntry[]> {
  const byEnv = new Map<string, RunHistoryScriptEntry[]>();
  for (const entry of entries) {
    const envId = extractEnvId(entry[0]) || 'other';
    if (!byEnv.has(envId)) byEnv.set(envId, []);
    byEnv.get(envId)!.push(entry);
  }
  for (const list of byEnv.values()) {
    list.sort(([a], [b]) => friendlyScriptLabel(a).localeCompare(friendlyScriptLabel(b), 'zh-CN'));
  }
  return byEnv;
}

function sortedEnvIds(byEnv: Map<string, RunHistoryScriptEntry[]>): string[] {
  return [...byEnv.keys()].sort((a, b) => {
    const ka = envIdSortKey(a);
    const kb = envIdSortKey(b);
    if (ka !== kb) return ka - kb;
    return a.localeCompare(b);
  });
}

function renderRunHistoryEnvLayout(
  grouped: Map<string, RunHistoryScriptEntry[]>,
  renderBlock: (scriptKey: string, rows: ScriptRunHistoryEntry[]) => string,
): string {
  const envIds = sortedEnvIds(grouped);
  if (!envIds.length) return '';

  const mainParts: string[] = [];
  const anchorParts: string[] = [];

  for (const envId of envIds) {
    const entries = grouped.get(envId)!;
    const anchorId = envAnchorId(envId);
    const blocks = entries.map(([scriptKey, rows]) => renderBlock(scriptKey, rows)).join('');
    mainParts.push(`
      <section class="run-history-env-group" id="${esc(anchorId)}" data-env="${esc(envId)}">
        <h2 class="run-history-env-title">${esc(envLabelFromId(envId) || envId)}</h2>
        ${blocks}
      </section>`);
    anchorParts.push(
      `<a class="run-history-anchor-link" href="#${esc(anchorId)}" data-env-anchor="${esc(anchorId)}">${esc(envLabelFromId(envId) || envId)}</a>`,
    );
  }

  if (envIds.length <= 1) return mainParts.join('');

  return `
  <div class="run-history-layout">
    <div class="run-history-main">${mainParts.join('')}</div>
    <aside class="run-history-anchor" aria-label="环境索引">
      <nav class="run-history-anchor-nav">${anchorParts.join('')}</nav>
    </aside>
  </div>`;
}

function countMinorRuns(model: CustomerReportModel): number {
  let n = 0;
  for (const rows of model.runHistory.values()) {
    n += rows.filter((r) => r.verdict === 'minor').length;
  }
  return n;
}

function renderRunHistoryTable(rows: ScriptRunHistoryEntry[], opts?: { showShots?: boolean }): string {
  const body = [...rows]
    .sort((a, b) => b.runIndex - a.runIndex)
    .map((r) => renderRunHistoryRow(r, opts))
    .join('');
  return `
      <table class="scope-table run-history-table">
        <thead>
          <tr>
            <th>次序</th>
            <th>开始时间</th>
            <th>耗时</th>
            <th>截图</th>
            <th>已对比</th>
            <th>最大差异</th>
            <th>用例</th>
            <th>判定</th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>`;
}

function renderMinorRunHistoryPanel(model: CustomerReportModel): string {
  const entries: RunHistoryScriptEntry[] = [...model.runHistory.entries()]
    .map(([scriptKey, rows]): RunHistoryScriptEntry => [scriptKey, rows.filter((r) => r.verdict === 'minor')])
    .filter(([, rows]) => rows.length > 0);

  if (!entries.length) return '';

  return renderRunHistoryEnvLayout(groupRunHistoryByEnv(entries), (scriptKey, rows) => {
    const label = friendlyScriptLabel(scriptKey);
    return `
    <section class="run-history-block">
      <h3 class="run-history-title">${esc(label)}</h3>
      <p class="run-history-meta">共 ${rows.length} 次运行存在可接受差异 · 多为位置偏移、显示效果或测试数据变化</p>
      ${renderRunHistoryTable(rows, { showShots: true })}
    </section>`;
  });
}

function minorTabLabel(latestCount: number, latestSteps: number, minorRunCount: number): string {
  if (latestCount > 0 && minorRunCount > 0) {
    return `可接受差异 · 本轮 ${latestCount} 组（${latestSteps} 步）/ 历史 ${minorRunCount} 次`;
  }
  if (latestCount > 0) return `可接受差异 · ${latestCount} 组（${latestSteps} 步）`;
  return `历史留档（${minorRunCount} 次）`;
}

function renderMinorTabBody(
  model: CustomerReportModel,
  minorGroupsHtml: string,
  minorRunCount: number,
): string {
  const runLog = renderMinorRunHistoryPanel(model);
  const latestCount = model.minorGroups.length;
  const latest =
    minorGroupsHtml ||
    `<div class="empty ok">最新一轮未发现轻微变化</div>`;
  const history =
    runLog ||
    `<div class="empty">历次 Golden 回归中暂无轻微变化记录</div>`;
  const historyTitle =
    minorRunCount > 0 ? `历史留档 · ${minorRunCount} 次 run` : '历史留档';
  const latestBlock =
    latestCount > 0
      ? `<h3 class="sec-title sec-minor">本轮可接受差异 · ${latestCount} 组（影响 ${model.minors.length} 步）</h3>${latest}`
      : '';
  const historyBlock =
    minorRunCount > 0
      ? `<h3 class="sec-title sec-minor"${latestCount > 0 ? ' style="margin-top:24px"' : ''}>${historyTitle}</h3>${history}`
      : '';
  return `${latestBlock}${historyBlock}`;
}

function renderUncoveredSummary(model: CustomerReportModel): string {
  const n = model.uncovered.length;
  if (n === 0) return '';
  const scripts = [...new Set(model.uncovered.map((p) => p.scriptKey))];
  const noise = model.uncovered.filter((p) => p.processOnly).length;
  const meaningful = model.uncovered.filter((p) => !p.processOnly);
  const uniquePages = new Set(meaningful.map((p) => p.pageTitle)).size;
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
    <div class="uncovered-summary-title">另有 ${n} 步未建验收基线（未参与本次判定）</div>
    <p class="uncovered-summary-meta">涉及 ${scripts.length} 个脚本${uniquePages > 0 ? ` · 去重后 ${uniquePages} 个不同页面` : ''}${noise > 0 ? ` · 其中 ${noise} 步为 before/skipped 过程截图` : ''}。详情见「检测覆盖」，建立验收基线后才会出现在上方对比中。</p>
    ${preview.length > 0 ? `<ul class="uncovered-preview">${rows}${more > 0 ? `<li class="uc-more">… 还有 ${more} 项</li>` : ''}</ul>` : ''}
    <button type="button" class="link-btn" onclick="switchCustomerTab('scope')">查看检测覆盖</button>
  </div>`;
}

function renderIncompleteNotice(model: CustomerReportModel): string {
  const list = model.incompleteScripts;
  if (!list?.length) return '';
  const rows = list
    .map((item) => `<li><strong>${esc(item.scriptLabel)}</strong> — ${esc(item.detail)}</li>`)
    .join('');
  return `<div class="incomplete-notice">
    <div class="incomplete-notice-title">部分脚本最新 run 未完成</div>
    <ul>${rows}</ul>
    <p class="incomplete-notice-meta">上方结论与检测覆盖已基于最近一次<strong>完整</strong> run；未完成 run 不参与结论，如需排查可在本地按截图目录时间定位。</p>
  </div>`;
}

function renderEnvBreakdown(model: CustomerReportModel): string {
  const list = model.envSummaries;
  if (!list?.length || list.length < 2) return '';
  const rows = list
    .map((env) => {
      const verdict =
        env.regressSteps > 0
          ? `<span class="env-bad">${env.regressSteps} 需修复</span>`
          : env.minorSteps > 0
            ? `<span class="env-watch">${env.minorSteps} 轻微</span>`
            : env.comparedSteps < env.expectedSteps
              ? `<span class="env-ok">通过（${env.comparedSteps}/${env.expectedSteps} 步）</span>`
              : `<span class="env-ok">通过</span>`;
      return `<tr>
        <td>${esc(env.envLabel)}</td>
        <td>${env.comparedSteps}/${env.expectedSteps}</td>
        <td>${verdict}</td>
      </tr>`;
    })
    .join('');
  return `<div class="env-breakdown">
    <h3 class="sec-title">分环境结论</h3>
    <p class="sec-lead">本报告含 ${list.length} 个环境，各环境独立统计如下。</p>
    <table class="scope-table env-table">
      <thead><tr><th>环境</th><th>已对比</th><th>结论</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

function renderBatchScope(model: CustomerReportModel): string {
  const batch = model.reportBatch;
  if (!batch) return '';
  const missing = Math.max(0, batch.expectedRunCount - batch.completedRunCount - batch.failedRunCount);
  const status =
    batch.failedRunCount > 0
      ? `${batch.failedRunCount} 个运行失败`
      : batch.skippedRunCount > 0
        ? `${batch.skippedRunCount} 个运行因缺少业务数据跳过`
        : missing > 0
        ? `${missing} 个运行未完成`
        : '批次运行已完成';
  return `<section class="batch-scope">
    <div class="batch-scope-head">
      <div>
        <h3 class="sec-title">本次交付范围</h3>
        <p class="sec-lead">${esc(batch.flowLabels.join('、'))} · ${esc(batch.envLabels.join('、'))}</p>
      </div>
      <span class="batch-id">批次 ${esc(batch.batchId)}</span>
    </div>
    <div class="batch-stats">
      <div><strong>${batch.completedRunCount}/${batch.expectedRunCount}</strong><span>已完成运行</span></div>
      <div><strong>${batch.flowLabels.length}</strong><span>业务流程</span></div>
      <div><strong>${batch.envLabels.length}</strong><span>环境</span></div>
      <div><strong>${batch.skippedRunCount}</strong><span>跳过运行</span></div>
    </div>
    <p class="batch-status">${esc(status)}。本报告只汇总清单中明确绑定的运行，不包含其他历史截图。</p>
  </section>`;
}

function renderBatchAudit(model: CustomerReportModel): string {
  const batch = model.reportBatch;
  if (!batch) return '';
  const audit = batch.audit;
  if (audit.runCount === 0) {
    return `<section class="batch-audit">
      <h3 class="sec-title">AI 质量观察</h3>
      <p class="sec-lead">本批次尚未生成 AI 审计摘要。截图基线验收结论不受影响。</p>
    </section>`;
  }
  return `<section class="batch-audit">
    <h3 class="sec-title">AI 质量观察</h3>
    <p class="sec-lead">AI 用于补充发现布局、遮挡、截断等体验问题，不改变上方截图基线验收结论。</p>
    <div class="batch-stats">
      <div><strong>${audit.runCount}/${batch.completedRunCount}</strong><span>已审计运行</span></div>
      <div><strong>${audit.total - audit.skipped}/${audit.total}</strong><span>有效审计步骤</span></div>
      <div><strong>${audit.issueTotal}</strong><span>需处理或确认</span></div>
      <div><strong>${audit.observationTotal}</strong><span>观察项</span></div>
    </div>
    ${audit.degradedSteps > 0 ? `<p class="batch-status warn">${audit.degradedSteps} 步 AI 分析降级为规则分析，相关结论需人工复核。</p>` : ''}
  </section>`;
}

function renderConclusionBody(model: CustomerReportModel): string {
  if (model.coverage.comparedSteps === 0) {
    return `
      ${renderReadingGuide()}
      ${renderActionItems(model)}
      <div class="empty">尚无已对比步骤。请先为关键页面建立验收基线，再重新生成报告。</div>
      ${renderUncoveredSummary(model)}`;
  }

  const focus =
    model.regressionDisplay.length > 0
      ? `<h3 class="sec-title sec-regress">需要修复 · ${model.regressionDisplay.length} 个问题</h3>
         <p class="sec-lead">公共布局类问题已合并展示；点「看对比图」查看各步骤独立对比证据。</p>
         <ol class="brief-list">${model.regressionDisplay.map((item, i) => renderRegressionBrief(item, i)).join('')}</ol>`
      : `<div class="empty ok">本次未发现需要修复的问题</div>`;

  const { degraded: degradedGroups, benign: benignGroups, degradedSteps: degradedStepsOf, benignSteps: benignStepsOf } =
    splitMinorGroups(model);
  const minorBlock =
    model.minorGroups.length > 0
      ? `<details class="minor-block">
           <summary>
             <span class="badge badge-minor">建议确认</span>
             ${model.minorGroups.length} 组非阻断差异（共 ${degradedStepsOf + benignStepsOf} 个步骤）：
             ${degradedStepsOf} 步内容确有变化（${degradedGroups.length} 组）、${benignStepsOf} 步内容未变（${benignGroups.length} 组）
             <button type="button" class="link-btn" onclick="event.preventDefault();switchCustomerTab('minor')">查看留档</button>
           </summary>
           <ol class="brief-list">${model.minorGroups.map((g, i) => renderIssueBrief(g, i)).join('')}</ol>
         </details>`
      : '';

  return `
    ${renderReadingGuide()}
    ${renderActionItems(model)}
    ${renderIncompleteNotice(model)}
    ${renderBatchScope(model)}
    ${renderEnvBreakdown(model)}
    ${focus}
    ${minorBlock}
    ${renderUncoveredSummary(model)}
    ${renderBatchAudit(model)}
  `;
}

export function renderCustomerReportHtml(model: CustomerReportModel): string {
  const c = model.coverage;
  const batch = model.reportBatch;
  const batchMissing = batch
    ? Math.max(0, batch.expectedRunCount - batch.completedRunCount - batch.failedRunCount)
    : 0;
  const regressList =
    model.regressionDisplay.length > 0
      ? `<h3 class="sec-title sec-regress">需要修复 · ${model.regressionDisplay.length} 个问题</h3>
         ${model.regressionDisplay.map((item, i) => renderRegressionDisplayItem(item, i, model)).join('')}`
      : `<div class="empty">本次未发现需要修复的问题</div>`;
  const {
    degraded: degradedGroups,
    benign: benignGroups,
    degradedSteps: degradedStepsOf,
    benignSteps: benignStepsOf,
  } = splitMinorGroups(model);
  const degradedList =
    degradedGroups.length > 0
      ? `<h3 class="sec-title sec-minor">${IMPACT_TIER_LABEL.degraded} · ${degradedGroups.length} 个问题（${degradedStepsOf} 步）</h3>
         <p class="sec-lead">页面内容确实发生了变化，但操作仍可完成。建议评估后修复，可协商是否延期。</p>
         ${degradedGroups.map((g, i) => renderIssueGroup(g, i, model)).join('')}`
      : '';
  const benignList =
    benignGroups.length > 0
      ? `<h3 class="sec-title sec-minor">${IMPACT_TIER_LABEL.benign} · ${benignGroups.length} 组（${benignStepsOf} 步）</h3>
         <p class="sec-lead">页面内容未发生变化，差异来自整体位置偏移、字体渲染或测试数据不同，不需要你处理。</p>
         ${benignGroups.map((g, i) => renderIssueGroup(g, i + degradedGroups.length, model)).join('')}`
      : '';
  const minorList = `${degradedList}${benignList}`;
  const uncoveredRatio = c.expectedSteps > 0 ? c.uncoveredSteps / c.expectedSteps : 0;
  const verdictClass =
    batch?.failedRunCount
      ? 'bad'
      : batch?.skippedRunCount || batchMissing > 0
        ? 'watch'
        : c.regressSteps > 0
      ? 'bad'
      : c.minorSteps > 0
        ? 'watch'
        : c.comparedSteps === 0
          ? 'unknown'
          : uncoveredRatio >= COVERAGE_GAP_RATIO
            ? 'watch'
            : 'good';
  const headline = batch?.failedRunCount
    ? `交付批次有 ${batch.failedRunCount} 个运行失败`
    : batch?.skippedRunCount
      ? `交付批次有 ${batch.skippedRunCount} 个运行因缺少业务数据跳过`
      : batchMissing > 0
      ? `交付批次尚有 ${batchMissing} 个运行未完成`
      : buildHeadline(c, model.regressionDisplay.length);
  const subline = batch?.failedRunCount
    ? `已有 ${batch.completedRunCount} 个运行完成，失败运行未纳入截图结论 · 建议修复运行失败后重新生成报告`
    : batch?.skippedRunCount
      ? `已有 ${batch.completedRunCount} 个运行完成，跳过运行未纳入截图结论 · 建议补充业务数据后重新验收`
      : batchMissing > 0
      ? `已有 ${batch?.completedRunCount ?? 0} 个运行完成，未完成运行未纳入截图结论 · 建议补齐后再验收`
      : c.regressSteps > 0
      ? `影响 ${c.regressSteps} 个检测步骤${c.minorSteps > 0 ? `；另有 ${c.minorSteps} 步为可接受差异，建议业务确认` : ''} · ${model.shipAdviceLabel}`
      : c.minorSteps > 0
        ? `${c.minorSteps} 步存在差异（${c.degradedSteps} 步内容确有变化、${c.benignSteps} 步内容未变），建议业务确认 · ${model.shipAdviceLabel}`
        : c.uncoveredSteps > 0
          ? model.shipAdviceLabel
          : `已对比 ${c.comparedSteps} 个步骤，与验收基线一致 · ${model.shipAdviceLabel}`;

  const minorRunCount = countMinorRuns(model);
  const minorEvidenceCount = model.minorGroups.length;
  const minorTabCount = minorRunCount + minorEvidenceCount;
  const showMinorTab = minorTabCount > 0;
  const minorTabLabelText = showMinorTab ? minorTabLabel(minorEvidenceCount, c.minorSteps, minorRunCount) : '';
  const scopeLine = batch
    ? `交付批次 · ${batch.completedRunCount}/${batch.expectedRunCount} 个运行`
    : model.reportScope === 'all'
      ? '全部脚本截图'
      : 'Golden 回归';
  const ctxParts = [model.envLabel, model.releaseTag ? `v${model.releaseTag}` : ''].filter(Boolean);
  // 对账句：三档之和必须等于已对比步骤数，并显式交代未单列证据的步骤去处
  const footSegments: string[] = [];
  if (c.regressSteps > 0) footSegments.push(`${c.regressSteps} 步${IMPACT_TIER_LABEL.blocking}`);
  if (c.degradedSteps > 0) footSegments.push(`${c.degradedSteps} 步${IMPACT_TIER_LABEL.degraded}`);
  if (c.benignSteps > 0) footSegments.push(`${c.benignSteps} 步${IMPACT_TIER_LABEL.benign}`);
  if (c.passSteps > 0) footSegments.push(`${c.passSteps} 步完全一致`);
  const verdictFoot =
    `已对比 ${c.comparedSteps} / 共 ${c.expectedSteps} 步：${footSegments.join('、') || '无有效对比'}` +
    (c.uncoveredSteps > 0 ? `；另有 ${c.uncoveredSteps} 步缺少基线，未参与判定` : '') +
    (model.accounting.ungroupedReason ? `。${model.accounting.ungroupedReason}` : '');
  const ctxLine = ctxParts.length > 0 ? `${esc(ctxParts.join(' · '))} · ` : '';
  const scopeNote = batch
    ? '<div class="report-scope-note">本报告按交付批次清单精确汇总；每项数据均绑定业务场景、账号与运行，不包含批次外历史数据。</div>'
    : model.envSummaries?.length
    ? '<div class="report-scope-note">本报告按各环境、各业务场景最近一次完整运行汇总，运行时间可能不同；分环境结论不可视为同一发布批次的同步检测。</div>'
    : '';

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>UI 验收检测报告</title>
  <style>${customerReportCss()}</style>
</head>
<body>
  <div class="header">
    <h1>UI 验收检测报告</h1>
    <div class="sub">${ctxLine}生成时间 ${esc(model.generatedAt)} · ${esc(scopeLine)} · 与验收基线逐项对比</div>
  </div>
  ${scopeNote}
  <div class="wrap">
    <div class="verdict ${verdictClass}">
      <div class="verdict-title">${esc(headline)}</div>
      <div class="verdict-meta">${esc(subline)}</div>
      ${renderCoverageBar(model)}
      <div class="stats">
        <div class="stat"><span class="n n-red">${c.regressSteps}</span><span class="l">${IMPACT_TIER_LABEL.blocking}</span><span class="h">内容变了，阻断使用</span></div>
        <div class="stat"><span class="n n-amber">${c.degradedSteps}</span><span class="l">${IMPACT_TIER_LABEL.degraded}</span><span class="h">内容有变化，建议修</span></div>
        <div class="stat"><span class="n n-gray">${c.benignSteps}</span><span class="l">${IMPACT_TIER_LABEL.benign}</span><span class="h">内容未变，仅位移/显示差异</span></div>
        <div class="stat"><span class="n n-green">${c.passSteps}</span><span class="l">完全一致</span><span class="h">与基线零差异</span></div>
      </div>
      <div class="verdict-legend">
        <span class="vl-item vl-blocking">● ${IMPACT_TIER_LABEL.blocking}：页面内容与基线相比发生了实质性变化，影响业务操作或数据展示，必须修复后才能发版</span>
        <span class="vl-item vl-degraded">● ${IMPACT_TIER_LABEL.degraded}：页面内容有变化，但操作仍可完成，建议评估后修复</span>
        <span class="vl-item vl-benign">● ${IMPACT_TIER_LABEL.benign}：页面内容未变化，差异来自整体位置偏移、字体渲染或测试数据不同，无需处理</span>
      </div>
      ${renderTrendPanel(model)}
      <div class="verdict-foot">${esc(verdictFoot)}</div>
    </div>

    <div class="tabs">
      <button class="tab active" data-tab="conclusion" onclick="switchCustomerTab('conclusion')">验收结论</button>
      <button class="tab" data-tab="regress" onclick="switchCustomerTab('regress')">问题证据${model.regressionDisplay.length > 0 ? ` (${model.regressionDisplay.length})` : ''}</button>
      ${showMinorTab ? `<button class="tab" data-tab="minor" onclick="switchCustomerTab('minor')">${minorTabLabelText}</button>` : ''}
      <button class="tab" data-tab="scope" onclick="switchCustomerTab('scope')">检测覆盖</button>
    </div>

    <div id="panel-conclusion" class="panel active">
      ${renderConclusionBody(model)}
    </div>
    <div id="panel-regress" class="panel">
      ${regressList}
    </div>
    ${showMinorTab ? `<div id="panel-minor" class="panel">
      ${renderMinorTabBody(model, minorList, minorRunCount)}
    </div>` : ''}
    <div id="panel-scope" class="panel">
      <p class="sec-lead">下表为本报告绑定运行的全部检测项。「待建基线」表示该步骤有截图但尚无可配对的验收基线；标记「过程」的是操作中间态截图，不作为验收结论。差异率为有效差异像素占可比较区域像素的比例。${showMinorTab && minorRunCount > 0 ? '历史可接受差异见「历史留档」。' : showMinorTab ? '可接受差异见对应 Tab。' : ''}</p>
      ${renderScopeTable(model)}
    </div>
  </div>
  <script>window.STUDIO_API_BASE = ${JSON.stringify(process.env.STUDIO_API_BASE || 'http://localhost:3001')};</script>
  <script>${customerReportClientJs()}</script>
</body>
</html>`;
}
