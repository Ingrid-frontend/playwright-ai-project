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
const GOLDEN_SKIP_MSG =
  '待审批无可用单号，跳过 Golden（APPROVAL_DOC_NO / golden-seeds 或确保有待审批数据）';

function configuredDocNo(): string {
  const fromEnv = env.approvalDocNo.trim();
  if (fromEnv) return fromEnv;
  const seed = resolveGoldenSeed(
    process.env.PLAYWRIGHT_ENV || 'dev',
    process.env.FLOW_ACCOUNT_SLUG || '',
  );
  return seed.docNo;
}

async function prepareGolden(approval: ApprovalListPage) {
  await approval.activateBestPendingSegment().catch(() => undefined);

  if (await approval.isPendingGoldenEmpty()) {
    test.skip(true, GOLDEN_SKIP_MSG);
  }

  if (!goldenCtx.docNo) goldenCtx.docNo = configuredDocNo();
  if (!goldenCtx.docNo) {
    goldenCtx.docNo = await approval.readFirstDocNo();
  }

  try {
    await approval.ensureRowVisible(goldenCtx.docNo);
  } catch {
    test.skip(true, GOLDEN_SKIP_MSG);
  }
}

test.describe('审批列表 · Golden 回归', () => {
  test.beforeAll(() => {
    process.env.FLOW_SPEC = 'approval/golden-regression.spec.ts';
  });

  test('Golden 全流程', async ({ authenticatedPage, page, flowRunDir }) => {
    void authenticatedPage;
    bindFlowStepCapture({ page, runDir: flowRunDir });
    const approval = new ApprovalListPage(page);

    await flowStep('打开审批列表', async () => {
      await approval.goto();
      await approval.expectGoldenLoaded();
      await prepareGolden(approval);
    }, { snapshot: 'approval-list', step: 1 });

    await flowStep('页签切换', async () => {
      await approval.switchTab(TABS.approved);
      await approval.expectListReady();
      await approval.switchTab(TABS.cc);
      await approval.expectListReady();
      await approval.switchTab(TABS.pending);
      await approval.expectListReady();
    }, { snapshot: 'approval-tabs', step: 2 });

    const docNo = goldenCtx.docNo;
    await flowStep('筛选与单号', async () => {
      await approval.expectFilterBarVisible();
      await approval.openFilterPanel();
      await approval.closeFilterPanel();
      await approval.filterByDocNo(docNo);
      await approval.expectRowContains(docNo);
      await approval.clearFilters();
      await approval.expectListReady();
    }, { snapshot: 'approval-filter', step: 3 });

    await flowStep('搜索并打开详情', async () => {
      if (!docNo) test.skip(true, GOLDEN_SKIP_MSG);
      await approval.switchTab(TABS.pending);
      await approval.search(docNo);
      await approval.openByCode(docNo);
      await approval.expectDetailVisible();
    }, { snapshot: 'approval-detail', step: 4 });
  });
});
