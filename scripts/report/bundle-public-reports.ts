#!/usr/bin/env tsx
/**
 * 打包可分享的静态报告目录（Playwright HTML + UI 回归 HTML + 可选单环境客户报告）
 * 输出: public-reports/
 *
 * 客户报告必须带 --env=<环境>，打包到 public-reports/customer-report/（图片改写到 assets/）。
 */
import fs from 'fs';
import path from 'path';
import { writeQualityDashboard } from './generate-quality-dashboard.js';
import { friendlyEnvLabel } from './customer-report-naming.js';
import {
  assertSafeEnvId,
  customerDeliveryJsonRel,
  customerReportHtmlRel,
  formatListEnvsText,
  knownCustomerEnvIds,
  listAvailableCustomerEnvs,
  parseCustomerEnvArgs,
  rewriteCustomerHtmlAssets,
} from './customer-report-env.js';

const root = process.cwd();
const outDir = path.join(root, 'public-reports');
const pwReport = path.join(root, 'playwright-report');
const uiHtml = path.join(root, 'results', 'screenshot-comparison.html');
const uiIssues = path.join(root, 'results', 'ui-issues.json');

function copyDir(src: string, dest: string): void {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, ent.name);
    const to = path.join(dest, ent.name);
    if (ent.isDirectory()) copyDir(from, to);
    else fs.copyFileSync(from, to);
  }
}

