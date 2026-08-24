import path from 'path';
import type { UiIssueSeverity } from './ui-issues.js';
import type { AuditIssue, AuditResult, AuditVerdict } from './ui-audit-schema.js';

export interface AuditStepReport {
  scriptKey: string;
  stepName: string;
  stepNumber?: number;
  /** 报告 HTML 所在目录到截图的相对路径 */
  screenshotRel: string;
  /** 报告 HTML 所在目录到 Figma 设计稿图的相对路径 */
  figmaRel?: string;
  figmaUrl?: string;
  /** 截图真实像素尺寸，用于把 bbox 换算成百分比 */
  imageWidth: number;
  imageHeight: number;
  /** 视口宽高；与 image 尺寸不一致时（如 fullPage）用于坐标换算 */
  viewportWidth: number;
  viewportHeight: number;
  url?: string;
  result: AuditResult;
}

const SEVERITY_COLOR: Record<UiIssueSeverity, string> = {
  blocker: '#e5484d',
  warning: '#f5a623',
  noise: '#3b82f6',
  info: '#8b93a1',
};

const SEVERITY_LABEL: Record<UiIssueSeverity, string> = {
  blocker: '阻塞',
  warning: '警告',
  noise: '噪声',
  info: '提示',
};

const VERDICT_LABEL: Record<AuditVerdict, string> = {
  pass: '🟢 通过',
  review: '🟡 待确认',
  fail: '🔴 需修复',
  skipped: '⚪ 未审计',
};

