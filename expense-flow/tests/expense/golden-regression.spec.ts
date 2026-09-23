import { test, expect } from '../../fixtures/index';
import { ExpenseListPage } from '../../pages/expense-list.page';
import { env } from '../../utils/env';
import { resolveGoldenSeed } from '../../utils/golden-seed';
import { bindFlowStepCapture, flowStep } from '../../../src/utils/flow-step.js';

const GOLDEN_SKIP_MSG = '列表无可用单号，跳过 Golden 搜索';

function configuredDocNo(): string {
  const fromEnv = env.expenseDocNo.trim();
  if (fromEnv) return fromEnv;
  const seed = resolveGoldenSeed(
    process.env.PLAYWRIGHT_ENV || 'dev',
    process.env.FLOW_ACCOUNT_SLUG || '',
  );
  return seed.docNo;
}

/**
 * 报销流程 golden 回归。
 *
 * 只做只读断言，不写数据——所以可以每天跑、可以对截图基线。
 * 写操作放到 expense/full-flow.spec.ts 并由 EXPENSE_ENABLE_WRITE 控制。
 *
 * 先跑起来再加用例：
 *   npm run flow:debug-fast -- --flow=expense-flow --grep=列表加载
 */
test.describe('报销流程 golden 回归', () => {
  test('列表加载与基础结构', async ({ page, flowRunDir }) => {
    bindFlowStepCapture({ page, flowRunDir });
    const list = new ExpenseListPage(page);

    await flowStep('打开列表', async () => {
      await list.goto();
      await list.expectLoaded();
    }, { snapshot: 'expense-list', step: 1 });

    await flowStep('校验表格结构', async () => {
      await expect(page).toHaveURL(/expense-parent-report\/expense-report/);
      await list.expectListReady();
      await list.restoreDefaultList();
    }, { capture: false });
  });

  test('按首行单号搜索', async ({ page, flowRunDir }) => {
    bindFlowStepCapture({ page, flowRunDir });
    const list = new ExpenseListPage(page);
    await list.goto();
    await list.expectLoaded();

    let docNo = configuredDocNo();
    if (!docNo) {
      if (!(await list.hasDataRows())) await list.recoverIfEmptyList();
      test.skip(!(await list.hasDataRows()), GOLDEN_SKIP_MSG);
      docNo = await list.readFirstDocNo();
    }

    await flowStep('搜索单号', async () => {
      await list.search(docNo);
      await list.expectRowContains(docNo);
      await list.restoreDefaultList();
    }, { snapshot: 'expense-search', step: 2 });
  });

  // TODO: 按 catalog 里的页签 / 筛选项补用例。
  // 每个用例结束都调 list.restoreDefaultList()，否则筛选状态会串。
});
