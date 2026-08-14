import {
  type DesignSpec,
  type LiveSpec,
  type SpecCheck,
  type SpecCheckSummary,
} from "./figma-spec-types.js";
import {
  escapeHtml,
  regionLabel,
  regionChecks,
  statusBadge,
  summarizeByRegion,
} from "./spec-report-format.js";
import { type CheckShot, type RegionShot } from "./spec-report-shots.js";

export function buildHtml(
  design: DesignSpec,
  live: LiveSpec,
  checks: SpecCheck[],
  summary: SpecCheckSummary,
  hasImages: boolean,
  regionShots: RegionShot[],
  checkShots: ReadonlyMap<string, CheckShot>,
): string {
  const rows = checks
    .map(
      (c) =>
        `<tr class="status-${c.status}"><td>${statusBadge(c.status)}</td><td>${escapeHtml(regionLabel(c.region))}</td><td>${c.category}</td><td>${escapeHtml(c.label)}</td><td>${escapeHtml(c.expected)}</td><td>${escapeHtml(c.actual)}</td><td>${escapeHtml(c.detail)}</td></tr>`,
    )
    .join("\n");
  const regionRows = summarizeByRegion(checks)
    .map(
      (r) =>
        `<tr><td>${escapeHtml(r.label)}</td><td>${r.pass}</td><td>${r.warn}</td><td>${r.fail}</td><td>${r.skip}</td></tr>`,
    )
    .join("");
  const images = hasImages
    ? `<div class="images"><figure><img src="design.png" alt="设计稿"><figcaption>设计稿</figcaption></figure><figure><img src="live.png" alt="线上截图"><figcaption>线上截图</figcaption></figure></div>`
    : "";
  const regionRowsHtml = regionShots
    .map((s) => {
      const designCell = s.designFile
        ? `<figure class="region-shot"><img src="${s.designFile}" alt="设计稿 ${escapeHtml(s.label)}"><figcaption>设计稿 ${s.designRect ? `${Math.round(s.designRect.x)},${Math.round(s.designRect.y)} ${Math.round(s.designRect.width)}x${Math.round(s.designRect.height)}` : ""}</figcaption></figure>`
        : `<div class="region-empty">无设计稿截图</div>`;
      const liveCell = s.liveFile
        ? `<figure class="region-shot"><img src="${s.liveFile}" alt="线上 ${escapeHtml(s.label)}"><figcaption>线上 ${s.liveRect ? `${Math.round(s.liveRect.x)},${Math.round(s.liveRect.y)} ${Math.round(s.liveRect.width)}x${Math.round(s.liveRect.height)}` : ""}</figcaption></figure>`
        : `<div class="region-empty">线上未匹配到该区块</div>`;
      const points = regionChecks(checks, s.key);
      const pointsHtml = points.length
        ? `<div class="region-points">${points
            .map((c) => {
              const shot = checkShots.get(c.key);
              const shotsHtml =
                shot && (shot.designFile || shot.liveFile)
                  ? `<span class="point-shots">${shot.designFile ? `<a href="${shot.designFile}" target="_blank"><img src="${shot.designFile}" alt="设计稿 ${escapeHtml(c.label)}"></a>` : ""}${shot.liveFile ? `<a href="${shot.liveFile}" target="_blank"><img src="${shot.liveFile}" alt="线上 ${escapeHtml(c.label)}"></a>` : ""}</span>`
                  : "";
              return `<div class="point status-${c.status}"><span class="badge">${statusBadge(c.status)}</span><span class="point-text">${escapeHtml(c.label)}：期望 ${escapeHtml(c.expected)} / 实际 ${escapeHtml(c.actual)}</span>${c.detail ? `<span class="point-detail">${escapeHtml(c.detail)}</span>` : ""}${shotsHtml}</div>`;
            })
            .join("")}</div>`
        : `<div class="region-points"><div class="point"><span class="point-text">该区块暂无对比点</span></div></div>`;
      return `<div class="region-row"><div class="region-name">${escapeHtml(s.label)}</div><div class="region-shots">${designCell}${liveCell}</div>${pointsHtml}</div>`;
    })
    .join("");
  const regionSection = regionRowsHtml
    ? `<h2>区块对比截图</h2><div class="region-list">${regionRowsHtml}</div>`
    : "";
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>设计稿规范对比报告</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft Yahei",sans-serif;margin:0;background:#f5f6f8;color:#1f2329}
.wrap{max-width:1180px;margin:0 auto;padding:24px}
h1{font-size:22px}h2{font-size:17px;margin-top:28px}
.summary{display:flex;gap:12px;flex-wrap:wrap;margin:16px 0}
.card{background:#fff;border:1px solid #e3e5e8;border-radius:8px;padding:12px 18px;min-width:120px}
.num{font-size:24px;font-weight:600}
.pass .num{color:#0f9d58}.warn .num{color:#f5a623}.fail .num{color:#e5484d}
table{border-collapse:collapse;background:#fff;width:100%;font-size:13px;border:1px solid #e3e5e8}
th,td{border-bottom:1px solid #eef0f2;padding:8px 10px;text-align:left;vertical-align:top}
th{background:#fafbfc;position:sticky;top:0}
.status-pass td:first-child{color:#0f9d58}.status-warn td:first-child{color:#f5a623}.status-fail td:first-child{color:#e5484d}
.images{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:16px 0}
.images img{width:100%;border:1px solid #e3e5e8;border-radius:8px}
.region-list{display:grid;gap:12px;margin:16px 0}
.region-row{background:#fff;border:1px solid #e3e5e8;border-radius:8px;padding:10px 12px}
.region-name{font-weight:600;font-size:13px;margin-bottom:8px}
.region-shots{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.region-shot{margin:0}
.region-shot img{width:100%;height:auto;border:1px solid #e3e5e8;border-radius:8px;background:#fff}
.region-shot figcaption{font-size:12px;color:#666;margin-top:4px}
.region-empty{border:1px dashed #d9dce1;border-radius:8px;color:#999;display:flex;align-items:center;justify-content:center;min-height:80px;background:#fafbfc;font-size:12px}
.region-points{display:grid;gap:6px;margin-top:10px;padding-top:10px;border-top:1px solid #eef0f2}
.point{display:flex;flex-wrap:wrap;gap:4px 10px;font-size:12px;line-height:1.5;align-items:baseline}
.badge{white-space:nowrap}.point-text{color:#333}.point-detail{color:#888}
.point.status-fail .badge{color:#e5484d}.point.status-warn .badge{color:#f5a623}.point.status-pass .badge{color:#0f9d58}
.point-shots{width:100%;display:flex;gap:8px;flex-wrap:wrap;margin-top:2px}
.point-shots a{line-height:0}
.point-shots img{max-width:260px;max-height:140px;width:auto;height:auto;border:1px solid #e3e5e8;border-radius:6px;background:#fff}
@media(max-width:720px){.images,.region-shots{grid-template-columns:1fr}}
</style>
</head>
<body>
<div class="wrap">
<h1>设计稿规范对比报告</h1>
<p>设计稿：${escapeHtml(design.source.nodeName)}（${design.canvas.width}x${design.canvas.height}）｜线上视口：${live.rootViewport.width}x${live.rootViewport.height}</p>
${live.warnings.map((w) => `<p class="note">${escapeHtml(w)}</p>`).join("")}
<div class="summary">
<div class="card pass"><div class="num">${summary.pass}</div><div>通过</div></div>
<div class="card warn"><div class="num">${summary.warn}</div><div>警告</div></div>
<div class="card fail"><div class="num">${summary.fail}</div><div>失败</div></div>
<div class="card"><div class="num">${summary.info}</div><div>信息</div></div>
</div>
${images}
${regionSection}
<h2>设计稿规范</h2>
<h3>布局骨架</h3>
<table><tr><th>区块</th><th>位置</th><th>尺寸</th></tr>${design.regions
    .map(
      (r) =>
        `<tr><td>${escapeHtml(r.name)}</td><td>${Math.round(r.bbox.x)},${Math.round(r.bbox.y)}</td><td>${Math.round(r.bbox.width)}x${Math.round(r.bbox.height)}</td></tr>`,
    )
    .join("")}</table>
<h3>色彩规范</h3>
<table><tr><th>色值</th><th>角色</th><th>面积权重</th><th>文本数</th><th>图形数</th></tr>${design.colors
    .slice(0, 14)
    .map(
      (c) =>
        `<tr><td>${c.hex}</td><td>${c.role}</td><td>${Math.round(c.weight)}</td><td>${c.textCount}</td><td>${c.shapeCount}</td></tr>`,
    )
    .join("")}</table>
<h3>字体规范</h3>
<table><tr><th>字号</th><th>字重</th><th>行高</th><th>颜色</th><th>示例</th></tr>${design.typography
    .slice(0, 12)
    .map(
      (t) =>
        `<tr><td>${t.fontSize}px</td><td>${t.fontWeight}</td><td>${t.lineHeight}px</td><td>${t.color}</td><td>${escapeHtml(t.examples.slice(0, 2).join("、"))}</td></tr>`,
    )
    .join("")}</table>
<h3>线上间距采集</h3>
<table><tr><th>类型</th><th>值</th><th>次数</th></tr>${live.spacing
    .slice(0, 10)
    .map(
      (s) =>
        `<tr><td>${s.kind}</td><td>${s.value}px</td><td>${s.count}</td></tr>`,
    )
    .join("")}</table>
<h2>规范校验</h2>
<h3>区块校验汇总</h3>
<table><tr><th>区块</th><th>通过</th><th>警告</th><th>失败</th><th>跳过</th></tr>${regionRows}</table>
<h3>明细</h3>
<table><tr><th>状态</th><th>区块</th><th>类别</th><th>校验项</th><th>设计稿期望</th><th>线上实际</th><th>说明</th></tr>
${rows}
</table>
</div>
</body>
</html>`;
}
