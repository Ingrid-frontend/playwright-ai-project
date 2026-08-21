/**
 * 契约体检：拿 ui-contract.json 里的结论去真实页面核对。
 *
 * 源码是高置信提示，不是唯一真相 —— 运行时环境（网关、壳、灰度）
 * 仍可能与源码不一致，所以生成脚本前先验一次。
 *
 * 用法：npx tsx scripts/index-frontend/verify-contract.ts --env=stage --route=/main/approve
 */
import fs from 'fs';
import path from 'path';
import { chromium } from '@playwright/test';
import type { UiContract } from './build-ui-contract.js';

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const arg of argv) {
    const m = arg.match(/^--([^=]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const envName = args.env || 'stage';
  const routeUrl = args.route || '/main/approve';

  const contract: UiContract = JSON.parse(
    fs.readFileSync(path.resolve('datasource/ui-contract.json'), 'utf8'),
  );
  const baseConfig = JSON.parse(fs.readFileSync(path.resolve('datasource/base-config.json'), 'utf8'));
  const envConfig = baseConfig[envName];
  if (!envConfig) throw new Error(`未知环境: ${envName}`);

  const route = contract.routes.find((r) => r.url === routeUrl);
  if (!route) throw new Error(`契约里没有该路由: ${routeUrl}`);

  const browser = await chromium.launch();
  const context = await browser.newContext({
    baseURL: envConfig.baseURL,
    storageState: fs.existsSync(envConfig.storageState) ? envConfig.storageState : undefined,
  });
  const page = await context.newPage();

  const report: Record<string, unknown> = { env: envName, route: routeUrl };

  try {
    await page.goto(routeUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForTimeout(6000);

    report.finalUrl = page.url();
    report.loginRedirect = /login/i.test(page.url());

    // 核心验证：页面实际的 iframe 数量与主内容是否在 iframe 内
    const iframeCount = await page.locator('iframe').count();
    report.iframeCount = iframeCount;
    report.contractSaysInIframe = route.inIframe;

    // 抽样验证锚点：在主 document 与各 iframe 内分别找
    const sample = route.anchors.slice(0, 12);
    const anchorResults: Array<{ key: string; text: string; onPage: number; inFrames: number }> = [];
    for (const anchor of sample) {
      const onPage = await page
        .getByText(anchor.matchText, { exact: !anchor.dynamic })
        .filter({ visible: true })
        .count()
        .catch(() => 0);
      let inFrames = 0;
      for (const frame of page.frames().slice(1)) {
        inFrames += await frame
          .getByText(anchor.matchText, { exact: !anchor.dynamic })
          .count()
          .catch(() => 0);
      }
      anchorResults.push({ key: anchor.i18nKey, text: anchor.matchText, onPage, inFrames });
    }
    report.anchors = anchorResults;
    report.anchorsHitOnPage = anchorResults.filter((a) => a.onPage > 0).length;
    report.anchorsHitInFrames = anchorResults.filter((a) => a.onPage === 0 && a.inFrames > 0).length;
  } catch (err) {
    report.error = String(err).slice(0, 300);
  } finally {
    console.log(JSON.stringify(report, null, 2));
    await browser.close();
  }
}

main();
