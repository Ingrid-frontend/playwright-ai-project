#!/usr/bin/env tsx
/**
 * 从 ui-issues.json 生成 AI 分析文档（compare 未跑时补生成）
 *
 * npm run feedback:docs
 * npm run feedback:docs -- --issues=results/flow-ui-issues.json
 * npm run feedback:docs -- --export=mf-xxx --out=tmp.md
 */
import fs from 'fs';
import { exportFeedbackDocMarkdown, isSplitFeedbackDocs, writeFeedbackDocsFromReport } from './ui-feedback-doc.js';
import type { UiIssuesReport } from './ui-issues.js';

const issuesFile = process.argv.find((a) => a.startsWith('--issues='))?.slice('--issues='.length) || 'results/ui-issues.json';
const exportId = process.argv.find((a) => a.startsWith('--export='))?.slice('--export='.length);
const outFile = process.argv.find((a) => a.startsWith('--out='))?.slice('--out='.length);

if (exportId) {
  const md = exportFeedbackDocMarkdown(exportId);
  if (!md) {
    console.error(`❌ 未在 latest.json 中找到 ${exportId}`);
    process.exit(1);
  }
  if (outFile) {
    fs.writeFileSync(outFile, md, 'utf-8');
    console.log(`✅ 已导出 ${exportId} → ${outFile}`);
  } else {
    process.stdout.write(md);
  }
  process.exit(0);
}

if (!fs.existsSync(issuesFile)) {
  console.error(`❌ 未找到 ${issuesFile}，请先运行 compare-screenshots`);
  process.exit(1);
}

const report = JSON.parse(fs.readFileSync(issuesFile, 'utf-8')) as UiIssuesReport;
const index = writeFeedbackDocsFromReport(report, { env: process.env.PLAYWRIGHT_ENV });
fs.writeFileSync(issuesFile, JSON.stringify(report, null, 2), 'utf-8');
const dest = isSplitFeedbackDocs() ? 'results/ui-feedback-docs/*.md' : 'results/ui-feedback-docs/latest.md';
console.log(`✅ 已生成 ${index.docs.length} 条 → ${dest}`);
