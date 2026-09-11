import { test } from '../fixtures';
import { ApprovalListPage } from '../pages/approval-list.page';
import { env } from './env';
import {
  ANNOTATION_STALE_IGNORED,
  isGoldenForceSeed,
  resolveGoldenDocSeed,
  type LiveSeedResult,
} from '../../src/utils/live-list-seed';

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
 * 审批只读搜索种子：现场 readFirstDocNo 优先。
 * APPROVAL_DOC_NO 只在 GOLDEN_FORCE_SEED=1，或现场读不出且该单号仍在列表时使用。
 */
export async function trySeedGoldenContext(approval: ApprovalListPage): Promise<LiveSeedResult> {
  await approval.expectListReady();
  const hasRows = await approval.hasDataRows();
  const liveDocNo = hasRows ? await approval.readFirstDocNo() : '';
  const configuredDocNo = env.approvalDocNo.trim();
  const forceSeed = isGoldenForceSeed(env.goldenForceSeed);
  const configuredPresentInList =
    hasRows && configuredDocNo ? await approval.docNoVisibleInList(configuredDocNo) : false;

  return resolveGoldenDocSeed({
    hasRows,
    liveDocNo,
    configuredDocNo,
    configuredPresentInList,
    forceSeed,
  });
}

export async function probeApprovalLiveDocNo(approval: ApprovalListPage): Promise<LiveSeedResult> {
  return trySeedGoldenContext(approval);
}
