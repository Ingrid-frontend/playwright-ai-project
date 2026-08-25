import { test } from '../../fixtures';
import { RequestListPage } from '../../pages/request-list.page';

test.describe('申请单 · 列表加载', () => {
  test('进入 /main/request 并加载列表', async ({ authenticatedPage, page }) => {
    void authenticatedPage;
    const list = new RequestListPage(page);
    await list.goto();
    await list.expectLoaded();
  });
});
