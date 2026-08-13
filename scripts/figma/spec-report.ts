/**
 * 生成设计稿规范与校验结果的 JSON/Markdown/HTML 产物。
 */
import fs from "fs";
import path from "path";
import { PNG } from "pngjs";
import {
  type Rect,
  type DesignText,
  type DesignSpec,
  type LiveText,
  type LiveSpec,
  type SpecCheck,
  type SpecCheckSummary,
} from "./figma-spec-types.js";
import { summarizeChecks } from "./spec-checks.js";

function statusBadge(status: SpecCheck["status"]): string {
  const map: Record<string, string> = {
    pass: "✅ 通过",
    warn: "⚠️ 警告",
    fail: "❌ 失败",
    info: "ℹ️ 信息",
    skip: "⏭️ 跳过",
  };
  return map[status] || status;
}

function escapeHtml(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function regionLabel(key?: string): string {
  const map: Record<string, string> = {
    header: "顶部导航",
    sidebar: "左侧导航",
    content: "主内容区",
    filter: "筛选/操作区",
    table: "数据列表",
    footer: "底部操作",
    global: "全局",
  };
  return key ? map[key] || key : "全局";
}

function statusRank(status: SpecCheck["status"]): number {
  return ["fail", "warn", "skip", "info", "pass"].indexOf(status);
}

function regionChecks(checks: SpecCheck[], regionKey: string): SpecCheck[] {
  return checks
    .filter((c) => c.region === regionKey)
    .sort((a, b) => statusRank(a.status) - statusRank(b.status));
}

function summarizeByRegion(checks: SpecCheck[]): Array<{
  region: string;
  label: string;
  pass: number;
  warn: number;
  fail: number;
  skip: number;
}> {
  const map = new Map<
    string,
    {
      region: string;
      label: string;
      pass: number;
      warn: number;
      fail: number;
      skip: number;
    }
  >();
  for (const c of checks) {
    const key = c.region || "global";
    const cur = map.get(key) || {
      region: key,
      label: regionLabel(key),
      pass: 0,
      warn: 0,
      fail: 0,
      skip: 0,
    };
    if (c.status === "pass" || c.status === "info") cur.pass += 1;
    else if (c.status === "warn") cur.warn += 1;
    else if (c.status === "fail") cur.fail += 1;
    else cur.skip += 1;
    map.set(key, cur);
  }
  const order = [
    "header",
    "sidebar",
    "content",
    "filter",
    "table",
    "footer",
    "global",
  ];
  return [...map.values()].sort(
    (a, b) =>
      (order.indexOf(a.region) === -1 ? 99 : order.indexOf(a.region)) -
      (order.indexOf(b.region) === -1 ? 99 : order.indexOf(b.region)),
  );
}

export interface RegionShot {
  key: string;
  label: string;
  designFile?: string;
  liveFile?: string;
  designRect?: Rect;
  liveRect?: Rect;
}

export interface CheckShot {
  designFile?: string;
  liveFile?: string;
}

function clampRect(rect: Rect, width: number, height: number): Rect | null {
  const x = Math.max(0, Math.min(rect.x, width));
  const y = Math.max(0, Math.min(rect.y, height));
  const right = Math.max(x, Math.min(rect.x + rect.width, width));
  const bottom = Math.max(y, Math.min(rect.y + rect.height, height));
  if (right - x < 1 || bottom - y < 1) return null;
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(right - x),
    height: Math.round(bottom - y),
  };
}

function cropPng(src: PNG, rect: Rect): PNG {
  const out = new PNG({ width: rect.width, height: rect.height });
  PNG.bitblt(src, out, rect.x, rect.y, rect.width, rect.height, 0, 0);
  return out;
}

function drawBorder(
  src: PNG,
  rect: Rect,
  color: [number, number, number],
  width: number,
): void {
  const safe = clampRect(rect, src.width, src.height);
  if (!safe) return;
  const left = safe.x;
  const top = safe.y;
  const right = safe.x + safe.width - 1;
  const bottom = safe.y + safe.height - 1;
  for (let i = 0; i < width && i * 2 < safe.width && i * 2 < safe.height; i++) {
    for (let px = left + i; px <= right - i; px++) {
      setPixel(src, px, top + i, color);
      setPixel(src, px, bottom - i, color);
    }
    for (let py = top + i; py <= bottom - i; py++) {
      setPixel(src, left + i, py, color);
      setPixel(src, right - i, py, color);
    }
  }
}

