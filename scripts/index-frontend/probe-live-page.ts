/**
 * 实机探查指定路由：把页签文案、表头、表格容器类名、实际请求的接口打出来，
 * 用于校准 ui-contract 里的锚点 / 接口是否与真实 DOM 一致。
 *
 * 静态索引会有两类偏差，只能靠实机发现：
 *   1. 运行时拼接（页签文案会追加计数 " (1)"，exact 匹配必然失败）
 *   2. 命名近似但语义不同的接口（/api/approvals/pending 是暂挂，不是待审批列表）
 *
 * 用法：
 *   npx tsx scripts/index-frontend/probe-live-page.ts --env=stage --entry=/main/approve
 */
import fs from 'fs';
import path from 'path';
import { chromium } from '@playwright/test';

function getArg(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  const hit = process.argv.slice(2).find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
}

async function main(): Promise<void> {
  const envName = getArg('env', 'stage');
  const entry = getArg('entry', '/main/approve');
  const baseConfig = JSON.parse(fs.readFileSync(path.resolve('datasource/base-config.json'), 'utf8'));
  const env = baseConfig[envName];
  if (!env) throw new Error(`未知环境: ${envName}`);
  const browser = await chromium.launch();
  const context = await browser.newContext({
    baseURL: env.baseURL,
    storageState: fs.existsSync(env.storageState) ? env.storageState : undefined,
  });
  const page = await context.newPage();
  const apiCalls: string[] = [];
  page.on('response', (res) => {
    const url = res.url();
    if (url.includes('/api/')) apiCalls.push(`${res.request().method()} ${res.status()} ${url.replace(env.baseURL, '')}`);
  });

  await page.goto(entry, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(12_000);

  // 注意：tsx 转译会给箭头函数注入 __name 助手，导致 evaluate 内报 ReferenceError，
  // 因此这里用字符串形式的 evaluate，不带任何本地函数声明。
  const info = await page.evaluate(`(() => {
    var pick = function (list, limit) {
      return Array.prototype.slice.call(list).map(function (el) {
        return (el.textContent || '').trim().slice(0, 60);
      }).slice(0, limit || 40);
    };
    return {
      url: location.href,
      title: document.title,
      iframeCount: document.querySelectorAll('iframe').length,
      tabs: pick(document.querySelectorAll('.ant-tabs-tab')),
      radios: pick(document.querySelectorAll('.ant-radio-button-wrapper, .ant-radio-wrapper')),
      headers: pick(document.querySelectorAll('.ant-table-thead th')),
      tbodyRows: document.querySelectorAll('.ant-table-tbody tr').length,
      hasAntTable: !!document.querySelector('.ant-table'),
      tableClasses: Array.prototype.slice.call(document.querySelectorAll('[class*="table"]')).slice(0, 25).map(function (el) {
        return String(el.className).slice(0, 90);
      }),
      bodySnippet: (document.body.innerText || '').replace(/\\n{2,}/g, '\\n').slice(0, 1200)
    };
  })()`);

  console.log(JSON.stringify(info, null, 2));
  console.log('--- api calls ---');
  console.log(Array.from(new Set(apiCalls)).slice(0, 40).join('\n'));
  await browser.close();
}

main();
