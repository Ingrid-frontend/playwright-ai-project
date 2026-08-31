#!/usr/bin/env tsx
/**
 * 导出客户报告一页 PDF 摘要。
 * 用法: npm run report:customer:pdf
 * 前置: npm run report:customer
 */
import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';
import {
  readCustomerReportSummary,
  renderCustomerSummaryPrintHtml,
} from './customer-report-summary.js';

const DEFAULT_OUT = 'results/ui-regression-customer-summary.pdf';

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const outPath = path.resolve(args[0] || DEFAULT_OUT);

  const summary = readCustomerReportSummary();
  if (!summary) {
    console.error('缺少 customer-report-summary.json，请先执行 npm run report:customer');
    process.exit(1);
  }

  const html = renderCustomerSummaryPrintHtml(summary);
  const tmpHtml = path.join(path.dirname(outPath), '.customer-summary-print.html');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(tmpHtml, html, 'utf-8');

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`file://${tmpHtml}`, { waitUntil: 'networkidle' });
    await page.pdf({
      path: outPath,
      format: 'A4',
      printBackground: true,
      margin: { top: '12mm', right: '12mm', bottom: '12mm', left: '12mm' },
    });
  } finally {
    await browser.close();
    fs.unlinkSync(tmpHtml);
  }

  console.log(`PDF 已导出: ${outPath}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
