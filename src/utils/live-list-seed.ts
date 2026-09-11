/**
 * Golden / 只读流程的现场种子策略（纯函数，不碰 Playwright）。
 *
 * 优先级（GOLDEN_FORCE_SEED=1 除外）：
 *   1) 当前列表可见行（liveDocNo / 事由单元格）
 *   2) env / resolveGoldenSeed 仅当现场值缺失且该值仍出现在列表中
 *   3) 否则 skip，绝不拿过期常量去搜索（避免 `未找到单据「CB…」`）
 *
 * GOLDEN_FORCE_SEED=1 时才允许 REQUEST_DOC_NO / 静态种子排在现场值之前。
 */

export const SKIP_NO_ROWS_DOC = '列表无数据，跳过搜索/详情步骤';
export const SKIP_NO_DOC = '无法从列表读取可用单号，跳过搜索/详情步骤';
export const SKIP_NO_ROWS_FILTER = '列表无数据，跳过筛选';
export const SKIP_NO_KEYWORD = '无法从列表读取可用事由关键字';

export const ANNOTATION_STALE_IGNORED = 'golden-seed-stale-ignored';

const DEFAULT_KEYWORD_MAX_LEN = 8;

export type LiveSeedSource = 'live' | 'forced' | 'verified-configured';

export type LiveSeedOk = {
  ok: true;
  value: string;
  source: LiveSeedSource;
  ignoredConfigured?: string;
  annotationType?: typeof ANNOTATION_STALE_IGNORED;
};

export type LiveSeedSkip = {
  ok: false;
  skipReason: string;
};

export type LiveSeedResult = LiveSeedOk | LiveSeedSkip;

export function normalizeListCellText(raw: string | null | undefined): string {
  return String(raw || '').replace(/\s+/g, ' ').trim();
}

export function normalizeDocNo(raw: string | null | undefined): string {
  return normalizeListCellText(raw).replace(/\s+/g, '');
}

export function isUsableListCell(text: string | null | undefined): boolean {
  const t = normalizeListCellText(text);
  return Boolean(t) && t !== '-';
}

export function isGoldenForceSeed(raw: string | null | undefined = process.env.GOLDEN_FORCE_SEED): boolean {
  const v = String(raw || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

/** 从可见事由单元格截一段筛选用关键字；空 / 「-」视为不可用。 */
export function deriveFilterKeyword(
  reason: string | null | undefined,
  maxLen = DEFAULT_KEYWORD_MAX_LEN,
): string {
  const t = normalizeListCellText(reason);
  if (!isUsableListCell(t)) return '';
  const limit = Number.isFinite(maxLen) && maxLen > 0 ? Math.floor(maxLen) : DEFAULT_KEYWORD_MAX_LEN;
  return t.slice(0, Math.min(limit, t.length));
}

function firstIgnored(live: string, ...candidates: string[]): string | undefined {
  return candidates.find((v) => v && v !== live);
}

function staleIgnored(live: string, ignored?: string): LiveSeedOk {
  const result: LiveSeedOk = { ok: true, value: live, source: 'live' };
  if (ignored) {
    result.ignoredConfigured = ignored;
    result.annotationType = ANNOTATION_STALE_IGNORED;
  }
  return result;
}

export type ResolveGoldenDocInput = {
  hasRows: boolean;
  liveDocNo?: string | null;
  configuredDocNo?: string | null;
  staticDocNo?: string | null;
  configuredPresentInList?: boolean;
  staticPresentInList?: boolean;
  forceSeed?: boolean;
};

/**
 * 列表有行 → 现场单号胜出。env/static 不得排在 live 之前。
 */
export function resolveGoldenDocSeed(input: ResolveGoldenDocInput): LiveSeedResult {
  const live = normalizeDocNo(input.liveDocNo);
  const configured = normalizeDocNo(input.configuredDocNo);
  const staticDoc = normalizeDocNo(input.staticDocNo);
  const force = Boolean(input.forceSeed);

  if (force) {
    const forced = configured || staticDoc || live;
    if (!forced) {
      return { ok: false, skipReason: input.hasRows ? SKIP_NO_DOC : SKIP_NO_ROWS_DOC };
    }
    return {
      ok: true,
      value: forced,
      source: configured || staticDoc ? 'forced' : 'live',
    };
  }

  if (input.hasRows && live) {
    return staleIgnored(live, firstIgnored(live, configured, staticDoc));
  }

  if (input.hasRows) {
    if (configured && input.configuredPresentInList) {
      return { ok: true, value: configured, source: 'verified-configured' };
    }
    if (staticDoc && input.staticPresentInList) {
      return { ok: true, value: staticDoc, source: 'verified-configured' };
    }
    return { ok: false, skipReason: SKIP_NO_DOC };
  }

  return { ok: false, skipReason: SKIP_NO_ROWS_DOC };
}

export type ResolveGoldenKeywordInput = {
  hasRows: boolean;
  liveReason?: string | null;
  configuredKeyword?: string | null;
  staticKeyword?: string | null;
  configuredPresentInList?: boolean;
  staticPresentInList?: boolean;
  forceSeed?: boolean;
};

export function resolveGoldenFilterKeyword(input: ResolveGoldenKeywordInput): LiveSeedResult {
  const liveKeyword = deriveFilterKeyword(input.liveReason);
  const configured = normalizeListCellText(input.configuredKeyword);
  const staticKeyword = normalizeListCellText(input.staticKeyword);
  const force = Boolean(input.forceSeed);

  if (force) {
    const forced = configured || staticKeyword || liveKeyword;
    if (!forced) {
      return { ok: false, skipReason: input.hasRows ? SKIP_NO_KEYWORD : SKIP_NO_ROWS_FILTER };
    }
    return {
      ok: true,
      value: forced,
      source: configured || staticKeyword ? 'forced' : 'live',
    };
  }

  if (input.hasRows && liveKeyword) {
    return staleIgnored(liveKeyword, firstIgnored(liveKeyword, configured, staticKeyword));
  }

  if (input.hasRows) {
    if (configured && input.configuredPresentInList) {
      return { ok: true, value: configured, source: 'verified-configured' };
    }
    if (staticKeyword && input.staticPresentInList) {
      return { ok: true, value: staticKeyword, source: 'verified-configured' };
    }
    return { ok: false, skipReason: SKIP_NO_KEYWORD };
  }

  return { ok: false, skipReason: SKIP_NO_ROWS_FILTER };
}

/** @deprecated 使用 resolveGoldenDocSeed；保留别名以免旧 verify 调用处漂移 */
export function resolveLiveDocNo(input: {
  hasRows: boolean;
  liveDocNo?: string | null;
  configuredDocNo?: string | null;
}): LiveSeedResult {
  return resolveGoldenDocSeed(input);
}

/** @deprecated 使用 resolveGoldenFilterKeyword */
export function resolveLiveFilterKeyword(input: {
  hasRows: boolean;
  liveReason?: string | null;
  configuredKeyword?: string | null;
}): LiveSeedResult {
  return resolveGoldenFilterKeyword(input);
}