function drawRectBorder(
  src: PNG,
  rect: Rect,
  color: [number, number, number],
  width = 2,
): void {
  const safe = clampRect(rect, src.width, src.height);
  if (!safe) return;
  drawBorder(src, safe, [255, 255, 255], width + 2);
  drawBorder(src, safe, color, width);
}

function setPixel(
  src: PNG,
  x: number,
  y: number,
  color: [number, number, number],
): void {
  if (x < 0 || y < 0 || x >= src.width || y >= src.height) return;
  const idx = (y * src.width + x) * 4;
  src.data[idx] = color[0];
  src.data[idx + 1] = color[1];
  src.data[idx + 2] = color[2];
  src.data[idx + 3] = 255;
}

/** 按设计稿区块和线上对应区块裁出局部截图，供报告直观对照。 */
function regionShotFiles(
  outDir: string,
  design: DesignSpec,
  live: LiveSpec,
): RegionShot[] {
  const designPath = path.join(outDir, "design.png");
  const livePath = path.join(outDir, "live.png");
  const designPng = fs.existsSync(designPath)
    ? PNG.sync.read(fs.readFileSync(designPath))
    : null;
  const livePng = fs.existsSync(livePath)
    ? PNG.sync.read(fs.readFileSync(livePath))
    : null;
  if (!designPng && !livePng) return [];

  const shotsDir = path.join(outDir, "regions");
  fs.mkdirSync(shotsDir, { recursive: true });
  const viewport = live.rootViewport || { x: 0, y: 0, width: 1, height: 1 };
  const scaleX = livePng ? livePng.width / Math.max(1, viewport.width) : 1;
  const scaleY = livePng ? livePng.height / Math.max(1, viewport.height) : 1;
  const shots: RegionShot[] = [];

  for (const region of design.regions) {
    const shot: RegionShot = {
      key: region.key,
      label: regionLabel(region.key),
    };
    if (designPng) {
      const rect = clampRect(region.bbox, designPng.width, designPng.height);
      if (rect) {
        const file = `regions/${region.key}-design.png`;
        fs.writeFileSync(
          path.join(shotsDir, `${region.key}-design.png`),
          PNG.sync.write(cropPng(designPng, rect)),
        );
        shot.designFile = file;
        shot.designRect = rect;
      }
    }
    const liveRegion = livePng
      ? live.regions.find((r) => r.key === region.key)
      : undefined;
    if (livePng && liveRegion) {
      const scaled: Rect = {
        x: liveRegion.bbox.x * scaleX,
        y: liveRegion.bbox.y * scaleY,
        width: liveRegion.bbox.width * scaleX,
        height: liveRegion.bbox.height * scaleY,
      };
      const rect = clampRect(scaled, livePng.width, livePng.height);
      if (rect) {
        const file = `regions/${region.key}-live.png`;
        fs.writeFileSync(
          path.join(shotsDir, `${region.key}-live.png`),
          PNG.sync.write(cropPng(livePng, rect)),
        );
        shot.liveFile = file;
        shot.liveRect = rect;
      }
    }
    if (shot.designFile || shot.liveFile) shots.push(shot);
  }
  return shots;
}

function paddedRect(
  rect: Rect,
  width: number,
  height: number,
  pad: number,
): Rect | null {
  return clampRect(
    {
      x: rect.x - pad,
      y: rect.y - pad,
      width: rect.width + pad * 2,
      height: rect.height + pad * 2,
    },
    width,
    height,
  );
}

function writeShotFile(
  outDir: string,
  src: PNG,
  rect: Rect,
  fileName: string,
  highlight?: { rect: Rect; color: [number, number, number] },
): string | undefined {
  const safe = clampRect(rect, src.width, src.height);
  if (!safe) return undefined;
  const crop = cropPng(src, safe);
  if (highlight) {
    const inner = clampRect(
      {
        x: highlight.rect.x - safe.x,
        y: highlight.rect.y - safe.y,
        width: highlight.rect.width,
        height: highlight.rect.height,
      },
      safe.width,
      safe.height,
    );
    if (inner) drawRectBorder(crop, inner, highlight.color);
  }
  fs.writeFileSync(path.join(outDir, fileName), PNG.sync.write(crop));
  return `regions/${fileName}`;
}

