/**
 * 用例路径与环境（PLAYWRIGHT_ENV）约定：
 *   tests/optimized/<env>/<dateCategory>/xxx.optimized.spec.ts
 *   tests/raw-recordings/original/<env>/<dateCategory>/xxx.spec.ts
 * 旧路径（无 env 段）视为 legacyEnvDefault（默认 stage）。
 */
const fs = require("fs");
const path = require("path");
const { isDateCategoryDirSegment } = require("./date-category.cjs");

const LAYOUT_REL = "config/test-path-layout.json";
const BASE_CONFIG_REL = "datasource/base-config.json";

const DEFAULT_LAYOUT = {
  envSegmentEnabled: true,
  legacyEnvDefault: "stage",
  enforceSpecEnvInCi: true,
};

let cachedLayout = null;
let cachedKnownEnvs = null;

function resolveRepoRoot(startDir) {
  let dir = startDir ? path.resolve(startDir) : process.cwd();
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, "playwright.config.ts"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return startDir ? path.resolve(startDir) : process.cwd();
}

function loadTestPathLayout(repoRoot) {
  if (cachedLayout && !repoRoot) return cachedLayout;
  const root = resolveRepoRoot(repoRoot);
  const p = path.join(root, LAYOUT_REL);
  let merged = { ...DEFAULT_LAYOUT };
  if (fs.existsSync(p)) {
    try {
      merged = { ...DEFAULT_LAYOUT, ...JSON.parse(fs.readFileSync(p, "utf8")) };
    } catch {
      /* use defaults */
    }
  }
  if (!repoRoot) cachedLayout = merged;
  return merged;
}

function listKnownEnvs(repoRoot) {
  if (cachedKnownEnvs && !repoRoot) return cachedKnownEnvs;
  const root = resolveRepoRoot(repoRoot);
  const p = path.join(root, BASE_CONFIG_REL);
  if (!fs.existsSync(p)) {
    const fallback = ["stage"];
    if (!repoRoot) cachedKnownEnvs = fallback;
    return fallback;
  }
  try {
    const keys = Object.keys(JSON.parse(fs.readFileSync(p, "utf8"))).filter(Boolean);
    if (!repoRoot) cachedKnownEnvs = keys;
    return keys;
  } catch {
    const fallback = ["stage"];
    if (!repoRoot) cachedKnownEnvs = fallback;
    return fallback;
  }
}

function isKnownEnv(envId, repoRoot) {
  return listKnownEnvs(repoRoot).includes(String(envId || "").trim());
}

function getLegacyEnvDefault(repoRoot) {
  return loadTestPathLayout(repoRoot).legacyEnvDefault || "stage";
}

function isEnvSegmentEnabled(repoRoot) {
  return loadTestPathLayout(repoRoot).envSegmentEnabled !== false;
}

function normalizeRel(p, repoRoot) {
  const rawInput = String(p || "").trim();
  if (!rawInput) return "";
  let raw = rawInput.replace(/\\/g, "/").replace(/^\.\/+/, "");
  if (raw.startsWith("tests/")) return raw;
  const root = resolveRepoRoot(repoRoot);
  const abs = path.isAbsolute(rawInput) || /^[A-Za-z]:[/\\]/.test(rawInput)
    ? path.resolve(rawInput.replace(/\\/g, path.sep))
    : path.resolve(root, rawInput.replace(/\\/g, path.sep));
  const rel = path.relative(root, abs);
  if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) {
    return rel.split(path.sep).join("/");
  }
  return raw;
}

function parseOptimizedRel(relPath, repoRoot) {
  const norm = normalizeRel(relPath, repoRoot);
  const prefix = "tests/optimized/";
  if (!norm.startsWith(prefix)) return null;
  const rest = norm.slice(prefix.length);
  const parts = rest.split("/").filter(Boolean);
  if (!parts.length) return null;
  const file = parts[parts.length - 1];
  if (!file.endsWith(".optimized.spec.ts") && !file.endsWith(".spec.ts")) {
    /* 目录路径 */
  }
  const legacyDefault = getLegacyEnvDefault(repoRoot);
  if (isKnownEnv(parts[0], repoRoot)) {
    return {
      env: parts[0],
      legacy: false,
      segments: parts.slice(0, -1),
      fileName: file,
    };
  }
  return {
    env: legacyDefault,
    legacy: true,
    segments: parts.slice(0, -1),
    fileName: file,
  };
}

