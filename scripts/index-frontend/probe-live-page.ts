/**
 * 实机探查指定路由：把页签文案、表头、表格容器类名、实际请求的接口打出来，
 * 用于校准 ui-contract 里的锚点 / 接口是否与真实 DOM 一致。
 *
 * 静态索引会有两类偏差，只能靠实机发现：
 *   1. 运行时拼接（页签文案会追加计数 " (1)"，exact 匹配必然失败）
 *   2. 命名近似但语义不同的接口（/api/approvals/pending 是暂挂，不是待审批列表）
 *
 * 用法：
 *   npx tsx scripts/index-frontend/probe-live-page.ts --env=dev --entry=/main/approve
 *   npx tsx scripts/index-frontend/probe-live-page.ts --env=dev --entry=/main/approve --out=approval-flow/datasource/live-snapshot.json
 */
import fs from 'fs';
import path from 'path';
import { chromium, type BrowserContext, type Page, type Response } from '@playwright/test';

function getArg(name: string, fallback = ''): string {
  const prefix = `--${name}=`;
  const hit = process.argv.slice(2).find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
}

function hasFlag(name: string): boolean {
  return process.argv.slice(2).includes(`--${name}`);
}

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

function isClosedError(err: unknown): boolean {
  const msg = String((err as Error)?.message || err);
  return /has been closed|Target closed|browser has been closed/i.test(msg);
}

let shuttingDown = false;

async function safeWait(page: Page, ms: number): Promise<void> {
  if (shuttingDown) return;
  try {
    await page.waitForTimeout(ms);
  } catch (err) {
    if (shuttingDown || isClosedError(err)) return;
    throw err;
  }
}

/**
 * 已知的列表接口（两个既有流程）。新流程不必来改这里：
 * 传 --list-api=<正则> 显式指定，或依赖 looksLikeListBody() 自动发现。
 */
const KNOWN_LIST_API_RE =
  /\/api\/approvals\/(pendingApproval|approved|copiedToMe)(?:\?|$)|\/api\/applications\/(?:v4\/)?search(?:\?|$)|\/api\/expense\/queryPage(?:\?|$)/;

/** --list-api=<正则> 覆盖 */
function customListApiRe(): RegExp | null {
  const raw = getArg('list-api', '').trim();
  if (!raw) return null;
  try {
    return new RegExp(raw);
  } catch {
    console.warn(`[probe] --list-api 不是合法正则，已忽略：${raw}`);
    return null;
  }
}

const CUSTOM_LIST_API_RE = customListApiRe();

function isListApi(url: string): boolean {
  if (CUSTOM_LIST_API_RE) return CUSTOM_LIST_API_RE.test(url);
  return KNOWN_LIST_API_RE.test(url);
}

/**
 * 自动发现列表接口：POST /api/... 且响应体里带「数组 + 分页总数」形状。
 * 用于新流程首次探活——此时既没人知道接口名，也来不及先写正则。
 */
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

function sampleRecords(body: unknown): unknown[] {
  if (!body || typeof body !== 'object') return [];
  const obj = body as Record<string, unknown>;
  const nested = obj.data && typeof obj.data === 'object' ? (obj.data as Record<string, unknown>) : null;
  const rows =
    (Array.isArray(obj.rows) && obj.rows) ||
    (Array.isArray(obj.data) && obj.data) ||
    (nested && Array.isArray(nested.rows) && nested.rows) ||
    (Array.isArray(obj.content) && obj.content) ||
    (Array.isArray(body) ? (body as unknown[]) : []);
  return rows.slice(0, 8).map((row) => {
    if (!row || typeof row !== 'object') return row;
    const r = row as Record<string, unknown>;
    return {
      businessCode: r.businessCode ?? r.businessCode ?? r.documentNumber,
      applicantName: r.applicantName ?? r.applicantName,
      entityOID: r.entityOID,
      entityType: r.entityType,
      formName: r.formName ?? r.formName,
      amount: r.baseCurrencyAmount ?? r.amount,
      keys: Object.keys(r).slice(0, 20),
    };
  });
}

