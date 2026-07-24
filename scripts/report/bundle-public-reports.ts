#!/usr/bin/env tsx
/**
 * 打包可分享的静态报告目录（Playwright HTML + UI 回归 HTML）
 * 输出: public-reports/
 */
import fs from 'fs';
import path from 'path';
import { writeQualityDashboard } from './generate-quality-dashboard.js';

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

function main(): void {
  if (fs.existsSync(outDir)) fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  const hasPw = fs.existsSync(pwReport);
  const hasUi = fs.existsSync(uiHtml);

  if (hasPw) copyDir(pwReport, path.join(outDir, 'playwright-report'));
  if (hasUi) {
    fs.mkdirSync(path.join(outDir, 'ui-regression'), { recursive: true });
    fs.copyFileSync(uiHtml, path.join(outDir, 'ui-regression', 'index.html'));
    if (fs.existsSync(uiIssues)) {
      fs.copyFileSync(uiIssues, path.join(outDir, 'ui-regression', 'ui-issues.json'));
    }
  }

  const dashboardPath = writeQualityDashboard(path.join(outDir, 'dashboard', 'index.html'));
  const hasDashboard = fs.existsSync(dashboardPath);

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
  </style>
</head>
<body>
  <h1>Playwright 测试报告</h1>
  <p>Headless 执行产物，可在浏览器直接查看（无需安装 Playwright）。</p>
  ${hasDashboard ? `<a href="${dashboardLink}">UI 质量仪表盘（趋势 / 脚本排行 / 路由分布）</a>` : ''}
  ${hasPw ? `<a href="${pwLink}">Playwright HTML 报告（用例步骤 / 失败截图 / trace）</a>` : '<p>暂无 Playwright HTML 报告</p>'}
  ${hasUi ? `<a href="${uiLink}">UI 截图对比报告</a>` : '<p>暂无 UI 回归报告（需先 compare-screenshots）</p>'}
  <p class="warn">UI 对比报告中的截图路径依赖 CI Artifact「screenshots」，离线打开可能缺图；Playwright 报告自包含失败附件。</p>
  <p class="meta">生成时间：${ts}${runId ? `<br/>GitHub Run：${repo}/actions/runs/${runId}` : ''}</p>
</body>
</html>`;

  fs.writeFileSync(path.join(outDir, 'index.html'), indexHtml, 'utf-8');

  console.log(`✅ 已打包: ${path.relative(root, outDir)}/`);
  if (hasPw) console.log('  - playwright-report/');
  if (hasUi) console.log('  - ui-regression/index.html');
  if (hasDashboard) console.log('  - dashboard/index.html');
  console.log('  - index.html（入口页）');
}

main();
