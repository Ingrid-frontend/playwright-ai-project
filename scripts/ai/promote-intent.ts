#!/usr/bin/env tsx
/**
 * Intent 晋升/降级建议（trust 算法不改，只消费 results/history/intent-trust 记录）。
 *
 *   npm run ai:promote-intent --                 # dry-run：只打印建议
 *   npm run ai:promote-intent -- --apply         # 批量改 YAML trustLevel
 *   npm run ai:promote-intent -- --key=<path>    # 只看单个用例
 *
 * 规则（对齐 computeSuggestedTrust）：
 *   trial→stable：建议=stable 且人设≠stable（连续 10 过 & healRate<15%）
 *   *→watch：建议=watch 且人设≠watch（连挂 2 或自愈率≥30%）——watch 用例不进每日 job
 */
import fs from 'fs';
import path from 'path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import {
  listIntentTrustRecords,
  type IntentTrustRecord,
} from '../../src/runtime/intent-trust.js';
import { validateTestIntent, type IntentTrustLevel } from '../../src/types/test-intent.js';

function getArg(name: string): string {
  const prefix = `--${name}=`;
  const hit = process.argv.slice(2).find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length).trim() : '';
}

function hasFlag(name: string): boolean {
  return process.argv.slice(2).includes(`--${name}`);
}

type Suggestion = {
  record: IntentTrustRecord;
  from: IntentTrustLevel | undefined;
  to: IntentTrustLevel;
  reason: string;
};

function buildSuggestions(records: IntentTrustRecord[], keyFilter: string): Suggestion[] {
  const out: Suggestion[] = [];
  for (const r of records) {
    if (keyFilter && r.intentKey !== keyFilter && r.intentPath !== keyFilter) continue;
    const current = r.trustLevel;
    const suggested = r.suggestedTrustLevel;
    if (suggested === 'stable' && current !== 'stable' && r.consecutivePass >= 10) {
      out.push({ record: r, from: current, to: 'stable', reason: `连续通过 ${r.consecutivePass} · 自愈率 ${(r.healRate * 100).toFixed(0)}%` });
    } else if (suggested === 'watch' && current !== 'watch') {
      out.push({ record: r, from: current, to: 'watch', reason: `连续失败 ${r.consecutiveFail} · 通过 ${r.passed}/${r.runs} · 自愈率 ${(r.healRate * 100).toFixed(0)}%` });
    }
  }
  return out;
}

function rewriteYamlTrustLevel(repoRoot: string, intentPath: string, to: IntentTrustLevel): string {
  const abs = path.isAbsolute(intentPath) ? intentPath : path.join(repoRoot, intentPath);
  if (!fs.existsSync(abs)) throw new Error(`YAML 不存在: ${intentPath}`);
  const raw = parseYaml(fs.readFileSync(abs, 'utf8'));
  const intent = validateTestIntent({ ...raw, trustLevel: to });
  const text = stringifyYaml(intent);
  fs.writeFileSync(abs, text.endsWith('\n') ? text : `${text}\n`);
  return path.relative(repoRoot, abs).replace(/\\/g, '/');
}

async function main(): Promise<void> {
  const repoRoot = process.cwd();
  const apply = hasFlag('apply');
  const keyFilter = getArg('key');
  const records = listIntentTrustRecords();
  const suggestions = buildSuggestions(records, keyFilter);

  if (!records.length) {
    console.log('无 trust 记录（results/history/intent-trust/ 为空）。先跑 npm run intent:run 积累历史。');
    return;
  }

  const up = suggestions.filter((s) => s.to === 'stable');
  const down = suggestions.filter((s) => s.to === 'watch');

  console.log(`\n📈 promote-intent ${apply ? '--apply' : 'dry-run'}（记录 ${records.length} 条）`);
  console.log(`\n↑ 晋升 trial→stable（${up.length}）:`);
  for (const s of up) {
    console.log(`   ${s.record.intentPath || s.record.intentKey} — ${s.reason}`);
  }
  console.log(`\n↓ 降级 →watch（${down.length}，不进每日 job，需人工复查 YAML）:`);
  for (const s of down) {
    console.log(`   ${s.record.intentPath || s.record.intentKey} — ${s.reason}`);
  }
  if (!suggestions.length) console.log('   （无）');

  if (!apply) {
    console.log('\n（dry-run 结束；确认无误后加 --apply 批量改 YAML）');
    return;
  }

  let changed = 0;
  const errors: string[] = [];
  for (const s of suggestions) {
    const target = s.record.intentPath;
    if (!target) {
      errors.push(`${s.record.intentKey}: 记录缺 intentPath，跳过`);
      continue;
    }
    try {
      const rel = rewriteYamlTrustLevel(repoRoot, target, s.to);
      changed++;
      console.log(`✏️  ${rel} trustLevel: ${s.from || '(缺省)'} → ${s.to}`);
    } catch (err) {
      errors.push(`${target}: ${err instanceof Error ? err.message : err}`);
    }
  }
  console.log(`\n📊 已更新 ${changed} 个 YAML${errors.length ? `，失败 ${errors.length}` : ''}`);
  for (const e of errors) console.log(`   ⚠️  ${e}`);
  if (down.length) {
    console.log(`\n🔔 ${down.length} 条降为 watch——请复查对应 YAML；watch 用例已被 intent-batch 排除。`);
  }
  if (errors.length) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
