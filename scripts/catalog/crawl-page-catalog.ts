/**
 * 页面目录爬取：自动发现全站可达页面，产出 datasource/page-catalog.json。
 *
 * 策略（三源合一）：
 *   A. 静态种子：datasource/menu_routes.json + menu_items.json（13 页底册，兜底）
 *   B. 侧栏菜单实爬：主页面 .ant-menu 展开/点击逐项记录落地路由（业务路由从 zoom iframe src 提取）
 *   C. 搜索兜底：静态种子中未实爬到的，经「菜单搜索框 fill + 点结果」补爬（搜索只过滤侧栏，不自动跳转）
 *
 * 合并规则：按 route 完全一致自动合并；同名不同 route 标 suspectDuplicateOf；
 * 旧 catalog 的人工标记（status / smoke / goldenFlowId）人工优先。
 *
 * 用法：
 *   npm run catalog:crawl -- --env=stage
 *   npm run catalog:crawl -- --env=dev --limit=5 --only=request,approve
 *   npm run catalog:crawl -- --static-only          # 只做静态种子合并，不开浏览器（CI 可用）
 */
import fs from 'fs';
import path from 'path';
import { chromium, type BrowserContext, type Page, type Response } from '@playwright/test';

function getArg(name: string, fallback = ''): string {
  const prefix = `--${name}=`;
  const hit = process.argv.slice(2).find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length).trim() : fallback;
}

function hasFlag(name: string): boolean {
  return process.argv.slice(2).includes(`--${name}`);
}

// ---------- 数据结构与静态种子 ----------

export type CatalogPage = {
  id: string;
  label: string;
  group: string;
  route: string;
  source: 'menu-crawl' | 'route-table' | 'manual';
  /** 生命周期标记（人工可改；retired 不参与 smoke 与入口解析） */
  status: 'active' | 'retired';
  /** 实爬健康度：ok=落地成功 / partial=点击但未取到新路由 / unseen=本轮未出现 / unverified=仅静态种子 */
  verify: 'ok' | 'partial' | 'unseen' | 'unverified';
  lastSeenAt: string | null;
  listApiHint?: string;
  suspectDuplicateOf?: string | null;
  smoke: {
    enabled: boolean;
    weight: 'core' | 'normal';
    keyElements: string[];
    keyElementsAiSuggested: boolean;
  };
  goldenFlowId?: string | null;
};

type CatalogFile = {
  version: number;
  app: string;
  env: string;
  crawledAt: string;
  pages: CatalogPage[];
};

type StaticSeed = { key: string; label: string; route: string };

function repoRoot(): string {
  let dir = path.resolve(process.cwd());
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, 'datasource/menu_routes.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(process.cwd());
}

function loadStaticSeeds(root: string): StaticSeed[] {
  const routes = JSON.parse(fs.readFileSync(path.join(root, 'datasource/menu_routes.json'), 'utf8')) as Record<string, string>;
  let items: Record<string, string> = {};
  const itemsPath = path.join(root, 'datasource/menu_items.json');
  if (fs.existsSync(itemsPath)) items = JSON.parse(fs.readFileSync(itemsPath, 'utf8'));
  return Object.entries(routes).map(([key, route]) => ({
    key,
    label: items[key] || key,
    route,
  }));
}

/** 三个 Golden 流程的入口默认为核心页 */
const GOLDEN_ROUTES = new Set(['/main/request', '/main/approve', '/main/expense-parent-report/expense-report']);

function readPrevCatalog(outPath: string): CatalogFile | null {
  if (!fs.existsSync(outPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(outPath, 'utf8')) as CatalogFile;
  } catch (e) {
    console.warn(`[crawl] 旧 catalog 解析失败，将整体重建：${String(e)}`);
    return null;
  }
}

// ---------- 环境与登录态（与 probe-live-page 同源） ----------

function pickEnvUrl(env: Record<string, string>): string {
  return env.baseURL || env.baseURL || '';
}

