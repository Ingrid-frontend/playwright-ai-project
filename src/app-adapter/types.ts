import type { FrameLocator, Page } from '@playwright/test';

/**
 * AppAdapter：把「目标应用」的平台特有假设收敛为一个接口。
 * 对接新应用 = 新增一个 adapter 实现并注册，上层（flow / smoke / ego / crawl）零改动。
 */

export type AppRoot = {
  page: Page;
  /** 业务操作作用域：iframe 或 page 本身 */
  scope: FrameLocator | Page;
  inIframe: boolean;
};

export type WaitForAppRootOptions = {
  timeout?: number;
  /**
   * iframe 存在时是否要求其中已渲染业务内容。
   * 默认 true；为 false 时退化为「iframe 一出现就进」。
   */
  requireBiz?: boolean;
};

/** 快照级错页上下文提示（ego 路线断言失败时使用） */
export type PageContextHint = {
  key: string;
  label: string;
  suggest: string;
};

/** 通用 UI 选择器档案：Smoke 巡检与 Golden catalog 生成的兜底依据 */
export type UiProfile = {
  /** 加载中指示器选择器：全部消失视为加载完成 */
  loadingSelectors: string[];
  /** 列表/表格容器选择器（关键元素兜底） */
  tableSelectors: string[];
  /** 空态文案特征：命中说明页面已加载但无数据（不算可疑空白） */
  emptyTextPatterns: RegExp[];
  /** 业务容器兜底选择器（文本判定失败时看关键 DOM） */
  bizContainers: string;
};

/** 菜单发现策略（页面目录爬取用） */
export type MenuDiscoveryProfile = {
  /** 菜单搜索框占位文案特征 */
  searchPlaceholderRe?: RegExp;
  /** 菜单搜索框选择器（可选，优先于占位文案） */
  searchInputSelector?: string;
  /** 搜索只过滤侧栏不自动跳转时，需要点击结果项 */
  clickResultAfterSearch?: boolean;
};

export type LoginStrategy = 'storage-state' | 'form' | 'sso-redirect';

export interface AppAdapter {
  readonly id: string;
  readonly label: string;
  /** 登录策略：当前统一走 storageState；form/sso 预留 */
  readonly loginStrategy: LoginStrategy;

  /** 环境判定：baseURL 是否属于本应用 */
  isEnv(env: string): boolean;
  resolveBaseURL(env: string): string | undefined;
  /** 工作台首页路径（导航归位锚点） */
  readonly homePath: string;
  /** 入口路径归一化（如根路径恢复上次模块时改写为 homePath） */
  normalizeEntryPath(env: string, pathOrUrl?: string): string | undefined;

  /** 等待业务根可用（iframe 判定 + 业务内容校验） */
  waitForAppRoot(page: Page, options?: WaitForAppRootOptions): Promise<AppRoot>;
  /** iframe 作用域定位（无 iframe 的应用返回主文档等价物） */
  appFrame(page: Page): FrameLocator;
  /** 文本级登录页判定：命中说明不在业务页 */
  isLoginText(text: string): boolean;

  /** 快照级导航守卫：识别常见错页并给出引导（ego 路线） */
  detectPageContext(snapshot: string): PageContextHint | null;
  assertWrongPageForListOps(snapshot: string): string | null;

  /** 写操作门禁：按业务域给出开关环境变量名（如 request → REQUEST_ENABLE_WRITE） */
  writeEnvVar(domain: string): string;

  /** 通用 UI 选择器档案 */
  readonly uiProfile: UiProfile;
  /** 菜单发现策略（爬取用，可选） */
  readonly menuDiscovery?: MenuDiscoveryProfile;
}

/** 通用写门禁环境变量命名约定：DOMAIN_ENABLE_WRITE */
export function writeEnvVarByDomain(domain: string): string {
  const up = domain.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_');
  return `${up}_ENABLE_WRITE`;
}
