import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';
import { test } from '../fixtures';
import { RequestListPage } from '../pages/request-list.page';
import { env } from './env';
import {
  ANNOTATION_STALE_IGNORED,
  isGoldenForceSeed,
  resolveGoldenDocSeed,
  resolveGoldenFilterKeyword,
  type LiveSeedResult,
} from '../../src/utils/live-list-seed';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function useLiveSeed(result: LiveSeedResult): string {
  if (!result.ok) {
    test.skip(true, result.skipReason);
    return '';
  }
  if (result.ignoredConfigured) {
    test.info().annotations.push({
      type: result.annotationType || ANNOTATION_STALE_IGNORED,
      description: `忽略过期配置「${result.ignoredConfigured}」，改用现场「${result.value}」`,
    });
  }
  return result.value;
}

/**
 * 静态目录种子（datasource/golden-seed.json 等）。默认空。
 * 调用方必须把它放在 readFirstDocNo 之后，不得排在现场列表前面。
 */
export function resolveGoldenSeed(): { docNo: string; keyword: string } {
  const p = path.resolve(__dirname, '../datasource/golden-seed.json');
  if (!fs.existsSync(p)) return { docNo: '', keyword: '' };
  try {
    const j = JSON.parse(fs.readFileSync(p, 'utf8')) as Record<string, unknown>;
    return {
      docNo: String(j.docNo || j.requestDocNo || '').trim(),
      keyword: String(j.filterKeyword || j.keyword || j.reason || '').trim(),
    };
  } catch {
    return { docNo: '', keyword: '' };
  }
}

export type GoldenSeedContext = {
  docNo: LiveSeedResult;
  keyword: LiveSeedResult;
};

/**
 * Golden 种子入口。顺序固定为：
 *   1) 清筛选后 readFirstDocNo / pickKeywordFromList（现场）
 *   2) env / resolveGoldenSeed 仅对照或 GOLDEN_FORCE_SEED=1
 * 禁止：env.requestDocNo → resolveGoldenSeed → 最后才 live。
 */
export async function trySeedGoldenContext(list: RequestListPage): Promise<GoldenSeedContext> {
  await list.clearListQuery();
  await list.expectListReady();
  const hasRows = await list.hasDataRows();
  const liveDocNo = hasRows ? await list.readFirstDocNo() : '';
  const liveReason = hasRows ? await list.pickKeywordFromList() : '';
  const staticSeed = resolveGoldenSeed();
  const configuredDocNo = env.requestDocNo.trim();
  const configuredKeyword = env.requestFilterKeyword.trim();
  const forceSeed = isGoldenForceSeed(env.goldenForceSeed);

  const configuredPresentInList =
    hasRows && configuredDocNo ? await list.docNoVisibleInList(configuredDocNo) : false;
  const staticPresentInList =
    hasRows && staticSeed.docNo ? await list.docNoVisibleInList(staticSeed.docNo) : false;
  const configuredKeywordPresent =
    hasRows && configuredKeyword ? await list.keywordVisibleInList(configuredKeyword) : false;
  const staticKeywordPresent =
    hasRows && staticSeed.keyword ? await list.keywordVisibleInList(staticSeed.keyword) : false;

  return {
    docNo: resolveGoldenDocSeed({
      hasRows,
      liveDocNo,
      configuredDocNo,
      staticDocNo: staticSeed.docNo,
      configuredPresentInList,
      staticPresentInList,
      forceSeed,
    }),
    keyword: resolveGoldenFilterKeyword({
      hasRows,
      liveReason,
      configuredKeyword,
      staticKeyword: staticSeed.keyword,
      configuredPresentInList: configuredKeywordPresent,
      staticPresentInList: staticKeywordPresent,
      forceSeed,
    }),
  };
}

export async function probeRequestLiveDocNo(list: RequestListPage): Promise<LiveSeedResult> {
  return (await trySeedGoldenContext(list)).docNo;
}

export async function probeRequestLiveFilterKeyword(list: RequestListPage): Promise<LiveSeedResult> {
  return (await trySeedGoldenContext(list)).keyword;
}
