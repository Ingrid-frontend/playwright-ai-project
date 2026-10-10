#!/usr/bin/env tsx
/**
 * Stable Intent 定期回归批：扫 tests/definitions 下 trustLevel=stable 且非 reviewRequired 的用例，
 * 顺序跑 run-intent.ts（trust 历史由 run-intent 内部落盘），汇总 summary。
 *
 *   npm run intents:stable -- --env=stage
 *   npm run intents:stable -- --env=stage --engine=pw --key=<子串过滤>
 *
 * 噪声控制（对齐计划）：
 *   trial 不进本批（试跑观察用）；watch 不进本批（连挂需人工复查）；reviewRequired（写动作）只进 write 类 job。
 * 退出码：stable 失败数 > 0 → 1。
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { parse as parseYaml } from 'yaml';
import { validateTestIntent, type IntentTrustLevel } from '../../src/types/test-intent.js';

function getArg(name: string, fallback = ''): string {
  const prefix = `--${name}=`;
  const hit = process.argv.slice(2).find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length).trim() : fallback;
}

type StableCase = { rel: string; abs: string; name: string; trustLevel: IntentTrustLevel };
type SkipStat = { label: string; items: string[] };

function collectCases(root: string, keyFilter: string): { selected: StableCase[]; skips: SkipStat[] } {
  const dir = path.join(root, 'tests/definitions');
  const selected: StableCase[] = [];
  const skips: SkipStat[] = [
    { label: 'trial（试跑观察）', items: [] },
    { label: 'watch（连挂待人工复查）', items: [] },
    { label: 'reviewRequired（写动作，只进 write 类 job）', items: [] },
    { label: '解析失败', items: [] },
  ];

  const walk = (rel: string) => {
    const absDir = path.join(dir, rel);
    if (!fs.existsSync(absDir)) return;
    for (const name of fs.readdirSync(absDir)) {
      if (name.startsWith('.')) continue;
      const relChild = rel ? `${rel}/${name}` : name;
      const abs = path.join(dir, relChild);
      if (fs.statSync(abs).isDirectory()) {
        walk(relChild);
        continue;
      }
      if (!/\.ya?ml$/i.test(name)) continue;
      if (keyFilter && !relChild.includes(keyFilter)) continue;
      try {
        const intent = validateTestIntent(parseYaml(fs.readFileSync(abs, 'utf8')));
        const trust: IntentTrustLevel = intent.trustLevel || 'trial';
        const item = { rel: `tests/definitions/${relChild}`, abs, name: intent.name, trustLevel: trust };
        if (intent.reviewRequired === true) skips[2].items.push(item.rel);
        else if (trust === 'stable') selected.push(item);
        else if (trust === 'watch') skips[1].items.push(item.rel);
        else skips[0].items.push(item.rel);
      } catch {
        skips[3].items.push(`tests/definitions/${relChild}`);
      }
    }
  };
  walk('');
  return { selected, skips };
}

async function main(): Promise<void> {
  const root = process.cwd();
  const env = getArg('env', process.env.PLAYWRIGHT_ENV || 'stage');
  const engine = getArg('engine', 'ego');
  const profile = getArg('profile', 'default');
  const keyFilter = getArg('key');
  const headed = process.argv.includes('--headed');

  const { selected, skips } = collectCases(root, keyFilter);
  console.log(`\n🎯 stable intent 回归 env=${env} engine=${engine} 用例=${selected.length}`);
  for (const s of skips) {
    if (s.items.length) console.log(`   ⏭️  跳过 ${s.label}: ${s.items.length} 条`);
  }
  if (!selected.length) {
    console.log('无 stable 用例可跑（用 npm run ai:promote-intent 查看晋升建议）。');
    return;
  }

  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const outRoot = path.resolve(root, 'results/intent-runs', `${stamp}-stable-batch`);
  fs.mkdirSync(outRoot, { recursive: true });
  const tsxBin = path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'tsx.cmd' : 'tsx');

  type CaseResult = { rel: string; name: string; passed: boolean; error?: string; outDir: string };
  const results: CaseResult[] = [];

  for (let i = 0; i < selected.length; i++) {
    const c = selected[i];
    const outDir = path.join(outRoot, String(i + 1).padStart(2, '0'));
    console.log(`\n▶ [${i + 1}/${selected.length}] ${c.rel}（${c.name}）`);
    const args = [
      'scripts/ai/run-intent.ts',
      `--intent=${c.abs}`,
      `--engine=${engine}`,
      `--env=${env}`,
      `--profile=${profile}`,
      `--out=${outDir}`,
    ];
    if (headed) args.push('--headed');
    const proc = spawnSync(tsxBin, args, { cwd: root, stdio: 'inherit', env: process.env });
    let passed = proc.status === 0;
    let error: string | undefined;
    const resultPath = path.join(outDir, 'result.json');
    if (fs.existsSync(resultPath)) {
      try {
        const r = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
        passed = r.passed === true && proc.status === 0;
        if (!passed) error = String(r.error || '').slice(0, 200);
      } catch {
        /* result.json 损坏按退出码计 */
      }
    }
    if (!passed && !error) error = `run-intent 退出码 ${proc.status}`;
    results.push({ rel: c.rel, name: c.name, passed, error, outDir: path.relative(root, outDir).replace(/\\/g, '/') });
    console.log(`${passed ? '✅' : '❌'} ${c.rel}`);
  }

  const failedCases = results.filter((r) => !r.passed);
  const summary = {
    env,
    engine,
    startedAt: stamp,
    total: results.length,
    passed: results.length - failedCases.length,
    failed: failedCases.length,
    skipped: Object.fromEntries(skips.map((s) => [s.label, s.items.length])),
    cases: results,
  };
  fs.writeFileSync(path.join(outRoot, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);

  console.log(`\n📊 stable 回归：通过 ${summary.passed} / 失败 ${summary.failed}（共 ${summary.total}）`);
  console.log(`📁 汇总: ${path.relative(root, path.join(outRoot, 'summary.json'))}`);
  for (const f of failedCases) console.log(`   ❌ ${f.rel} — ${f.error || ''}`);
  const watchCount = skips[1].items.length;
  if (watchCount) {
    console.log(`\n🔔 提醒：${watchCount} 条 watch 用例未进本批，需人工复查（npm run ai:promote-intent 查看降级原因）。`);
  }
  if (failedCases.length) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
