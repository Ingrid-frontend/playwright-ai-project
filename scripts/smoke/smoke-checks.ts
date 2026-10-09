/**
 * Smoke 断言规则引擎：对单个页面执行五级检查（零 LLM）。
 *
 * ① 可达      —— goto 落地且未回登录页（adapter.isLoginText + /login URL）
 * ② 加载完成  —— adapter.waitForAppRoot + 加载指示器（.ant-spin-spinning 等）消失
 * ③ 关键元素  —— catalog.smoke.keyElements 命中数达标；无配置降级为「表格或空态任一可见」
 * ④ console   —— pageerror + console level=error 采集，白名单过滤；--enforce-console 时计入失败
 * ⑤ 截图      —— 首屏归档 screenshots/smoke/<env>/<pageId>.png
 *
 * 判定分级：failed（硬失败）> suspicious（可疑，慢加载/空白/关键元素未命中）> passed。
 * suspicious 不挡 exit code，避免告警疲劳；连续失败升级由 job 侧按历史报告判断。
 */
import fs from 'fs';
import path from 'path';
import type { Locator, Page } from '@playwright/test';
import type { AppAdapter, WaitForAppRootOptions } from '../../src/app-adapter/types.js';

export type SmokeCheck = {
  key: 'reachable' | 'loaded' | 'key-elements' | 'console' | 'screenshot';
  label: string;
  passed: boolean;
  /** suspicious=true 时本项不计硬失败，只计可疑 */
  suspicious?: boolean;
  detail?: string;
};

export type SmokePageStatus = 'passed' | 'suspicious' | 'failed' | 'skipped';

export type SmokePageResult = {
  pageId: string;
  label: string;
  route: string;
  env: string;
  status: SmokePageStatus;
  durationMs: number;
  checks: SmokeCheck[];
  consoleErrors: Array<{ text: string; url?: string }>;
  screenshot?: string | null;
  runAt: string;
};

export type CatalogPageLite = {
  id: string;
  label: string;
  route: string;
  smoke: {
    enabled: boolean;
    weight: 'core' | 'normal';
    keyElements: string[];
    keyElementsAiSuggested: boolean;
  };
};

export type SmokeRunOptions = {
  env: string;
  baseURL: string;
  adapter: AppAdapter;
  catalogPage: CatalogPageLite;
  /** console error 计入失败（调参期结束后开启） */
  enforceConsole?: boolean;
  screenshotPath?: string;
  timeoutMs?: number;
};

// ---------- catalog 加载与过滤 ----------

export function loadCatalogPages(repoRoot: string, catalogRel = 'datasource/page-catalog.json'): CatalogPageLite[] {
  const abs = path.isAbsolute(catalogRel) ? catalogRel : path.resolve(repoRoot, catalogRel);
  if (!fs.existsSync(abs)) {
    throw new Error(`页面清单不存在: ${abs}。先跑 npm run catalog:crawl 生成。`);
  }
  const catalog = JSON.parse(fs.readFileSync(abs, 'utf8')) as {
    pages?: Array<CatalogPageLite & { status?: string }>;
  };
  return (catalog.pages || [])
    .filter((p) => p && p.route && p.status !== 'retired')
    .map((p) => ({
      id: p.id,
      label: p.label || p.id,
      route: p.route,
      smoke: {
        enabled: p.smoke?.enabled !== false,
        weight: p.smoke?.weight === 'core' ? 'core' : 'normal',
        keyElements: Array.isArray(p.smoke?.keyElements) ? p.smoke.keyElements : [],
        keyElementsAiSuggested: Boolean(p.smoke?.keyElementsAiSuggested),
      },
    }));
}

// ---------- console 错误采集 ----------

export type ConsoleCollector = {
  errors: Array<{ text: string; url?: string }>;
  detach: () => void;
};

export function attachConsoleCollector(page: Page): ConsoleCollector {
  const errors: Array<{ text: string; url?: string }> = [];
  const onPageError = (err: Error) => {
    errors.push({ text: `pageerror: ${err?.message || String(err)}`, url: page.url() });
  };
  const onConsole = (msg: { type(): string; text(): string; location?: () => { url?: string } }) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    // 浏览器扩展/资源加载噪声常见但不可归因 UI 缺陷的，原样保留交由白名单处理
    errors.push({ text: `console.error: ${text}`.slice(0, 500), url: msg.location?.()?.url });
  };
  page.on('pageerror', onPageError);
  page.on('console', onConsole as never);
  return {
    errors,
    detach: () => {
      page.off('pageerror', onPageError);
      page.off('console', onConsole as never);
    },
  };
}

