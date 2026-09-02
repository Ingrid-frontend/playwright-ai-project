import { createFlowFixtures } from '../../flow-kit/fixtures/create-flow-fixtures';
import { ExpenseListPage } from '../pages/expense-list.page';
import { env, hasLoginCredentials } from '../utils/env';

/**
 * 报销流程 fixtures。
 * 共享实现在 flow-kit/fixtures/create-flow-fixtures，这里只声明本流程的 Page。
 */
export const test = createFlowFixtures({
  flowId: 'expense-flow',
  defaultSpec: 'expense/golden-regression.spec.ts',
  env,
  hasLoginCredentials,
  pages: {
    expenseListPage: (page) => new ExpenseListPage(page),
  },
});

export { expect } from '@playwright/test';
export type { ApiFailure, ApiGuard } from '../../flow-kit/utils/api-guard';
