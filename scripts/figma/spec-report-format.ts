import { type SpecCheck } from "./figma-spec-types.js";

export function statusBadge(status: SpecCheck["status"]): string {
  const map: Record<string, string> = {
    pass: "✅ 通过",
    warn: "⚠️ 警告",
    fail: "❌ 失败",
    info: "ℹ️ 信息",
    skip: "⏭️ 跳过",
  };
  return map[status] || status;
}

export function escapeHtml(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function regionLabel(key?: string): string {
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

export function statusRank(status: SpecCheck["status"]): number {
  return ["fail", "warn", "skip", "info", "pass"].indexOf(status);
}

export function regionChecks(checks: SpecCheck[], regionKey: string): SpecCheck[] {
  return checks
    .filter((c) => c.region === regionKey)
    .sort((a, b) => statusRank(a.status) - statusRank(b.status));
}

export function summarizeByRegion(checks: SpecCheck[]): Array<{
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
