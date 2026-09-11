import { test } from '../fixtures';
import { RequestListPage } from '../pages/request-list.page';
import { FILTER_LABELS } from './request-catalog';
import { env } from './env';
import {
  resolveLiveDocNo,
  resolveLiveFilterKeyword,
  type LiveSeedResult,
} from '../../src/utils/live-list-seed';

export function useLiveSeed(result: LiveSeedResult): string {
  if (!result.ok) {
    test.skip(true, result.skipReason);
    return '';
  }
  if (result.ignoredConfigured) {
    test.info().annotations.push({
      type: 'live-seed-fallback',
      description: `忽略过期配置「${result.ignoredConfigured}」，改用现场「${result.value}」`,
    });
  }
  return result.value;
}

/** 清筛选后从当前列表取样单号；无行 / 读不出则 skip，不回退历史 REQUEST_DOC_NO。 */
export async function probeRequestLiveDocNo(list: RequestListPage): Promise<LiveSeedResult> {
  await list.clearListQuery();
  await list.expectListReady();
  const hasRows = await list.hasDataRows();
  let liveDocNo = '';
  if (hasRows) {
    try {
      liveDocNo = await list.pickFirstDocNo();
    } catch {
      liveDocNo = '';
    }
  }
  return resolveLiveDocNo({
    hasRows,
    liveDocNo,
    configuredDocNo: env.requestDocNo,
  });
}

/** 从可见首行事由取样关键字；无行 / 无可用事由则 skip，不使用默认「测试」。 */
export async function probeRequestLiveFilterKeyword(list: RequestListPage): Promise<LiveSeedResult> {
  await list.clearListQuery();
  await list.expectListReady();
  const hasRows = await list.hasDataRows();
  let liveReason = '';
  if (hasRows) {
    try {
      liveReason = await list.pickFirstRowCell(FILTER_LABELS.reason);
    } catch {
      liveReason = '';
    }
  }
  return resolveLiveFilterKeyword({
    hasRows,
    liveReason,
    configuredKeyword: env.requestFilterKeyword,
  });
}
