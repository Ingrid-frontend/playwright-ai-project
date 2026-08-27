import { test } from '../../fixtures';
import { RequestListPage } from '../../pages/request-list.page';
import { RequestEditPage } from '../../pages/request-edit.page';
import { env } from '../../utils/env';
import { randomReason } from '../../utils/random';
import { bindFlowStepCapture, flowStep } from '../../../src/utils/flow-step';

/**
 * 申请单全流程（serial，共享登录会话）：
 *  1) 列表加载（POST /api/applications/v4/search）
 *  2) 单号搜索 / 筛选
 *  3) 打开详情
 *  4) 新建 → 填事由 → 保存 → 提交（REQUEST_ENABLE_WRITE=1）
 */
test.describe.configure({ mode: 'serial' });

test.describe('申请单 · 全流程', () => {
  test.beforeAll(() => {
    process.env.FLOW_SPEC = 'request/full-flow.spec.ts';
  });

  test('申请单列表加载出数据行或空状态', async ({ authenticatedPage, page, flowRunDir }) => {
    void authenticatedPage;
    bindFlowStepCapture({ page, runDir: flowRunDir });
    const list = new RequestListPage(page);
    await flowStep('打开申请单列表', async () => {
      await list.goto();
      await list.expectLoaded();
    }, { snapshot: 'request-list' });
  });

  test('按单号搜索并校验列表', async ({ page, flowRunDir }) => {
    bindFlowStepCapture({ page, runDir: flowRunDir });
    const list = new RequestListPage(page);
    await flowStep('准备列表', async () => {
      await list.ensureOnList();
    }, { capture: false });
    const docNo = env.requestDocNo || (await list.pickFirstDocNo());
    await flowStep('按单号搜索', async () => {
      await list.search(docNo);
      await list.expectRowContains(docNo);
    }, { snapshot: 'request-search' });
  });

  test('展开筛选并按事由筛选', async ({ page, flowRunDir }) => {
    bindFlowStepCapture({ page, runDir: flowRunDir });
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
    await flowStep('按事由筛选', async () => {
      await list.filterByReason(keyword);
      await list.expectListReady();
      await list.resetFilters();
      await list.expectListReady();
    }, { snapshot: 'request-filter' });
  });

  test('用现场单号搜索并打开详情', async ({ page, flowRunDir }) => {
    bindFlowStepCapture({ page, runDir: flowRunDir });
    const list = new RequestListPage(page);
    await list.ensureOnList();
    const docNo = env.requestDocNo || (await list.pickFirstDocNo());
    await flowStep('搜索并打开详情', async () => {
      await list.search(docNo);
      await list.openByCode(docNo);
      const edit = new RequestEditPage(page);
      await edit.expectEditVisible();
    }, { snapshot: 'request-detail' });
  });

  test('新建申请单、保存并提交', async ({ page, flowRunDir }) => {
    test.skip(!env.writeEnabled, '未开启写操作：设置 REQUEST_ENABLE_WRITE=1 后才会真实新建/提交');
    bindFlowStepCapture({ page, runDir: flowRunDir });
    const list = new RequestListPage(page);
    const reason = env.requestReason || randomReason();
    await flowStep('新建并提交申请单', async () => {
      await list.goto();
      await list.expectLoaded();
      await list.clickNewRequest();
      const edit = new RequestEditPage(page);
      await edit.confirmNewRequestModal(env.requestFormName || undefined);
      await edit.expectEditVisible();
      await edit.save(env.requestApprover || undefined, reason);
      await edit.submit(env.requestApprover || undefined);
    }, { snapshot: 'request-submit' });
  });
});
