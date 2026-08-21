/**
 * 用例元数据（账号档案 / 登录账号 / 录制信息）
 *  sidecar: *.spec-meta.json / *.optimized.spec-meta.json
 */
import fs from "fs";
import path from "path";
import { extractFromCode } from "./extract-login-account.js";
import { readLoginStateMeta, formatLoginAccountLabel } from "./storage-state-meta.js";
import { parseEnvFromSpecRel, getLegacyEnvDefault } from "./test-env-path.js";

const META_VERSION = 1;
const UNKNOWN_PROFILE = "unknown";

function maskUsername(username?: any) {
  const u = String(username || "");
  if (!u.trim()) return null;
  if (u.length <= 4) return "****";
  if (u.includes("@")) {
    const [name, domain] = u.split("@");
    const head = name.slice(0, Math.min(3, name.length));
    return `${head}***@${domain}`;
  }
  return `${u.slice(0, 3)}***${u.slice(-2)}`;
}

function specMetaPathForRel(specRel?: any) {
  const norm = String(specRel || "").replace(/\\/g, "/");
  if (norm.endsWith(".optimized.spec.ts")) {
    return norm.replace(/\.optimized\.spec\.ts$/, ".optimized.spec-meta.json");
  }
  if (norm.endsWith(".spec.ts")) {
    return norm.replace(/\.spec\.ts$/, ".spec-meta.json");
  }
  return null;
}

function readSpecMetaFile(repoRoot?: any, specRel?: any) {
  const metaRel = specMetaPathForRel(specRel);
  if (!metaRel) return null;
  const abs = path.join(repoRoot, metaRel);
  if (!fs.existsSync(abs)) return null;
  try {
    return JSON.parse(fs.readFileSync(abs, "utf8"));
  } catch {
    return null;
  }
}

