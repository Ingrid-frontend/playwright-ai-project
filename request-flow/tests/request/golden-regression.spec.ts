import { test } from '../../fixtures';
import { RequestListPage } from '../../pages/request-list.page';
import { RequestEditPage } from '../../pages/request-edit.page';
import { bindFlowStepCapture, flowStep } from '../../../src/utils/flow-step';
import {
  probeRequestLiveDocNo,
  probeRequestLiveFilterKeyword,
  useLiveSeed,
} from '../../utils/golden-seed';

/**
 * Golden 固定回归（只读）：
 * 供像素基线对比。单号/筛选用当前列表可见行现场取样；
 * REQUEST_DOC_NO / REQUEST_FILTER_KEYWORD 仅作对照，过期则忽略并 skip（无可用种子时），
 * 不把历史单据号当搜索词。须使用 golden* 账号档案，勿与 write 档案混跑造单用例。
 * 多角色时基线按登录账号 slug 分目录（by-account/<slug>）。
 */
test.describe.configure({ mode: 'serial' });

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
    const docNo = useLiveSeed(await probeRequestLiveDocNo(list));
    await flowStep('按单号搜索', async () => {
      await list.search(docNo);
      await list.expectRowContains(docNo);
    }, { snapshot: 'request-search' });
  });

  test('展开筛选并按事由筛选', async ({ page, flowRunDir }) => {
    bindFlowStepCapture({ page, runDir: flowRunDir });
    const list = new RequestListPage(page);
    await list.ensureOnList();
    const keyword = useLiveSeed(await probeRequestLiveFilterKeyword(list));
    await flowStep('按事由筛选', async () => {
      await list.filterByReason(keyword);
      await list.expectReasonFilterResult(keyword);
      await list.resetFilters();
      await list.expectListReady();
    }, { snapshot: 'request-filter' });
  });

  test('用现场单号搜索并打开详情', async ({ page, flowRunDir }) => {
    bindFlowStepCapture({ page, runDir: flowRunDir });
    const list = new RequestListPage(page);
    await list.ensureOnList();
    const docNo = useLiveSeed(await probeRequestLiveDocNo(list));
    await flowStep('搜索并打开详情', async () => {
      await list.search(docNo);
      await list.openByCode(docNo);
      const edit = new RequestEditPage(page);
      await edit.expectEditVisible();
    }, { snapshot: 'request-detail' });
  });
});
