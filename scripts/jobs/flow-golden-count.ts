import { createRequire } from "module";
import path from "path";
import type { AccountProfileFilter } from "./job-utils.js";
import { listKnownEnvs } from "../../src/utils/test-env-path.js";

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
  if (envId === "all") {
    const envs = listKnownEnvs(repoRoot);
    const n = envs.reduce((sum, env) => sum + countRequestFlowGoldenProfiles(repoRoot, env, profileFilter), 0);
    return n ? `申请单 Golden · 全环境 ${n} 个 golden* 角色` : "申请单 Golden · 请先为 golden* 档案登录";
  }
  const n = countRequestFlowGoldenProfiles(repoRoot, envId, profileFilter);
  return n ? `申请单 Golden · ${n} 个 golden* 角色` : "申请单 Golden · 请先为 golden* 档案登录";
}

export function resolveRepoRoot(): string {
  return process.cwd();
}

export function countApprovalFlowGoldenProfiles(
  repoRoot: string,
  envId: string,
  profileFilter?: AccountProfileFilter,
): number {
  return countRequestFlowGoldenProfiles(repoRoot, envId, profileFilter);
}

export function formatApprovalFlowGoldenSpecsLabel(
  repoRoot: string,
  envId: string,
  profileFilter?: AccountProfileFilter,
): string {
  const n = countApprovalFlowGoldenProfiles(repoRoot, envId, profileFilter);
  return n ? `审批 Golden · ${n} 个 golden* 角色` : "审批 Golden · 请先为 golden* 档案登录";
}

export function approvalGoldenSpecPath(): string {
  return path.join("approval-flow", "tests", "approval", "golden-regression.spec.ts");
}

export function flowGoldenSpecPath(): string {
  return path.join("request-flow", "tests", "request", "golden-regression.spec.ts");
}