function parseRawOriginalRel(relPath, repoRoot) {
  const norm = normalizeRel(relPath, repoRoot);
  const prefix = "tests/raw-recordings/original/";
  if (!norm.startsWith(prefix)) return null;
  const rest = norm.slice(prefix.length);
  const parts = rest.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  const fileName = parts[parts.length - 1];
  const legacyDefault = getLegacyEnvDefault(repoRoot);
  if (isKnownEnv(parts[0], repoRoot)) {
    if (parts.length >= 3) {
      return {
        env: parts[0],
        legacy: false,
        dateCategory: parts[1],
        fileName,
      };
    }
    return {
      env: parts[0],
      legacy: false,
      dateCategory: null,
      fileName,
    };
  }
  if (isDateCategoryDirSegment(parts[0])) {
    return {
      env: legacyDefault,
      legacy: true,
      dateCategory: parts[0],
      fileName,
    };
  }
  return null;
}

function parseEnvFromSpecRel(relPath, repoRoot) {
  const parsed = parseOptimizedRel(relPath, repoRoot);
  return parsed ? parsed.env : null;
}

function buildRawOriginalRel({ playwrightEnv, dateCategory, fileName, repoRoot }) {
  const layout = loadTestPathLayout(repoRoot);
  const env = String(playwrightEnv || getLegacyEnvDefault(repoRoot)).trim();
  if (!isKnownEnv(env, repoRoot)) {
    throw new Error(`未知环境: ${env}（请在 datasource/base-config.json 中配置）`);
  }
  const cat = String(dateCategory || "").trim();
  if (!cat) throw new Error("dateCategory 不能为空");
  if (layout.envSegmentEnabled) {
    return `tests/raw-recordings/original/${env}/${cat}/${fileName}`;
  }
  return `tests/raw-recordings/original/${cat}/${fileName}`;
}

function buildOptimizedRel({ playwrightEnv, dateCategory, stem, repoRoot }) {
  const layout = loadTestPathLayout(repoRoot);
  const env = String(playwrightEnv || getLegacyEnvDefault(repoRoot)).trim();
  if (!isKnownEnv(env, repoRoot)) {
    throw new Error(`未知环境: ${env}`);
  }
  const fileName = `${stem}.optimized.spec.ts`;
  const cat = String(dateCategory || "").trim();
  if (layout.envSegmentEnabled && cat) {
    return `tests/optimized/${env}/${cat}/${fileName}`;
  }
  if (cat) return `tests/optimized/${cat}/${fileName}`;
  if (layout.envSegmentEnabled) return `tests/optimized/${env}/${fileName}`;
  return `tests/optimized/${fileName}`;
}

function buildScreenshotDir({ playwrightEnv, dateCategory, fileName, repoRoot }) {
  const layout = loadTestPathLayout(repoRoot);
  const env = String(playwrightEnv || getLegacyEnvDefault(repoRoot)).trim();
  const cat = String(dateCategory || "").trim();
  if (layout.envSegmentEnabled && cat) return `screenshots/${env}/${cat}/${fileName}`;
  if (layout.envSegmentEnabled && env) return `screenshots/${env}/${fileName}`;
  if (cat) return `screenshots/${cat}/${fileName}`;
  return `screenshots/${fileName}`;
}

function specMatchesEnv(relPath, targetEnv, repoRoot) {
  const env = parseEnvFromSpecRel(relPath, repoRoot);
  if (!env) return true;
  return env === String(targetEnv || "").trim();
}

