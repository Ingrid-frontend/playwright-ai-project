import path from 'path';
import { resolveDeliveryImagePath, type DeliveryPayload } from './customer-delivery-payload.js';

function esc(s: string): string {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * 本地预览：按飞书文档同样的结构渲染成 HTML，图片走本地相对路径。
 * 没有飞书凭证也能核对「要交付什么内容」，也是 --dry-run 的产出物。
 */
export function renderDeliveryPreview(payload: DeliveryPayload, title?: string): string {
  const s = payload.stats;
  const rel = (p: string) => {
    const abs = resolveDeliveryImagePath(p);
    return path.relative(path.resolve('results'), abs) || p;
  };

  // 与飞书文档正文保持同一套分章逻辑：问题、抽样、待补基线分开呈现
  const issues = payload.items.filter((i) => i.kind === 'regress' || i.kind === 'minor');
  const samples = payload.items.filter((i) => i.kind === 'pass');
  const uncovered = payload.uncoveredList ?? [];

  const CN = ['一', '二', '三', '四', '五', '六'];
  let ch = 0;
  const h2 = (t: string): string => `<h2>${CN[ch++] ?? ch}、${esc(t)}</h2>`;

  const renderItem = (item: (typeof payload.items)[number], i: number): string => {
    const images = item.images
      .map(
        (img) => `
      <figure class="shot">
        <figcaption>${esc(img.label)}</figcaption>
        <img src="${esc(rel(img.relPath))}" alt="${esc(img.label)}" loading="lazy">
      </figure>`,
      )
      .join('');
    return `
    <section class="item">
      <h3>${i + 1}. [${esc(item.verdictLabel)}] ${esc(item.title)}<span class="diff">${esc(item.differenceLabel)}${item.affectedSteps > 1 ? ` · 影响 ${item.affectedSteps} 步` : ''}</span></h3>
      <p class="meta">流程 ${esc(item.scriptLabel)} · 步骤 ${esc(item.stepLabel)} · ${esc(item.browserLabel)}</p>
      <p class="reason">${esc(item.plainText || item.reason)}</p>
      <div class="shots">${images || '<p class="empty">无证据图</p>'}</div>
    </section>`;
  };

  const issueHtml =
    issues.map((item, i) => renderItem(item, i)).join('') ||
    '<div class="card"><p class="empty">本次未发现需要修复的 UI 衰退，已检测步骤与验收基线一致。</p></div>';

  // 章节标题留到主体模板里调用，保证编号按渲染顺序递增
  const sampleBody = samples.length
    ? `<p class="meta">本次无衰退项，以下为已比对且确认一致的代表性页面（共 ${s.passSteps} 步完全一致），用于说明本次检测确实覆盖并核验过：</p>
  ${samples.map((item, i) => renderItem(item, i)).join('')}`
    : '';

  const uncoveredBody = uncovered.length
    ? `<div class="card">
    <p class="meta">以下 ${uncovered.length} 个步骤尚无验收基线，未参与本次判定。确认页面样式正确后固化基线，下次即可纳入比对：</p>
    <ul>${uncovered.map((u) => `<li>${esc(u.title)}　·　${esc(u.scriptLabel)}　·　${esc(u.stepLabel)}</li>`).join('')}</ul>
  </div>`
    : '';

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title || 'UI 验收检测报告')}</title>
<style>
  body { font-family: "PingFang SC", "Microsoft YaHei", sans-serif; color: #1f2329; background: #f6f7f9; margin: 0; line-height: 1.7; }
  .wrap { max-width: 900px; margin: 0 auto; padding: 24px 20px 60px; }
  h1 { font-size: 22px; margin: 0 0 6px; }
  h2 { font-size: 17px; margin: 28px 0 10px; padding-left: 10px; border-left: 4px solid #2c4a7c; }
  h3 { font-size: 15px; margin: 0 0 6px; }
  .meta, .reason { color: #646a73; font-size: 13px; margin: 4px 0; }
  .card { background: #fff; border: 1px solid #e5e6eb; border-radius: 10px; padding: 16px 18px; margin-bottom: 14px; }
  .headline { font-size: 18px; font-weight: 600; }
  .stats { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 10px; }
  .stat { flex: 1 1 120px; border: 1px solid #e5e6eb; border-radius: 8px; padding: 8px 10px; text-align: center; }
  .stat .n { font-size: 18px; font-weight: 600; }
  .stat .l { font-size: 12px; color: #646a73; }
  .item { background: #fff; border: 1px solid #e5e6eb; border-radius: 10px; padding: 14px 16px; margin-bottom: 12px; }
  .diff { font-weight: 400; color: #646a73; margin-left: 8px; font-size: 13px; }
  .shots { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 12px; margin-top: 10px; }
  .shot { margin: 0; }
  .shot figcaption { font-size: 12px; color: #646a73; margin-bottom: 4px; }
  .shot img { width: 100%; border: 1px solid #e5e6eb; border-radius: 6px; display: block; }
  .empty { color: #868e96; font-size: 13px; }
  ol, ul { padding-left: 22px; }
  ul li { margin: 2px 0; }
  .mode { display: inline-block; background: #fff4e6; color: #a35b00; border-radius: 4px; padding: 2px 8px; font-size: 12px; }
</style>
</head>
<body>
<div class="wrap">
  <h1>${esc(title || 'UI 验收检测报告')}</h1>
  <p class="meta">生成时间 ${esc(payload.generatedAt)}${payload.envLabel ? ` · 环境 ${esc(payload.envLabel)}` : ''}${payload.releaseTag ? ` · 版本 v${esc(payload.releaseTag)}` : ''} <span class="mode">本地预览</span></p>

  ${h2('结论')}
  <div class="card">
    <div class="headline">${esc(payload.headline)}</div>
    <p>发版建议：${esc(payload.shipAdviceLabel)}</p>
    <p class="meta">检测覆盖 ${s.coveragePct}%（已对比 ${s.comparedSteps} / ${s.expectedSteps} 步）${s.uncoveredSteps > 0 ? `，另有 ${s.uncoveredSteps} 步待建基线未参与判定` : ''}</p>
    <div class="stats">
      <div class="stat"><div class="n" style="color:#e03131">${s.regressSteps}</div><div class="l">需要修复</div></div>
      <div class="stat"><div class="n" style="color:#f08c00">${s.minorSteps}</div><div class="l">无需处理</div></div>
      <div class="stat"><div class="n" style="color:#2f9e44">${s.passSteps}</div><div class="l">完全一致</div></div>
      ${s.uncoveredSteps > 0
        ? `<div class="stat"><div class="n" style="color:#868e96">${s.uncoveredSteps}</div><div class="l">待建基线</div></div>`
        : `<div class="stat"><div class="n">${(s.passRate * 100).toFixed(1)}%</div><div class="l">通过率</div></div>`}
    </div>
    ${s.uncoveredSteps > 0
      ? '<p class="meta">覆盖率不足时暂不给出整体通过率：未建基线的步骤未参与判定，当前结果不足以支撑整体验收结论。</p>'
      : ''}
  </div>

  ${h2('问题与证据')}
  ${issueHtml}
  ${sampleBody ? h2('已验证抽样') + sampleBody : ''}
  ${uncoveredBody ? h2('待补基线') + uncoveredBody : ''}

  ${h2('建议操作')}
  <div class="card">
    ${payload.actionItems.length ? `<ol>${payload.actionItems.map((a) => `<li>${esc(a)}</li>`).join('')}</ol>` : '<p class="empty">无额外操作建议。</p>'}
  </div>

  ${h2('检测范围')}
  <div class="card">
    <p>本次共 ${s.expectedSteps} 个检测步骤，其中 ${s.comparedSteps} 步与验收基线做了比对，${s.uncoveredSteps} 步尚无验收基线。</p>
  </div>
</div>
</body>
</html>`;
}