const DOM_DUMP = `(() => {
  var pick = function (list, limit) {
    return Array.prototype.slice.call(list).map(function (el) {
      return (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 80);
    }).filter(Boolean).slice(0, limit || 40);
  };
  var firstRow = document.querySelector('.ant-table-tbody tr.ant-table-row');
  var searchInputs = Array.prototype.slice.call(document.querySelectorAll('input')).map(function (el) {
    return {
      placeholder: el.getAttribute('placeholder') || '',
      className: String(el.className || '').slice(0, 80),
      visible: !!(el.offsetWidth || el.offsetHeight)
    };
  }).filter(function (x) { return x.visible && (x.placeholder || /search/i.test(x.className)); }).slice(0, 8);
  var rowBtns = firstRow ? pick(firstRow.querySelectorAll('a, button, span'), 12) : [];
  return {
    url: location.href,
    title: document.title,
    iframeCount: document.querySelectorAll('iframe').length,
    tabs: pick(document.querySelectorAll('.ant-tabs-tab')),
    radios: pick(document.querySelectorAll('.ant-radio-button-wrapper, .ant-radio-wrapper')),
    headers: pick(document.querySelectorAll('.ant-table-thead th')),
    tbodyRows: document.querySelectorAll('.ant-table-tbody tr.ant-table-row').length,
    hasAntTable: !!document.querySelector('.ant-table'),
    searchInputs: searchInputs,
    firstRowText: firstRow ? (firstRow.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 200) : '',
    firstRowButtons: rowBtns,
    hasApproveEntrance: !!document.querySelector('.approve-entrance'),
    hasFullScreen: !!document.querySelector('.full-screen, .helios-full-screen'),
    hasModal: !!document.querySelector('.ant-modal:not(.ant-modal-hidden)'),
    detailButtons: pick(document.querySelectorAll('.approve-entrance button, .approve-bar button, .ant-modal button'), 20),
    hasCommentTextarea: !!document.querySelector('.approve-entrance textarea, .approve-bar textarea'),
    hasApproveList: !!document.querySelector('.approve-list, .approve-request'),
    hasCardList: !!document.querySelector('.approve-card-list'),
    bodyChildCount: document.body ? document.body.children.length : 0,
    htmlLength: (document.body && document.body.innerHTML || '').length,
    iframeSrcs: Array.prototype.slice.call(document.querySelectorAll('iframe')).map(function (el) {
      return el.getAttribute('src') || '';
    }).slice(0, 5),
    tableClasses: Array.prototype.slice.call(document.querySelectorAll('[class*="table"]')).slice(0, 15).map(function (el) {
      return String(el.className).slice(0, 90);
    }),
    bodySnippet: (document.body.innerText || '').replace(/\\n{2,}/g, '\\n').slice(0, 1500)
  };
})()`;

async function dumpDom(page: Page) {
  const main = (await page.evaluate(DOM_DUMP)) as Record<string, unknown>;
  const frames: unknown[] = [];
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue;
    const info = await frame.evaluate(DOM_DUMP).catch(() => null);
    if (info) frames.push(info);
  }
  return { ...main, childFrames: frames };
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

async function waitForListReady(page: Page): Promise<void> {
  await Promise.all([
    page
      .waitForResponse((r) => isListApi(r.url()) && r.status() === 200, { timeout: 12_000 })
      .catch(() => undefined),
    page
      .waitForSelector('.approve-list, .approve-request, .application-list, .ant-tabs-tab', { timeout: 12_000 })
      .catch(() => undefined),
    page
      .waitForSelector('.ant-table, .approve-card-list, .ant-table-tbody tr.ant-table-row', { timeout: 12_000 })
      .catch(() => undefined),
  ]);
  await safeWait(page, 800);
}

/** 报销等列表默认不自动查数，空表时点「搜索」触发列表接口 */
async function maybeTriggerListSearch(page: Page): Promise<void> {
  const inZoom = await page.locator('iframe[src*="openBySelf=zoom"]').count();
  const root = inZoom ? page.frameLocator('iframe[src*="openBySelf=zoom"]') : page;
  const rows = await root.locator('.ant-table-tbody tr.ant-table-row').count().catch(() => 0);
  if (rows > 0) return;
  const searchBtn = root.getByRole('button', { name: /搜\s*索|查\s*询/ }).first();
  if (!(await searchBtn.isVisible({ timeout: 2_000 }).catch(() => false))) return;
  const respP = page
    .waitForResponse((r) => r.request().method() === 'POST' && r.url().includes('/api/') && r.status() === 200, {
      timeout: 15_000,
    })
    .catch(() => undefined);
  await searchBtn.click();
  await respP;
  await safeWait(page, 1_500);
}