function shouldEnforceSpecEnv() {
  if (process.env.PLAYWRIGHT_ENFORCE_SPEC_ENV === "1") return true;
  if (process.env.PLAYWRIGHT_ENFORCE_SPEC_ENV === "0") return false;
  const layout = loadTestPathLayout();
  const inCi =
    process.env.CI === "true" ||
    process.env.CI === "1" ||
    process.env.GITHUB_ACTIONS === "true" ||
    process.env.GITHUB_ACTIONS === "1";
  return inCi && layout.enforceSpecEnvInCi !== false;
}

function assertSpecEnvMatch(relPath, runtimeEnv, repoRoot) {
  const specEnv = parseEnvFromSpecRel(relPath, repoRoot);
  const runEnv = String(runtimeEnv || process.env.PLAYWRIGHT_ENV || getLegacyEnvDefault(repoRoot)).trim();
  if (!specEnv || specEnv === runEnv) return { ok: true, specEnv: specEnv || runEnv, runtimeEnv: runEnv };
  const msg = `用例环境「${specEnv}」与当前运行环境「${runEnv}」不一致: ${relPath}`;
  if (shouldEnforceSpecEnv()) {
    throw new Error(msg);
  }
  console.warn(`⚠️  ${msg}`);
  return { ok: false, specEnv, runtimeEnv: runEnv, warned: true };
}

function optimizedImportDepthFromRel(relPath) {
  const parsed = parseOptimizedRel(relPath);
  if (!parsed) return 1;
  return Math.max(1, parsed.segments.length);
}

function optimizedImportPathsForDepth(depth) {
  const up = "../".repeat(depth);
  return {
    fixtures: `${up}fixtures`,
    screenshot: `${up}../utils/screenshot`,
    optimizedActions: `${up}../utils/optimized-actions`,
    fixturesCommentPhrase: `${up}fixtures`,
  };
}

function parseEnvAndDateCategoryFromRawOrProcessed(absOrRel, repoRoot) {
  const norm = normalizeRel(absOrRel, repoRoot);
  let m = norm.match(/^tests\/raw-recordings\/original\/([^/]+)\/([^/]+)\/.+\.spec\.ts$/);
  if (m) {
    if (isKnownEnv(m[1], repoRoot)) return { env: m[1], dateCategory: m[2], legacy: false };
    if (isDateCategoryDirSegment(m[1])) return { env: getLegacyEnvDefault(repoRoot), dateCategory: m[1], legacy: true };
  }
  m = norm.match(/^tests\/raw-recordings\/([^/]+)\/([^/]+)\/processed\/.+\.spec\.ts$/);
  if (m) {
    if (isKnownEnv(m[1], repoRoot)) return { env: m[1], dateCategory: m[2], legacy: false };
    if (isDateCategoryDirSegment(m[1])) return { env: getLegacyEnvDefault(repoRoot), dateCategory: m[1], legacy: true };
  }
  m = norm.match(/^tests\/raw-recordings\/original\/([^/]+)\/.+\.spec\.ts$/);
  if (m && isDateCategoryDirSegment(m[1])) {
    return { env: getLegacyEnvDefault(repoRoot), dateCategory: m[1], legacy: true };
  }
  m = norm.match(/^tests\/raw-recordings\/original\/([^/]+)\/([^/]+)\.spec\.ts$/);
  if (m && isKnownEnv(m[1], repoRoot)) {
    return { env: m[1], dateCategory: null, legacy: false };
  }
  return { env: getLegacyEnvDefault(repoRoot), dateCategory: null, legacy: true };
}

module.exports = {
  loadTestPathLayout,
  listKnownEnvs,
  isKnownEnv,
  getLegacyEnvDefault,
  isEnvSegmentEnabled,
  parseOptimizedRel,
  parseRawOriginalRel,
  parseEnvFromSpecRel,
  buildRawOriginalRel,
  buildOptimizedRel,
  buildScreenshotDir,
  specMatchesEnv,
  shouldEnforceSpecEnv,
  assertSpecEnvMatch,
  optimizedImportDepthFromRel,
  optimizedImportPathsForDepth,
  parseEnvAndDateCategoryFromRawOrProcessed,
  resolveRepoRoot,
};
