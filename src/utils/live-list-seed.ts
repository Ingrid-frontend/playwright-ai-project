/**
 * Golden / 只读流程的现场种子策略（纯函数，不碰 Playwright）。
 *
 * 以前：搜索/详情直接用 REQUEST_DOC_NO / APPROVAL_DOC_NO，筛选用固定
 * 「测试」等关键字。单据过期后变成 `未找到单据「CB…」` / `事由筛选「测试」后列表无数据行` 红灯。
 *
 * 现在：有数据行时一律用当前列表可见单元格；列表空或读不出可用值则 skip
 * （中文原因），不把历史常量当搜索词。选择器失败仍应红灯。
 */

export const SKIP_NO_ROWS_DOC = '列表无数据，跳过搜索/详情步骤';
export const SKIP_NO_DOC = '无法从列表读取可用单号，跳过搜索/详情步骤';
export const SKIP_NO_ROWS_FILTER = '列表无数据，跳过筛选';
export const SKIP_NO_KEYWORD = '无法从列表读取可用事由关键字';

const DEFAULT_KEYWORD_MAX_LEN = 8;

export type LiveSeedOk = {
  ok: true;
  value: string;
  source: 'live';
  ignoredConfigured?: string;
};

export type LiveSeedSkip = {
  ok: false;
  skipReason: string;
};

export type LiveSeedResult = LiveSeedOk | LiveSeedSkip;

export function normalizeListCellText(raw: string | null | undefined): string {
  return String(raw || '').replace(/\s+/g, ' ').trim();
}

export function isUsableListCell(text: string | null | undefined): boolean {
  const t = normalizeListCellText(text);
  return Boolean(t) && t !== '-';
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

export function resolveLiveDocNo(input: {
  hasRows: boolean;
  liveDocNo?: string | null;
  configuredDocNo?: string | null;
}): LiveSeedResult {
  if (!input.hasRows) {
    return { ok: false, skipReason: SKIP_NO_ROWS_DOC };
  }
  const live = normalizeListCellText(input.liveDocNo).replace(/\s+/g, '');
  if (!live) {
    return { ok: false, skipReason: SKIP_NO_DOC };
  }
  const configured = normalizeListCellText(input.configuredDocNo).replace(/\s+/g, '');
  const result: LiveSeedOk = { ok: true, value: live, source: 'live' };
  if (configured && configured !== live) {
    result.ignoredConfigured = configured;
  }
  return result;
}

export function resolveLiveFilterKeyword(input: {
  hasRows: boolean;
  liveReason?: string | null;
  configuredKeyword?: string | null;
}): LiveSeedResult {
  if (!input.hasRows) {
    return { ok: false, skipReason: SKIP_NO_ROWS_FILTER };
  }
  const liveKeyword = deriveFilterKeyword(input.liveReason);
  if (!liveKeyword) {
    return { ok: false, skipReason: SKIP_NO_KEYWORD };
  }
  const configured = normalizeListCellText(input.configuredKeyword);
  const result: LiveSeedOk = { ok: true, value: liveKeyword, source: 'live' };
  if (configured && configured !== liveKeyword) {
    result.ignoredConfigured = configured;
  }
  return result;
}
