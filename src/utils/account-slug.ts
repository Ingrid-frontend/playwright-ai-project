/** 登录账号 → 基线路径安全 slug（不含完整邮箱/手机号原文） */
export function slugifyLoginAccount(account?: string | null): string {
  const raw = String(account || "").trim().toLowerCase();
  if (!raw) return "";
  let slug = raw
    .replace(/@/g, "_")
    .replace(/\./g, "_")
    .replace(/[^a-z0-9\u4e00-\u9fa5_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  if (!slug) return "";
  return slug.slice(0, 48);
}

export function flowRolePathSegment(roleSlug?: string | null): string {
  const s = String(roleSlug || "").trim();
  if (!s) return "";
  return `by-account/${s}`;
}

export function isGoldenProfileId(profileId?: string | null): boolean {
  const s = String(profileId || "").trim();
  if (!s) return false;
  if (s === "golden") return true;
  if (s.startsWith("golden_") || s.startsWith("golden-")) return true;
  return false;
}

export function isWriteProfileId(profileId?: string | null): boolean {
  const s = String(profileId || "").trim();
  if (!s) return false;
  if (s === "write") return true;
  if (s.startsWith("write_") || s.startsWith("write-")) return true;
  return false;
}
