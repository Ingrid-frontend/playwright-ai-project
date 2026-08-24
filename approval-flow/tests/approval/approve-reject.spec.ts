import { test, expect } from '../../fixtures';
import { ApprovalListPage } from '../../pages/approval-list.page';
import { env } from '../../utils/env';

/**
 * 审批「写操作」全流程（串行）：
 *  1) 对待审批第一条（或指定单号）执行「通过」
 *  2) 对另一条待审批执行「驳回」
 *
 * serial 保证顺序；通过后第一条单据离开待审批队列，
 * 第 2 步取的是「新的第一条」，避免对同一单据既通过又驳回。
 */
test.describe('审批列表 · 审批通过 / 驳回（写操作）', () => {
  test.describe.configure({ mode: 'serial' });

  test('对待审批单据执行「通过」', async ({ authenticatedPage, page }) => {
    test.skip(!env.writeEnabled, '未开启写操作：设置 APPROVAL_ENABLE_WRITE=1 后才会真实审批');
    void authenticatedPage;

    const approval = new ApprovalListPage(page);
    await approval.goto();
    await approval.expectLoaded();

    if (env.approvalDocNo) {
      await approval.search(env.approvalDocNo);
      await approval.approveRow(env.approvalComment, env.approvalDocNo);
    } else {
      await approval.approveRow(env.approvalComment);
    }
    await approval.expectApprovalSuccess();
    await approval.expectBackToList();
  });

  test('对另一条待审批单据执行「驳回」', async ({ authenticatedPage, page }) => {
    test.skip(!env.writeEnabled, '未开启写操作：设置 APPROVAL_ENABLE_WRITE=1 后才会真实审批');
    void authenticatedPage;

    const approval = new ApprovalListPage(page);
    await approval.goto();
    await approval.expectLoaded();

    if (env.rejectDocNo) {
      await approval.search(env.rejectDocNo);
      await approval.rejectRow(env.rejectComment, env.rejectDocNo);
    } else {
      // 上一步已处理一条，这里取新的第一条待审批
      await approval.rejectRow(env.rejectComment);
    }
    await approval.expectApprovalSuccess();
    await approval.expectBackToList();
  });
});
