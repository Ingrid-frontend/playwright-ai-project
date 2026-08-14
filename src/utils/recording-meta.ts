import { extractLoginAccount, extractFromCode } from "./extract-login-account.js";
import { readLoginStateMeta, formatLoginAccountLabel } from "./storage-state-meta.js";
import { resolveAccountProfile, resolveStorageState } from "./env-config.js";

const META_MARKERS = /录制元信息|录制环境:/;

function isLikelyInternalUserId(value: string): boolean {
  return /^\d{4,}$/.test(value.trim());
}

function resolveLoginUsernameForComment(
  env: string,
  profile: string,
  opts?: { code?: string; storagePath?: string },
): string | null {
  const fromCode = extractFromCode(opts?.code);
  if (fromCode) return fromCode;
  if (opts?.storagePath) {
    const fromMeta = formatLoginAccountLabel(readLoginStateMeta(opts.storagePath));
    if (fromMeta) return fromMeta;
  }
  const detected = extractLoginAccount({
    code: opts?.code,
    storagePath: opts?.storagePath,
  });
  if (detected && !isLikelyInternalUserId(detected)) return detected;
  return null;
}

/** 生成录制脚本头部注释（不含密码） */
export function buildRecordingAccountComment(
  env: string,
  profile?: string,
  opts?: { code?: string; storagePath?: string },
): string {
  const prof = resolveAccountProfile(env, profile);
  const storageRel = resolveStorageState(env, prof);
  const storagePath = opts?.storagePath;
  const meta = storagePath ? readLoginStateMeta(storagePath) : null;
  const loginUsername = resolveLoginUsernameForComment(env, prof, opts);
  const userId =
    meta?.userId ||
    (opts?.storagePath &&
    isLikelyInternalUserId(extractLoginAccount({ storagePath: opts.storagePath }) || "")
      ? extractLoginAccount({ storagePath: opts.storagePath })
      : null);
  const recordedAt = new Date().toISOString();
  const lines = ["// Playwright 录制元信息（勿在仓库中提交密码）"];
  if (loginUsername) {
    lines.push(`// 环境: ${env} | 登录账号: ${loginUsername}`);
  } else if (userId) {
    lines.push(`// 环境: ${env} | 登录账号: 未识别`);
    lines.push(`// 用户ID: ${userId}`);
  } else {
    lines.push(`// 环境: ${env} | 登录账号: 浏览器手动登录（未识别账号）`);
  }
  lines.push(`// storageState: ${storageRel}`, `// 录制时间: ${recordedAt}`, "");
  return lines.join("\n");
}

export function prependRecordingAccountComment(
  code: string,
  env: string,
  profile?: string,
  opts?: { storagePath?: string },
): string {
  if (!code?.trim()) return code;
  if (META_MARKERS.test(code.slice(0, 600))) return code;
  return (
    buildRecordingAccountComment(env, profile, { code, storagePath: opts?.storagePath }) +
    code.replace(/^\s*/, "")
  );
}
