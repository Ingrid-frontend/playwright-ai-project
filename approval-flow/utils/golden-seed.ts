import { test } from '../fixtures';
import { ApprovalListPage } from '../pages/approval-list.page';
import { env } from './env';
import { resolveLiveDocNo, type LiveSeedResult } from '../../src/utils/live-list-seed';

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

/** 只读搜索/详情：现场列表单号优先，忽略过期 APPROVAL_DOC_NO。写操作仍走 env。 */
export async function probeApprovalLiveDocNo(approval: ApprovalListPage): Promise<LiveSeedResult> {
  await approval.expectListReady();
  const hasRows = await approval.hasDataRows();
  let liveDocNo = '';
  if (hasRows) {
    try {
      liveDocNo = await approval.pickFirstDocNo();
    } catch {
      liveDocNo = '';
    }
  }
  return resolveLiveDocNo({
    hasRows,
    liveDocNo,
    configuredDocNo: env.approvalDocNo,
  });
}
