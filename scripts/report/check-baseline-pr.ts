#!/usr/bin/env tsx
/**
 * PR 变更 screenshots-baseline/ 时需显式批准，避免静默接受 UI 基线漂移。
 *
 * 用法:
 *   npm run check-baseline-pr -- --base=origin/main
 *
 * 批准方式（任一）:
 *   - PR label: baseline-update
 *   - 环境变量: BASELINE_UPDATE_OK=1
 */
import { execSync } from 'child_process';

const BASELINE_ROOT = 'screenshots-baseline';
const APPROVAL_LABEL = 'baseline-update';

function parseBaseArg(argv: string[]): string {
  const hit = argv.find((a) => a.startsWith('--base='));
  if (hit) return hit.slice('--base='.length).trim();
  return process.env.BASELINE_DIFF_BASE || 'origin/main';
}

function listBaselineChanges(base: string): string[] {
  try {
    const out = execSync(`git diff --name-only ${base}...HEAD -- ${BASELINE_ROOT}`, {
      encoding: 'utf-8',
    }).trim();
    return out ? out.split('\n').filter(Boolean) : [];
  } catch {
    try {
      const out = execSync(`git diff --name-only ${base} HEAD -- ${BASELINE_ROOT}`, {
        encoding: 'utf-8',
      }).trim();
      return out ? out.split('\n').filter(Boolean) : [];
    } catch {
      return [];
    }
  }
}

function hasApproval(): boolean {
  if (process.env.BASELINE_UPDATE_OK === '1') return true;

  const pr = process.env.PR_NUMBER || process.env.GITHUB_EVENT_PULL_REQUEST_NUMBER;
  const repo = process.env.GITHUB_REPOSITORY;
  if (!pr || !repo || !process.env.GITHUB_TOKEN) return false;

  try {
    const labels = execSync(`gh pr view ${pr} --repo ${repo} --json labels -q '.labels[].name'`, {
      encoding: 'utf-8',
    })
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    return labels.includes(APPROVAL_LABEL);
  } catch {
    return false;
  }
}

function main(): void {
  const base = parseBaseArg(process.argv.slice(2));
  const changed = listBaselineChanges(base);

  if (!changed.length) {
    console.log('✅ 无 baseline 变更');
    process.exit(0);
  }

  console.log(`📋 baseline 变更 ${changed.length} 个文件（对比 ${base}）:`);
  changed.slice(0, 30).forEach((f) => console.log(`  - ${f}`));
  if (changed.length > 30) console.log(`  ... 另有 ${changed.length - 30} 个`);

  if (hasApproval()) {
    console.log(`✅ 已批准 baseline 更新（label: ${APPROVAL_LABEL} 或 BASELINE_UPDATE_OK=1）`);
    process.exit(0);
  }

  console.error('');
  console.error(`❌ baseline 变更需 review 后再合并`);
  console.error(`   1. 确认 diff 为预期 UI 变更`);
  console.error(`   2. 给 PR 加 label「${APPROVAL_LABEL}」`);
  console.error('   3. 或本地/CI 设 BASELINE_UPDATE_OK=1（仅 intentional promote 时使用）');
  process.exit(1);
}

main();
