#!/usr/bin/env tsx
/**
 * flow-runs history 保留策略与清理（P1：manifest/history 无限增长）
 *
 * 现状：results/flow-runs/<flowId>/history/<yyyy-mm-dd>.json 每次 run 都追加一份完整
 * manifest（含 failures/skips 明细），从不回收，长期运行后单仓库体积与单文件行数持续增长。
 *
 * 策略：按天文件为单位，只保留最近 N 天，其余整天删除（当天的所有 run 记录一起回收，
 * 不拆分单条），避免破坏「同一天所有 run 在一个文件里」的既有读取假设。
 *
 * 用法:
 *   npm run prune:flow-history                # 预览（默认 dry-run）
 *   npm run prune:flow-history -- --apply      # 实际执行
 *   npm run prune:flow-history -- --keep-days=60 --apply
 */
import fs from 'fs';
import path from 'path';

function arg(name: string, def: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : def;
}
const APPLY = process.argv.includes('--apply');
const KEEP_DAYS = Math.max(1, Number(arg('keep-days', '30')) || 30);

const ROOT = path.resolve('results');
const FLOW_RUNS = path.join(ROOT, 'flow-runs');
const DAY_RE = /^(\d{4}-\d{2}-\d{2})\.json$/;

function main(): void {
  if (!fs.existsSync(FLOW_RUNS)) {
    console.log('[prune:flow-history] results/flow-runs 不存在，跳过');
    return;
  }

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - KEEP_DAYS);
  const cutoffDay = cutoff.toISOString().slice(0, 10);

  let freedBytes = 0;
  let removed = 0;
  let dryPlans = 0;

  for (const flowId of fs.readdirSync(FLOW_RUNS)) {
    const histDir = path.join(FLOW_RUNS, flowId, 'history');
    if (!fs.existsSync(histDir) || !fs.statSync(histDir).isDirectory()) continue;

    for (const name of fs.readdirSync(histDir)) {
      const m = name.match(DAY_RE);
      if (!m) continue;
      const day = m[1]!;
      if (day >= cutoffDay) continue; // 保留窗口内，不动

      const p = path.join(histDir, name);
      if (APPLY) {
        freedBytes += fs.statSync(p).size;
        fs.unlinkSync(p);
        removed++;
        console.log(`  🗑  ${flowId}/history/${name}`);
      } else {
        dryPlans++;
        console.log(`  ~  将删除 ${flowId}/history/${name}`);
      }
    }
  }

  if (!APPLY) {
    if (dryPlans === 0) {
      console.log(`[prune:flow-history] 无需清理（保留最近 ${KEEP_DAYS} 天）`);
    } else {
      console.log(
        `\n[dry-run] 将回收 ${dryPlans} 份 history 日文件（超过 ${KEEP_DAYS} 天）。确认后执行: npm run prune:flow-history -- --apply`,
      );
    }
    return;
  }
  console.log(`\n✅ 已回收 ${removed} 份 history 日文件，释放约 ${(freedBytes / 1024).toFixed(0)} KB`);
}

main();
