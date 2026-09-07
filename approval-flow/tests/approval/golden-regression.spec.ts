import { test } from '../../fixtures';
import { ApprovalListPage } from '../../pages/approval-list.page';
import { TABS } from '../../utils/approval-catalog';
import { env } from '../../utils/env';
import { resolveGoldenSeed } from '../../utils/golden-seed';
import { bindFlowStepCapture, flowStep } from '../../../src/utils/flow-step';

/**
 * Golden 固定回归（只读 + 完整筛选流程）：
 * 供像素/结构基线对比；单号用 APPROVAL_DOC_NO / golden-seeds / 列表现场读取。
 * 须使用 golden* 账号档案，复用申请单流程登录态，勿与 write 档案混跑。
 * 多角色时基线按登录账号 slug 分目录（by-account/<slug>）。
 */
test.describe.configure({ mode: 'serial' });

const goldenCtx = { docNo: '' };

async function hasDataRows(approval: ApprovalListPage) {
  return (await approval.dataRows().count().catch(() => 0)) > 0;
}

async function trySeedGoldenContext(approval: ApprovalListPage) {
  if (!goldenCtx.docNo) goldenCtx.docNo = env.approvalDocNo.trim();
  if (!goldenCtx.docNo) {
    const seed = resolveGoldenSeed(
      process.env.PLAYWRIGHT_ENV || 'dev',
      process.env.FLOW_ACCOUNT_SLUG || '',
    );
    goldenCtx.docNo = seed.docNo;
  }

  if (!(await hasDataRows(approval))) {
    await approval.switchToPending().catch(() => undefined);
    await approval.resetFilterState().catch(() => undefined);
  }

  if (!goldenCtx.docNo && !(await hasDataRows(approval))) {
    const fromApi = await approval.readDocNoFromListApi({ refresh: true }).catch(() => '');
    if (fromApi) goldenCtx.docNo = fromApi;
  }

  if (!(await hasDataRows(approval))) {
    if (!goldenCtx.docNo) return;
    return;
  }

  if (!goldenCtx.docNo) {
    try {
      goldenCtx.docNo = await approval.pickFirstDocNo();
    } catch {
      const fromApi = await approval.readDocNoFromListApi().catch(() => '');
      if (fromApi) goldenCtx.docNo = fromApi;
    }
  }
}

async function ensureGoldenList(approval: ApprovalListPage) {
  await approval.ensureOnList();
  if (!goldenCtx.docNo) {
    await trySeedGoldenContext(approval);
  }
  if (!goldenCtx.docNo) {
    test.skip(true, '待审批列表无可用单号，跳过后续 Golden 步骤');
  }
  if (await hasDataRows(approval)) return;
  await approval.switchToPending();
  await approval.resetFilterState().catch(() => undefined);
  if (!(await hasDataRows(approval))) {
    test.skip(true, '待审批列表无数据，跳过后续 Golden 步骤');
  }
}

async function prepareGoldenList(approval: ApprovalListPage) {
  await ensureGoldenList(approval);
  await approval.switchToPending();
  await approval.resetFilterState();
}

test.describe('审批列表 · Golden 回归', () => {
  test.beforeAll(() => {
    process.env.FLOW_SPEC = 'approval/golden-regression.spec.ts';
  });

  test('待审批列表加载出数据行', async ({ authenticatedPage, page, flowRunDir }) => {
    void authenticatedPage;
    bindFlowStepCapture({ page, runDir: flowRunDir });
    const approval = new ApprovalListPage(page);
    await flowStep('打开审批列表', async () => {
      await approval.goto();
      await approval.expectLoaded();
      await approval.recoverIfEmptyList();
      await trySeedGoldenContext(approval);
    }, { snapshot: 'approval-list', step: 1 });
  });

  test('切换已审批、抄送我后回到待审批', async ({ page, flowRunDir }) => {
    bindFlowStepCapture({ page, runDir: flowRunDir });
    const approval = new ApprovalListPage(page);
    await flowStep('页签切换', async () => {
      await approval.ensureOnList();
      await approval.switchTab(TABS.approved);
      await approval.expectListReady();
      await approval.switchTab(TABS.cc);
      await approval.expectListReady();
      await approval.switchTab(TABS.pending);
      await approval.expectListReady();
    }, { snapshot: 'approval-tabs', step: 2 });
  });

  test('筛选条、业务类型与单号筛选', async ({ page, flowRunDir }) => {
    bindFlowStepCapture({ page, runDir: flowRunDir });
    const approval = new ApprovalListPage(page);
    await flowStep('准备列表', async () => {
      await prepareGoldenList(approval);
      await approval.expectFilterBarVisible();
    }, { capture: false });
    const docNo = goldenCtx.docNo;
    await flowStep('筛选与单号', async () => {
      await approval.openFilterPanel();
      await approval.closeFilterPanel();
      await approval.filterByDocNo(docNo);
      await approval.expectRowContains(docNo);
      await approval.clearFilters();
      await approval.expectListReady();
    }, { snapshot: 'approval-filter', step: 3 });
  });

  test('用现场单号搜索并打开详情', async ({ page, flowRunDir }) => {
    bindFlowStepCapture({ page, runDir: flowRunDir });
    const approval = new ApprovalListPage(page);
    await prepareGoldenList(approval);
    const docNo = goldenCtx.docNo;
    await flowStep('搜索并打开详情', async () => {
      await approval.search(docNo);
      await approval.openByCode(docNo);
      await approval.expectDetailVisible();
    }, { snapshot: 'approval-detail', step: 4 });
  });
});
