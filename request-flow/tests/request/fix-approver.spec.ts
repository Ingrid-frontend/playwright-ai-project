import { test } from '../../fixtures';
import { RequestListPage } from '../../pages/request-list.page';
import { RequestEditPage } from '../../pages/request-edit.page';
import { env } from '../../utils/env';

/**
 * 单独跑：打开指定申请单 → 必要时撤回 → 自选审批人改为 97dev（或 REQUEST_APPROVER）
 *
 * 仓库根目录：
 *   REQUEST_ENABLE_WRITE=1 REQUEST_DOC_NO=EA1144499145925038250 \
 *     npx playwright test -c request-flow/playwright.config.ts request-flow/tests/request/fix-approver.spec.ts
 *
 * request-flow 目录：
 *   REQUEST_ENABLE_WRITE=1 REQUEST_DOC_NO=EA... npm run test:fix-approver
 */
test.describe('申请单 · 撤回并修正自选审批人', () => {
  test('撤回（如需）并更新自选审批人为登录人/97dev', async ({ authenticatedPage, page }) => {
    test.skip(!env.writeEnabled, '未开启写操作：设置 REQUEST_ENABLE_WRITE=1');
    const docNo = env.requestDocNo.trim();
    test.skip(!docNo, '请设置 REQUEST_DOC_NO=单号（如刚造的 EA1144499145925038250）');
    void authenticatedPage;

    const approver = env.requestApprover.trim() || '97dev';
    const list = new RequestListPage(page);
    await list.goto();
    await list.expectLoaded();
    await list.search(docNo);
    await list.expectRowContains(docNo);
    await list.openByCode(docNo);

    const edit = new RequestEditPage(page);
    await edit.expectEditVisible();
    await edit.withdrawIfNeeded();
    if (!(await edit.detailShell().isVisible({ timeout: 2_000 }).catch(() => false))) {
      await list.openByCode(docNo);
      await edit.expectEditVisible();
    }
    await edit.updateApprover(approver);
  });
});