function writeSpecMetaFile(repoRoot?: any, specRel?: any, meta?: any) {
  const metaRel = specMetaPathForRel(specRel);
  if (!metaRel) return false;
  const abs = path.join(repoRoot, metaRel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const payload = { version: META_VERSION, ...meta };
  delete payload.hasMeta;
  fs.writeFileSync(abs, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return true;
}

function deleteSpecMetaFile(repoRoot?: any, specRel?: any) {
  const metaRel = specMetaPathForRel(specRel);
  if (!metaRel) return false;
  const abs = path.join(repoRoot, metaRel);
  if (!fs.existsSync(abs)) return false;
  fs.unlinkSync(abs);
  return true;
}

function parseSpecMetaBlockFromCode(code?: any) {
  const text = String(code || "");
  const block = text.match(/\/\*\*\s*\n\s*\*\s*@spec-meta\s*\n\s*\*\s*(\{[\s\S]*?\})\s*\n\s*\*\//);
  if (block) {
    try {
      return JSON.parse(block[1]);
    } catch {
      /* ignore */
    }
  }
  const envMatch = text.match(/\/\/\s*环境:\s*([^|]+)\|\s*登录账号:\s*(.+)/);
  const storageMatch = text.match(/\/\/\s*storageState:\s*(.+)/);
  if (envMatch) {
    const loginRaw = envMatch[2].trim();
    const loginAccount =
      loginRaw && !loginRaw.includes("未识别") && !loginRaw.includes("手动登录")
        ? maskUsername(loginRaw) || loginRaw
        : null;
    return {
      playwrightEnv: envMatch[1].trim(),
      loginAccount,
      storageStateRel: storageMatch ? storageMatch[1].trim() : null,
    };
  }
  return null;
}

function normalizeSpecMeta(meta?: any, opts: { hasMetaFile?: boolean } = {}) {
  const hasMetaFile = opts.hasMetaFile !== false;
  const accountProfile = String(meta?.accountProfile || UNKNOWN_PROFILE).trim() || UNKNOWN_PROFILE;
  return {
    hasMeta: hasMetaFile && accountProfile !== UNKNOWN_PROFILE,
    playwrightEnv: meta?.playwrightEnv || null,
    accountProfile,
    loginAccount: meta?.loginAccount || null,
    loginUserId: meta?.loginUserId || null,
    storageStateRel: meta?.storageStateRel || null,
    recordedAt: meta?.recordedAt || null,
    recordSource: meta?.recordSource || null,
    rawOriginalRel: meta?.rawOriginalRel || null,
    optimizedRel: meta?.optimizedRel || null,
  };
}

function buildSpecMeta(opts?: any) {
  const loginRaw = opts.loginAccountRaw || opts.loginAccount || null;
  return {
    version: META_VERSION,
    playwrightEnv: opts.playwrightEnv || "stage",
    accountProfile: opts.accountProfile || "default",
    loginAccount: loginRaw ? maskUsername(String(loginRaw)) : null,
    loginUserId: opts.loginUserId || null,
    storageStateRel: opts.storageStateRel || null,
    recordedAt: opts.recordedAt || new Date().toISOString(),
    recordSource: opts.recordSource || "studio",
    rawOriginalRel: opts.rawOriginalRel || null,
    optimizedRel: opts.optimizedRel || null,
  };
}

function buildSpecMetaFromSession(repoRoot?: any, opts?: any) {
  const code = opts.code || "";
  const storageAbs = opts.storageAbs || null;
  const storageRel =
    opts.storageStateRel ||
    (storageAbs ? path.relative(repoRoot, storageAbs).replace(/\\/g, "/") : null);
  let loginAccountRaw = extractFromCode(code);
  let loginUserId = null;
  if (storageAbs && fs.existsSync(storageAbs)) {
    const stMeta = readLoginStateMeta(storageAbs);
    loginAccountRaw = loginAccountRaw || formatLoginAccountLabel(stMeta) || null;
    loginUserId = stMeta?.userId || null;
  }
  const header = parseSpecMetaBlockFromCode(code);
  if (header?.loginAccount) {
    loginAccountRaw = loginAccountRaw || header.loginAccount;
  }
  return buildSpecMeta({
    playwrightEnv: opts.playwrightEnv,
    accountProfile: opts.accountProfile || "default",
    loginAccountRaw,
    loginUserId,
    storageStateRel: storageRel || header?.storageStateRel || null,
    recordedAt: opts.recordedAt,
    recordSource: opts.recordSource || "studio",
    rawOriginalRel: opts.rawOriginalRel || null,
    optimizedRel: opts.optimizedRel || null,
  });
}

function appendSpecMetaHeaderToCode(code?: any, meta?: any) {
  const payload = {
    playwrightEnv: meta.playwrightEnv,
    accountProfile: meta.accountProfile,
    loginAccount: meta.loginAccount,
    recordedAt: meta.recordedAt,
  };
  const block = `/**\n * @spec-meta\n * ${JSON.stringify(payload)}\n */\n`;
  const text = String(code || "");
  if (/@spec-meta/.test(text.slice(0, 1200))) return text;
  return block + text.replace(/^\s*/, "");
}

function mapProcessedToOriginalRel(processedRel?: any) {
  const norm = String(processedRel || "").replace(/\\/g, "/");
  let m = norm.match(/^tests\/raw-recordings\/([^/]+)\/(\d{6})\/processed\/(.+\.spec\.ts)$/);
  if (m) return `tests/raw-recordings/original/${m[1]}/${m[2]}/${m[3]}`;
  m = norm.match(/^tests\/raw-recordings\/(\d{6})\/processed\/(.+\.spec\.ts)$/);
  if (m) return `tests/raw-recordings/original/${m[1]}/${m[2]}`;
  return null;
}

function resolveOptimizedSpecMeta(repoRoot?: any, optimizedRel?: any) {
  const fileMeta = readSpecMetaFile(repoRoot, optimizedRel);
  if (fileMeta) return normalizeSpecMeta(fileMeta, { hasMetaFile: true });

  const abs = path.join(repoRoot, optimizedRel);
  if (fs.existsSync(abs)) {
    const fromCode = parseSpecMetaBlockFromCode(fs.readFileSync(abs, "utf8"));
    if (fromCode) {
      return normalizeSpecMeta(
        {
          ...fromCode,
          accountProfile: fromCode.accountProfile || UNKNOWN_PROFILE,
          optimizedRel,
        },
        { hasMetaFile: false },
      );
    }
  }
  const env = parseEnvFromSpecRel(optimizedRel, repoRoot) || getLegacyEnvDefault(repoRoot);
  return normalizeSpecMeta(
    { playwrightEnv: env, accountProfile: UNKNOWN_PROFILE, optimizedRel },
    { hasMetaFile: false },
  );
}

function enrichOptimizedSpecEntry(repoRoot?: any, rel?: any) {
  const meta = resolveOptimizedSpecMeta(repoRoot, rel);
  return {
    rel,
    playwrightEnv: meta.playwrightEnv,
    accountProfile: meta.accountProfile,
    loginAccount: meta.loginAccount,
    recordedAt: meta.recordedAt,
    hasMeta: meta.hasMeta,
  };
}

function copyRawMetaToOptimized(repoRoot?: any, rawRel?: any, optimizedRel?: any, patch: any = {}) {
  let meta = readSpecMetaFile(repoRoot, rawRel);
  if (!meta) {
    meta = buildSpecMetaFromSession(repoRoot, {
      playwrightEnv: patch.playwrightEnv,
      accountProfile: patch.accountProfile,
      code: patch.code,
      storageAbs: patch.storageAbs,
      rawOriginalRel: rawRel,
      optimizedRel,
      recordSource: patch.recordSource || "studio",
    });
  }
  meta.optimizedRel = optimizedRel;
  meta.rawOriginalRel = rawRel;
  if (patch.accountProfile) meta.accountProfile = patch.accountProfile;
  if (patch.playwrightEnv) meta.playwrightEnv = patch.playwrightEnv;
  writeSpecMetaFile(repoRoot, optimizedRel, meta);
  return meta;
}

function writeRawSpecMetaFromSession(repoRoot?: any, rawRel?: any, sessionMeta?: any) {
  const meta = buildSpecMetaFromSession(repoRoot, { ...sessionMeta, rawOriginalRel: rawRel });
  writeSpecMetaFile(repoRoot, rawRel, meta);
  return meta;
}

function groupEntriesByPlaywrightEnv(entries?: any) {
  const groups = new Map<string, any[]>();
  for (const entry of entries || []) {
    const env = String(entry?.playwrightEnv || '').trim() || 'unknown';
    if (!groups.has(env)) groups.set(env, []);
    groups.get(env)!.push(entry);
  }
  return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

function groupEntriesByAccountProfile(entries?: any) {
  const groups = new Map<string, any[]>();
  for (const entry of entries) {
    const prof = entry.accountProfile || UNKNOWN_PROFILE;
    if (!groups.has(prof)) groups.set(prof, []);
    groups.get(prof)!.push(entry);
  }
  return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

function summarizeProfileCounts(entries?: any) {
  const counts: Record<string, number> = {};
  for (const e of entries) {
    const p = e.accountProfile || UNKNOWN_PROFILE;
    counts[p] = (counts[p] || 0) + 1;
  }
  return counts;
}

export {
  META_VERSION, UNKNOWN_PROFILE, maskUsername, specMetaPathForRel, readSpecMetaFile, writeSpecMetaFile, deleteSpecMetaFile, parseSpecMetaBlockFromCode, buildSpecMeta, buildSpecMetaFromSession, appendSpecMetaHeaderToCode, mapProcessedToOriginalRel, resolveOptimizedSpecMeta, enrichOptimizedSpecEntry, copyRawMetaToOptimized, writeRawSpecMetaFromSession, groupEntriesByPlaywrightEnv, groupEntriesByAccountProfile, summarizeProfileCounts,
};