/** 为警告/失败校验点裁出对应文字或区块的局部对比截图。 */
function checkShotFiles(
  outDir: string,
  design: DesignSpec,
  live: LiveSpec,
  checks: SpecCheck[],
): Map<string, CheckShot> {
  const designPath = path.join(outDir, "design.png");
  const livePath = path.join(outDir, "live.png");
  const designPng = fs.existsSync(designPath)
    ? PNG.sync.read(fs.readFileSync(designPath))
    : null;
  const livePng = fs.existsSync(livePath)
    ? PNG.sync.read(fs.readFileSync(livePath))
    : null;
  const viewport = live.rootViewport || { x: 0, y: 0, width: 1, height: 1 };
  const scaleX = livePng ? livePng.width / Math.max(1, viewport.width) : 1;
  const scaleY = livePng ? livePng.height / Math.max(1, viewport.height) : 1;

  const designTexts = new Map<string, DesignText>();
  for (const t of design.texts) {
    if (!t.regionKey) continue;
    designTexts.set(`text:${t.regionKey}:${t.normalized}`, t);
  }
  const liveTexts = new Map<string, LiveText>();
  for (const t of live.texts) {
    if (!t.regionKey) continue;
    const key = `text:${t.regionKey}:${t.normalized}`;
    if (!liveTexts.has(key)) liveTexts.set(key, t);
  }

  const shotsDir = path.join(outDir, "regions");
  fs.mkdirSync(shotsDir, { recursive: true });
  const shots = new Map<string, CheckShot>();
  let seq = 0;

  for (const c of checks) {
    if (c.status !== "warn" && c.status !== "fail") continue;
    const shot: CheckShot = {};
    const designText = designTexts.get(c.key);
    const liveText = liveTexts.get(c.key);
    const designRegion = design.regions.find((r) => r.key === c.region);
    const liveRegion = live.regions.find((r) => r.key === c.region);
    const designRect = designText?.bbox ?? designRegion?.bbox;
    const liveRect = liveText
      ? {
          x: liveText.bbox.x * scaleX,
          y: liveText.bbox.y * scaleY,
          width: liveText.bbox.width * scaleX,
          height: liveText.bbox.height * scaleY,
        }
      : liveRegion
        ? {
            x: liveRegion.bbox.x * scaleX,
            y: liveRegion.bbox.y * scaleY,
            width: liveRegion.bbox.width * scaleX,
            height: liveRegion.bbox.height * scaleY,
          }
        : undefined;
    const color: [number, number, number] =
      c.status === "fail" ? [229, 72, 77] : [245, 166, 35];
    if (designRect && designPng) {
      const dRect = paddedRect(
        designRect,
        designPng.width,
        designPng.height,
        8,
      );
      if (dRect) {
        shot.designFile = writeShotFile(
          shotsDir,
          designPng,
          dRect,
          `check-${seq}-design.png`,
          {
            rect: designRect,
            color,
          },
        );
      }
    }
    if (liveRect && livePng) {
      const lRect = paddedRect(liveRect, livePng.width, livePng.height, 8);
      if (lRect) {
        shot.liveFile = writeShotFile(
          shotsDir,
          livePng,
          lRect,
          `check-${seq}-live.png`,
          {
            rect: liveRect,
            color,
          },
        );
      }
    }
    if (shot.designFile || shot.liveFile) {
      shots.set(c.key, shot);
      seq += 1;
    }
  }
  return shots;
}

