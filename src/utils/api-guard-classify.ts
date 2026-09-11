/**
 * api-guard 失败分类：业务关键 vs 非业务/基础设施噪声。
 *
 * 默认仍监听 `/api`、`/report/api`、`/oauth`。命中本文件 denylist 的失败：
 * - 仍写入 api-failures.json（blocking: false），便于排查
 * - 打 warn，不让 Golden 步骤失败
 *
 * 使用显式 denylist，而不是忽略整个 `/auth/**`，以免掩盖真实登录失败。
 */

export type NonBlockingApiPattern = {
  id: string;
  pattern: RegExp;
  reason: string;
};

/**
 * 非阻断 URL denylist。只收录已知基础设施/旁路，以及同类上报路径。
 *
 * 不要把 `/auth/**` 整段加进来：`/oauth`、登录相关 `/auth/api/*` 仍应阻断。
 */
export const NON_BLOCKING_URL_PATTERNS: readonly NonBlockingApiPattern[] = [
  {
    id: 'tenant-protocol-agree',
    // GET /auth/api/tenant/protocol/agree?roleType=TENANT&protocolType=USER_LOGIN
    // 登录后协议同意旁路；stage/nginx 502 不影响列表/详情/提交。
    pattern: /\/auth\/api\/tenant\/protocol\/agree(?:\?|$)/i,
    reason: '租户协议同意（登录旁路，非业务主路径）',
  },
  {
    id: 'sentry-ingest-store',
    // Sentry ingest：POST /api/{projectId}/store/?sentry_key=...
    // 同源或自建上报，不能只靠 sentry.io 域名忽略。
    pattern: /\/api\/\d+\/store\/?(?:\?|$)/i,
    reason: 'Sentry ingest store',
  },
  {
    id: 'sentry-ingest-envelope',
    pattern: /\/api\/\d+\/envelope\/?(?:\?|$)/i,
    reason: 'Sentry envelope',
  },
  {
    id: 'sentry-key-query',
    pattern: /[?&]sentry_key=/i,
    reason: 'Sentry ingest（sentry_key）',
  },
];

export type ClassifiedApiFailure = {
  kind?: string;
  url: string;
  fullUrl?: string;
  method: string;
  status?: number;
  bodySummary?: string;
  errorText?: string;
  fields?: Record<string, string>;
  /** false：已记录但不阻断步骤 */
  blocking: boolean;
  ignoreReason?: string;
};

export function matchNonBlockingApiUrl(url: string): NonBlockingApiPattern | null {
  if (!url) return null;
  for (const item of NON_BLOCKING_URL_PATTERNS) {
    if (item.pattern.test(url)) return item;
  }
  return null;
}

export function isNonBlockingApiUrl(url: string): boolean {
  return matchNonBlockingApiUrl(url) != null;
}

export function classifyApiFailure<T extends { url: string; fullUrl?: string }>(
  failure: T,
): T & { blocking: boolean; ignoreReason?: string } {
  const hit = matchNonBlockingApiUrl(failure.fullUrl || failure.url);
  if (!hit) {
    return { ...failure, blocking: true };
  }
  return { ...failure, blocking: false, ignoreReason: hit.reason };
}

export function partitionApiFailures<T extends { blocking?: boolean }>(failures: readonly T[]): {
  blocking: T[];
  ignored: T[];
} {
  const blocking: T[] = [];
  const ignored: T[] = [];
  for (const f of failures) {
    if (f.blocking === false) ignored.push(f);
    else blocking.push(f);
  }
  return { blocking, ignored };
}

function formatFailureLine(f: ClassifiedApiFailure, index: number): string {
  const status = f.status != null ? ` status=${f.status}` : '';
  const body = f.bodySummary ? ` body=${f.bodySummary}` : '';
  const err = f.errorText ? ` error=${f.errorText}` : '';
  const kind = f.kind ? `[${f.kind}] ` : '';
  const reason = f.blocking === false && f.ignoreReason ? ` · ${f.ignoreReason}` : '';
  const fieldEntries = f.fields
    ? Object.entries(f.fields)
        .filter(([, v]) => v)
        .map(([k, v]) => `${k}=${v}`)
    : [];
  const fieldBlock = fieldEntries.length ? `\n     ${fieldEntries.join('\n     ')}` : '';
  return `  ${index + 1}. ${kind}${f.method} ${f.url}${status}${err}${body}${reason}${fieldBlock}`;
}

export function formatIgnoredApiFailures(failures: readonly ClassifiedApiFailure[]): string | null {
  if (!failures.length) return null;
  const lines = failures.map((f, i) => formatFailureLine(f, i));
  return `[api-guard] 已记录 ${failures.length} 个非阻断失败（不导致步骤失败）：\n${lines.join('\n')}`;
}

export function formatBlockingApiGuardError(label: string, failures: readonly ClassifiedApiFailure[]): string | null {
  if (!failures.length) return null;
  const lines = failures.map((f, i) => formatFailureLine(f, i));
  return `${label} 监听发现 ${failures.length} 个失败接口：\n${lines.join('\n')}`;
}

/**
 * 仅对业务关键失败抛错。非阻断失败只 warn。
 * 供单测直接断言；ApiGuard.assertNoFailures 走同一套分类结果。
 */
export function assertNoBlockingApiFailures(
  label: string,
  failures: readonly ClassifiedApiFailure[],
  log: (msg: string) => void = console.warn,
): void {
  const { blocking, ignored } = partitionApiFailures(failures);
  const ignoredMsg = formatIgnoredApiFailures(ignored);
  if (ignoredMsg) log(ignoredMsg);
  const err = formatBlockingApiGuardError(label, blocking);
  if (err) throw new Error(err);
}
