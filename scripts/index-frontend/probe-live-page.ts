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
import { chromium, type Page, type Response } from '@playwright/test';

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
  const p = env.storageState || env.storageState;
  return p && fs.existsSync(p) ? p : undefined;
}

function isListApi(url: string): boolean {
  return /\/api\/approvals\/(pendingApproval|approved|copiedToMe)(?:\?|$)/.test(url);
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
  const main = await page.evaluate(DOM_DUMP);
  const frames = [];
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue;
    const info = await frame.evaluate(DOM_DUMP).catch(() => null);
    if (info) frames.push(info);
  }
  return { ...main, childFrames: frames };
}

async function main(): Promise<void> {
  const envName = getArg('env', 'stage');
  const entry = getArg('entry', '/main/approve');
  const outPath = getArg(
    'out',
    entry.includes('approve') ? 'approval-flow/datasource/live-snapshot.json' : '',
  );
  const clickFirstRow = hasFlag('click-first-row') || entry.includes('approve');
  const baseConfig = JSON.parse(fs.readFileSync(path.resolve('datasource/base-config.json'), 'utf8'));
  const env = baseConfig[envName] as Record<string, string> | undefined;
  if (!env) throw new Error(`未知环境: ${envName}`);
  const baseURL = pickEnvUrl(env);
  if (!baseURL) throw new Error(`环境 ${envName} 未配置 baseURL/baseURL`);
  const storageState = pickStorageState(env);

  const browser = await chromium.launch();
  const context = await browser.newContext({
    baseURL,
    storageState,
    locale: 'zh-CN',
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  const apiCalls: string[] = [];
  const listApis: Array<{ method: string; status: number; url: string; sample: unknown[] }> = [];

  page.on('response', (res: Response) => {
    const url = res.url();
    if (!url.includes('/api/')) return;
    apiCalls.push(`${res.request().method()} ${res.status()} ${url.replace(baseURL, '')}`);
    if (isListApi(url) && res.status() === 200) {
      void res
        .json()
        .then((body) => {
          listApis.push({
            method: res.request().method(),
            status: res.status(),
            url: url.replace(baseURL, ''),
            sample: sampleRecords(body),
          });
        })
        .catch(() => undefined);
    }
  });

  await page.goto(entry, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page
    .waitForResponse((r) => isListApi(r.url()) && r.status() === 200, { timeout: 25_000 })
    .catch(() => undefined);
  await page.waitForSelector('.approve-list, .approve-request, .ant-tabs-tab', { timeout: 30_000 }).catch(() => undefined);
  await page
    .waitForSelector('.ant-table, .approve-card-list, .ant-table-tbody tr.ant-table-row', { timeout: 30_000 })
    .catch(() => undefined);
  await page.waitForTimeout(2_000);

  const listDom = (await dumpDom(page)) as { url?: string };

  let detailDom: unknown = null;
  if (clickFirstRow) {
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
      await page.waitForTimeout(2_000);
      detailDom = await dumpDom(page);
    }
  }

  const snapshot = {
    env: envName,
    entry,
    storageState: storageState || null,
    loginRedirect: /login/i.test(listDom.url || ''),
    list: listDom,
    detail: detailDom,
    listApis,
    apiCalls: Array.from(new Set(apiCalls)).slice(0, 50),
    capturedAt: new Date().toISOString(),
  };

  console.log(JSON.stringify(snapshot, null, 2));
  if (outPath) {
    const abs = path.resolve(outPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, JSON.stringify(snapshot, null, 2), 'utf8');
    console.log(`\n--- wrote ${abs} ---`);
  }
  await browser.close();
}

main();
