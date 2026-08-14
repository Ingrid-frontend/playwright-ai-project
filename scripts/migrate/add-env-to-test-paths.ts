/**
 * 将旧版无 env 段的用例/录制/截图目录迁移到 tests/optimized/<env>/<dateCategory>/ 等结构。
 *
 * 用法:
 *   npm run migrate:test-env-paths          # 预览
 *   npm run migrate:test-env-paths -- --apply
 *   npm run migrate:test-env-paths -- --env=uat --apply
 */
import fs from 'fs';
import path from 'path';
import {
  getLegacyEnvDefault,
  isKnownEnv,
  isEnvSegmentEnabled,
  listKnownEnvs,
  parseOptimizedRel,
  optimizedImportDepthFromRel,
  optimizedImportPathsForDepth,
  buildScreenshotDir,
} from '../../src/utils/test-env-path.js';
import { isDateCategoryDirSegment } from '../../src/utils/date-category.js';

type MovePlan = { from: string; to: string; kind: string };

function parseArgs() {
  const apply = process.argv.includes('--apply');
  const fixSpecsOnly = process.argv.includes('--fix-specs-only');
  let targetEnv = getLegacyEnvDefault();
  for (const arg of process.argv.slice(2)) {
    const m = arg.match(/^--env=(.+)$/);
    if (m) targetEnv = m[1].trim();
  }
  return { apply, fixSpecsOnly, targetEnv };
}

function rel(p: string): string {
  return path.relative(process.cwd(), p).replace(/\\/g, '/');
}

