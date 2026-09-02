import { createFlowFixtures } from '../../flow-kit/fixtures/create-flow-fixtures';
import { RequestListPage } from '../pages/request-list.page';
import { RequestEditPage } from '../pages/request-edit.page';
import { env, hasLoginCredentials } from '../utils/env';

/**
 * 申请单流程 fixtures。
 * 共享实现在 flow-kit/fixtures/create-flow-fixtures，这里只声明本流程的 Page。
 */
export const test = createFlowFixtures({
  flowId: 'request-flow',
  defaultSpec: 'request/full-flow.spec.ts',
  env,
  hasLoginCredentials,
  pages: {
    requestListPage: (page) => new RequestListPage(page),
    requestEditPage: (page) => new RequestEditPage(page),
  },
});

export { expect } from '@playwright/test';
export type { ApiFailure, ApiGuard } from '../../flow-kit/utils/api-guard';
