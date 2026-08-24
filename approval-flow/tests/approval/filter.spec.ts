import { test } from '../../fixtures';
import { ApprovalListPage } from '../../pages/approval-list.page';

test.describe('审批列表 · 筛选', () => {
  test('筛选条可见：全部业务类型 / 筛选', async ({ authenticatedPage, page }) => {
    void authenticatedPage;
    const approval = new ApprovalListPage(page);
    await approval.goto();
    await approval.expectLoaded();
    await approval.expectFilterBarVisible();
  });

  test('打开筛选面板后关闭，不改条件', async ({ authenticatedPage, page }) => {
    void authenticatedPage;
    const approval = new ApprovalListPage(page);
    await approval.goto();
    await approval.expectLoaded();
    await approval.openFilterPanel();
    await approval.closeFilterPanel();
    await approval.expectRowsGreaterThan(0);
  });

  test('按业务类型筛选后列表就绪，再还原全部', async ({ authenticatedPage, page }) => {
    void authenticatedPage;
    const approval = new ApprovalListPage(page);
    await approval.goto();
    await approval.expectLoaded();

    const types = await approval.listBusinessTypes();
    test.skip(types.length === 0, '业务类型下拉没有可选项');

    await approval.selectBusinessType(types[0]);
    await approval.expectListReady();

    await approval.resetBusinessType();
    await approval.expectListReady();
    await approval.expectRowsGreaterThan(0);
  });

  test('按现场单号筛选命中后清除', async ({ authenticatedPage, page }) => {
    void authenticatedPage;
    const approval = new ApprovalListPage(page);
    await approval.goto();
    await approval.expectLoaded();

    const docNo = await approval.pickFirstDocNo();
    await approval.filterByDocNo(docNo);
    await approval.expectRowContains(docNo);

    await approval.clearFilters();
    await approval.expectListReady();
    await approval.expectRowsGreaterThan(0);
  });
});
