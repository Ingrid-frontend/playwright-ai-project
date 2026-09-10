import { test } from '../../fixtures';
import { ExpenseListPage } from '../../pages/expense-list.page';
import { ExpenseEditPage } from '../../pages/expense-edit.page';
import { env } from '../../utils/env';
import { randomReason } from '../../utils/random';
import { bindFlowStepCapture, flowStep } from '../../../src/utils/flow-step.js';

/**
 * 报销单全流程（serial，共享登录会话）：
 *  1) 列表加载（POST /api/expense/queryPage）
 *  2) 单号搜索
 *  3) 打开详情（SlideFrame）
 *  4) 新建 → 填事由 → 保存 → 提交（EXPENSE_ENABLE_WRITE=1）
 *
 * 写操作统一受 EXPENSE_ENABLE_WRITE 控制，默认只跑只读部分。
 */
test.describe.configure({ mode: 'serial' });

test.describe('报销单 · 全流程', () => {
  test.beforeAll(() => {
    process.env.FLOW_SPEC = 'expense/full-flow.spec.ts';
  });

  test('报销单列表加载出数据行或空状态', async ({ authenticatedPage, page, flowRunDir }) => {
    void authenticatedPage;
    bindFlowStepCapture({ page, runDir: flowRunDir });
    const list = new ExpenseListPage(page);
    await flowStep('打开报销单列表', async () => {
      await list.goto();
      await list.expectLoaded();
    }, { snapshot: 'expense-list' });
  });

  test('按单号搜索并校验列表', async ({ page, flowRunDir }) => {
    bindFlowStepCapture({ page, runDir: flowRunDir });
    const list = new ExpenseListPage(page);
    await flowStep('准备列表', async () => {
      await list.ensureOnList();
      await list.expectLoaded();
    }, { capture: false });
    const docNo = env.expenseDocNo || (await list.pickFirstDocNo().catch(() => ''));
    test.skip(!docNo, '列表无数据，跳过搜索用例');
    await flowStep('按单号搜索', async () => {
      await list.search(docNo);
      await list.expectRowContains(docNo);
      await list.restoreDefaultList();
    }, { snapshot: 'expense-search' });
  });

  test('用现场单号搜索并打开详情', async ({ page, flowRunDir }) => {
    bindFlowStepCapture({ page, runDir: flowRunDir });
    const list = new ExpenseListPage(page);
    await list.ensureOnList();
    const docNo = env.expenseDocNo || (await list.pickFirstDocNo().catch(() => ''));
    test.skip(!docNo, '列表无数据，跳过详情用例');
    await flowStep('搜索并打开详情', async () => {
      await list.search(docNo);
      await list.openByCode(docNo);
      const edit = new ExpenseEditPage(page);
      await edit.expectEditVisible();
    }, { snapshot: 'expense-detail' });
  });

  test('新建报销单、保存并提交', async ({ page, flowRunDir }) => {
    test.skip(!env.writeEnabled, '未开启写操作：设置 EXPENSE_ENABLE_WRITE=1 后才会真实新建/提交');
    test.setTimeout(300_000);
    bindFlowStepCapture({ page, runDir: flowRunDir });
    const list = new ExpenseListPage(page);
    const reason = env.expenseReason || randomReason();
    await flowStep('新建并提交报销单', async () => {
      await list.goto();
      await list.expectLoaded();
      const edit = await list.startNewExpense(env.expenseFormName || undefined);
      await edit.fillReason(reason);
      await edit.save();
      await edit.submit();
    }, { snapshot: 'expense-submit' });
  });
});
