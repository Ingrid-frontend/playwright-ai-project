#!/usr/bin/env tsx
/**
 * 从 flow-ui-issues 中的 selector-drift 生成 structureChecks 补丁建议
 *
 * 用法: npm run selector-drift:suggest [-- --issues=results/flow-ui-issues.json]
 */
import fs from "fs";
import path from "path";
import type { UiIssue } from "./ui-issues.js";
import { loadUiRegressionConfig } from "./ui-regression-config.js";
import type { StepMeta } from "./structure-check.js";

export type SelectorDriftPatch = {
  issueId: string;
  scriptKey: string;
  stepNumber: number;
  stepName: string;
  key: string;
  configSelector: string;
  resolvedBy: string;
  suggestSelectors: string[];
  metaPath: string;
  note: string;
};

export type SelectorDriftSuggestReport = {
  generatedAt: string;
  patches: SelectorDriftPatch[];
  skipped: Array<{ issueId: string; reason: string }>;
};

function metaPathForPng(pngPath: string): string {
  return pngPath.replace(/\.png$/i, ".meta.json");
}

function readMeta(filePath: string): StepMeta | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as StepMeta;
  } catch {
    return null;
  }
}

function pngFromIssue(repoRoot: string, issue: UiIssue): string {
  const rel = String(issue.currentPath || "").replace(/\\/g, "/");
  if (!rel) return "";
  const shotIdx = rel.indexOf("screenshots/");
  if (shotIdx >= 0) {
    const png = path.resolve(repoRoot, rel.slice(shotIdx));
    return png.endsWith(".png") ? png : png.replace(/\.meta\.json$/i, ".png");
  }
  const abs = path.resolve(repoRoot, "results", rel);
  return abs.endsWith(".png") ? abs : abs.replace(/\.meta\.json$/i, ".png");
}

function itemKeyFromIssue(issue: UiIssue): string {
  const m = String(issue.detail || "").match(/:\s*(\S+)\s*$/);
  return m?.[1] || "";
}

export function buildSelectorDriftSuggest(
  repoRoot: string,
  issues: UiIssue[],
): SelectorDriftSuggestReport {
  const cfgItems = loadUiRegressionConfig().structureChecks?.items || [];
  const patches: SelectorDriftPatch[] = [];
  const skipped: SelectorDriftSuggestReport["skipped"] = [];

  for (const issue of issues.filter((i) => i.structureType === "selector-drift")) {
    const key = itemKeyFromIssue(issue);
    if (!key) {
      skipped.push({ issueId: issue.issueId, reason: "无法解析 structureChecks key" });
      continue;
    }
    const cfg = cfgItems.find((i) => i.key === key);
    const pngAbs = pngFromIssue(repoRoot, issue);
    const metaAbs = pngAbs ? metaPathForPng(pngAbs) : "";
    const meta = metaAbs ? readMeta(metaAbs) : null;
    const sel = meta?.selectors?.[key];
    if (!sel) {
      skipped.push({ issueId: issue.issueId, reason: `meta 无 selectors.${key}` });
      continue;
    }

    const resolvedBy = String(sel.resolvedBy || "selector");
    const suggest: string[] = [];
    const fp = sel.fingerprint;
    if (Array.isArray(fp?.fallbackSelectors)) {
      for (const s of fp.fallbackSelectors) {
        if (typeof s === "string" && s.trim()) suggest.push(s.trim());
      }
    }
    if (fp?.xpath && typeof fp.xpath === "string") suggest.push(fp.xpath);
    if (!suggest.length && cfg?.selector) suggest.push(cfg.selector);

    patches.push({
      issueId: issue.issueId,
      scriptKey: issue.scriptKey,
      stepNumber: issue.stepNumber,
      stepName: issue.stepName,
      key,
      configSelector: cfg?.selector || "",
      resolvedBy,
      suggestSelectors: [...new Set(suggest)],
      metaPath: metaAbs ? path.relative(repoRoot, metaAbs) : "",
      note:
        resolvedBy === "selector"
          ? "主选择器仍生效，可忽略"
          : `主选择器失效，当前由 ${resolvedBy} 兜底；可将 suggestSelectors 写回 ui-regression.json structureChecks.items`,
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    patches,
    skipped,
  };
}

export function writeSelectorDriftSuggest(
  repoRoot: string,
  report: SelectorDriftSuggestReport,
  outJson = "results/selector-drift-suggest.json",
): void {
  const jsonAbs = path.resolve(repoRoot, outJson);
  fs.mkdirSync(path.dirname(jsonAbs), { recursive: true });
  fs.writeFileSync(jsonAbs, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  const mdLines = [
    "# selector-drift 补丁建议",
    "",
    `生成于 ${report.generatedAt}`,
    "",
  ];
  if (!report.patches.length) {
    mdLines.push("无 selector-drift 项。");
  } else {
    for (const p of report.patches) {
      mdLines.push(`## ${p.scriptKey} · step ${p.stepNumber} · ${p.key}`);
      mdLines.push(`- config: \`${p.configSelector}\``);
      mdLines.push(`- resolvedBy: \`${p.resolvedBy}\``);
      mdLines.push(`- suggest: ${p.suggestSelectors.map((s) => `\`${s}\``).join(" · ") || "—"}`);
      mdLines.push(`- meta: \`${p.metaPath}\``);
      mdLines.push(`- ${p.note}`);
      mdLines.push("");
    }
  }
  const mdAbs = jsonAbs.replace(/\.json$/i, ".md");
  fs.writeFileSync(mdAbs, `${mdLines.join("\n")}\n`, "utf8");
}

function main(): void {
  const repoRoot = process.cwd();
  let issuesPath = "results/flow-ui-issues.json";
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--issues=")) issuesPath = arg.slice(9).trim();
  }
  const abs = path.resolve(repoRoot, issuesPath);
  if (!fs.existsSync(abs)) {
    console.error(`未找到 ${issuesPath}`);
    process.exit(1);
  }
  const raw = JSON.parse(fs.readFileSync(abs, "utf8")) as { issues?: UiIssue[] };
  const report = buildSelectorDriftSuggest(repoRoot, raw.issues || []);
  writeSelectorDriftSuggest(repoRoot, report);
  console.log(`✅ selector-drift 建议: ${report.patches.length} 条 · ${report.skipped.length} 跳过`);
  console.log(`   results/selector-drift-suggest.json`);
}

main();
