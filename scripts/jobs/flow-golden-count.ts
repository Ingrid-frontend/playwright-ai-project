import { createRequire } from "module";
import path from "path";
import type { AccountProfileFilter } from "./job-utils.js";

const require = createRequire(import.meta.url);
const repoEnv = require("../../pw-files/repo-env.js");

export function countRequestFlowGoldenProfiles(
  repoRoot: string,
  envId: string,
  profileFilter?: AccountProfileFilter,
): number {
  let ids: string[] = repoEnv.listGoldenProfileIds(repoRoot, envId);
  if (profileFilter && profileFilter !== "all") {
    const allowed = Array.isArray(profileFilter) ? profileFilter : [String(profileFilter)];
    ids = ids.filter((id: string) => allowed.includes(id));
  }
  return ids.filter((id: string) => {
    const rel = repoEnv.resolveStorageStateRelDirect(repoRoot, envId, id);
    return repoEnv.storageExists(repoRoot, rel);
  }).length;
}

export function formatFlowGoldenSpecsLabel(
  repoRoot: string,
  envId: string,
  profileFilter?: AccountProfileFilter,
): string {
  const n = countRequestFlowGoldenProfiles(repoRoot, envId, profileFilter);
  return n ? `申请单 Golden · ${n} 个 golden* 角色` : "申请单 Golden · 请先为 golden* 档案登录";
}

export function resolveRepoRoot(): string {
  return process.cwd();
}

export function flowGoldenSpecPath(): string {
  return path.join("request-flow", "tests", "request", "golden-regression.spec.ts");
}
