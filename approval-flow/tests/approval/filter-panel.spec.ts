import { type Page } from '@playwright/test';
import { test } from '../../fixtures';
import { ApprovalListPage } from '../../pages/approval-list.page';
import { FILTER_LABELS } from '../../utils/approval-catalog';

test.describe.configure({ mode: 'serial' });

async function useApprovalList(page: Page) {
  const approval = new ApprovalListPage(page);
  await approval.ensureOnList();
  return approval;
}

test.describe('审批列表 · 筛选面板', () => {
  test.afterEach(async ({ page }) => {
    if (!/\/approve/.test(page.url())) return;
    try {
      const approval = await useApprovalList(page);
      await approval.resetFilterState();
    } catch {
      /* ignore */
    }
  });

  test('筛选面板按「单号」命中后清除', async ({ authenticatedPage, page }) => {
    void authenticatedPage;
    const approval = await useApprovalList(page);

    const docNo = await approval.pickFirstDocNo();
    await approval.filterByPanelField(FILTER_LABELS.docNo, docNo);
    await approval.expectRowContains(docNo);

    await approval.clearFilterPanel();
    await approval.expectListReady();
    await approval.expectRowsGreaterThan(0);
  });

  test('筛选面板按「事由」命中后清除', async ({ authenticatedPage, page }) => {
    void authenticatedPage;
    const approval = await useApprovalList(page);

    const reason = await approval.pickFirstRowCell(FILTER_LABELS.reason);
    const key = reason.slice(0, Math.min(12, reason.length));
    test.skip(!key, '首行事由为空');

    await approval.filterByPanelField(FILTER_LABELS.reason, key);
    await approval.expectFirstRowCellContains(FILTER_LABELS.reason, key.slice(0, 4));

    await approval.clearFilterPanel();
    await approval.expectListReady();
    await approval.expectRowsGreaterThan(0);
  });
});
