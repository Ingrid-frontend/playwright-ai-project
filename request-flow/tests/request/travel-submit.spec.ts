import { type Page } from '@playwright/test';
import { test, type ApiGuard } from '../../fixtures';
import { RequestListPage } from '../../pages/request-list.page';
import { RequestEditPage } from '../../pages/request-edit.page';
import { ApprovalListPage } from '../../../approval-flow/pages/approval-list.page';
import { env } from '../../utils/env';
import { randomReason } from '../../utils/random';

/**
 * 差旅/差补/自由式：造单提交 → 审批通过 / 驳回（serial）
 * 默认表单：自由式-97测试差补规则申请单（可用 REQUEST_FORM_NAME 覆盖）
 *
 * 注意：comic 单号在待审批列表可能重复展示，审批搜索用「事由」保证唯一行。
 */
test.describe.configure({ mode: 'serial' });

const FORM = env.requestFormName || '自由式-97测试差补规则申请单';
const shared = {
  approveDocNo: '',
  approveReason: '',
  rejectDocNo: '',
  rejectReason: '',
};
const AVAILABLE_RE = /\/api\/custom\/forms\/my\/available/;

async function createTravelAndSubmit(
  page: Page,
  apiGuard: ApiGuard,
): Promise<{ docNo: string; reason: string }> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const reason = randomReason();
    try {
      const list = new RequestListPage(page);
      await list.goto();
      await list.expectLoaded();
      await list.clickNewRequest();

      const edit = new RequestEditPage(page);
      await edit.confirmNewRequestModal(FORM);
      await edit.expectEditVisible();
      await edit.fillReason(reason);
      await edit.save(env.requestApprover || undefined);
      await edit.submit(env.requestApprover || undefined);

      apiGuard.dismissMatching(AVAILABLE_RE);

      let docNo = '';
      try {
        docNo = await edit.readDocNo();
      } catch {
        await list.goto();
        await list.expectLoaded();
        await list.filterByReason(reason);
        docNo = await list.pickFirstDocNo();
      }
      return { docNo, reason };
    } catch (err) {
      lastErr = err;
      apiGuard.dismissMatching(AVAILABLE_RE);
      if (attempt === 2) break;
      await page.waitForTimeout(2_000);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

test.describe('差旅申请单提交 → 审批通过 / 驳回', () => {
  test('造差旅单并提交（待通过）', async ({ authenticatedPage, page, apiGuard }) => {
    test.skip(!env.writeEnabled, '未开启写操作：设置 REQUEST_ENABLE_WRITE=1');
    test.setTimeout(300_000);
    void authenticatedPage;
    const created = await createTravelAndSubmit(page, apiGuard);
    shared.approveDocNo = created.docNo;
    shared.approveReason = created.reason;
  });

  test('审批列表按事由搜索并「通过」', async ({ page }) => {
    test.skip(!env.writeEnabled, '未开启写操作：设置 REQUEST_ENABLE_WRITE=1');
    test.skip(!shared.approveReason, '缺少待通过事由（上一步造单失败）');
    test.setTimeout(120_000);

    const approval = new ApprovalListPage(page);
    await approval.goto();
    await approval.expectLoaded();
    await approval.searchUntilRow(shared.approveReason);
    await approval.approveRow(env.approvalComment);
    await approval.expectApprovalSuccess(shared.approveReason);
    await approval.expectBackToList();
  });

  test('再造差旅单并提交（待驳回）', async ({ page, apiGuard }) => {
    test.skip(!env.writeEnabled, '未开启写操作：设置 REQUEST_ENABLE_WRITE=1');
    test.setTimeout(300_000);
    const created = await createTravelAndSubmit(page, apiGuard);
    shared.rejectDocNo = created.docNo;
    shared.rejectReason = created.reason;
  });

  test('审批列表按事由搜索并「驳回」', async ({ page }) => {
    test.skip(!env.writeEnabled, '未开启写操作：设置 REQUEST_ENABLE_WRITE=1');
    test.skip(!shared.rejectReason, '缺少待驳回事由（上一步造单失败）');
    test.setTimeout(120_000);

    const approval = new ApprovalListPage(page);
    await approval.goto();
    await approval.expectLoaded();
    await approval.searchUntilRow(shared.rejectReason);
    await approval.rejectRow(env.rejectComment);
    await approval.expectApprovalSuccess(shared.rejectReason);
    await approval.expectBackToList();
  });
});
