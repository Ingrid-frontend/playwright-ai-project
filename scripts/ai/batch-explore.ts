#!/usr/bin/env tsx
/**
 * 批量用例初稿生成：catalog weight=core 页面 → 每页一次 exploreToIntent → 草稿箱。
 *
 *   npm run ai:batch-explore -- --env=stage --limit=3
 *   npm run ai:batch-explore -- --env=stage --page=request,approve
 *   npm run ai:batch-explore -- --env=stage --dry-run
 *
 * 产物：results/drafts/<pageId>/intent.preview.yaml + results/drafts/index.json
 * 门禁：trustLevel 强制 trial；detectWriteActions 命中 → reviewRequired=true（只进 write 类 job）。
 * 成本：共享 AiBudget（--max-calls，默认 页数×(步数+1)，上限 40）；goal 模板只做查看/搜索。
 */
import fs from 'fs';
import path from 'path';
import { stringify as stringifyYaml } from 'yaml';
import { createAiBudget } from '../../src/ai/llm-client.js';
import { detectWriteActions, validateTestIntent, type TestIntent } from '../../src/types/test-intent.js';
import { exploreToIntent } from '../ego/explore-to-intent.js';
import { loadCatalogPages } from '../smoke/smoke-checks.js';

function getArg(name: string, fallback = ''): string {
  const prefix = `--${name}=`;
  const hit = process.argv.slice(2).find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length).trim() : fallback;
}

function hasFlag(name: string): boolean {
  return process.argv.slice(2).includes(`--${name}`);
}

type DraftIndexEntry = {
  pageId: string;
  label: string;
  route: string;
  env: string;
  dir: string;
  yamlPath: string;
  status: 'pending-review' | 'error';
  trustLevel: 'trial';
  reviewRequired: boolean;
  writeActions: string[];
  steps: number;
  generatedAt: string;
  error?: string;
};

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

function loadDraftIndex(root: string): DraftIndexEntry[] {
  const p = path.join(root, 'results/drafts/index.json');
  if (!fs.existsSync(p)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    return Array.isArray(raw?.drafts) ? raw.drafts : [];
  } catch {
    return [];
  }
}

function saveDraftIndex(root: string, drafts: DraftIndexEntry[]): void {
  const p = path.join(root, 'results/drafts/index.json');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(
    p,
    `${JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), drafts }, null, 2)}\n`,
  );
}

async function main(): Promise<void> {
  const root = repoRoot();
  const env = getArg('env', process.env.PLAYWRIGHT_ENV || 'stage');
  const limit = Number(getArg('limit', '0')) || 0;
  const maxSteps = Math.max(2, Number(getArg('max-steps', '4')) || 4);
  const only = new Set(getArg('page', '').split(',').map((s) => s.trim()).filter(Boolean));
  const dryRun = hasFlag('dry-run');

  const corePages = loadCatalogPages(root).filter((p) => p.smoke.enabled && p.smoke.weight === 'core');
  let pages = corePages;
  if (only.size) pages = pages.filter((p) => only.has(p.id) || only.has(p.label));
  if (limit) pages = pages.slice(0, limit);

  if (!pages.length) {
    console.log('[batch-explore] 无目标页面（catalog weight=core 且 smoke.enabled；可用 --page= 指定）');
    return;
  }

  console.log(`\n🧪 batch-explore env=${env} 页数=${pages.length} maxSteps=${maxSteps}${dryRun ? '（dry-run）' : ''}`);
  for (const p of pages) console.log(`   - ${p.id} ${p.route}（${p.label}）`);
  if (dryRun) return;

  const maxCalls = Math.min(40, Number(getArg('max-calls', String(pages.length * (maxSteps + 1)))) || 40);
  const budget = createAiBudget({ maxCalls, deadline: Date.now() + 60 * 60_000 });
  console.log(`💰 LLM 预算: maxCalls=${maxCalls}\n`);

  const index = loadDraftIndex(root).filter((e) => !pages.some((p) => p.id === e.pageId));
  let ok = 0;
  let failed = 0;

  for (const p of pages) {
    const outDir = path.join(root, 'results/drafts', p.id);
    const goal = `打开${p.label}页面，验证主内容加载，只做查看/搜索操作`;
    try {
      const res = await exploreToIntent({
        goal,
        env,
        entry: p.route,
        maxSteps,
        spaceName: `batch-explore:${p.id}`,
        outDir,
        log: (line) => console.log(line),
      });

      // 门禁盖章：来源页 / 强制 trial / 写动作 → reviewRequired
      const stamped: TestIntent = validateTestIntent({
        ...res.intent,
        pageId: p.id,
        trustLevel: 'trial',
        reviewRequired: detectWriteActions(res.intent).length > 0 || res.intent.reviewRequired === true,
        constraints: Array.from(new Set([...(res.intent.constraints || []), '只读操作：不提交、不审批、不删除'])),
      });
      const yamlText = stringifyYaml(stamped);
      fs.writeFileSync(path.join(outDir, 'intent.preview.yaml'), yamlText.endsWith('\n') ? yamlText : `${yamlText}\n`);
      fs.writeFileSync(path.join(outDir, 'intent.json'), `${JSON.stringify(stamped, null, 2)}\n`);

      const writeActions = detectWriteActions(stamped);
      index.push({
        pageId: p.id,
        label: p.label,
        route: p.route,
        env,
        dir: path.relative(root, outDir).replace(/\\/g, '/'),
        yamlPath: 'intent.preview.yaml',
        status: 'pending-review',
        trustLevel: 'trial',
        reviewRequired: stamped.reviewRequired === true,
        writeActions,
        steps: stamped.steps.length,
        generatedAt: new Date().toISOString(),
      });
      ok++;
      console.log(`\n📦 [${p.id}] 草稿完成：${stamped.steps.length} 步 · reviewRequired=${stamped.reviewRequired}${writeActions.length ? ` · 写动作: ${writeActions.length}` : ''}\n`);
    } catch (err) {
      failed++;
      const msg = (err instanceof Error ? err.message : String(err)).slice(0, 300);
      index.push({
        pageId: p.id,
        label: p.label,
        route: p.route,
        env,
        dir: path.relative(root, outDir).replace(/\\/g, '/'),
        yamlPath: 'intent.preview.yaml',
        status: 'error',
        trustLevel: 'trial',
        reviewRequired: true,
        writeActions: [],
        steps: 0,
        generatedAt: new Date().toISOString(),
        error: msg,
      });
      console.log(`\n❌ [${p.id}] ${msg}\n`);
      if (/ego 不可用/.test(msg) || /用户正在操控/.test(msg)) break;
    }
  }

  saveDraftIndex(root, index);
  console.log(`📊 batch-explore 完成：成功 ${ok} / 失败 ${failed} → results/drafts/index.json`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