function pickStorageState(env: Record<string, string>): string | undefined {
  for (const raw of [process.env.STORAGE_STATE, process.env.STORAGE_STATE_PATH]) {
    const p = String(raw || '').trim();
    if (!p) continue;
    const abs = path.isAbsolute(p) ? p : path.resolve(p);
    if (fs.existsSync(abs)) return abs;
  }
  const p = env.storageState;
  if (!p) return undefined;
  const abs = path.isAbsolute(p) ? p : path.resolve(p);
  return fs.existsSync(abs) ? abs : undefined;
}

const LOGIN_RE = /二维码登录|账号登录|请使用.*APP扫码登录/;

async function isLoginPage(page: Page): Promise<boolean> {
  if (/\/login/i.test(page.url())) return true;
  for (const frame of page.frames()) {
    const text = await frame.evaluate(() => document.body?.innerText || '').catch(() => '');
    if (LOGIN_RE.test(text)) return true;
  }
  return false;
}

// ---------- 列表接口自动发现（形状判定，复用 probe-live-page 经验） ----------

function looksLikeListBody(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false;
  const obj = body as Record<string, unknown>;
  const nested = obj.data && typeof obj.data === 'object' ? (obj.data as Record<string, unknown>) : null;
  const arrays = [obj.rows, obj.data, obj.content, nested?.rows, nested?.content];
  const hasArray = arrays.some((a) => Array.isArray(a) && a.length > 0);
  if (!hasArray) return false;
  const totals = [obj.total, obj.totalCount, obj.totalElements, nested?.total, nested?.totalElements];
  return totals.some((t) => typeof t === 'number') || hasArray;
}

// ---------- 路由提取（业务内容在 zoom iframe 内，top URL 不变） ----------

