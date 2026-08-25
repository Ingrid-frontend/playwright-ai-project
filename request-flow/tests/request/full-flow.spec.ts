import { test } from '../../fixtures';
import { RequestListPage } from '../../pages/request-list.page';
import { RequestEditPage } from '../../pages/request-edit.page';
import { env } from '../../utils/env';
import { randomReason } from '../../utils/random';

/**
 * 申请单全流程（serial，共享登录会话）：
 *  1) 列表加载（POST /api/applications/v4/search）
 *  2) 单号搜索 / 筛选
 *  3) 打开详情
 *  4) 新建 → 填事由 → 保存 → 提交（REQUEST_ENABLE_WRITE=1）
 */
test.describe.configure({ mode: 'serial' });

test.describe('申请单 · 全流程', () => {
  test('申请单列表加载出数据行或空状态', async ({ authenticatedPage, page }) => {
    void authenticatedPage;
    const list = new RequestListPage(page);
    await list.goto();
    await list.expectLoaded();
  });

  test('按单号搜索并校验列表', async ({ page }) => {
    const list = new RequestListPage(page);
    await list.ensureOnList();
    const docNo = env.requestDocNo || (await list.pickFirstDocNo());
    await list.search(docNo);
    await list.expectRowContains(docNo);
  });

  test('展开筛选并按事由筛选', async ({ page }) => {
    const list = new RequestListPage(page);
    await list.ensureOnList();
    let reason = '';
    try {
      reason = await list.pickFirstRowCell('事由');
    } catch {
      test.skip(true, '列表首行事由为空，跳过筛选');
    }
    if (!reason || reason === '-') {
      test.skip(true, '列表首行事由为空，跳过筛选');
    }
    const keyword = reason.slice(0, Math.min(8, reason.length));
    await list.filterByReason(keyword);
    await list.expectListReady();
    await list.resetFilters();
    await list.expectListReady();
  });

  test('用现场单号搜索并打开详情', async ({ page }) => {
    const list = new RequestListPage(page);
    await list.ensureOnList();
    const docNo = env.requestDocNo || (await list.pickFirstDocNo());
    await list.search(docNo);
    await list.openByCode(docNo);
    const edit = new RequestEditPage(page);
    await edit.expectEditVisible();
  });

  test('新建申请单、保存并提交', async ({ page }) => {
    test.skip(!env.writeEnabled, '未开启写操作：设置 REQUEST_ENABLE_WRITE=1 后才会真实新建/提交');
    const list = new RequestListPage(page);
    await list.goto();
    await list.expectLoaded();
    await list.clickNewRequest();

    const edit = new RequestEditPage(page);
    await edit.confirmNewRequestModal(env.requestFormName || undefined);
    await edit.expectEditVisible();
    await edit.fillReason(env.requestReason || randomReason());
    await edit.save(env.requestApprover || undefined);
    await edit.submit(env.requestApprover || undefined);
  });
});
