#!/usr/bin/env tsx
/**
 * 打包可分享的客户报告目录（HTML + 截图 + diff 图）。
 * 输出: public-reports/customer-report/
 */
import fs from 'fs';
import path from 'path';

const root = process.cwd();
const srcHtml = path.join(root, 'results', 'ui-regression-customer.html');
const outDir = path.join(root, 'public-reports', 'customer-report');

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

function rewriteHtmlPaths(html: string): string {
  return html
    .replace(/src="\.\.\/screenshots\//g, 'src="../screenshots/')
    .replace(/src='\.\.\/screenshots\//g, "src='../screenshots/")
    .replace(/src="diffs\//g, 'src="../diffs/')
    .replace(/src='diffs\//g, "src='../diffs/");
}

function main(): void {
  if (!fs.existsSync(srcHtml)) {
    console.error(`客户报告不存在，请先执行 npm run report:customer: ${srcHtml}`);
    process.exit(1);
  }

  if (fs.existsSync(outDir)) fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  const html = rewriteHtmlPaths(fs.readFileSync(srcHtml, 'utf-8'));
  fs.writeFileSync(path.join(outDir, 'index.html'), html, 'utf-8');

  const screenshots = path.join(root, 'screenshots');
  if (fs.existsSync(screenshots)) {
    copyDir(screenshots, path.join(outDir, '..', 'screenshots'));
  }
  const diffs = path.join(root, 'results', 'diffs');
  if (fs.existsSync(diffs)) {
    copyDir(diffs, path.join(outDir, '..', 'diffs'));
  }

  console.log(`客户报告已打包: ${outDir}/index.html`);
  console.log('归档时请保留 public-reports/ 整个目录（含 screenshots 与 diffs）');
}

main();