export function writeDesignSpecOnly(outDir: string, design: DesignSpec): void {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, "design-spec.json"),
    JSON.stringify(design, null, 2),
    "utf-8",
  );
  const lines: string[] = [];
  lines.push("# 设计稿规范");
  lines.push("");
  lines.push(`- 节点：${design.source.nodeName}`);
  lines.push(`- 画布：${design.canvas.width}x${design.canvas.height}`);
  lines.push("");
  lines.push("## 布局骨架");
  lines.push("");
  lines.push("| 区块 | 位置 | 尺寸 |");
  lines.push("| --- | --- | --- |");
  for (const r of design.regions) {
    lines.push(
      `| ${r.name} | ${Math.round(r.bbox.x)},${Math.round(r.bbox.y)} | ${Math.round(r.bbox.width)}x${Math.round(r.bbox.height)} |`,
    );
  }
  lines.push("");
  lines.push("## 色彩规范");
  lines.push("");
  lines.push("| 色值 | 角色 | 面积权重 |");
  lines.push("| --- | --- | --- |");
  for (const c of design.colors.slice(0, 20)) {
    lines.push(`| ${c.hex} | ${c.role} | ${Math.round(c.weight)} |`);
  }
  lines.push("");
  lines.push("## 字体规范");
  lines.push("");
  lines.push("| 字号 | 字重 | 行高 | 颜色 | 示例 |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const t of design.typography.slice(0, 15)) {
    lines.push(
      `| ${t.fontSize}px | ${t.fontWeight} | ${t.lineHeight}px | ${t.color} | ${t.examples.slice(0, 2).join("、")} |`,
    );
  }
  lines.push("");
  lines.push("## 间距与圆角");
  lines.push("");
  lines.push(
    `- 间距：${
      design.spacing
        .slice(0, 12)
        .map((s) => `${s.kind}=${s.value}`)
        .join("，") || "无"
    }`,
  );
  lines.push(
    `- 圆角：${
      design.radii
        .slice(0, 8)
        .map((r) => `${r.value}px`)
        .join("，") || "无"
    }`,
  );
  lines.push("");
  fs.writeFileSync(
    path.join(outDir, "design-spec.md"),
    lines.join("\n"),
    "utf-8",
  );
}

