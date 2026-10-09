import type { Page } from '@playwright/test';
import {
  appFrame,
  waitForAppRoot,
  BIZ_CONTAINERS,
  LOGIN_MARKERS,
  type AppRoot,
  type WaitForAppRootOptions,
} from './app-frame.js';
import {
  WORKBENCH_HOME_PATH,
  assertWrongPageForListOps,
  detectHuilianyiPageContext,
  isHuilianyiEnv,
  normalizeHuilianyiEntryPath,
} from './nav-guard.js';
import { getBaseEnvConfig } from '../../utils/env-config.js';
import { writeEnvVarByDomain, type AppAdapter, type UiProfile } from '../types.js';

export { appFrame, waitForAppRoot };
export type { AppRoot, WaitForAppRootOptions };
export {
  WORKBENCH_HOME_PATH,
  assertWrongPageForListOps,
  detectHuilianyiPageContext,
  isHuilianyiEnv,
  normalizeHuilianyiEntryPath,
};

/** 汇联易通用 UI 选择器档案 */
export const HUILIANYI_UI_PROFILE: UiProfile = {
  loadingSelectors: ['.ant-spin-spinning'],
  tableSelectors: ['.application-table-v2 .ant-table', '.ant-table'],
  emptyTextPatterns: [/暂无数据/, /暂无相关/, /没有数据/],
  bizContainers: BIZ_CONTAINERS,
};

/**
 * 汇联易 AppAdapter：iframe 内嵌应用（iframe[src*="openBySelf=zoom"]）。
 * 词表与判定逻辑收编自 flow-kit/utils/app-frame.ts 与 src/runtime/ego-nav-guard.ts。
 */
export const HUILIANYI_ADAPTER: AppAdapter = {
  id: 'huilianyi',
  label: '汇联易',
  loginStrategy: 'storage-state',

  isEnv(env: string): boolean {
    return isHuilianyiEnv(env);
  },

  resolveBaseURL(env: string): string | undefined {
    return getBaseEnvConfig(env)?.baseURL;
  },

  homePath: WORKBENCH_HOME_PATH,

  normalizeEntryPath(env: string, pathOrUrl?: string): string | undefined {
    return normalizeHuilianyiEntryPath(env, pathOrUrl);
  },

  waitForAppRoot(page: Page, options?: WaitForAppRootOptions): Promise<AppRoot> {
    return waitForAppRoot(page, options);
  },

  appFrame(page: Page) {
    return appFrame(page);
  },

  isLoginText(text: string): boolean {
    return LOGIN_MARKERS.test(text || '');
  },

  detectPageContext(snapshot: string) {
    return detectHuilianyiPageContext(snapshot);
  },

  assertWrongPageForListOps(snapshot: string): string | null {
    return assertWrongPageForListOps(snapshot);
  },

  writeEnvVar(domain: string): string {
    return writeEnvVarByDomain(domain);
  },

  uiProfile: HUILIANYI_UI_PROFILE,

  menuDiscovery: {
    // 汇联易侧栏菜单搜索：填值只过滤侧栏，不会自动跳转，必须再点结果项
    searchPlaceholderRe: /搜索菜单|菜单搜索|请输入菜单/,
    clickResultAfterSearch: true,
  },
};