function planOptimizedMoves(root: string, targetEnv: string): MovePlan[] {
  const base = path.join(root, 'tests/optimized');
  if (!fs.existsSync(base)) return [];
  const plans: MovePlan[] = [];
  for (const ent of fs.readdirSync(base, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    if (isKnownEnv(ent.name, root)) continue;
    if (!isDateCategoryDirSegment(ent.name)) continue;
    plans.push({
      kind: 'optimized',
      from: path.join(base, ent.name),
      to: path.join(base, targetEnv, ent.name),
    });
  }
  return plans;
}

function planRawOriginalMoves(root: string, targetEnv: string): MovePlan[] {
  const base = path.join(root, 'tests/raw-recordings/original');
  if (!fs.existsSync(base)) return [];
  const plans: MovePlan[] = [];
  for (const ent of fs.readdirSync(base, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    if (isKnownEnv(ent.name, root)) continue;
    if (!isDateCategoryDirSegment(ent.name)) continue;
    plans.push({
      kind: 'raw-original',
      from: path.join(base, ent.name),
      to: path.join(base, targetEnv, ent.name),
    });
  }
  return plans;
}

function planScreenshotMoves(root: string, targetEnv: string): MovePlan[] {
  const base = path.join(root, 'screenshots');
  if (!fs.existsSync(base)) return [];
  const plans: MovePlan[] = [];
  for (const ent of fs.readdirSync(base, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    if (isKnownEnv(ent.name, root)) continue;
    if (!isDateCategoryDirSegment(ent.name)) continue;
    plans.push({
      kind: 'screenshots',
      from: path.join(base, ent.name),
      to: path.join(base, targetEnv, ent.name),
    });
  }
  return plans;
}

function applyMove(plan: MovePlan): void {
  if (!fs.existsSync(plan.from)) return;
  if (fs.existsSync(plan.to)) {
    throw new Error(`目标已存在，跳过: ${rel(plan.to)}`);
  }
  fs.mkdirSync(path.dirname(plan.to), { recursive: true });
  fs.renameSync(plan.from, plan.to);
}

function fixOptimizedSpecFile(absPath: string, root: string, targetEnv: string): boolean {
  if (!absPath.endsWith('.optimized.spec.ts')) return false;
  const outputRel = rel(absPath);
  const parsed = parseOptimizedRel(outputRel, root);
  if (!parsed) return false;

  const depth = optimizedImportDepthFromRel(outputRel);
  const paths = optimizedImportPathsForDepth(depth);
  const stem = parsed.fileName.replace(/\.optimized\.spec\.ts$/, '');
  const dateCategory = parsed.segments.filter((s) => isDateCategoryDirSegment(s)).pop() || '';
  const screenshotDir = buildScreenshotDir({
    playwrightEnv: parsed.env || targetEnv,
    dateCategory,
    fileName: stem,
    repoRoot: root,
  });

  let content = fs.readFileSync(absPath, 'utf8');
  const next = content
    .replace(
      /^import \{ test, expect \} from ['"][^'"]+['"];/m,
      `import { test, expect } from '${paths.fixtures}';`,
    )
    .replace(
      /^import \{ takeStepScreenshot, waitForPostInteractionPaint, withScreenshotRunSegment \} from ['"][^'"]+['"];/m,
      `import { takeStepScreenshot, waitForPostInteractionPaint, withScreenshotRunSegment } from '${paths.screenshot}';`,
    )
    .replace(
      /^import \{ step, maybePause, smartClick \} from ['"][^'"]+['"];/m,
      `import { step, maybePause, smartClick } from '${paths.optimizedActions}';`,
    )
    .replace(
      /withScreenshotRunSegment\(['"][^'"]+['"]\)/,
      `withScreenshotRunSegment('${screenshotDir}')`,
    );

  if (next !== content) {
    fs.writeFileSync(absPath, next, 'utf8');
    return true;
  }
  return false;
}

function fixOptimizedSpecsUnder(dir: string, root: string, targetEnv: string): number {
  if (!fs.existsSync(dir)) return 0;
  let fixed = 0;
  const walk = (d: string) => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (ent.name.endsWith('.optimized.spec.ts') && fixOptimizedSpecFile(full, root, targetEnv)) {
        fixed++;
        console.log(`  📝 已修正 import/截图路径: ${rel(full)}`);
      }
    }
  };
  walk(dir);
  return fixed;
}

function main() {
  const root = process.cwd();
  const { apply, fixSpecsOnly, targetEnv } = parseArgs();

  if (!isEnvSegmentEnabled(root)) {
    console.log('ℹ️  config/test-path-layout.json 中 envSegmentEnabled=false，无需迁移');
    process.exit(0);
  }

  if (!isKnownEnv(targetEnv, root)) {
    console.error(`❌ 未知环境「${targetEnv}」，可选: ${listKnownEnvs(root).join(', ')}`);
    process.exit(1);
  }

  if (fixSpecsOnly) {
    const optimizedBase = path.join(root, 'tests/optimized', targetEnv);
    const fixed = fixOptimizedSpecsUnder(optimizedBase, root, targetEnv);
    console.log(fixed ? `\n📝 共修正 ${fixed} 个 optimized spec` : '\n✅ 无需修正');
    process.exit(0);
  }

  const plans = [
    ...planOptimizedMoves(root, targetEnv),
    ...planRawOriginalMoves(root, targetEnv),
    ...planScreenshotMoves(root, targetEnv),
  ];

  if (!plans.length) {
    console.log('✅ 未发现需要迁移的旧路径（无 env 段的 dateCategory 目录）');
    process.exit(0);
  }

  console.log(`${apply ? '🔧 执行' : '👀 预览'}迁移（legacy → ${targetEnv}），共 ${plans.length} 项:\n`);
  for (const p of plans) {
    console.log(`  [${p.kind}] ${rel(p.from)} → ${rel(p.to)}`);
  }

  if (!apply) {
    console.log('\n加 --apply 执行实际迁移');
    process.exit(0);
  }

  let ok = 0;
  let failed = 0;
  for (const p of plans) {
    try {
      applyMove(p);
      ok++;
      if (p.kind === 'optimized') {
        fixOptimizedSpecsUnder(p.to, root, targetEnv);
      }
    } catch (e) {
      failed++;
      console.error(`❌ ${rel(p.from)}: ${e instanceof Error ? e.message : e}`);
    }
  }
  const optimizedBase = path.join(root, 'tests/optimized', targetEnv);
  const extraFixed = fixOptimizedSpecsUnder(optimizedBase, root, targetEnv);
  if (extraFixed) console.log(`\n📝 额外修正 ${extraFixed} 个 optimized spec 的 import/截图路径`);
  console.log(`\n📊 完成: 成功 ${ok}，失败 ${failed}`);
  process.exit(failed ? 1 : 0);
}

main();