export function escapeHtml(input: string): string {
  return String(input)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * bbox 是「视口坐标系」，而截图可能是全页图（高度 > 视口高度）。
 * 横向按 图宽/视口宽 换算，纵向按同一缩放比换算，避免 fullPage 下纵向错位。
 */
function bboxToPercent(
  bbox: { x: number; y: number; width: number; height: number },
  step: AuditStepReport,
): { left: number; top: number; width: number; height: number } | null {
  const imgW = step.imageWidth;
  const imgH = step.imageHeight;
  if (!(imgW > 0 && imgH > 0)) return null;

  const vpW = step.viewportWidth > 0 ? step.viewportWidth : imgW;
  // 视口宽 → 图宽 的缩放比（deviceScaleFactor 或 CSS 像素差异）
  const scale = imgW / vpW;

  const left = (bbox.x * scale) / imgW;
  const top = (bbox.y * scale) / imgH;
  const width = (bbox.width * scale) / imgW;
  const height = (bbox.height * scale) / imgH;

  // 完全落在图外的框不渲染，避免误导
  if (left > 1 || top > 1 || left + width < 0 || top + height < 0) return null;

  const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
  return {
    left: clamp01(left) * 100,
    top: clamp01(top) * 100,
    width: Math.min(100 - clamp01(left) * 100, Math.max(0.3, width * 100)),
    height: Math.min(100 - clamp01(top) * 100, Math.max(0.3, height * 100)),
  };
}

function renderOverlay(step: AuditStepReport): string {
  const boxes = step.result.issues
    .map((issue) => {
      if (!issue.bbox) return '';
      const pct = bboxToPercent(issue.bbox, step);
      if (!pct) return '';
      const color = SEVERITY_COLOR[issue.severity];
      return `<div class="box" style="left:${pct.left.toFixed(2)}%;top:${pct.top.toFixed(2)}%;width:${pct.width.toFixed(2)}%;height:${pct.height.toFixed(2)}%;border-color:${color}"><span class="tag" style="background:${color}">${escapeHtml(SEVERITY_LABEL[issue.severity])} · ${escapeHtml(issue.type)}</span></div>`;
    })
    .filter(Boolean)
    .join('');
  return `<div class="overlay">${boxes}</div>`;
}

function renderIssue(issue: AuditIssue): string {
  const color = SEVERITY_COLOR[issue.severity];
  const selector = issue.selector
    ? `<code class="sel">${escapeHtml(issue.selector)}</code>`
    : '';
  return `<li class="issue">
      <span class="sev" style="background:${color}">${escapeHtml(SEVERITY_LABEL[issue.severity])}</span>
      <span class="type">${escapeHtml(issue.type)}</span>
      <span class="desc">${escapeHtml(issue.description)}</span>
      ${selector}
      <span class="conf">置信 ${Math.round(issue.confidence * 100)}%</span>
    </li>`;
}

function renderCard(step: AuditStepReport): string {
  const { result } = step;
  const issuesHtml =
    result.issues.length > 0
      ? result.issues.map(renderIssue).join('')
      : result.verdict === 'skipped'
        ? '<li class="issue">缺少判定依据，未做有效审计</li>'
        : '<li class="issue ok">未发现明显 UI 缺陷</li>';

  const sourceBadge =
    result.source === 'mock'
      ? '<span class="src">规则分析</span>'
      : result.source === 'ai'
        ? '<span class="src ai">AI 视觉</span>'
        : '<span class="src err">分析失败</span>';

  const figmaBadge = step.figmaRel
    ? '<span class="src figma">Figma 基准</span>'
    : '';

  const title = `${step.stepNumber != null ? `#${step.stepNumber} ` : ''}${step.stepName}`;

  const sub =
    result.verdict === 'skipped'
      ? `${escapeHtml(step.scriptKey)} · 未审计 ${sourceBadge}${figmaBadge}`
      : `${escapeHtml(step.scriptKey)} · 健康分 ${result.score} ${sourceBadge}${figmaBadge}`;

  const shotHtml = step.figmaRel
    ? `<div class="compare">
      <div>
        <div class="cap">Figma 设计稿</div>
        <div class="shot"><img src="${escapeHtml(step.figmaRel)}" loading="lazy" /></div>
      </div>
      <div>
        <div class="cap">实际页面</div>
        <div class="shot">
          <img src="${escapeHtml(step.screenshotRel)}" loading="lazy" />
          ${renderOverlay(step)}
        </div>
      </div>
    </div>`
    : `<div class="shot">
      <img src="${escapeHtml(step.screenshotRel)}" loading="lazy" />
      ${renderOverlay(step)}
    </div>`;

  return `<div class="card ${result.verdict}">
    <div class="head">
      <h3>${escapeHtml(title)}</h3>
      <span class="badge ${result.verdict}">${VERDICT_LABEL[result.verdict]}</span>
    </div>
    <div class="sub">${sub}</div>
    ${shotHtml}
    <ul class="issues">${issuesHtml}</ul>
  </div>`;
}

export interface AuditReportMeta {
  generatedAt?: Date;
  mode?: string;
}

export function renderAuditReportHtml(
  steps: AuditStepReport[],
  meta: AuditReportMeta = {},
): string {
  const counts: Record<AuditVerdict, number> = { pass: 0, review: 0, fail: 0, skipped: 0 };
  let issueTotal = 0;
  for (const s of steps) {
    counts[s.result.verdict]++;
    if (s.result.verdict !== 'skipped') issueTotal += s.result.issues.length;
  }

  const when = (meta.generatedAt ?? new Date()).toLocaleString('zh-CN');
  const modeText = meta.mode ? ` · ${escapeHtml(meta.mode)}` : '';

  return `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>AI UI 审计报告</title>
<style>
 body{font-family:system-ui,-apple-system,"PingFang SC",sans-serif;background:#f5f6f8;margin:0;padding:24px;color:#222}
 h1{font-size:20px;margin:0}
 .top{display:flex;justify-content:space-between;align-items:flex-end;flex-wrap:wrap;gap:12px}
 .time{color:#888;font-size:12px}
 .stats{display:flex;gap:10px;margin:14px 0;flex-wrap:wrap}
 .stat{padding:8px 14px;border-radius:8px;font-weight:600;font-size:14px}
 .stat.p{background:#e6f6ec;color:#18794e}.stat.r{background:#fff4e0;color:#b25e09}
 .stat.f{background:#fdecec;color:#e5484d}.stat.n{background:#eef0f3;color:#444}
 .stat.s{background:#f0f1f3;color:#888}
 .card.skipped{border-style:dashed;border-color:#ccc;opacity:.85}
 .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(440px,1fr));gap:16px}
 .card{background:#fff;border:1px solid #e3e6ea;border-radius:10px;padding:14px;box-shadow:0 1px 3px rgba(0,0,0,.05)}
 .card.fail{border-color:#e5484d}.card.review{border-color:#f5a623}
 .head{display:flex;justify-content:space-between;align-items:center;gap:8px}
 .head h3{font-size:15px;margin:0;word-break:break-all}
 .badge{padding:2px 10px;border-radius:20px;font-size:12px;font-weight:600;white-space:nowrap}
 .badge.pass{background:#e6f6ec;color:#18794e}.badge.review{background:#fff4e0;color:#b25e09}
 .badge.fail{background:#fdecec;color:#e5484d}.badge.skipped{background:#f0f1f3;color:#888}
 .sub{color:#888;font-size:12px;margin:4px 0 8px;word-break:break-all}
 .src{background:#eef0f3;color:#555;padding:1px 6px;border-radius:4px;font-size:11px;margin-left:4px}
 .src.ai{background:#eef4ff;color:#0a66c2}.src.err{background:#fdecec;color:#e5484d}.src.figma{background:#f3e8ff;color:#7c3aed}
 .compare{display:grid;grid-template-columns:1fr 1fr;gap:8px}
 .cap{font-size:11px;color:#888;padding:4px 6px;background:#f7f8fa;line-height:1.4}
 .shot{position:relative;line-height:0;border:1px solid #eee;border-radius:6px;overflow:hidden;background:#fafafa}
 .shot img{width:100%;display:block}
 .overlay{position:absolute;inset:0}
 .box{position:absolute;border:2px solid;border-radius:3px;box-sizing:border-box}
 .box .tag{position:absolute;top:-17px;left:0;color:#fff;font-size:10px;padding:1px 5px;border-radius:3px;white-space:nowrap;line-height:1.4}
 .issues{list-style:none;padding:0;margin:10px 0 0}
 .issue{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:6px 0;border-top:1px dashed #eee;font-size:13px}
 .issue .sev{color:#fff;font-size:11px;padding:1px 7px;border-radius:10px;font-weight:700}
 .issue .type{color:#555;font-size:12px;background:#f0f1f3;padding:1px 6px;border-radius:4px}
 .issue .desc{flex:1;min-width:160px}
 .issue .sel{font-size:11px;color:#0a66c2;background:#eef4ff;padding:1px 6px;border-radius:4px;word-break:break-all}
 .issue .conf{color:#999;font-size:11px}
 .issue.ok{color:#18794e}
 .empty{background:#fff;border:1px dashed #ccc;border-radius:10px;padding:32px;text-align:center;color:#888}
</style></head>
<body>
 <div class="top"><h1>AI UI 审计报告</h1><div class="time">${escapeHtml(when)}${modeText}</div></div>
 <div class="stats">
   <div class="stat p">🟢 通过 ${counts.pass}</div>
   <div class="stat r">🟡 待确认 ${counts.review}</div>
   <div class="stat f">🔴 需修复 ${counts.fail}</div>
   <div class="stat s">⚪ 未审计 ${counts.skipped}</div>
   <div class="stat n">问题数 ${issueTotal}</div>
 </div>
 ${
   steps.length === 0
     ? '<div class="empty">没有找到可审计的截图（需要 .png 及同名 .meta.json）</div>'
     : `<div class="grid">${steps.map(renderCard).join('')}</div>`
 }
</body></html>`;
}

export function relativeAssetPath(reportDir: string, assetPath: string): string {
  return path.relative(reportDir, assetPath).split(path.sep).join('/');
}