function buildMarkdown(
  design: DesignSpec,
  live: LiveSpec,
  checks: SpecCheck[],
  summary: SpecCheckSummary,
  regionShots: RegionShot[],
  checkShots: ReadonlyMap<string, CheckShot>,
): string {
  const lines: string[] = [];
  lines.push("# 设计稿规范对比报告");
  lines.push("");
  lines.push(
    `- 设计稿：${design.source.nodeName}（${design.canvas.width}x${design.canvas.height}）`,
  );
  lines.push(
    `- 线上页面：${live.rootViewport.width}x${live.rootViewport.height}`,
  );
  lines.push(
    `- 结论：通过 ${summary.pass}，警告 ${summary.warn}，失败 ${summary.fail}，信息 ${summary.info}`,
  );
  for (const w of live.warnings) lines.push(`- 说明：${w}`);
  lines.push("");

  if (regionShots.length) {
    lines.push("## 区块对比截图");
    lines.push("");
    for (const s of regionShots) {
      lines.push(`### ${s.label}`);
      lines.push("");
      lines.push("| 设计稿 | 线上 |");
      lines.push("| --- | --- |");
      const designCell = s.designFile
        ? `![设计稿](${s.designFile})`
        : "无设计稿截图";
      const liveCell = s.liveFile
        ? `![线上](${s.liveFile})`
        : "线上未匹配到该区块";
      lines.push(`| ${designCell} | ${liveCell} |`);
      const points = regionChecks(checks, s.key);
      lines.push("");
      if (points.length) {
        for (const c of points) {
          const shot = checkShots.get(c.key);
          const shotsMd = shot
            ? `${shot.designFile ? ` ![设计稿](${shot.designFile})` : ""}${shot.liveFile ? ` ![线上](${shot.liveFile})` : ""}`
            : "";
          lines.push(
            `- ${statusBadge(c.status)} ${c.label}：期望 ${c.expected ?? "-"} / 实际 ${c.actual ?? "-"}${c.detail ? `（${c.detail}）` : ""}${shotsMd}`,
          );
        }
      } else {
        lines.push("- 该区块暂无对比点");
      }
      lines.push("");
    }
  }

  lines.push("## 设计稿规范");
  lines.push("");
  lines.push("### 布局骨架");
  lines.push("");
  lines.push("| 区块 | 设计稿位置 | 尺寸 |");
  lines.push("| --- | --- | --- |");
  for (const r of design.regions) {
    lines.push(
      `| ${r.name} | ${Math.round(r.bbox.x)},${Math.round(r.bbox.y)} | ${Math.round(r.bbox.width)}x${Math.round(r.bbox.height)} |`,
    );
  }
  lines.push("");

  lines.push("### 色彩规范");
  lines.push("");
  lines.push("| 色值 | 角色 | 面积权重 | 文本数 | 图形数 |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const c of design.colors.slice(0, 14)) {
    lines.push(
      `| ${c.hex} | ${c.role} | ${Math.round(c.weight)} | ${c.textCount} | ${c.shapeCount} |`,
    );
  }
  lines.push("");

  lines.push("### 字体规范");
  lines.push("");
  lines.push("| 字号 | 字重 | 行高 | 颜色 | 字体 | 示例 |");
  lines.push("| --- | --- | --- | --- | --- | --- |");
  for (const t of design.typography.slice(0, 12)) {
    lines.push(
      `| ${t.fontSize}px | ${t.fontWeight} | ${t.lineHeight}px | ${t.color} | ${t.fontFamily} | ${t.examples.slice(0, 2).join("、")} |`,
    );
  }
  lines.push("");

  lines.push("### 间距与圆角");
  lines.push("");
  lines.push(
    `- 间距令牌：${
      design.spacing
        .slice(0, 8)
        .map((s) => `${s.kind}=${s.value}`)
        .join("，") || "无"
    }`,
  );
  lines.push(
    `- 圆角令牌：${
      design.radii
        .slice(0, 6)
        .map((r) => `${r.value}px`)
        .join("，") || "无"
    }`,
  );
  lines.push("");

  lines.push("### 线上间距采集");
  lines.push("");
  lines.push(
    `- gap/padding：${
      live.spacing
        .slice(0, 10)
        .map((s) => `${s.kind}=${s.value}px`)
        .join("，") || "未采集到"
    }`,
  );
  lines.push("");

  lines.push("## 规范校验");
  lines.push("");
  lines.push("### 区块校验汇总");
  lines.push("");
  lines.push("| 区块 | 通过 | 警告 | 失败 | 跳过 |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const r of summarizeByRegion(checks)) {
    lines.push(
      `| ${r.label} | ${r.pass} | ${r.warn} | ${r.fail} | ${r.skip} |`,
    );
  }
  lines.push("");
  lines.push("| 状态 | 区块 | 类别 | 校验项 | 设计稿期望 | 线上实际 | 说明 |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- |");
  for (const c of checks) {
    lines.push(
      `| ${statusBadge(c.status)} | ${regionLabel(c.region)} | ${c.category} | ${c.label} | ${c.expected ?? "-"} | ${c.actual ?? "-"} | ${c.detail || "-"} |`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

function buildHtml(
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

export function writeSpecReport(
  outDir: string,
  design: DesignSpec,
  live: LiveSpec,
  checks: SpecCheck[],
): SpecCheckSummary {
  fs.mkdirSync(outDir, { recursive: true });
  const summary = summarizeChecks(checks);

  fs.writeFileSync(
    path.join(outDir, "design-spec.json"),
    JSON.stringify(design, null, 2),
    "utf-8",
  );
  fs.writeFileSync(
    path.join(outDir, "live-spec.json"),
    JSON.stringify(live, null, 2),
    "utf-8",
  );
  fs.writeFileSync(
    path.join(outDir, "checks.json"),
    JSON.stringify(checks, null, 2),
    "utf-8",
  );
  const regionShots = regionShotFiles(outDir, design, live);
  const checkShots = checkShotFiles(outDir, design, live, checks);
  const regionScreenshots: Record<string, { design?: string; live?: string }> =
    {};
  for (const s of regionShots) {
    regionScreenshots[s.key] = {};
    if (s.designFile) regionScreenshots[s.key]!.design = s.designFile;
    if (s.liveFile) regionScreenshots[s.key]!.live = s.liveFile;
  }
  fs.writeFileSync(
    path.join(outDir, "result.json"),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        summary,
        design: {
          nodeName: design.source.nodeName,
          canvas: design.canvas,
          file: "design-spec.json",
        },
        live: {
          rootViewport: live.rootViewport,
          file: "live-spec.json",
        },
        checksFile: "checks.json",
        reportHtml: "report.html",
        reportMd: "report.md",
        regionScreenshots,
      },
      null,
      2,
    ),
    "utf-8",
  );

  fs.writeFileSync(
    path.join(outDir, "report.md"),
    buildMarkdown(design, live, checks, summary, regionShots, checkShots),
    "utf-8",
  );
  const hasImages =
    fs.existsSync(path.join(outDir, "design.png")) &&
    fs.existsSync(path.join(outDir, "live.png"));
  fs.writeFileSync(
    path.join(outDir, "report.html"),
    buildHtml(
      design,
      live,
      checks,
      summary,
      hasImages,
      regionShots,
      checkShots,
    ),
    "utf-8",
  );
  return summary;
}