function copyFile(src: string, dest: string): void {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

/** ui-regression 报告从 results/ 迁到 public-reports/ui-regression/ 时修正 diff 相对路径 */
function rewriteUiReportHtml(html: string): string {
  return html
    .replace(/src="diffs\//g, 'src="../diffs/')
    .replace(/src='diffs\//g, "src='../diffs/")
    .replace(/openModal\('diffs\//g, "openModal('../diffs/");
}

function bundleHelpText(): string {
  return `用法:
  npm run report:bundle -- --env=<环境>
  npm run report:bundle -- --list-envs

选项:
  --env=<环境>     打包该环境的客户报告到 public-reports/customer-report/
  --list-envs      列出可用环境
  --help           显示本说明

说明:
  不传 --env 时仍打包 Playwright / 工程 UI 对比报告，但不会打包客户报告
  （避免把历史混环境 ui-regression-customer.html 当默认交付物）。
`;
}

function packageCustomerReport(envId: string): { ok: true; assetCount: number } {
  const htmlRel = customerReportHtmlRel(envId);
  const htmlAbs = path.resolve(root, htmlRel);
  if (!fs.existsSync(htmlAbs)) {
    throw new Error(
      [
        `未找到客户报告: ${htmlRel.replaceAll(path.sep, '/')}`,
        `请先执行: npm run report:customer -- --env=${envId}`,
        '不要使用无后缀的 results/ui-regression-customer.html（那是历史混环境产物）。',
      ].join('\n'),
    );
  }

  const destDir = path.join(outDir, 'customer-report');
  fs.mkdirSync(destDir, { recursive: true });

  const originalHtml = fs.readFileSync(htmlAbs, 'utf-8');
  const { html, keys } = rewriteCustomerHtmlAssets({
    html: originalHtml,
    htmlAbs,
    repoRoot: root,
    destDir,
  });
  fs.writeFileSync(path.join(destDir, 'index.html'), html, 'utf-8');

  const deliverySrc = path.resolve(root, customerDeliveryJsonRel(envId));
  if (fs.existsSync(deliverySrc)) {
    copyFile(deliverySrc, path.join(destDir, path.basename(deliverySrc)));
  }

  const copied = keys.filter((k) => k.copied);
  const reportKeys = {
    env: envId,
    envLabel: friendlyEnvLabel(envId),
    sourceHtml: htmlRel.replaceAll(path.sep, '/'),
    html: 'index.html',
    assetsDir: 'assets',
    assetCount: copied.length,
    keys: copied.map((k) => ({ original: k.original, bundled: k.bundled })),
  };
  fs.writeFileSync(
    path.join(destDir, 'report-keys.json'),
    JSON.stringify(reportKeys, null, 2),
    'utf-8',
  );

  return { ok: true, assetCount: copied.length };
}

function main(): void {
  const args = parseCustomerEnvArgs(process.argv.slice(2));
  if (args.help) {
    console.log(bundleHelpText());
    return;
  }
  if (args.listEnvs) {
    console.log(formatListEnvsText(listAvailableCustomerEnvs(), knownCustomerEnvIds()));
    return;
  }

  let envId: string | undefined;
  if (args.env) {
    envId = assertSafeEnvId(args.env);
    const htmlAbs = path.resolve(root, customerReportHtmlRel(envId));
    if (!fs.existsSync(htmlAbs)) {
      throw new Error(
        [
          `未找到客户报告: ${customerReportHtmlRel(envId).replaceAll(path.sep, '/')}`,
          `请先执行: npm run report:customer -- --env=${envId}`,
          '不要使用无后缀的 results/ui-regression-customer.html（那是历史混环境产物）。',
        ].join('\n'),
      );
    }
  }

  if (fs.existsSync(outDir)) fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  const hasPw = fs.existsSync(pwReport);
  const hasUi = fs.existsSync(uiHtml);

  if (hasPw) copyDir(pwReport, path.join(outDir, 'playwright-report'));
  if (hasUi) {
    fs.mkdirSync(path.join(outDir, 'ui-regression'), { recursive: true });
    const bundledHtml = rewriteUiReportHtml(fs.readFileSync(uiHtml, 'utf-8'));
    fs.writeFileSync(path.join(outDir, 'ui-regression', 'index.html'), bundledHtml, 'utf-8');
    if (fs.existsSync(uiIssues)) {
      fs.copyFileSync(uiIssues, path.join(outDir, 'ui-regression', 'ui-issues.json'));
    }
  }

  const hasScreenshots = fs.existsSync(path.join(root, 'screenshots'));
  if (hasScreenshots) {
    copyDir(path.join(root, 'screenshots'), path.join(outDir, 'screenshots'));
  }
  const diffsDir = path.join(root, 'results', 'diffs');
  if (fs.existsSync(diffsDir)) {
    copyDir(diffsDir, path.join(outDir, 'diffs'));
  }

  const dashboardPath = writeQualityDashboard(path.join(outDir, 'dashboard', 'index.html'));
  const hasDashboard = fs.existsSync(dashboardPath);

  let hasCustomer = false;
  let customerAssetCount = 0;
  if (envId) {
    const packed = packageCustomerReport(envId);
    hasCustomer = true;
    customerAssetCount = packed.assetCount;
  }

  const ts = new Date().toISOString();
  const runId = process.env.GITHUB_RUN_ID || '';
  const repo = process.env.GITHUB_REPOSITORY || '';
  const pagesBase = process.env.PUBLIC_REPORT_URL?.replace(/\/$/, '') || '';

  const pwLink = hasPw
    ? pagesBase
      ? `${pagesBase}/playwright-report/index.html`
      : './playwright-report/index.html'
    : '';
  const uiLink = hasUi
    ? pagesBase
      ? `${pagesBase}/ui-regression/index.html`
      : './ui-regression/index.html'
    : '';
  const dashboardLink = hasDashboard
    ? pagesBase
      ? `${pagesBase}/dashboard/index.html`
      : './dashboard/index.html'
    : '';
  const customerLink = hasCustomer
    ? pagesBase
      ? `${pagesBase}/customer-report/index.html`
      : './customer-report/index.html'
    : '';
  const customerLabel = envId ? `客户版 UI 衰退报告（${friendlyEnvLabel(envId)}）` : '';

  const indexHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Playwright 测试报告</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 720px; margin: 48px auto; padding: 0 16px; }
    h1 { font-size: 1.5rem; }
    a { display: block; margin: 12px 0; padding: 12px 16px; border: 1px solid #ddd; border-radius: 8px; text-decoration: none; color: #1677ff; }
    a:hover { background: #f5f5f5; }
    .meta { color: #666; font-size: 14px; margin-top: 24px; }
    .warn { color: #ad6800; font-size: 13px; }
    .warn.ok { color: #389e0d; }
  </style>
</head>
<body>
  <h1>Playwright 测试报告</h1>
  <p>Headless 执行产物，可在浏览器直接查看（无需安装 Playwright）。</p>
  ${hasDashboard ? `<a href="${dashboardLink}">UI 质量仪表盘（趋势 / 脚本排行 / 路由分布）</a>` : ''}
  ${hasPw ? `<a href="${pwLink}">Playwright HTML 报告（用例步骤 / 失败截图 / trace）</a>` : '<p>暂无 Playwright HTML 报告</p>'}
  ${hasUi ? `<a href="${uiLink}">UI 截图对比报告</a>` : '<p>暂无 UI 回归报告（需先 compare-screenshots）</p>'}
  ${hasCustomer ? `<a href="${customerLink}">${customerLabel}</a>` : ''}
  ${hasUi && hasScreenshots ? '<p class="warn ok">已打包步骤截图与 diff 图，UI 对比报告可离线查看。</p>' : hasUi ? '<p class="warn">UI 对比报告中的截图路径依赖 CI Artifact「screenshots」，离线打开可能缺图；Playwright 报告自包含失败附件。</p>' : ''}
  ${hasCustomer ? '<p class="warn ok">客户报告图片已复制到 customer-report/assets/，可离线打开。</p>' : ''}
  <p class="meta">生成时间：${ts}${runId ? `<br/>GitHub Run：${repo}/actions/runs/${runId}` : ''}${envId ? `<br/>客户报告环境：${friendlyEnvLabel(envId)}（${envId}）` : ''}</p>
</body>
</html>`;

  fs.writeFileSync(path.join(outDir, 'index.html'), indexHtml, 'utf-8');

  console.log(`✅ 已打包: ${path.relative(root, outDir)}/`);
  if (hasPw) console.log('  - playwright-report/');
  if (hasUi) console.log('  - ui-regression/index.html');
  if (hasScreenshots) console.log('  - screenshots/（UI 报告配图）');
  if (fs.existsSync(diffsDir)) console.log('  - diffs/（像素 diff 图）');
  if (hasDashboard) console.log('  - dashboard/index.html');
  if (hasCustomer) {
    console.log(`  - customer-report/index.html（${friendlyEnvLabel(envId!)}，${customerAssetCount} 张配图）`);
    console.log('  - customer-report/report-keys.json');
  } else {
    console.log('  （未指定 --env，已跳过客户报告打包，避免混环境默认 HTML）');
    console.log('  客户报告请使用: npm run report:bundle -- --env=<环境>');
  }
  console.log('  - index.html（入口页）');
}

try {
  main();
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
