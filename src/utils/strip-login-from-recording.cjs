/**
 * 从 codegen 录制结果中移除登录流程，保留登录后操作（依赖项目 storageState / setup）。
 */
const LOGIN_ACTION_RE =
  /账号登录|请输入手机号\/邮箱|(?:name:\s*['"]密码['"])|用户协议|隐私协议|登\s*录|二维码登录|汇联易管理系统.*登录|未激活的账号在登录后/;

const LOGIN_FILL_PASSWORD_RE = /getByRole\([^)]*textbox[^)]*['"]密码['"]|\.fill\([^)]*['"][^'"]*['"]\s*\)[^;]*密码/;

function isLoginActionLine(line) {
  const s = line.trim();
  if (!s.startsWith("await ")) return false;
  if (LOGIN_ACTION_RE.test(s)) return true;
  if (LOGIN_FILL_PASSWORD_RE.test(s)) return true;
  if (/frameLocator\(['"]iframe['"]\).*filter\(\s*\{\s*hasText:.*登录/.test(s)) return true;
  return false;
}

function isInitialGotoLine(line) {
  return /^\s*await\s+page\.goto\(/.test(line);
}

function isLoginTailLine(line) {
  const s = line.trim();
  if (!s.startsWith("await ")) return false;
  if (/waitForNavigation|waitForURL.*login|not\.toHaveURL.*login/i.test(s)) return true;
  if (/waitForLoadState/.test(s) && /login/i.test(s)) return true;
  return false;
}

/** 登录页辅助操作：协议勾选、label 点击等 */
function isLoginHelperLine(line) {
  const s = line.trim();
  if (!s.startsWith("await ")) return false;
  if (!/iframe|frameLocator/.test(s)) return false;
  if (/getByRole\([^)]*checkbox/.test(s) && /协议/.test(s)) return true;
  if (/locator\(['"]label['"]\)\.click\(\)/.test(s)) return true;
  if (/\.uncheck\(\)|\.check\(\)/.test(s) && /协议/.test(s)) return true;
  return false;
}

function isLoginButtonLine(line) {
  return /getByRole\([^)]*button[^)]*['"]登\s*录['"]|['"]登\s*录['"]\s*\}\s*\)\.click/.test(line);
}

function findLoginBlockEndIndex(awaitIndices, lines) {
  for (let i = 0; i < awaitIndices.length; i++) {
    const idx = awaitIndices[i];
    if (isLoginButtonLine(lines[idx])) return idx;
  }
  let cutUntil = -1;
  for (const idx of awaitIndices) {
    if (
      isLoginActionLine(lines[idx]) ||
      isLoginHelperLine(lines[idx]) ||
      isLoginTailLine(lines[idx]) ||
      (cutUntil < 0 && isInitialGotoLine(lines[idx]))
    ) {
      cutUntil = idx;
      continue;
    }
    if (cutUntil >= 0) break;
  }
  return cutUntil;
}

/**
 * @param {string} code
 * @returns {{ code: string, removed: number }}
 */
function stripLoginFlowFromRecording(code) {
  if (!code?.trim()) return { code, removed: 0 };
  if (/已自动移除录制中的登录步骤/.test(code)) return { code, removed: 0 };

  const lines = code.split("\n");
  const awaitIndices = [];
  let testStart = -1;

  for (let i = 0; i < lines.length; i++) {
    if (
      testStart < 0 &&
      /\btest\s*\(/.test(lines[i]) &&
      /\bpage\b/.test(lines[i]) &&
      !/test\.use\s*\(/.test(lines[i])
    ) {
      testStart = i;
    }
    if (testStart >= 0 && i > testStart && /^\s*await\s+/.test(lines[i])) {
      awaitIndices.push(i);
    }
  }

  if (!awaitIndices.length) return { code, removed: 0 };

  const cutUntil = findLoginBlockEndIndex(awaitIndices, lines);
  if (cutUntil < 0) return { code, removed: 0 };

  const removeSet = new Set();
  for (const idx of awaitIndices) {
    if (idx <= cutUntil) removeSet.add(idx);
    else break;
  }

  let removed = 0;
  const kept = lines.filter((line, i) => {
    if (removeSet.has(i)) {
      removed++;
      return false;
    }
    return true;
  });

  let out = kept.join("\n");
  if (removed > 0) {
    const note = "  // 已自动移除录制中的登录步骤（执行时依赖 storageState / setup 项目登录态）";
    out = kept
      .map((line) => {
        if (/\btest\s*\(/.test(line) && /\bpage\b/.test(line) && line.includes("{") && !/test\.use/.test(line)) {
          return `${line}\n${note}`;
        }
        return line;
      })
      .join("\n");
  }

  out = out.replace(/\n{3,}/g, "\n\n");
  return { code: out, removed };
}

/**
 * @param {string} code
 * @param {string} storageRel
 */
function ensureStorageStateUse(code, storageRel) {
  if (!storageRel?.trim()) return code;
  if (/test\.use\s*\([\s\S]*?storageState/.test(code)) return code;

  const norm = storageRel.replace(/\\/g, "/");
  const block = `test.use({\n  storageState: process.env.STORAGE_STATE_PATH || '${norm}',\n});\n\n`;
  const lines = code.split("\n");
  let lastImport = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*import\s+/.test(lines[i])) lastImport = i;
  }
  const insertAt = lastImport >= 0 ? lastImport + 1 : 0;
  return [...lines.slice(0, insertAt), block.trimEnd(), "", ...lines.slice(insertAt)].join("\n");
}

/**
 * 使用 storageState 时，用例开头需先进入应用首页（Studio 在临时目录执行，依赖 config baseURL + '/'）
 * @param {string} code
 */
function ensureInitialNavigation(code) {
  if (!code?.trim()) return code;
  if (!/test\.use\s*\([\s\S]*?storageState|storageState\s*:/.test(code)) return code;

  const lines = code.split("\n");
  let testStart = -1;
  let bodyStart = -1;

  for (let i = 0; i < lines.length; i++) {
    if (
      testStart < 0 &&
      /\btest\s*\(/.test(lines[i]) &&
      /\bpage\b/.test(lines[i]) &&
      !/test\.use\s*\(/.test(lines[i])
    ) {
      testStart = i;
      if (/\{/.test(lines[i])) {
        bodyStart = i + 1;
      }
      continue;
    }
    if (testStart >= 0 && bodyStart < 0 && /\{/.test(lines[i])) {
      bodyStart = i + 1;
      break;
    }
  }

  if (bodyStart < 0) return code;

  let insertAt = bodyStart;
  let hasGoto = false;
  for (let i = bodyStart; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*\}\s*\)\s*;?\s*$/.test(line) || (/^\s*\}\s*;?\s*$/.test(line) && i > bodyStart)) {
      break;
    }
    if (/^\s*test\s*\(/.test(line) && i > testStart) break;

    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("//")) {
      insertAt = i + 1;
      continue;
    }
    if (/await\s+page\.goto\(/.test(line)) {
      hasGoto = true;
    }
    break;
  }

  if (hasGoto) return code;

  const navLines = [
    "  // 加载应用首页（storageState 已带登录态）",
    "  await page.goto('/');",
    "",
  ];
  return [...lines.slice(0, insertAt), ...navLines, ...lines.slice(insertAt)].join("\n");
}

/**
 * @param {string} code
 * @param {{ storageRel?: string }} opts
 */
function postprocessRecordedScript(code, opts = {}) {
  const stripped = stripLoginFlowFromRecording(code);
  let next = stripped.code;
  if (opts.storageRel) {
    next = ensureStorageStateUse(next, opts.storageRel);
  }
  if (opts.storageRel || /test\.use\s*\([\s\S]*?storageState/.test(next)) {
    next = ensureInitialNavigation(next);
  }
  return { code: next, removedLoginLines: stripped.removed };
}

module.exports = {
  stripLoginFlowFromRecording,
  ensureStorageStateUse,
  ensureInitialNavigation,
  postprocessRecordedScript,
};
