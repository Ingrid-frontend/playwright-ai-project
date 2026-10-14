import { createFlowFixtures } from '../../flow-kit/fixtures/create-flow-fixtures';
import { ApRequestListPage } from '../pages/ap-request-list.page';
import { env, hasLoginCredentials } from '../utils/env';

/**
 * 对公申请单流程 fixtures。
 * 共享实现在 flow-kit/fixtures/create-flow-fixtures，这里只声明本流程的 Page。
 */
export const test = createFlowFixtures({
  flowId: 'ap-request-flow',
  defaultSpec: 'ap-request/golden-regression.spec.ts',
  env,
  hasLoginCredentials,
  pages: {
    apRequestListPage: (page) => new ApRequestListPage(page),
  },
});

export { expect } from '@playwright/test';
export type { ApiFailure, ApiGuard } from '../../flow-kit/utils/api-guard';
