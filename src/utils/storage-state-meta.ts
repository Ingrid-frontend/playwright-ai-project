/**
 * Playwright storageState 扩展元信息（Playwright 加载时忽略未知顶层字段）
 */
import fs from "fs";
import { extractFromCode, extractUserIdFromStorageData } from "./extract-login-account.js";

const META_KEY = "_loginStateMeta";

/**
 * @param {string} storagePath
 * @returns {{ loginAccount?: string, userId?: string, savedAt?: string, env?: string, source?: string } | null}
 */
function readLoginStateMeta(storagePath?: any) {
  if (!storagePath || !fs.existsSync(storagePath)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(storagePath, "utf8"));
    const meta = data[META_KEY];
    return meta && typeof meta === "object" ? meta : null;
  } catch {
    return null;
  }
}

/**
 * 录制注释等场景展示用：优先手机号/邮箱，不把内部 userId 当作「登录账号」
 * @param {{ loginAccount?: string, userId?: string } | null} meta
 * @returns {string|null}
 */
function formatLoginAccountLabel(meta?: any) {
  const account = meta?.loginAccount;
  if (typeof account === "string" && account.trim()) return account.trim();
  return null;
}

/**
 * @param {string} storagePath
 * @param {{ loginAccount?: string, userId?: string, code?: string, env?: string, source?: string }} opts
 * @returns {boolean}
 */
function annotateStorageStateMeta(storagePath?: any, opts: any = {}) {
  if (!storagePath || !fs.existsSync(storagePath)) return false;

  let data;
  try {
    data = JSON.parse(fs.readFileSync(storagePath, "utf8"));
  } catch {
    return false;
  }
  const prev = data[META_KEY] && typeof data[META_KEY] === "object" ? data[META_KEY] : {};
  const fromCode = opts.loginAccount || extractFromCode(opts.code);
  const userId = opts.userId || extractUserIdFromStorageData(data) || prev.userId || null;
  const loginAccount =
    (typeof fromCode === "string" && fromCode.trim() ? fromCode.trim() : null) ||
    (typeof prev.loginAccount === "string" && prev.loginAccount.trim() ? prev.loginAccount.trim() : null) ||
    null;

  const next = {
    loginAccount,
    userId: userId ? String(userId).trim() : null,
    savedAt: new Date().toISOString(),
    env: opts.env || prev.env || null,
    source: opts.source || prev.source || null,
  };

  data[META_KEY] = next;
  fs.writeFileSync(storagePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  return true;
}

export {
  META_KEY, readLoginStateMeta, formatLoginAccountLabel, annotateStorageStateMeta,
};
