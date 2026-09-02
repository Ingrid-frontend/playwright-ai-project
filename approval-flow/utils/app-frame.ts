import type { Page } from '@playwright/test';
import {
  appFrame,
  waitForAppRoot as waitForAppRootShared,
  type AppRoot,
} from '../../flow-kit/utils/app-frame';

/**
 * 审批流程：保留历史行为「iframe 一出现就进」，不做业务内容校验。
 * 想切到更严格的 requireBiz=true，设 FLOW_APP_FRAME_REQUIRE_BIZ=1 即可。
 */
export async function waitForAppRoot(page: Page, timeout = 60_000): Promise<AppRoot> {
  const raw = (process.env.FLOW_APP_FRAME_REQUIRE_BIZ || '').trim().toLowerCase();
  const requireBiz = raw === '1' || raw === 'true' || raw === 'yes';
  return waitForAppRootShared(page, { timeout, requireBiz });
}

export { appFrame };
export type { AppRoot, WaitForAppRootOptions } from '../../flow-kit/utils/app-frame';
