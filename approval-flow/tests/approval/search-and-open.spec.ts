import { test, expect } from '../../fixtures';
import { ApprovalListPage } from '../../pages/approval-list.page';
import { trySeedGoldenContext, useLiveSeed } from '../../utils/golden-seed';

test.describe('审批列表 · 搜索与打开详情', () => {
  test('搜索并打开一条单据详情', async ({ authenticatedPage, page }) => {
    void authenticatedPage;

    const approval = new ApprovalListPage(page);
    await approval.goto();
    await approval.expectLoaded();

    const docNo = useLiveSeed(await trySeedGoldenContext(approval));
    await approval.search(docNo);
    await approval.openByCode(docNo);

    await expect(
      approval.detailEntrance()
    ).toBeVisible({ timeout: 20_000 });
  });
});