/** console 错误白名单：datasource/smoke-ignore.json（正则字符串数组），命中即忽略 */
export function loadConsoleIgnore(repoRoot: string): RegExp[] {
  const abs = path.resolve(repoRoot, 'datasource/smoke-ignore.json');
  if (!fs.existsSync(abs)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(abs, 'utf8')) as string[];
    const out: RegExp[] = [];
    for (const s of raw) {
      try {
        out.push(new RegExp(s, 'i'));
      } catch {
        console.warn(`[smoke] smoke-ignore.json 中无效正则已跳过: ${s}`);
      }
    }
    return out;
  } catch {
    return [];
  }
}

export function filterConsoleErrors(
  errors: Array<{ text: string; url?: string }>,
  ignore: RegExp[],
): Array<{ text: string; url?: string }> {
  if (!ignore.length) return errors;
  return errors.filter((e) => !ignore.some((re) => re.test(e.text) || (e.url ? re.test(e.url) : false)));
}

// ---------- 元素匹配 ----------

/** Page 与 FrameLocator 的公共能力（本引擎只用 locator()） */
type ScopeLike = { locator(selector: string): Locator };

function isCssSelector(s: string): boolean {
  return /^[.#\[:]/.test(s) || /^(button|input|a|table|form|main|nav|header|footer|svg|img)([.\s[#:]|$)/.test(s);
}

async function countInScope(scope: ScopeLike, expr: string): Promise<number> {
  const sel = isCssSelector(expr) ? expr : `text=${expr}`;
  return scope.locator(sel).count().catch(() => 0);
}

async function firstVisibleInScope(scope: ScopeLike, expr: string): Promise<boolean> {
  const sel = isCssSelector(expr) ? expr : `text=${expr}`;
  return scope
    .locator(sel)
    .first()
    .isVisible({ timeout: 1_500 })
    .catch(() => false);
}

async function scopeBodyText(_page: Page, scope: ScopeLike): Promise<string> {
  return scope.locator('body').innerText({ timeout: 3_000 }).catch(() => '');
}

// ---------- 单页五级检查 ----------

export async function runSmokeChecks(page: Page, opts: SmokeRunOptions): Promise<SmokePageResult> {
  const startedAt = Date.now();
  const { adapter, catalogPage, baseURL } = opts;
  const checks: SmokeCheck[] = [];
  const target = /^https?:\/\//i.test(catalogPage.route)
    ? catalogPage.route
    : new URL(catalogPage.route, baseURL).toString();

  // ① 可达 + 未回登录页
  let loginPage = false;
  try {
    await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForTimeout(1_200);
    const mainText = await page.locator('body').innerText({ timeout: 3_000 }).catch(() => '');
    loginPage = adapter.isLoginText(mainText) || /\/login(\?|$)/.test(page.url());
    if (loginPage) {
      checks.push({ key: 'reachable', label: '可达', passed: false, detail: '落地登录页（登录态失效或会话过期）' });
    } else {
      checks.push({ key: 'reachable', label: '可达', passed: true, detail: page.url() });
    }
  } catch (err) {
    checks.push({ key: 'reachable', label: '可达', passed: false, detail: `goto 失败: ${String((err as Error)?.message || err).slice(0, 200)}` });
  }

  // ② 加载完成（reachable 失败则后续跳过）
  if (loginPage || !checks[0]?.passed) {
    return finish(checks, 'failed', startedAt, [], opts, catalogPage);
  }

  let scope: ScopeLike = page;
  try {
    const waitOpts: WaitForAppRootOptions = { timeout: opts.timeoutMs ?? 45_000 };
    const root = await adapter.waitForAppRoot(page, waitOpts);
    scope = root.inIframe ? root.scope : page;

    // 加载指示器消失（best effort，超时记 suspicious）
    const loadingSelectors = adapter.uiProfile.loadingSelectors;
    const deadline = Date.now() + 12_000;
    let stillLoading = 0;
    while (Date.now() < deadline) {
      let spinning = 0;
      for (const sel of loadingSelectors) {
        spinning += await page.locator(sel).count().catch(() => 0);
        if (scope !== page) spinning += await scope.locator(sel).count().catch(() => 0);
      }
      if (!spinning) {
        stillLoading = 0;
        break;
      }
      stillLoading = spinning;
      await page.waitForTimeout(500);
    }
    checks.push({
      key: 'loaded',
      label: '加载完成',
      passed: true,
      suspicious: stillLoading > 0,
      detail: stillLoading > 0 ? `12s 后仍有 ${stillLoading} 个加载指示器（疑似慢加载）` : `inIframe=${root.inIframe}`,
    });
  } catch (err) {
    checks.push({
      key: 'loaded',
      label: '加载完成',
      passed: false,
      detail: `waitForAppRoot 失败: ${String((err as Error)?.message || err).slice(0, 200)}`,
    });
    return finish(checks, 'failed', startedAt, [], opts, catalogPage);
  }

  // ③ 关键元素 / 表格-空态兜底
  const keyElements = catalogPage.smoke.keyElements;
  const emptyPatterns = adapter.uiProfile.emptyTextPatterns;

  // 内容稳定等待（有界 8s）：等表格/空态/关键元素任一出现再判定，
  // 避免并发巡检下列表尚未渲染就被判「疑似空白页」
  const settleDeadline = Date.now() + 8_000;
  while (Date.now() < settleDeadline) {
    const bodyText = await scopeBodyText(page, scope);
    if (emptyPatterns.some((re) => re.test(bodyText))) break;
    let signal = false;
    for (const sel of adapter.uiProfile.tableSelectors) {
      if (await firstVisibleInScope(scope, sel)) {
        signal = true;
        break;
      }
    }
    if (!signal) {
      for (const el of keyElements) {
        if ((await countInScope(scope, el)) > 0) {
          signal = true;
          break;
        }
      }
    }
    if (signal) break;
    await page.waitForTimeout(600);
  }

  if (keyElements.length) {
    const hits: string[] = [];
    const missing: string[] = [];
    for (const el of keyElements) {
      const n = await countInScope(scope, el);
      (n > 0 ? hits : missing).push(el);
    }
    const threshold = Math.max(1, Math.ceil(keyElements.length * 0.5));
    checks.push({
      key: 'key-elements',
      label: '关键元素',
      passed: hits.length >= threshold,
      suspicious: hits.length < threshold,
      detail: `命中 ${hits.length}/${keyElements.length}（阈值 ${threshold}）${missing.length ? `；缺失: ${missing.slice(0, 5).join('、')}` : ''}`,
    });
  } else {
    // 无配置降级：表格可见 或 空态文案（二者其一即通过；都无 → suspicious-empty）
    const bodyText = await scopeBodyText(page, scope);
    const isEmptyState = emptyPatterns.some((re) => re.test(bodyText));
    let tableVisible = false;
    for (const sel of adapter.uiProfile.tableSelectors) {
      if (await firstVisibleInScope(scope, sel)) {
        tableVisible = true;
        break;
      }
    }
    const passed = tableVisible || isEmptyState;
    checks.push({
      key: 'key-elements',
      label: '关键元素',
      passed,
      suspicious: !passed,
      detail: passed
        ? `兜底命中: ${tableVisible ? '表格容器' : '空态文案'}（keyElements 未配置，可用 catalog:suggest-key-elements 补）`
        : '表格与空态均未命中（疑似空白页）',
    });
  }

  // ④ console 错误（由执行器挂接的 collector 在 result 外传入计数，这里只做展示位）
  //    实际判定在 run-smoke-patrol 合并 consoleErrors 时进行。

  // ⑤ 截图
  if (opts.screenshotPath) {
    try {
      fs.mkdirSync(path.dirname(opts.screenshotPath), { recursive: true });
      await page.screenshot({ path: opts.screenshotPath, fullPage: false, timeout: 10_000 });
      checks.push({ key: 'screenshot', label: '截图', passed: true, detail: opts.screenshotPath });
    } catch (err) {
      checks.push({ key: 'screenshot', label: '截图', passed: true, suspicious: true, detail: `截图失败: ${String((err as Error)?.message || err).slice(0, 120)}` });
    }
  }

  return finish(checks, null, startedAt, [], opts, catalogPage);
}

function finish(
  checks: SmokeCheck[],
  forced: SmokePageStatus | null,
  startedAt: number,
  consoleErrors: Array<{ text: string; url?: string }>,
  opts: SmokeRunOptions,
  catalogPage: CatalogPageLite,
): SmokePageResult {
  let status: SmokePageStatus;
  if (forced) {
    status = forced;
  } else if (checks.some((c) => !c.passed && !c.suspicious)) {
    status = 'failed';
  } else if (checks.some((c) => c.suspicious)) {
    status = 'suspicious';
  } else {
    status = 'passed';
  }
  void opts;
  void catalogPage;
  return {
    pageId: catalogPage.id,
    label: catalogPage.label,
    route: catalogPage.route,
    env: opts.env,
    status,
    durationMs: Date.now() - startedAt,
    checks,
    consoleErrors,
    screenshot: opts.screenshotPath || null,
    runAt: new Date().toISOString(),
  };
}