async function main(): Promise<void> {
  const envName = getArg('env', 'stage');
  const entry = getArg('entry', '/main/approve');
  const outPath = getArg(
    'out',
    entry.includes('approve')
      ? 'approval-flow/datasource/live-snapshot.json'
      : entry.includes('request')
        ? 'request-flow/datasource/live-snapshot.json'
        : '',
  );
  const clickFirstRow = hasFlag('click-first-row') || entry.includes('approve');
  const baseConfig = JSON.parse(fs.readFileSync(path.resolve('datasource/base-config.json'), 'utf8'));
  const env = baseConfig[envName] as Record<string, string> | undefined;
  if (!env) throw new Error(`未知环境: ${envName}`);
  const baseURL = pickEnvUrl(env);
  if (!baseURL) throw new Error(`环境 ${envName} 未配置 baseURL/baseURL`);
  const storageState = pickStorageState(env);

  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
  let context: BrowserContext | null = null;
  let page: Page | null = null;
  const shutdown = async (code = 130) => {
    shuttingDown = true;
    try {
      await page?.close().catch(() => undefined);
      await context?.close().catch(() => undefined);
      await browser?.close();
    } catch {
      /* ignore */
    }
    process.exit(code);
  };
  process.once('SIGTERM', () => {
    shuttingDown = true;
    void shutdown(130);
  });
  process.once('SIGINT', () => {
    shuttingDown = true;
    void shutdown(130);
  });

  browser = await chromium.launch();
  context = await browser.newContext({
    baseURL,
    storageState,
    locale: 'zh-CN',
    viewport: { width: 1440, height: 900 },
  });
  page = await context.newPage();
  const apiCalls: string[] = [];
  const listApis: Array<{ method: string; status: number; url: string; sample: unknown[] }> = [];
  /** 形状像列表接口但没被 isListApi 命中的 POST 接口——新流程靠它发现接口名 */
  const listApiCandidates: Array<{ method: string; url: string; rows: number }> = [];

  page.on('response', (res: Response) => {
    const url = res.url();
    if (!url.includes('/api/')) return;
    const method = res.request().method();
    apiCalls.push(`${method} ${res.status()} ${url.replace(baseURL, '')}`);
    if (isListApi(url) && res.status() === 200) {
      void res
        .json()
        .then((body) => {
          listApis.push({
            method,
            status: res.status(),
            url: url.replace(baseURL, ''),
            sample: sampleRecords(body),
          });
        })
        .catch(() => undefined);
      return;
    }
    // 自动发现：POST 且响应体像列表
    if (method !== 'POST' || res.status() !== 200) return;
    void res
      .json()
      .then((body) => {
        if (!looksLikeListBody(body)) return;
        const rows = sampleRecords(body).length;
        const rel = url.replace(baseURL, '').split('?')[0];
        if (listApiCandidates.some((c) => c.url === rel)) return;
        listApiCandidates.push({ method, url: rel, rows });
      })
      .catch(() => undefined);
  });

  await page.goto(entry, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await safeWait(page, 800);
  const onLogin = await isLoginPage(page);
  if (!onLogin) {
    await waitForListReady(page);
    await maybeTriggerListSearch(page);
  }

  const listDom = (await dumpDom(page)) as { url?: string };

  let detailDom: unknown = null;
  if (clickFirstRow && !onLogin) {
    const frame = page.frameLocator('iframe[src*="openBySelf=zoom"]');
    const inZoom = await page.locator('iframe[src*="openBySelf=zoom"]').count();
    const root = inZoom ? frame : page;
    const row = root
      .locator('.ant-table-tbody tr.ant-table-row, .approve-card-list .detail-card, .approve-card-list .item-wrap')
      .first();
    if (await row.isVisible({ timeout: 8_000 }).catch(() => false)) {
      await row.click();
      await root
        .locator('.approve-entrance, .full-screen, .helios-full-screen, .ant-modal:not(.ant-modal-hidden)')
        .first()
        .waitFor({ timeout: 15_000 })
        .catch(() => undefined);
      await safeWait(page, 2_000);
      detailDom = await dumpDom(page);
    }
  }

  const snapshot = {
    env: envName,
    entry,
    storageState: storageState || null,
    loginRedirect: onLogin || /login/i.test(listDom.url || ''),
    list: listDom,
    detail: detailDom,
    listApis,
    listApiCandidates,
    apiCalls: Array.from(new Set(apiCalls)).slice(0, 50),
    capturedAt: new Date().toISOString(),
  };

  if (snapshot.loginRedirect) {
    console.warn(
      '[probe] 落在登录页，快照内容为空。先跑登录（如 npm run login:dev）生成 storageState，再重新探活。',
    );
  } else if (!listApis.length && listApiCandidates.length) {
    console.warn(
      `[probe] 未命中已知列表接口，但发现 ${listApiCandidates.length} 个候选：\n` +
        listApiCandidates.map((c) => `    ${c.method} ${c.url}  (rows≈${c.rows})`).join('\n') +
        `\n  确认后可用 --list-api=<正则> 重探，或直接填进 catalog 的 LIST_API。`,
    );
  }

  if (outPath) {
    const abs = path.resolve(outPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, JSON.stringify(snapshot, null, 2), 'utf8');
  } else {
    console.log(JSON.stringify(snapshot, null, 2));
  }
  await browser.close();
}

main().catch((err) => {
  if (shuttingDown || isClosedError(err)) {
    process.exit(130);
  }
  console.error(err);
  process.exit(1);
});
