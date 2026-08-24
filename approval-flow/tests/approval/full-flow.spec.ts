import { test } from '../../fixtures';
import { ApprovalListPage } from '../../pages/approval-list.page';
import { TABS } from '../../utils/approval-catalog';
import { env } from '../../utils/env';

/**
 * 审批列表全流程（serial，共享登录会话）：
 *  1) 待审批列表加载（等 pendingApproval）
 *  2) 按实机页签切换：我的已办 / 抄送我
 *  3) 筛选：业务类型 / 筛选面板 / 外露单号
 *  4) 回到待审批，用 pickFirstDocNo() 取现场单号再搜索打开
 *  5) 写操作默认跳过，APPROVAL_ENABLE_WRITE=1 才通过/驳回
 */
test.describe.configure({ mode: 'serial' });

test.describe('审批列表 · 全流程', () => {
  test('待审批列表加载出数据行', async ({ authenticatedPage, page }) => {
    void authenticatedPage;
    const approval = new ApprovalListPage(page);
    await approval.goto();
    await approval.expectLoaded();
  });

  test('切换「我的已办」「抄送我」后列表就绪', async ({ page }) => {
    const approval = new ApprovalListPage(page);
    await approval.goto();
    await approval.expectLoaded();
    await page.waitForTimeout(2_000);

    await approval.switchTab(TABS.approved);
    await approval.expectListReady();

    await approval.switchTab(TABS.cc);
    await approval.expectListReady();

    await approval.switchTab(TABS.pending);
    await approval.expectListReady();
  });

  test('筛选条、业务类型与单号筛选', async ({ page }) => {
    const approval = new ApprovalListPage(page);
    await approval.goto();
    await approval.expectLoaded();
    await approval.expectFilterBarVisible();

    await approval.openFilterPanel();
    await approval.closeFilterPanel();

    const types = await approval.listBusinessTypes();
    if (types.length > 0) {
      await approval.selectBusinessType(types[0]);
      await approval.expectListReady();
      await approval.resetBusinessType();
      await approval.expectListReady();
    }

    const docNo = await approval.pickFirstDocNo();
    await approval.filterByDocNo(docNo);
    await approval.expectRowContains(docNo);
    await approval.clearFilters();
    await approval.expectListReady();
  });

  test('用现场单号搜索并打开详情', async ({ page }) => {
    const approval = new ApprovalListPage(page);
    await approval.goto();
    await approval.expectLoaded();

    const docNo = env.approvalDocNo || (await approval.pickFirstDocNo());
    await approval.search(docNo);
    await approval.openByCode(docNo);
    await approval.expectDetailVisible();
  });

  test('对待审批单据执行「通过」', async ({ page }) => {
    test.skip(!env.writeEnabled, '未开启写操作：设置 APPROVAL_ENABLE_WRITE=1 后才会真实审批');
    const approval = new ApprovalListPage(page);
    await approval.goto();
    await approval.expectLoaded();
    const docNo = env.approvalDocNo || (await approval.pickFirstDocNo());
    await approval.search(docNo);
    await approval.approveRow(env.approvalComment, docNo);
    await approval.expectApprovalSuccess();
    await approval.expectBackToList();
  });

  test('对另一条待审批执行「驳回」', async ({ page }) => {
    test.skip(!env.writeEnabled, '未开启写操作：设置 APPROVAL_ENABLE_WRITE=1 后才会真实审批');
    const approval = new ApprovalListPage(page);
    await approval.goto();
    await approval.expectLoaded();
    const docNo = env.rejectDocNo || (await approval.pickFirstDocNo());
    await approval.search(docNo);
    await approval.rejectRow(env.rejectComment, docNo);
    await approval.expectApprovalSuccess();
    await approval.expectBackToList();
  });
});
