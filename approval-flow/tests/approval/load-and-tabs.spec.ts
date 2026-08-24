import { test, expect } from '../../fixtures';
import { ApprovalListPage } from '../../pages/approval-list.page';

test.describe('审批列表 · 列表加载与页签切换', () => {
  test('待审批列表加载并渲染数据行', async ({ authenticatedPage, page }) => {
    void authenticatedPage;

    const approval = new ApprovalListPage(page);
    await approval.goto();
    await approval.expectLoaded();
  });

  test('切换到「我的已办」页签并加载', async ({ authenticatedPage, page }) => {
    void authenticatedPage;

    const approval = new ApprovalListPage(page);
    await approval.goto();
    await approval.expectLoaded();
    await approval.switchTab('我的已办');
    await approval.expectListReady();
  });

  test('切换到「抄送我」页签并加载', async ({ authenticatedPage, page }) => {
    void authenticatedPage;

    const approval = new ApprovalListPage(page);
    await approval.goto();
    await approval.expectLoaded();
    await approval.switchTab('抄送我');
    await approval.expectListReady();
  });
});
