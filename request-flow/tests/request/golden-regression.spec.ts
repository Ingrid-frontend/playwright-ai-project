import { test } from '../../fixtures';
import { RequestListPage } from '../../pages/request-list.page';
import { RequestEditPage } from '../../pages/request-edit.page';
import { env } from '../../utils/env';
import { bindFlowStepCapture, flowStep } from '../../../src/utils/flow-step';

/**
 * Golden 固定回归（只读 + 固定筛选项）：
 * 供像素基线对比；筛选用 REQUEST_FILTER_KEYWORD，单号用 REQUEST_DOC_NO。
 * 须使用 golden* 账号档案，勿与 write 档案混跑造单用例。
 * 多角色时基线按登录账号 slug 分目录（by-account/<slug>）。
 */
test.describe.configure({ mode: 'serial' });

async function resolveGoldenDocNo(list: RequestListPage): Promise<string> {
  if (env.requestDocNo) return env.requestDocNo;
  await list.clearListQuery();
  await list.expectListReady();
  if (!(await list.hasDataRows())) {
    test.skip(true, '列表无数据且未设置 REQUEST_DOC_NO，跳过搜索/详情 Golden 步骤');
  }
  return list.pickFirstDocNo();
}

test.describe('申请单 · Golden 回归', () => {
  test.beforeAll(() => {
    process.env.FLOW_SPEC = 'request/golden-regression.spec.ts';
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
    const docNo = await resolveGoldenDocNo(list);
    await flowStep('按单号搜索', async () => {
      await list.search(docNo);
      await list.expectRowContains(docNo);
    }, { snapshot: 'request-search' });
  });

  test('展开筛选并按固定关键字筛选', async ({ page, flowRunDir }) => {
    test.skip(!env.requestFilterKeyword, '请设置 REQUEST_FILTER_KEYWORD 以固定 Golden 筛选项');
    bindFlowStepCapture({ page, runDir: flowRunDir });
    const list = new RequestListPage(page);
    await list.ensureOnList();
    const keyword = env.requestFilterKeyword;
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
    const docNo = await resolveGoldenDocNo(list);
    await flowStep('搜索并打开详情', async () => {
      await list.search(docNo);
      await list.openByCode(docNo);
      const edit = new RequestEditPage(page);
      await edit.expectEditVisible();
    }, { snapshot: 'request-detail' });
  });
});
