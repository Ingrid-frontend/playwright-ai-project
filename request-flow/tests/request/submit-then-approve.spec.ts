import { type Page } from '@playwright/test';
import { test, type ApiGuard } from '../../fixtures';
import { RequestListPage } from '../../pages/request-list.page';
import { RequestEditPage } from '../../pages/request-edit.page';
import { ApprovalListPage } from '../../../approval-flow/pages/approval-list.page';
import { env } from '../../utils/env';
import { randomReason } from '../../utils/random';

/**
 * 申请单提交 → 审批通过 / 驳回（serial，共享登录会话）：
 *  1) 新建并提交单据 A → 记单号
 *  2) 我的审批按单号搜索 → 通过
 *  3) 再新建并提交单据 B → 记单号
 *  4) 我的审批按单号搜索 → 驳回
 *
 * 自选审批人须为当前登录人（默认 REQUEST_APPROVER=97dev），否则待审批搜不到。
 * 写操作：REQUEST_ENABLE_WRITE=1（Studio 勾选「开启写操作」）。
 */
test.describe.configure({ mode: 'serial' });

const shared = { approveDocNo: '', rejectDocNo: '' };
const AVAILABLE_RE = /\/api\/custom\/forms\/my\/available/;

async function createAndSubmit(page: Page, apiGuard: ApiGuard): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const reason = randomReason();
    try {
      const list = new RequestListPage(page);
      await list.goto();
      await list.expectLoaded();
      await list.clickNewRequest();

      const edit = new RequestEditPage(page);
      await edit.confirmNewRequestModal(env.requestFormName || undefined);
      await edit.expectEditVisible();
      await edit.fillReason(reason);
      await edit.save(env.requestApprover || undefined);
      await edit.submit(env.requestApprover || undefined);

      apiGuard.dismissMatching(AVAILABLE_RE);

      try {
        return await edit.readDocNo();
      } catch {
        await list.goto();
        await list.expectLoaded();
        await list.filterByReason(reason);
        return list.pickFirstDocNo();
      }
    } catch (err) {
      lastErr = err;
      apiGuard.dismissMatching(AVAILABLE_RE);
      if (attempt === 2) break;
      await page.waitForTimeout(2_000);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

test.describe('申请单提交 → 审批通过 / 驳回', () => {
  test('造单并提交（待通过）', async ({ authenticatedPage, page, apiGuard }) => {
    test.skip(!env.writeEnabled, '未开启写操作：设置 REQUEST_ENABLE_WRITE=1');
    void authenticatedPage;
    shared.approveDocNo = await createAndSubmit(page, apiGuard);
  });

  test('审批列表按单号搜索并「通过」', async ({ page }) => {
    test.skip(!env.writeEnabled, '未开启写操作：设置 REQUEST_ENABLE_WRITE=1');
    test.skip(!shared.approveDocNo, '缺少待通过单号（上一步造单失败）');

    const approval = new ApprovalListPage(page);
    await approval.goto();
    await approval.expectLoaded();
    await approval.search(shared.approveDocNo);
    await approval.expectRowContains(shared.approveDocNo);
    await approval.approveRow(env.approvalComment, shared.approveDocNo);
    await approval.expectApprovalSuccess();
    await approval.expectBackToList();
  });

  test('再造一单并提交（待驳回）', async ({ page, apiGuard }) => {
    test.skip(!env.writeEnabled, '未开启写操作：设置 REQUEST_ENABLE_WRITE=1');
    shared.rejectDocNo = await createAndSubmit(page, apiGuard);
  });

  test('审批列表按单号搜索并「驳回」', async ({ page }) => {
    test.skip(!env.writeEnabled, '未开启写操作：设置 REQUEST_ENABLE_WRITE=1');
    test.skip(!shared.rejectDocNo, '缺少待驳回单号（上一步造单失败）');

    const approval = new ApprovalListPage(page);
    await approval.goto();
    await approval.expectLoaded();
    await approval.search(shared.rejectDocNo);
    await approval.expectRowContains(shared.rejectDocNo);
    await approval.rejectRow(env.rejectComment, shared.rejectDocNo);
    await approval.expectApprovalSuccess();
    await approval.expectBackToList();
  });
});
