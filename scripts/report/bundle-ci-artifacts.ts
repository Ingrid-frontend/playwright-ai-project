#!/usr/bin/env tsx
/**
 * 合并 CI 产物为单一目录 ci-artifacts/（供 GitHub Actions 一次上传）
 */
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const root = process.cwd();
const outDir = path.join(root, 'ci-artifacts');

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

function main(): void {
  execSync('npm run report:bundle', { stdio: 'inherit', cwd: root });

  if (fs.existsSync(outDir)) fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  copyDir(path.join(root, 'public-reports'), path.join(outDir, 'public-reports'));
  copyDir(path.join(root, 'screenshots'), path.join(outDir, 'screenshots'));
  copyDir(path.join(root, 'results', 'diffs'), path.join(outDir, 'results', 'diffs'));
  copyFile(
    path.join(root, 'results', 'screenshot-comparison.html'),
    path.join(outDir, 'results', 'screenshot-comparison.html'),
  );
  copyFile(path.join(root, 'results', 'ui-issues.json'), path.join(outDir, 'results', 'ui-issues.json'));

  if (process.env.CI_BUNDLE_TEST_RESULTS === '1') {
    copyDir(path.join(root, 'test-results'), path.join(outDir, 'test-results'));
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    runId: process.env.GITHUB_RUN_ID || '',
    repository: process.env.GITHUB_REPOSITORY || '',
    sha: process.env.GITHUB_SHA || '',
    entry: 'public-reports/index.html',
    layout: {
      'public-reports/': 'Playwright + UI 对比入口',
      'screenshots/': '步骤截图（UI 报告配图）',
      'results/diffs/': '像素 diff 图',
      'results/ui-issues.json': '结构化 UI 问题',
      'test-results/': '失败 trace/视频（仅 CI_BUNDLE_TEST_RESULTS=1 时）',
    },
  };

  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');

  const readme = `# CI 测试产物

打开 \`public-reports/index.html\` 查看报告入口。

| 目录 | 说明 |
|------|------|
| public-reports/ | Playwright HTML + UI 对比 |
| screenshots/ | 步骤截图 |
| results/diffs/ | diff 图 |
| results/ui-issues.json | UI 问题清单 |

Run: ${manifest.repository}/actions/runs/${manifest.runId}
`;

  fs.writeFileSync(path.join(outDir, 'README.md'), readme, 'utf-8');

  console.log(`✅ CI 产物已合并: ${path.relative(root, outDir)}/`);
}

main();
