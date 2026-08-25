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

test.describe('审批列表 · 筛选', () => {
  test.afterEach(async ({ page }) => {
    if (!/\/approve/.test(page.url())) return;
    try {
      const approval = await useApprovalList(page);
      await approval.resetFilterState();
    } catch {
      /* ignore */
    }
  });

  test('筛选条可见：业务类型 / 筛选 / 外露四项', async ({ authenticatedPage, page }) => {
    void authenticatedPage;
    const approval = await useApprovalList(page);
    await approval.expectFilterBarVisible();
    await approval.expectExposedFiltersVisible();
  });

  test('打开筛选面板后关闭，不改条件', async ({ authenticatedPage, page }) => {
    void authenticatedPage;
    const approval = await useApprovalList(page);
    await approval.openFilterPanel();
    await approval.closeFilterPanel();
    await approval.expectRowsGreaterThan(0);
  });

  test('按业务类型筛选后列表就绪，再还原全部', async ({ authenticatedPage, page }) => {
    void authenticatedPage;
    const approval = await useApprovalList(page);

    const types = await approval.listBusinessTypes();
    test.skip(types.length === 0, '业务类型下拉没有可选项');

    await approval.selectBusinessType(types[0]);
    await approval.expectListReady();

    await approval.resetBusinessType();
    await approval.expectListReady();
    await approval.expectRowsGreaterThan(0);
  });

  test('外露「单号」筛选命中后清除', async ({ authenticatedPage, page }) => {
    void authenticatedPage;
    const approval = await useApprovalList(page);

    const docNo = await approval.pickFirstDocNo();
    await approval.filterByDocNo(docNo);
    await approval.expectRowContains(docNo);

    await approval.clearFilters();
    await approval.expectListReady();
    await approval.expectRowsGreaterThan(0);
  });

  test('外露「申请人」筛选命中后清除', async ({ authenticatedPage, page }) => {
    void authenticatedPage;
    const approval = await useApprovalList(page);

    const applicant = await approval.pickFirstRowCell(FILTER_LABELS.applicant);
    await approval.filterByExposedField(FILTER_LABELS.applicant, applicant);
    await approval.expectFirstRowCellContains(FILTER_LABELS.applicant, applicant);

    await approval.clearFilters();
    await approval.expectListReady();
    await approval.expectRowsGreaterThan(0);
  });

  test('外露「单据公司」筛选命中后清除', async ({ authenticatedPage, page }) => {
    void authenticatedPage;
    const approval = await useApprovalList(page);

    await approval.selectExposedCompany();
    await approval.clickExposedSearch();
    await approval.expectListReady();

    await approval.clearFilters();
    await approval.expectListReady();
    await approval.expectRowsGreaterThan(0);
  });

  test('外露「提交日期」筛选命中后清除', async ({ authenticatedPage, page }) => {
    void authenticatedPage;
    const approval = await useApprovalList(page);

    const submitDate = await approval.pickFirstRowCell(FILTER_LABELS.submitDate);
    const datePart = submitDate.match(/\d{4}-\d{2}-\d{2}/)?.[0] || submitDate.slice(0, 10);
    await approval.filterByExposedField(FILTER_LABELS.submitDate, datePart);
    await approval.expectFirstRowCellContains(FILTER_LABELS.submitDate, datePart);

    await approval.clearFilters();
    await approval.expectListReady();
    await approval.expectRowsGreaterThan(0);
  });
});
