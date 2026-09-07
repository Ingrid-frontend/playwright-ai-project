import {
  isDiffPage,
  type CustomerBrowserCard,
  type CustomerIssueGroup,
  type CustomerPageCard,
  type CustomerReportModel,
} from './customer-report-model.js';
import { customerReportCss, customerReportClientJs } from './customer-report-assets.js';
import { buildFeedbackRegisterDescription, buildHeadline, COVERAGE_GAP_RATIO } from './customer-report-plain.js';
import { friendlyScriptLabel, friendlyStepLabel, regionZoneLabel, extractEnvId, envIdSortKey, envLabelFromId } from './customer-report-naming.js';
import { formatDurationSec, formatScriptStartedAt, summarizeScriptRuns } from './customer-report-run-meta.js';
import { totalRunCount } from './customer-report-run-history.js';
import type { ScriptRunHistoryEntry } from './customer-report-run-meta.js';

function esc(s: string): string {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function runIdForScript(model: CustomerReportModel, scriptKey: string): string {
  return model.scriptRuns.get(scriptKey)?.runId || '';
}

function renderRunIdCopy(runId: string): string {
  if (!runId) return '—';
  return `<button type="button" class="run-marker run-id-copy" data-copy="${esc(runId)}" title="点击复制 runId · 删除: npm run flow:delete-runs -- --search=${esc(runId)} --delete">${esc(runId)}</button>`;
}

function renderRunIndexCell(r: ScriptRunHistoryEntry): string {
  const latest = r.isLatest ? '<span class="tag-latest">最新</span>' : '';
  const label = `第 ${r.runIndex} 次${latest}`;
  if (!r.runId) return label;
  return `<button type="button" class="run-index-copy run-id-copy" data-copy="${esc(r.runId)}" title="点击复制 runId · 删除: npm run flow:delete-runs -- --search=${esc(r.runId)} --delete">${label}</button>`;
}

function renderRunIdMeta(model: CustomerReportModel, scriptKeys: string[]): string {
  const ids = [...new Set(scriptKeys.map((k) => runIdForScript(model, k)).filter(Boolean))];
  if (!ids.length) return '';
  const chips = ids.map((id) => renderRunIdCopy(id)).join(' ');
  return `<span class="ig-run-id">runId ${chips}</span>`;
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
      <div class="view-hint">左侧为验收基线，右侧为本次结果</div>
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
    return `<div class="pair-warn">${esc(card.stateDriftReason)}</div>`;
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
    <div class="view-hint">左右为同一快照并排对照；右侧红实线框为实质变化，灰虚线框为位置偏移/显示差异</div>`;
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
function renderIssueGroup(group: CustomerIssueGroup, index: number, model: CustomerReportModel): string {
  const statusLabel = group.status === 'regress' ? '需要修复' : '无需处理';
  const primary = group.representative.browsers[0];
  const regionList = primary ? renderRegionList(primary) : '';
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
          ${renderRunIdMeta(model, group.scriptKeys)}
        </div>
        ${regionList}
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

function natureTagForGroup(group: CustomerIssueGroup): string {
  const card = group.representative.browsers[0];
  if (!card) return '';
  const region = card.regions.find((r) => r.actionable) || card.regions[0];
  return region?.natureLabel || '';
}

function isComparableTrendVerdict(v: string): boolean {
  return v === 'pass' || v === 'minor' || v === 'regress';
}

function renderTrendHint(model: CustomerReportModel): string {
  const improved: string[] = [];
  const worsened: string[] = [];
  const rank = (v: string) => (v === 'regress' ? 3 : v === 'minor' ? 2 : v === 'pass' ? 1 : 0);
  for (const [scriptKey, rows] of model.runHistory) {
    const sorted = [...rows].sort((a, b) => b.runIndex - a.runIndex);
    if (sorted.length < 2) continue;
    const latest = sorted.find((r) => r.isLatest) || sorted[0]!;
    const prev = sorted.find((r) => r.runIndex === latest.runIndex - 1) || sorted[1]!;
    if (!isComparableTrendVerdict(latest.verdict) || !isComparableTrendVerdict(prev.verdict)) continue;
    const label = friendlyScriptLabel(scriptKey);
    if (rank(latest.verdict) < rank(prev.verdict)) improved.push(label);
    else if (rank(latest.verdict) > rank(prev.verdict)) worsened.push(label);
  }
  if (improved.length === 0 && worsened.length === 0) return '';
  const parts: string[] = [];
  if (worsened.length > 0) {
    parts.push(`${worsened.length} 个流程较上一轮恶化（${worsened.join('、')}）`);
  }
  if (improved.length > 0) {
    parts.push(`${improved.length} 个流程较上一轮好转（${improved.join('、')}）`);
  }
  return `<div class="trend-hint">${esc(parts.join(' · '))}</div>`;
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
      <li>看顶部颜色：红 = 有问题要修；琥珀 = 轻微变化无需处理；绿 = 可发版</li>
      <li>问题清单每行可点「看对比图」查看证据</li>
      <li>「待建基线」不算通过，需补基线后再测</li>
    </ol>
  </details>`;
}
function renderIssueBrief(group: CustomerIssueGroup, index: number): string {
  const card = group.representative.browsers[0];
  const scope =
    group.affectedSteps > 1 ? `影响 ${group.affectedSteps} 个步骤` : '影响 1 个步骤';
  const priority = group.status === 'regress' ? 'P0' : 'P1';
  const natureTag = natureTagForGroup(group);
  const scripts =
    group.scriptLabels.length > 0 ? `<span class="brief-flow">${esc(group.scriptLabels.join('、'))}</span>` : '';
  return `
  <li class="brief ${esc(group.status)}">
    ${card ? renderBriefThumb(card) : ''}
    <span class="brief-no">${index + 1}</span>
    <span class="brief-main">
      <span class="brief-tags">
        <span class="brief-priority ${group.status === 'regress' ? 'p0' : 'p1'}">${priority}</span>
        ${natureTag ? `<span class="brief-nature">${esc(natureTag)}</span>` : ''}
      </span>
      <span class="brief-title">${esc(group.title)}</span>
      <span class="brief-reason">${esc(group.reason || '检测到与验收基线的差异')}</span>
      ${scripts}
    </span>
    <span class="brief-meta">
      <span class="brief-diff">${esc(group.maxDifferenceLabel)}</span>
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
  const runId = renderRunIdCopy(runIdForScript(model, s.scriptKey));
  return `<tr data-status="${esc(s.status)}">
    <td>${esc(friendlyStepLabel(s.pageTitle))}</td>
    <td>${esc(friendlyStepLabel(s.stepName))}${s.processOnly ? '<span class="tag-process">过程</span>' : ''}</td>
    <td>${s.difference != null ? `${(s.difference * 100).toFixed(2)}%` : '—'}</td>
    <td>${esc(kind)}</td>
    <td>${esc(runStart)}</td>
    <td>${runId}</td>
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
            <th>runId</th>
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

function renderRunHistoryPanel(model: CustomerReportModel): string {
  const entries = [...model.runHistory.entries()];
  if (!entries.length) {
    return `<div class="empty">尚无 run 截图目录，请先执行 Golden 回归。</div>`;
  }

  return renderRunHistoryEnvLayout(groupRunHistoryByEnv(entries), (scriptKey, rows) => {
    const label = friendlyScriptLabel(scriptKey);
    return `
    <section class="run-history-block">
      <h3 class="run-history-title">${esc(label)}</h3>
      <p class="run-history-meta">共 ${rows.length} 次 run · 与验收基线逐步对比；「最新」一轮用于上方结论与检测覆盖；截图已清理的 run 仅保留历史判定</p>
      ${renderRunHistoryTable(rows)}
    </section>`;
  });
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
      <p class="run-history-meta">共 ${rows.length} 次 run 判定为轻微变化 · 内容与基线一致，多为位置偏移或显示效果差异</p>
      ${renderRunHistoryTable(rows, { showShots: true })}
    </section>`;
  });
}

function minorTabLabel(latestCount: number, minorRunCount: number): string {
  if (latestCount > 0 && minorRunCount > 0) {
    return `轻微变化 · 本轮 ${latestCount} / 历史 ${minorRunCount}`;
  }
  if (latestCount > 0) return `轻微变化 (${latestCount})`;
  return `历史留档 (${minorRunCount})`;
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
      ? `<h3 class="sec-title sec-minor">本轮轻微变化 · ${latestCount} 项</h3>${latest}`
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
    <div class="uncovered-summary-title">另有 ${n} 步未建验收基线（未计入通过率）</div>
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
    <p class="incomplete-notice-meta">上方结论与检测覆盖已基于最近一次<strong>完整</strong> run；未完成 run 见「技术附录」。</p>
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

function renderConclusionBody(model: CustomerReportModel): string {
  if (model.coverage.comparedSteps === 0) {
    return `
      ${renderReadingGuide()}
      ${renderActionItems(model)}
      <div class="empty">尚无已对比步骤。请先为关键页面建立验收基线，再重新生成报告。</div>
      ${renderUncoveredSummary(model)}`;
  }

  const focus =
    model.regressionGroups.length > 0
      ? `<h3 class="sec-title sec-regress">需要修复 · ${model.regressionGroups.length} 个问题</h3>
         <p class="sec-lead">按根因归并，同一变化影响多个步骤只算一个问题。点「看对比图」查看证据。</p>
         <ol class="brief-list">${model.regressionGroups.map((g, i) => renderIssueBrief(g, i)).join('')}</ol>`
      : `<div class="empty ok">本次未发现需要修复的问题</div>`;

  const minorBlock =
    model.minorGroups.length > 0
      ? `<details class="minor-block">
           <summary>
             <span class="badge badge-minor">无需处理</span>
             ${model.minorGroups.length} 项轻微变化（共 ${model.minors.length} 个步骤）· 内容与基线一致，仅位置偏移或显示效果差异
             <button type="button" class="link-btn" onclick="event.preventDefault();switchCustomerTab('minor')">查看留档</button>
           </summary>
           <ol class="brief-list">${model.minorGroups.map((g, i) => renderIssueBrief(g, i)).join('')}</ol>
         </details>`
      : '';

  return `
    ${renderReadingGuide()}
    ${renderActionItems(model)}
    ${renderIncompleteNotice(model)}
    ${renderEnvBreakdown(model)}
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
      ? `<h3 class="sec-title sec-regress">需要修复 · ${model.regressionGroups.length} 个问题</h3>
         ${model.regressionGroups.map((g, i) => renderIssueGroup(g, i, model)).join('')}`
      : `<div class="empty">本次未发现需要修复的问题</div>`;
  const minorList =
    model.minorGroups.length > 0
      ? `<p class="sec-lead">以下差异范围很小，多为位置偏移或显示效果不同，不影响功能，可不处理。</p>
         ${model.minorGroups.map((g, i) => renderIssueGroup(g, i, model)).join('')}`
      : '';
  const uncoveredRatio = c.expectedSteps > 0 ? c.uncoveredSteps / c.expectedSteps : 0;
  const verdictClass =
    c.regressSteps > 0
      ? 'bad'
      : c.minorSteps > 0
        ? 'watch'
        : c.comparedSteps === 0
          ? 'unknown'
          : uncoveredRatio >= COVERAGE_GAP_RATIO
            ? 'watch'
            : 'good';
  const headline = buildHeadline(c, model.regressionGroups.length);
  const subline =
    c.regressSteps > 0
      ? `影响 ${c.regressSteps} 个检测步骤${c.minorSteps > 0 ? `；另有 ${c.minorSteps} 步为位置偏移等无害差异，无需处理` : ''} · ${model.shipAdviceLabel}`
      : c.minorSteps > 0
        ? `${c.minorSteps} 步存在位置偏移或显示效果差异，内容与验收基线一致 · ${model.shipAdviceLabel}`
        : c.uncoveredSteps > 0
          ? model.shipAdviceLabel
          : `已对比 ${c.comparedSteps} 个步骤，与验收基线一致 · ${model.shipAdviceLabel}`;

  const runSummary = summarizeScriptRuns([...model.scriptRuns.values()]);
  const runTotal = totalRunCount(model.runHistory);
  const runMetaLine = runSummary ? ` · 最新一轮 ${esc(runSummary)}` : '';
  const runCountLine = runTotal > 1 ? ` · 共 ${runTotal} 次 run` : '';
  const stepsHint =
    runTotal > 1
      ? `最新一轮 ${c.expectedSteps} 步 · 共 ${runTotal} 次 run`
      : `共 ${c.expectedSteps} 步/轮`;
  const showRunsTab = runTotal > 1;
  const runsTabLabel = showRunsTab ? `技术附录 (${runTotal})` : '';
  const minorRunCount = countMinorRuns(model);
  const minorEvidenceCount = model.minorGroups.length;
  const minorTabCount = minorRunCount + minorEvidenceCount;
  const showMinorTab = minorTabCount > 0;
  const minorTabLabelText = showMinorTab ? minorTabLabel(minorEvidenceCount, minorRunCount) : '';
  const scopeLine = model.reportScope === 'all' ? '全部脚本截图' : 'Golden 回归';
  const ctxParts = [model.envLabel, model.releaseTag ? `v${model.releaseTag}` : ''].filter(Boolean);
  const ctxLine = ctxParts.length > 0 ? `${esc(ctxParts.join(' · '))} · ` : '';

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
    <div class="sub">${ctxLine}生成时间 ${esc(model.generatedAt)}${runCountLine}${runMetaLine} · ${esc(scopeLine)} · 与验收基线逐项对比</div>
  </div>
  <div class="wrap">
    <div class="verdict ${verdictClass}">
      <div class="verdict-title">${esc(headline)}</div>
      <div class="verdict-meta">${esc(subline)}</div>
      ${renderTrendHint(model)}
      ${renderCoverageBar(model)}
      <div class="stats">
        <div class="stat"><span class="n n-red">${c.regressSteps}</span><span class="l">需要修复</span><span class="h">步骤级，需处理</span></div>
        <div class="stat"><span class="n n-amber">${c.minorSteps}</span><span class="l">无需处理</span><span class="h">内容一致，可忽略</span></div>
        <div class="stat"><span class="n n-green">${c.passSteps}</span><span class="l">完全一致</span><span class="h">与基线零差异</span></div>
        <div class="stat"><span class="n">${c.comparedSteps}</span><span class="l">已对比步骤</span><span class="h">${esc(stepsHint)}</span></div>
      </div>
      <div class="verdict-foot">${c.uncoveredSteps > 0
        ? `已检测 ${c.comparedSteps} 步全部通过 · ${c.uncoveredSteps} 步待建基线未参与判定（检测覆盖 ${Math.round((c.comparedSteps / Math.max(1, c.expectedSteps)) * 100)}%）`
        : `通过率 ${passPct}% · 已对比 ${c.comparedSteps} 步，全部无需修复`}</div>
    </div>

    <div class="tabs">
      <button class="tab active" data-tab="conclusion" onclick="switchCustomerTab('conclusion')">验收结论</button>
      <button class="tab" data-tab="regress" onclick="switchCustomerTab('regress')">问题证据${model.regressionGroups.length > 0 ? ` (${model.regressionGroups.length})` : ''}</button>
      ${showMinorTab ? `<button class="tab" data-tab="minor" onclick="switchCustomerTab('minor')">${minorTabLabelText}</button>` : ''}
      <button class="tab" data-tab="scope" onclick="switchCustomerTab('scope')">检测覆盖</button>
      ${showRunsTab ? `<button class="tab" data-tab="runs" onclick="switchCustomerTab('runs')">${runsTabLabel}</button>` : ''}
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
      <p class="sec-lead">下表为<strong>最新一轮</strong> run 的全部检测项。「待建基线」表示该步骤有截图但尚无可配对的验收基线；标记「过程」的是操作中间态截图，不作为验收结论。${showRunsTab ? '历次 run 见「技术附录」。' : ''}${showMinorTab && minorRunCount > 0 ? '历史轻微变化见「历史留档」。' : showMinorTab ? '轻微变化见对应 Tab。' : ''}</p>
      ${renderScopeTable(model)}
    </div>
    ${showRunsTab ? `<div id="panel-runs" class="panel">
      <p class="sec-lead">按环境分组展示历次 Golden 回归（stage → stage9084 → uat → dev）。点击「次序」复制 runId；右侧索引可跳转环境区块。</p>
      ${renderRunHistoryPanel(model)}
    </div>` : ''}
  </div>
  <script>window.STUDIO_API_BASE = ${JSON.stringify(process.env.STUDIO_API_BASE || 'http://localhost:3001')};</script>
  <script>${customerReportClientJs()}</script>
</body>
</html>`;
}
