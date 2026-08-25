import { type Page } from '@playwright/test';
import { test } from '../../fixtures';
import { ApprovalListPage } from '../../pages/approval-list.page';
import { TABS } from '../../utils/approval-catalog';

test.describe.configure({ mode: 'serial' });

async function useApprovalList(page: Page) {
  const approval = new ApprovalListPage(page);
  await approval.ensureOnList();
  return approval;
}

test.describe('审批列表 · 页签筛选', () => {
  test.afterEach(async ({ page }) => {
    if (!/\/approve/.test(page.url())) return;
    try {
      const approval = await useApprovalList(page);
      await approval.switchToPending();
      await approval.resetFilterState();
    } catch {
      /* ignore */
    }
  });

  test('已审批：列表就绪并校验首行单号', async ({ authenticatedPage, page }) => {
    void authenticatedPage;
    const approval = await useApprovalList(page);
    await approval.switchTab(TABS.approved);
    await approval.expectListReady();

    const rows = await approval.dataRows().count();
    test.skip(rows === 0, '已审批暂无数据');

    const docNo = await approval.pickFirstDocNo();
    await approval.expectRowContains(docNo);
  });

  test('抄送我：列表就绪并校验首行单号', async ({ authenticatedPage, page }) => {
    void authenticatedPage;
    const approval = await useApprovalList(page);
    await approval.switchTab(TABS.cc);
    await approval.expectListReady();

    const rows = await approval.dataRows().count();
    test.skip(rows === 0, '抄送我暂无数据');

    const docNo = await approval.pickFirstDocNo();
    await approval.expectRowContains(docNo);
  });
});
