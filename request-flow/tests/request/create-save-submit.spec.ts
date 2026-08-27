import { test } from '../../fixtures';
import { RequestListPage } from '../../pages/request-list.page';
import { RequestEditPage } from '../../pages/request-edit.page';
import { env } from '../../utils/env';
import { randomReason } from '../../utils/random';

test.describe('申请单 · 新建保存提交', () => {
  test('新建单据并保存', async ({ authenticatedPage, page }) => {
    test.skip(!env.writeEnabled, '未开启写操作：设置 REQUEST_ENABLE_WRITE=1');
    void authenticatedPage;

    const list = new RequestListPage(page);
    await list.goto();
    await list.clickNewRequest();

    const edit = new RequestEditPage(page);
    await edit.confirmNewRequestModal(env.requestFormName || undefined);
    const reason = env.requestReason || randomReason();
    await edit.save(env.requestApprover || undefined, reason);
  });
});
