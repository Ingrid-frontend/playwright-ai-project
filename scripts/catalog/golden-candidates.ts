#!/usr/bin/env tsx
/**
 * Golden 晋升候选清单（只输出建议，不自动生成代码）。
 *
 *   npm run catalog:golden-candidates -- --env=stage
 *
 * 候选条件（同时满足）：
 *   ① 有 stable 用例覆盖（tests/definitions 下 trustLevel=stable 的 YAML，pageId 或 entry 命中）
 *   ② smoke 近 N 次运行（默认 5）中该页未 failed
 *   ③ catalog 尚未登记 goldenFlowId
 * 建议动作：补进对应 flow 的 ListCatalog，或走 npm run flow:new（可先 flow:gen-catalog 生成 catalog 草稿）。
 */
import fs from 'fs';
import path from 'path';
import { parse as parseYaml } from 'yaml';
import { validateTestIntent } from '../../src/types/test-intent.js';
import { loadCatalogPages } from '../smoke/smoke-checks.js';

function getArg(name: string, fallback = ''): string {
  const prefix = `--${name}=`;
  const hit = process.argv.slice(2).find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length).trim() : fallback;
}

function repoRoot(): string {
  let dir = path.resolve(process.cwd());
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, 'datasource/page-catalog.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(process.cwd());
}

type IntentHit = { path: string; name: string; trustLevel?: string; entry?: string; pageId?: string };

function collectDefinitionIntents(root: string): IntentHit[] {
  const dir = path.join(root, 'tests/definitions');
  if (!fs.existsSync(dir)) return [];
  const out: IntentHit[] = [];
  const walk = (rel: string) => {
    for (const name of fs.readdirSync(path.join(dir, rel))) {
      if (name.startsWith('.')) continue;
      const relChild = rel ? `${rel}/${name}` : name;
      const abs = path.join(dir, relChild);
      if (fs.statSync(abs).isDirectory()) {
        walk(relChild);
        continue;
      }
      if (!/\.ya?ml$/i.test(name)) continue;
      try {
        const intent = validateTestIntent(parseYaml(fs.readFileSync(abs, 'utf8')));
        out.push({ path: `tests/definitions/${relChild}`, name: intent.name, trustLevel: intent.trustLevel, entry: intent.entry, pageId: intent.pageId });
      } catch {
        /* 跳过解析失败的 YAML */
      }
    }
  };
  walk('');
  return out;
}

type SmokeStability = { seen: number; failed: number; lastStatus?: string };

function collectSmokeStability(root: string, window: number): Map<string, SmokeStability> {
  const dir = path.join(root, 'results/smoke');
  const map = new Map<string, SmokeStability>();
  if (!fs.existsSync(dir)) return map;
  const reports = fs
    .readdirSync(dir)
    .filter((name) => fs.existsSync(path.join(dir, name, 'smoke-report.json')))
    .sort((a, b) => a.localeCompare(b)) // runId 为时间戳目录名，字典序即时间序
    .slice(-window)
    .map((name) => JSON.parse(fs.readFileSync(path.join(dir, name, 'smoke-report.json'), 'utf8')) as {
      pages?: Array<{ pageId: string; status: string }>;
    });
  for (const report of reports) {
    for (const p of report.pages || []) {
      const s = map.get(p.pageId) || { seen: 0, failed: 0 };
      s.seen++;
      if (p.status === 'failed') s.failed++;
      s.lastStatus = p.status;
      map.set(p.pageId, s);
    }
  }
  return map;
}

async function main(): Promise<void> {
  const root = repoRoot();
  const window = Number(getArg('window', '5')) || 5;

  const raw = JSON.parse(fs.readFileSync(path.join(root, 'datasource/page-catalog.json'), 'utf8')) as {
    pages?: Array<{ id: string; goldenFlowId?: string }>;
  };
  const goldenFlowByPage = new Map((raw.pages || []).filter((p) => p.goldenFlowId).map((p) => [p.id, p.goldenFlowId as string]));

  const pages = loadCatalogPages(root).filter((p) => p.smoke.enabled);
  const intents = collectDefinitionIntents(root);
  const smoke = collectSmokeStability(root, window);

  type Candidate = { pageId: string; label: string; route: string; stableIntents: string[]; smoke: SmokeStability };
  const candidates: Candidate[] = [];
  const coveredButRegistered: Array<{ pageId: string; goldenFlowId: string }> = [];
  const coveredUnstable: Array<{ pageId: string; reason: string }> = [];

  for (const page of pages) {
    const stableHits = intents.filter(
      (i) => i.trustLevel === 'stable' && (i.pageId === page.id || (i.entry && page.route.startsWith(i.entry)) || page.route === i.entry),
    );
    if (!stableHits.length) continue;
    const goldenFlowId = goldenFlowByPage.get(page.id);
    if (goldenFlowId) {
      coveredButRegistered.push({ pageId: page.id, goldenFlowId });
      continue;
    }
    const s = smoke.get(page.id);
    if (!s || s.seen === 0) {
      coveredUnstable.push({ pageId: page.id, reason: 'smoke 无运行记录' });
      continue;
    }
    if (s.failed > 0) {
      coveredUnstable.push({ pageId: page.id, reason: `smoke 近 ${s.seen} 次 ${s.failed} 次 failed` });
      continue;
    }
    candidates.push({ pageId: page.id, label: page.label, route: page.route, stableIntents: stableHits.map((h) => h.path), smoke: s });
  }

  console.log(`\n🏆 Golden 候选（stable 覆盖 + smoke 近 ${window} 次稳定 + 未登记 goldenFlowId）：${candidates.length} 页`);
  for (const c of candidates) {
    console.log(`\n   ◆ ${c.pageId}（${c.label}）${c.route}`);
    console.log(`     smoke: 最近 ${c.smoke.seen} 次 0 失败（最后一次 ${c.smoke.lastStatus}）`);
    for (const p of c.stableIntents) console.log(`     stable 用例: ${p}`);
    console.log(`     建议: 补进对应 flow 的 ListCatalog，或 npm run flow:new（可先 flow:gen-catalog 出 catalog 草稿）`);
  }
  if (!candidates.length) console.log('   （暂无候选——继续积累 stable 用例与 smoke 记录）');

  if (coveredUnstable.length) {
    console.log(`\n⏸️  有 stable 覆盖但 smoke 未达稳定的页：${coveredUnstable.map((x) => `${x.pageId}（${x.reason}）`).join('、')}`);
  }
  if (coveredButRegistered.length) {
    console.log(`已登记 goldenFlowId（不重复建议）: ${coveredButRegistered.map((x) => `${x.pageId}→${x.goldenFlowId}`).join('、')}`);
  }
  console.log('');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
