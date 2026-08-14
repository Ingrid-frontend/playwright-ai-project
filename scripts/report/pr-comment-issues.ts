#!/usr/bin/env tsx
/**
 * 将 ui-issues.json 摘要写入 GitHub PR comment（CI 可选步骤）。
 * 需环境变量 GITHUB_TOKEN、GITHUB_REPOSITORY、PR_NUMBER 或 GITHUB_EVENT_PATH。
 */
import fs from 'fs';
import path from 'path';
import type { UiIssuesReport } from './ui-issues-index.js';

const ISSUES_PATH = process.env.UI_ISSUES_OUT || 'results/ui-issues.json';

function readIssues(): UiIssuesReport | null {
  if (!fs.existsSync(ISSUES_PATH)) return null;
  return JSON.parse(fs.readFileSync(ISSUES_PATH, 'utf-8')) as UiIssuesReport;
}

function buildMarkdown(report: UiIssuesReport): string {
  const top = report.issues.filter((i) => i.severity === 'blocker').slice(0, 5);
  const lines = [
    '## UI 回归摘要',
    '',
    `- **blocker**: ${report.summary.blocker}`,
    `- **warning**: ${report.summary.warning}`,
    `- **总计**: ${report.summary.total}`,
    '',
  ];
  if (top.length) {
    lines.push('### Top blocker 步骤', '');
    for (const i of top) {
      lines.push(
        `- \`${i.scriptKey}\` 步骤 ${i.stepNumber} (${i.stepName}) · ${i.browser} · ${(i.difference * 100).toFixed(3)}% · ${i.compareKind}`,
      );
    }
  }
  lines.push('', '完整清单见 CI artifact：`ui-issues.json` / `screenshot-comparison.html`');
  return lines.join('\n');
}

async function main(): Promise<void> {
  const report = readIssues();
  if (!report) {
    console.log('ℹ️  无 ui-issues.json，跳过 PR comment');
    return;
  }

  const body = buildMarkdown(report);
  const outPath = path.join('results', 'pr-ui-issues-comment.md');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, body, 'utf-8');
  console.log(`✅ PR comment 草稿已写入 ${outPath}`);

  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  const prNumber = process.env.PR_NUMBER || process.env.GITHUB_PR_NUMBER;

  if (!token || !repo || !prNumber) {
    console.log('ℹ️  未配置 GITHUB_TOKEN / GITHUB_REPOSITORY / PR_NUMBER，仅生成 markdown 草稿');
    return;
  }

  const [owner, name] = repo.split('/');
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${name}/issues/${prNumber}/comments`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ body }),
    },
  );
  if (!res.ok) {
    console.error('❌ PR comment 失败', await res.text());
    process.exit(1);
  }
  console.log('✅ 已发布 PR comment');
}

main();
