/**
 * 从录制脚本或 Playwright storageState 推断登录账号（不读取 accounts.json）
 */
const fs = require("fs");

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const PHONE_RE = /\b1[3-9]\d{9}\b/;

const LOGIN_FILL_PATTERNS = [
  /请输入手机号\/邮箱['"]\s*\}\)[\s\S]{0,160}?\.fill\(\s*['"]([^'"\\]+)['"]/,
  /name:\s*['"]请输入手机号\/邮箱['"][\s\S]{0,120}?\.fill\(\s*['"]([^'"\\]+)['"]/,
  /(?:手机|邮箱|账号)[^'"]*['"][\s\S]{0,100}?\.fill\(\s*['"]([^'"\\]+)['"]/i,
];

const STORAGE_USER_KEY_HINTS = [
  "hly.user",
  "hly.currentuser",
  "hly.login.user",
  "userinfo",
  "currentuser",
  "loginuser",
];

function isLikelyAccount(value) {
  if (!value || typeof value !== "string") return false;
  const text = value.trim();
  if (text.length < 3 || text.length > 128) return false;
  if (/^\*+$/.test(text) || text === "********") return false;
  if (/^password$/i.test(text)) return false;
  if (/example\.com|your-.*@/i.test(text)) return false;
  return true;
}

function pickFromJson(obj, preferId) {
  if (!obj || typeof obj !== "object") return null;
  const fields = [
    "email",
    "userEmail",
    "login",
    "loginName",
    "username",
    "userName",
    "mobile",
    "phone",
    "account",
    "employeeCode",
  ];
  for (const field of fields) {
    const value = obj[field];
    if (typeof value === "string" && isLikelyAccount(value)) return value.trim();
  }
  if (!preferId) {
    const id = obj.userId ?? obj.employeeId;
    if (typeof id === "string" && id.trim()) return id.trim();
    if (typeof id === "number") return String(id);
  }
  if (obj.user && typeof obj.user === "object") {
    return pickFromJson(obj.user, preferId);
  }
  return null;
}

function scanString(value) {
  if (!value || value.length > 800000) return null;

  const emails = value.match(EMAIL_RE);
  if (emails?.length) {
    const email = emails.find((e) => !/example\.com|test\.com/i.test(e));
    if (email) return email;
  }

  const phones = value.match(PHONE_RE);
  if (phones?.[0]) return phones[0];

  try {
    const parsed = JSON.parse(value);
    const fromJson = pickFromJson(parsed, false);
    if (fromJson) return fromJson;
    if (typeof parsed === "string") return scanString(parsed);
  } catch {
    /* not json */
  }

  const inline = value.match(/"(?:mobile|phone|email|userName|loginName)"\s*:\s*"([^"]+)"/i);
  if (inline?.[1] && isLikelyAccount(inline[1])) return inline[1].trim();

  return null;
}

function extractFromCode(code) {
  if (!code) return null;
  for (const pattern of LOGIN_FILL_PATTERNS) {
    const match = code.match(pattern);
    if (match?.[1] && isLikelyAccount(match[1])) return match[1].trim();
  }
  const genericFill = code.match(/\.fill\(\s*['"]([^'"]+@[^'"]+)['"]\s*\)/);
  if (genericFill?.[1] && isLikelyAccount(genericFill[1])) return genericFill[1].trim();
  return null;
}

function extractUserIdFromStorageData(data) {
  if (!data || typeof data !== "object") return null;
  for (const origin of data.origins || []) {
    const userIdItem = (origin.localStorage || []).find((x) => x.name === "hly.custom-browser-userId");
    if (userIdItem?.value) return String(userIdItem.value).trim();
  }
  return null;
}

function extractFromStorage(storagePath) {
  if (!storagePath || !fs.existsSync(storagePath)) return null;
  let data;
  try {
    data = JSON.parse(fs.readFileSync(storagePath, "utf8"));
  } catch {
    return null;
  }

  const meta = data._loginStateMeta;
  if (meta && typeof meta.loginAccount === "string" && meta.loginAccount.trim()) {
    return meta.loginAccount.trim();
  }

  const origins = data.origins || [];
  for (const origin of origins) {
    const stores = [...(origin.localStorage || []), ...(origin.sessionStorage || [])];
    for (const item of stores) {
      const name = String(item.name || "").toLowerCase();
      if (STORAGE_USER_KEY_HINTS.some((hint) => name.includes(hint.replace("hly.", "")) || name === hint)) {
        const found = scanString(item.value || "");
        if (found) return found;
      }
    }
  }

  for (const origin of origins) {
    for (const item of [...(origin.localStorage || []), ...(origin.sessionStorage || [])]) {
      const found = scanString(item.value || "");
      if (found) return found;
    }
  }

  const userId = extractUserIdFromStorageData(data);
  if (userId) return userId;

  return null;
}

/**
 * @param {{ code?: string, storagePath?: string }} opts
 * @returns {string|null}
 */
function extractLoginAccount(opts = {}) {
  return extractFromCode(opts.code) || extractFromStorage(opts.storagePath) || null;
}

module.exports = {
  extractLoginAccount,
  extractFromCode,
  extractFromStorage,
  extractUserIdFromStorageData,
};
