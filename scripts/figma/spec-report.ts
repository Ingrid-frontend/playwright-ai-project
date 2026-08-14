/**
 * 生成设计稿规范与校验结果的 JSON/Markdown/HTML 产物。
 */
import fs from "fs";
import path from "path";
import {
  type DesignSpec,
  type LiveSpec,
  type SpecCheck,
  type SpecCheckSummary,
} from "./figma-spec-types.js";
import { summarizeChecks } from "./spec-checks.js";
import {
  regionLabel,
  regionChecks,
  statusBadge,
  summarizeByRegion,
} from "./spec-report-format.js";
import { buildHtml } from "./spec-report-html.js";
import {
  checkShotFiles,
  regionShotFiles,
  type CheckShot,
  type RegionShot,
} from "./spec-report-shots.js";

export type { CheckShot, RegionShot } from "./spec-report-shots.js";

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
