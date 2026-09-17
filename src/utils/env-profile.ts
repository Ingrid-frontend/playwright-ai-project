import fs from "fs";
import path from "path";

export type EnvProfile = {
  label: string;
  compareCrossBrowser?: boolean;
  defaultBrowsers?: string[];
  deliverySuffix?: string;
  customerDeliveryPrimary?: boolean;
};

export type EnvProfilesConfig = {
  version: number;
  defaultProfile: string;
  runHistoryOrder: string[];
  profiles: Record<string, EnvProfile>;
};

const CONFIG_REL = "config/env-profiles.json";

const FALLBACK: EnvProfilesConfig = {
  version: 1,
  defaultProfile: "stage",
  runHistoryOrder: ["stage", "stage9084", "uat", "dev"],
  profiles: {
    dev: { label: "DEV环境", compareCrossBrowser: true, defaultBrowsers: ["chrome", "webkit"] },
    uat: { label: "UAT环境", compareCrossBrowser: false, defaultBrowsers: ["chrome"] },
    stage9084: {
      label: "Stage9084环境",
      compareCrossBrowser: false,
      defaultBrowsers: ["chrome"],
      customerDeliveryPrimary: true,
    },
    stage: { label: "预发布环境", compareCrossBrowser: false, defaultBrowsers: ["chrome"] },
  },
};

let cached: EnvProfilesConfig | null = null;

function resolveRepoRoot(startDir?: string): string {
  let dir = startDir ? path.resolve(startDir) : process.cwd();
  for (let i = 0; i < 10; i += 1) {
    if (fs.existsSync(path.join(dir, "playwright.config.ts"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return startDir ? path.resolve(startDir) : process.cwd();
}

export function loadEnvProfiles(repoRoot?: string): EnvProfilesConfig {
  if (cached && !repoRoot) return cached;
  const root = resolveRepoRoot(repoRoot);
  const file = path.join(root, CONFIG_REL);
  let merged = { ...FALLBACK, profiles: { ...FALLBACK.profiles } };
  if (fs.existsSync(file)) {
    try {
      const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<EnvProfilesConfig>;
      merged = {
        ...FALLBACK,
        ...raw,
        profiles: { ...FALLBACK.profiles, ...(raw.profiles || {}) },
        runHistoryOrder: raw.runHistoryOrder?.length ? raw.runHistoryOrder : FALLBACK.runHistoryOrder,
      };
    } catch {
      /* use fallback */
    }
  }
  if (!repoRoot) cached = merged;
  return merged;
}

export function reloadEnvProfiles(repoRoot?: string): EnvProfilesConfig {
  if (!repoRoot) cached = null;
  return loadEnvProfiles(repoRoot);
}

export function listEnvProfileIds(repoRoot?: string): string[] {
  return Object.keys(loadEnvProfiles(repoRoot).profiles);
}

export function getEnvProfile(envId?: string, repoRoot?: string): EnvProfile | null {
  const id = String(envId || process.env.PLAYWRIGHT_ENV || loadEnvProfiles(repoRoot).defaultProfile).trim();
  if (!id) return null;
  return loadEnvProfiles(repoRoot).profiles[id] ?? null;
}

export function resolveActiveEnvId(repoRoot?: string): string {
  return (
    process.env.PLAYWRIGHT_ENV?.trim() ||
    loadEnvProfiles(repoRoot).defaultProfile ||
    "stage"
  );
}

export function envLabelFromProfile(envId: string, repoRoot?: string): string {
  const id = String(envId || "").trim();
  if (!id) return "";
  const profile = loadEnvProfiles(repoRoot).profiles[id];
  if (profile?.label) return profile.label;
  const stageNum = /^stage(\d+)$/i.exec(id);
  if (stageNum) return `Stage${stageNum[1]}环境`;
  return id;
}

export function envIdSortKey(envId: string, repoRoot?: string): number {
  const key = String(envId || "").toLowerCase();
  const order = loadEnvProfiles(repoRoot).runHistoryOrder;
  const i = order.indexOf(key);
  if (i >= 0) return i;
  if (!key) return order.length + 1;
  return order.length;
}

export function isKnownEnvProfile(envId: string, repoRoot?: string): boolean {
  const key = String(envId || "").trim().toLowerCase();
  if (!key) return false;
  if (loadEnvProfiles(repoRoot).profiles[key]) return true;
  return Boolean(/^stage\d+$/i.test(key));
}

export function resolveDeliveryPayloadPath(envId?: string, repoRoot?: string): string {
  const id = String(envId || resolveActiveEnvId(repoRoot)).trim();
  const suffix = getEnvProfile(id, repoRoot)?.deliverySuffix || id;
  return suffix ? `results/customer-delivery-${suffix}.json` : "results/customer-delivery.json";
}

export function resolveCompareCrossBrowserForEnv(envId?: string, repoRoot?: string): boolean | undefined {
  const profile = getEnvProfile(envId, repoRoot);
  if (profile?.compareCrossBrowser === undefined) return undefined;
  return profile.compareCrossBrowser !== false;
}

export function resolveDefaultBrowsersForEnv(envId?: string, repoRoot?: string): string[] | undefined {
  const browsers = getEnvProfile(envId, repoRoot)?.defaultBrowsers;
  return browsers?.length ? browsers : undefined;
}

export function primaryCustomerDeliveryEnv(repoRoot?: string): string {
  const cfg = loadEnvProfiles(repoRoot);
  const hit = Object.entries(cfg.profiles).find(([, p]) => p.customerDeliveryPrimary);
  return hit?.[0] || "stage9084";
}