function extractRouteFromIframeSrc(src: string): string | null {
  try {
    const u = new URL(src, 'https://x.invalid');
    const candidates = [u.hash.replace(/^#/, ''), u.pathname];
    for (const v of u.searchParams.values()) candidates.push(v);
    for (const c of candidates) {
      const clean = String(c || '').split('?')[0];
      if (/^\/main(\/|$)/.test(clean)) return clean;
    }
  } catch {
    /* ignore */
  }
  return null;
}

async function currentIframeSrc(page: Page): Promise<string | null> {
  const iframe = page.locator('iframe[src*="openBySelf=zoom"]').first();
  if (!(await iframe.count())) return null;
  return iframe.getAttribute('src').catch(() => null);
}

async function currentRoute(page: Page): Promise<string | null> {
  const src = await currentIframeSrc(page);
  if (src) {
    const fromSrc = extractRouteFromIframeSrc(src);
    if (fromSrc) return fromSrc;
  }
  // 兜底：读 iframe 内部 location
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue;
    const inner = await frame
      .evaluate(() => `${location.pathname}${location.hash}`)
      .catch(() => '');
    const clean = String(inner || '').split('?')[0].replace(/^#/, '');
    if (/^\/main(\/|$)/.test(clean)) return clean;
  }
  try {
    const u = new URL(page.url());
    const hash = u.hash.replace(/^#/, '');
    if (/^\/main(\/|$)/.test(hash)) return hash.split('?')[0];
    if (/^\/main(\/|$)/.test(u.pathname)) return u.pathname;
  } catch {
    /* ignore */
  }
  return null;
}

// ---------- 侧栏菜单采集与点击 ----------

const MENU_ITEM_SELECTOR = '.ant-menu-item, [role="menuitem"]';
const MENU_GROUP_SELECTOR = '.ant-menu-submenu-title';
const SIDEBAR_X_RATIO = 0.4; // 侧栏启发式：菜单项中心 x 落在视口左侧 40%

type MenuLeaf = { text: string; group: string };

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function collectMenuLeaves(page: Page): Promise<MenuLeaf[]> {
  return page
    .evaluate(
      ({ itemSel, groupSel, xRatio }) => {
        const vw = window.innerWidth || 1440;
        const norm = (s: string) => (s || '').replace(/\s+/g, ' ').trim();
        const visible = (el: Element) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && r.left >= 0 && r.left + r.width < vw * xRatio + 200;
        };
        // group = 最近的展开组标题文本
        const groupOf = (el: Element): string => {
          let cur: Element | null = el.parentElement;
          while (cur) {
            if (cur.classList.contains('ant-menu-submenu')) {
              const title = cur.querySelector(':scope > .ant-menu-submenu-title');
              if (title) return norm(title.textContent || '');
            }
            cur = cur.parentElement;
          }
          return '';
        };
        const leaves: Array<{ text: string; group: string }> = [];
        const seen = new Set<string>();
        for (const el of Array.from(document.querySelectorAll(`${itemSel}, ${groupSel}`))) {
          if (!visible(el)) continue;
          const isGroup = el.matches(groupSel);
          const text = norm(el.textContent || '');
          if (!text) continue;
          if (isGroup) continue; // 组标题不当叶子点
          const group = groupOf(el);
          const key = `${group}::${text}`;
          if (seen.has(key)) continue;
          seen.add(key);
          leaves.push({ text, group });
        }
        return leaves;
      },
      { itemSel: MENU_ITEM_SELECTOR, groupSel: MENU_GROUP_SELECTOR, xRatio: SIDEBAR_X_RATIO },
    )
    .catch(() => []);
}

/** 展开所有折叠组（best effort），返回是否找到侧栏菜单 */
async function expandSidebarGroups(page: Page): Promise<boolean> {
  const groups = page.locator(MENU_GROUP_SELECTOR);
  const n = await groups.count().catch(() => 0);
  if (!n) return false;
  for (let i = 0; i < Math.min(n, 40); i++) {
    const g = groups.nth(i);
    if (!(await g.isVisible().catch(() => false))) continue;
    // 仅展开折叠态（aria-expanded=false）
    const expanded = await g.getAttribute('aria-expanded').catch(() => null);
    if (expanded === 'false') {
      await g.click({ timeout: 1_500 }).catch(() => undefined);
      await page.waitForTimeout(250);
    }
  }
  return true;
}

async function findMenuSearchInput(page: Page): Promise<ReturnType<Page['locator']> | null> {
  const inputs = page.locator('input[placeholder]');
  const n = await inputs.count().catch(() => 0);
  for (let i = 0; i < Math.min(n, 30); i++) {
    const input = inputs.nth(i);
    if (!(await input.isVisible().catch(() => false))) continue;
    const ph = (await input.getAttribute('placeholder').catch(() => '')) || '';
    if (/搜索菜单|菜单搜索|请输入菜单/.test(ph)) return input;
  }
  return null;
}

async function clickMenuItemByText(page: Page, text: string): Promise<boolean> {
  const re = new RegExp(`^\\s*${escapeRe(text)}\\s*$`);
  const loc = page.locator(`${MENU_ITEM_SELECTOR}, ${MENU_GROUP_SELECTOR}`).filter({ hasText: re });
  const n = await loc.count().catch(() => 0);
  for (let i = 0; i < Math.min(n, 5); i++) {
    const cand = loc.nth(i);
    if (!(await cand.isVisible().catch(() => false))) continue;
    const box = await cand.boundingBox().catch(() => null);
    if (box && box.x > (page.viewportSize()?.width || 1440) * SIDEBAR_X_RATIO) continue;
    await cand.click({ timeout: 3_000 }).catch(() => undefined);
    return true;
  }
  return false;
}

// ---------- settle：等待落地路由稳定 ----------

async function waitForRouteSettle(page: Page, prevSrc: string | null, timeoutMs = 9_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastSrc: string | null = prevSrc;
  let stableSince = 0;
  while (Date.now() < deadline) {
    const src = await currentIframeSrc(page);
    if (src !== lastSrc) {
      lastSrc = src;
      stableSince = Date.now();
    } else if (!stableSince) {
      stableSince = Date.now();
    }
    if (Date.now() - stableSince > 1_200) break;
    await page.waitForTimeout(300);
  }
  // 渲染余量
  await page.waitForTimeout(1_000).catch(() => undefined);
}

// ---------- 爬取主流程 ----------

type CrawledEntry = {
  label: string;
  group: string;
  route: string | null;
  listApiHint?: string;
  via: 'menu-crawl' | 'menu-search';
  /** 同路由不同名时指向首条记录的 label */
  suspectOf?: string | null;
};

async function crawlAll(opts: {
  envName: string;
  baseURL: string;
  storageState?: string;
  seeds: StaticSeed[];
  limit: number;
  only: Set<string>;
}): Promise<{ crawled: CrawledEntry[]; loginRedirect: boolean; menuFound: boolean }> {
  const browser = await chromium.launch();
  const context: BrowserContext = await browser.newContext({
    baseURL: opts.baseURL,
    storageState: opts.storageState,
    locale: 'zh-CN',
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();

  const crawled: CrawledEntry[] = [];
  const seenRoutes = new Set<string>();

  // 列表接口自动发现：POST /api/ 且响应形状像列表
  let currentApis: string[] = [];
  page.on('response', (res: Response) => {
    try {
      const url = res.url();
      if (!url.includes('/api/')) return;
      if (res.request().method() !== 'POST' || res.status() !== 200) return;
      void res
        .json()
        .then((body) => {
          if (!looksLikeListBody(body)) return;
          const rel = url.replace(opts.baseURL, '').split('?')[0];
          if (!currentApis.includes(rel)) currentApis.push(rel);
        })
        .catch(() => undefined);
    } catch {
      /* ignore */
    }
  });

  // 新开页（外链菜单）：记录后关闭，不跟随
  context.on('page', (popup) => {
    void popup
      .waitForLoadState('domcontentloaded')
      .catch(() => undefined)
      .then(() => {
        const u = popup.url();
        if (u && !u.includes('/login')) {
          crawled.push({ label: '(新开页)', group: '', route: u, via: 'menu-crawl' });
        }
      })
      .catch(() => undefined)
      .finally(() => void popup.close().catch(() => undefined));
  });

  const record = (entry: CrawledEntry) => {
    if (entry.route && seenRoutes.has(entry.route)) {
      // 同路由不同名：首条为准，后续标 suspect
      const first = crawled.find((c) => c.route === entry.route);
      crawled.push({ ...entry, suspectOf: first?.label || null });
      return;
    }
    if (entry.route) seenRoutes.add(entry.route);
    crawled.push(entry);
  };

  let loginRedirect = false;
  let menuFound = false;

  try {
    await page.goto('/main/home', { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForTimeout(1_500);
    loginRedirect = await isLoginPage(page);
    if (loginRedirect) return { crawled, loginRedirect, menuFound };

    // A. 侧栏实爬：展开分组 → 逐项点击
    menuFound = await expandSidebarGroups(page);
    if (menuFound) {
      let leaves = await collectMenuLeaves(page);
      if (opts.only.size) leaves = leaves.filter((l) => matchOnly(l.text, opts.only));
      if (opts.limit) leaves = leaves.slice(0, opts.limit);
      for (const leaf of leaves) {
        const prevSrc = await currentIframeSrc(page);
        currentApis = [];
        const clicked = await clickMenuItemByText(page, leaf.text);
        if (!clicked) continue;
        await waitForRouteSettle(page, prevSrc);
        const route = await currentRoute(page);
        record({
          label: leaf.text,
          group: leaf.group,
          route,
          listApiHint: currentApis[0],
          via: 'menu-crawl',
        });
      }
    }

    // B. 搜索兜底：静态种子中未被实爬覆盖的（含 --only 命中的）
    const needSearch = opts.seeds.filter((s) => {
      if (opts.only.size && !matchOnly(s.label, opts.only) && !matchOnly(s.key, opts.only)) return false;
      return !crawled.some((c) => c.route === s.route) && !crawled.some((c) => c.label === s.label && c.route);
    });
    for (const seed of needSearch.slice(0, opts.limit || needSearch.length)) {
      const prevSrc = await currentIframeSrc(page);
      currentApis = [];
      const input = await findMenuSearchInput(page);
      let ok = false;
      if (input) {
        await input.fill(seed.label).catch(() => undefined);
        await page.waitForTimeout(600);
        ok = await clickMenuItemByText(page, seed.label);
      }
      if (ok) {
        await waitForRouteSettle(page, prevSrc);
        const route = await currentRoute(page);
        record({ label: seed.label, group: '', route, listApiHint: currentApis[0], via: 'menu-search' });
      } else {
        // 未实爬到：静态种子兜底记录
        record({ label: seed.label, group: '', route: seed.route, via: 'menu-search' });
      }
      // 清空搜索框，避免影响后续项
      const reset = await findMenuSearchInput(page);
      if (reset) await reset.fill('').catch(() => undefined);
    }
  } finally {
    await browser.close().catch(() => undefined);
  }

  return { crawled, loginRedirect, menuFound };
}

function matchOnly(text: string, only: Set<string>): boolean {
  const t = String(text || '').trim();
  if (!t) return false;
  for (const o of only) {
    if (t === o || t.includes(o) || o.includes(t)) return true;
  }
  return false;
}

// ---------- 合并与写盘 ----------

function slugFromRoute(route: string): string {
  const tail = route.replace(/^\/main\//, '').replace(/^\/+/, '');
  const slug = tail.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
  return slug || 'page';
}

function buildCatalog(opts: {
  envName: string;
  seeds: StaticSeed[];
  crawled: CrawledEntry[];
  prev: CatalogFile | null;
  loginRedirect: boolean;
  menuFound: boolean;
}): CatalogFile {
  const now = new Date().toISOString();
  const pages: CatalogPage[] = [];
  const byRoute = new Map<string, CatalogPage>();
  const prevByRoute = new Map<string, CatalogPage>();
  for (const p of opts.prev?.pages || []) prevByRoute.set(p.route, p);

  const pageIdFor = (route: string, label: string): string => {
    const prevHit = prevByRoute.get(route);
    if (prevHit?.id) return prevHit.id;
    const seed = opts.seeds.find((s) => s.route === route);
    return seed?.key || slugFromRoute(route) || slugFromRoute(label);
  };

  const pushPage = (p: CatalogPage) => {
    const exist = byRoute.get(p.route);
    if (exist) {
      // 同路由：保留首条，第二条标 suspect（同名不同 route 反向场景在 route 维度不发生）
      return;
    }
    byRoute.set(p.route, p);
    pages.push(p);
  };

  // 1) 实爬结果为主
  for (const c of opts.crawled) {
    if (!c.route) continue;
    const prev = prevByRoute.get(c.route);
    const id = pageIdFor(c.route, c.label);
    const isCore = GOLDEN_ROUTES.has(c.route) || prev?.smoke?.weight === 'core';
    pushPage({
      id,
      label: prev?.label || c.label,
      group: c.group || prev?.group || '',
      route: c.route,
      source: 'menu-crawl',
      status: prev?.status || 'active',
      verify: c.route ? 'ok' : 'partial',
      lastSeenAt: now,
      listApiHint: c.listApiHint || prev?.listApiHint,
      suspectDuplicateOf: c.suspectOf ?? null,
      smoke: {
        enabled: prev?.smoke?.enabled ?? true,
        weight: isCore ? 'core' : (prev?.smoke?.weight || 'normal'),
        keyElements: prev?.smoke?.keyElements || [],
        keyElementsAiSuggested: prev?.smoke?.keyElementsAiSuggested ?? false,
      },
      goldenFlowId: prev?.goldenFlowId ?? null,
    });
  }

  // 2) 静态种子补齐（实爬未覆盖 + 本轮未出现标记）
  for (const s of opts.seeds) {
    if (byRoute.has(s.route)) continue;
    const prev = prevByRoute.get(s.route);
    const seenThisRun = opts.crawled.some((c) => c.route === s.route);
    pushPage({
      id: pageIdFor(s.route, s.label),
      label: prev?.label || s.label,
      group: prev?.group || '',
      route: s.route,
      source: prev?.source === 'manual' ? 'manual' : 'route-table',
      status: prev?.status || 'active',
      verify: opts.loginRedirect ? (prev?.verify || 'unverified') : seenThisRun ? 'ok' : 'unseen',
      lastSeenAt: seenThisRun ? now : (prev?.lastSeenAt ?? null),
      listApiHint: prev?.listApiHint,
      suspectDuplicateOf: prev?.suspectDuplicateOf ?? null,
      smoke: {
        enabled: prev?.smoke?.enabled ?? true,
        weight: GOLDEN_ROUTES.has(s.route) ? 'core' : (prev?.smoke?.weight || 'normal'),
        keyElements: prev?.smoke?.keyElements || [],
        keyElementsAiSuggested: prev?.smoke?.keyElementsAiSuggested ?? false,
      },
      goldenFlowId: prev?.goldenFlowId ?? null,
    });
  }

  // 3) 旧 catalog 中人工维护（manual）且本轮未涉及的条目原样保留
  for (const p of opts.prev?.pages || []) {
    if (byRoute.has(p.route)) continue;
    if (p.source !== 'manual') continue;
    pushPage({ ...p });
  }

  return {
    version: 1,
    app: 'huilianyi',
    env: opts.envName,
    crawledAt: now,
    pages,
  };
}

// ---------- main ----------

async function main(): Promise<void> {
  const root = repoRoot();
  const envName = getArg('env', 'stage');
  const outRel = getArg('out', 'datasource/page-catalog.json');
  const outPath = path.isAbsolute(outRel) ? outRel : path.resolve(root, outRel);
  const limit = Number(getArg('limit', '0')) || 0;
  const onlyRaw = getArg('only', '');
  const only = new Set(onlyRaw.split(',').map((s) => s.trim()).filter(Boolean));
  const staticOnly = hasFlag('static-only');

  const seeds = loadStaticSeeds(root);
  const prev = readPrevCatalog(outPath);

  let crawled: CrawledEntry[] = [];
  let loginRedirect = false;
  let menuFound = false;

  if (!staticOnly) {
    const baseConfigPath = path.join(root, 'datasource/base-config.json');
    const baseConfig = JSON.parse(fs.readFileSync(baseConfigPath, 'utf8'));
    const env = baseConfig[envName] as Record<string, string> | undefined;
    if (!env) throw new Error(`未知环境: ${envName}（datasource/base-config.json）`);
    const baseURL = pickEnvUrl(env);
    if (!baseURL) throw new Error(`环境 ${envName} 未配置 baseURL`);
    const storageState = pickStorageState(env);

    console.log(`[crawl] env=${envName} baseURL=${baseURL} storageState=${storageState || '(无)'}`);
    const result = await crawlAll({ envName, baseURL, storageState, seeds, limit, only });
    crawled = result.crawled;
    loginRedirect = result.loginRedirect;
    menuFound = result.menuFound;

    if (loginRedirect) {
      console.error(
        '[crawl] 落在登录页，实爬中止。先跑登录（如 npm run login:force 或 ego:export-storage）生成 storageState 后重试；本次仅输出静态种子合并结果。',
      );
    } else if (!menuFound) {
      console.warn('[crawl] 未识别到侧栏菜单 DOM（.ant-menu/[role=menuitem]），实爬可能不全，请检查结果 verify 字段。');
    }
  }

  const catalog = buildCatalog({ envName, seeds, crawled, prev, loginRedirect, menuFound });

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(catalog, null, 2), 'utf8');

  const okCount = catalog.pages.filter((p) => p.verify === 'ok').length;
  console.log(
    `[crawl] 产出 ${outPath}：共 ${catalog.pages.length} 页（实爬 ok=${okCount}，静态兜底=${catalog.pages.filter((p) => p.source === 'route-table').length}）`,
  );
  for (const p of catalog.pages) {
    console.log(
      `  - ${p.id.padEnd(28)} ${String(p.label).padEnd(10)} ${p.route}  [${p.source}/${p.verify}]${p.listApiHint ? ` api=${p.listApiHint}` : ''}`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
