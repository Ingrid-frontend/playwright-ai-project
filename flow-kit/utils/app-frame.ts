import type { FrameLocator, Page } from '@playwright/test';

/**
 * 有 zoom iframe 时进 iframe，否则用主页面。
 * dev 实机 /main/approve、/main/request 的业务内容都在 iframe[src*="openBySelf=zoom"] 内。
 *
 * 这份实现由 request-flow 与 approval-flow 两份分叉版本合并而来：
 * approval 侧少了「iframe 里必须看到业务内容」这道校验，一旦 iframe 先渲染但内容还没到，
 * 后续定位会全部打空。统一后由 requireBiz 控制，默认开启；
 * 需要保留旧行为时用 FLOW_APP_FRAME_REQUIRE_BIZ=0 或传 options。
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
   * 默认 true；为 false 时退化为「iframe 一出现就进」（历史 approval 行为）。
   */
  requireBiz?: boolean;
};

/** 登录页特征：命中说明不在业务页 */
const LOGIN_MARKERS = /账号登录|二维码登录|请使用.*APP扫码/;
/** 业务内容特征：命中说明已渲染出真实业务 */
const BIZ_MARKERS =
  /申请单|审批|待审批|已审批|我发起的|新建申请单|单据信息|保存并添加明细|报销|差旅/;
/** 业务容器兜底：文本没命中时看关键 DOM */
const BIZ_CONTAINERS =
  '.application-list, .application-table, .request-edit, .one-screen-request, .full-screen, .approve-list, .approve-entrance, .ant-table, main';
/** 顶层页面特征（无 iframe 时） */
const TOP_LEVEL_MARKERS =
  /账号登录|二维码登录|工作台|数据分析|自定义报表|审批|待审批|已审批|我发起的|申请单/;

export function appFrame(page: Page): FrameLocator {
  return page.frameLocator('iframe[src*="openBySelf=zoom"]');
}

function requireBizDefault(): boolean {
  const raw = (process.env.FLOW_APP_FRAME_REQUIRE_BIZ || '').trim().toLowerCase();
  if (raw === '0' || raw === 'false' || raw === 'no') return false;
  if (raw === '1' || raw === 'true' || raw === 'yes') return true;
  return true;
}

async function iframeHasBiz(scope: FrameLocator): Promise<boolean> {
  const text = ((await scope.locator('body').innerText({ timeout: 2_000 }).catch(() => '')) || '').trim();
  if (LOGIN_MARKERS.test(text)) return false;
  if (BIZ_MARKERS.test(text)) return true;
  return scope
    .locator(BIZ_CONTAINERS)
    .first()
    .isVisible({ timeout: 1_500 })
    .catch(() => false);
}

export async function waitForAppRoot(
  page: Page,
  options: number | WaitForAppRootOptions = {},
): Promise<AppRoot> {
  const opts: WaitForAppRootOptions = typeof options === 'number' ? { timeout: options } : options;
  const timeout = opts.timeout ?? 60_000;
  const requireBiz = opts.requireBiz ?? requireBizDefault();

  const deadline = Date.now() + timeout;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      const iframe = page.locator('iframe[src*="openBySelf=zoom"]');
      if (await iframe.count()) {
        const scope = appFrame(page);
        await scope.locator('body').waitFor({ timeout: 5_000 });
        if (!requireBiz || (await iframeHasBiz(scope))) {
          return { page, scope, inIframe: true };
        }
      }

      // 无 iframe：登录页或已登录主站直接渲染在顶层
      const bodyText = await page.locator('body').innerText({ timeout: 2_000 }).catch(() => '');
      if (TOP_LEVEL_MARKERS.test(bodyText)) {
        return { page, scope: page, inIframe: false };
      }
    } catch (e) {
      lastError = e;
    }
    await page.waitForTimeout(500);
  }

  const url = page.url();
  const html = await page.content().catch(() => '');
  throw new Error(
    `等待业务页超时（url=${url}）${lastError ? `；last=${String(lastError)}` : ''}；html=${html.slice(0, 300)}`,
  );
}
