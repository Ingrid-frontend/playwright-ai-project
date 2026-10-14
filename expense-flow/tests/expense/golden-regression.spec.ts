import { test } from '../../fixtures/index';
import { ExpenseListPage } from '../../pages/expense-list.page';
import { ExpenseEditPage } from '../../pages/expense-edit.page';
import { env } from '../../utils/env';
import { resolveGoldenSeed } from '../../utils/golden-seed';
import { bindFlowStepCapture, flowStep } from '../../../src/utils/flow-step.js';

const GOLDEN_SKIP_MSG = '列表无可用单号，跳过 Golden 搜索';
const ctx = { docNo: '' };

function configuredDocNo(): string {
  const fromEnv = env.expenseDocNo.trim();
  if (fromEnv) return fromEnv;
  const seed = resolveGoldenSeed(
    process.env.PLAYWRIGHT_ENV || 'dev',
    process.env.FLOW_ACCOUNT_SLUG || '',
  );
  return seed.docNo;
}

async function ensureDocNo(list: ExpenseListPage): Promise<string> {
  if (ctx.docNo) return ctx.docNo;
  ctx.docNo = configuredDocNo();
  if (!ctx.docNo) {
    if (!(await list.hasDataRows())) await list.recoverIfEmptyList();
    test.skip(!(await list.hasDataRows()), GOLDEN_SKIP_MSG);
    ctx.docNo = await list.readFirstDocNo();
  }
  return ctx.docNo;
}

/**
 * 报销流程 golden 回归（只读）。
 *
 * 同一页顺序做：打开列表 → 按单号搜索 → 打开详情。
 * 不再每步整页重开，也不在搜索后重置列表。
 * 新建/提交放在 expense/full-flow.spec.ts，由 EXPENSE_ENABLE_WRITE 控制。
 */
test.describe.configure({ mode: 'serial' });

test.describe('报销流程 golden 回归', () => {
  test('列表加载与基础结构', async ({ page, flowRunDir }) => {
    bindFlowStepCapture({ page, flowRunDir });
    const list = new ExpenseListPage(page);

    await flowStep('打开列表', async () => {
      await list.goto();
      await list.expectLoaded();
    }, { snapshot: 'expense-list', step: 1 });
  });

  test('按首行单号搜索', async ({ page, flowRunDir }) => {
    bindFlowStepCapture({ page, flowRunDir });
    const list = new ExpenseListPage(page);
    await list.ensureOnList();
    const docNo = await ensureDocNo(list);

    await flowStep('搜索单号', async () => {
      await list.search(docNo);
      await list.expectRowContains(docNo);
    }, { snapshot: 'expense-search', step: 2 });
  });

  test('用现场单号搜索并打开详情', async ({ page, flowRunDir }) => {
    bindFlowStepCapture({ page, flowRunDir });
    const list = new ExpenseListPage(page);
    await list.ensureOnList();
    const docNo = await ensureDocNo(list);

    await flowStep('打开详情', async () => {
      await list.openByCode(docNo);
      const edit = new ExpenseEditPage(page);
      await edit.expectEditVisible();
    }, { snapshot: 'expense-detail', step: 3 });
  });

  // TODO: 按 catalog 里的页签 / 筛选项补用例。
  // 每个用例结束都调 list.restoreDefaultList()，否则筛选状态会串。
});
