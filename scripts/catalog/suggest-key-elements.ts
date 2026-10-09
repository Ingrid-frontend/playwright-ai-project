/**
 * 关键元素自动建议（Smoke 巡检的唯一 LLM 消耗点，仅新页面 1 次/页）：
 * ego snapshot 当前页 → LLM 产出 keyElements + 页面类型建议 → 写回 page-catalog.json（标记待人审）。
 *
 * 用法：
 *   npm run catalog:suggest-key-elements -- --env=stage                 # 补齐所有未配置页
 *   npm run catalog:suggest-key-elements -- --env=stage --page=request  # 指定页
 *   npm run catalog:suggest-key-elements -- --env=stage --force         # 覆盖已配置页
 *
 * 产出标记 keyElementsAiSuggested: true，人工审核后可直接编辑 page-catalog.json 去掉该标记。
 */
import fs from 'fs';
import path from 'path';
import {
  EGO_RESULT_PREFIX,
  EgoUnavailableError,
  EgoUserControllingError,
  runEgoJson,
} from '../../src/utils/ego-browser.js';
import { completeJson, createAiBudget } from '../../src/ai/llm-client.js';
import { getBaseEnvConfig } from '../../src/utils/env-config.js';

function getArg(name: string, fallback = ''): string {
  const prefix = `--${name}=`;
  const hit = process.argv.slice(2).find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length).trim() : fallback;
}

function hasFlag(name: string): boolean {
  return process.argv.slice(2).includes(`--${name}`);
}

function jsString(value: string): string {
  return JSON.stringify(value);
}

const SYSTEM_PROMPT = `你是 UI 巡检配置助手。根据页面语义快照，产出「页面加载成功时几乎必然可见的关键元素」清单，供后续无头 Smoke 巡检断言使用。

必须只输出 JSON：
{"pageType":"list|detail|report|admin|home|other","keyElements":["元素1","元素2"]}

规则：
1. keyElements 3-6 个，每个 ≤ 20 字。优先页面主内容的标志性文案（表头、页签、按钮、区块标题）。
2. 禁止使用侧栏/顶部导航菜单名（与页面内容无关且跨页重复）。
3. 禁止行级动态数据（人名、单号、金额、日期、计数）。
4. 元素写成用户可见短文案；确实是稳定类名时才给 CSS 选择器（以 . 或 # 开头）。
5. 只输出一次 JSON。`;

type Suggestion = { pageType: string; keyElements: string[] };

type CatalogFile = {
  version: number;
  app: string;
  env: string;
  crawledAt: string;
  pages: Array<{
    id: string;
    label: string;
    route: string;
    status?: string;
    smoke: {
      enabled: boolean;
      weight: 'core' | 'normal';
      keyElements: string[];
      keyElementsAiSuggested: boolean;
    };
    [k: string]: unknown;
  }>;
};

async function egoSnapshot(url: string, pageId: string): Promise<{ snapshot: string; url: string }> {
  const script = [
    `const task = await useOrCreateTaskSpace(${jsString(`smoke-suggest:${pageId}`)})`,
    `await openOrReuseTab(${jsString(url)}, { wait: true, timeout: 45 })`,
    `await waitForNetworkIdle({ timeout: 15 }).catch(() => {})`,
    `await wait(2)`,
    `const snap = await snapshotText()`,
    `const info = await pageInfo()`,
    `const __result = { snapshot: String(snap || ''), url: info.url || '' }`,
    `cliLog(${jsString(EGO_RESULT_PREFIX)} + JSON.stringify(typeof __result !== 'undefined' ? __result : { snapshot: '', url: '' }))`,
  ].join('\n');
  return runEgoJson<{ snapshot: string; url: string }>(script, { timeoutMs: 120_000 }).then((r) => r.data);
}

async function main(): Promise<void> {
  const root = path.resolve(process.cwd());
  const env = getArg('env', process.env.PLAYWRIGHT_ENV || 'stage');
  const catalogPath = path.resolve(root, 'datasource/page-catalog.json');
  if (!fs.existsSync(catalogPath)) {
    console.error('❌ datasource/page-catalog.json 不存在，先跑 npm run catalog:crawl');
    process.exit(1);
  }
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8')) as CatalogFile;

  const onlyRaw = getArg('page', '');
  const only = new Set(onlyRaw.split(',').map((s) => s.trim()).filter(Boolean));
  const force = hasFlag('force');
  const limit = Number(getArg('limit', '0')) || 0;
  const dryRun = hasFlag('dry-run');

  const base = getBaseEnvConfig(env)?.baseURL;
  if (!base) throw new Error(`环境 ${env} 未配置 baseURL`);

  const targets = catalog.pages.filter((p) => {
    if (p.status === 'retired' || p.smoke?.enabled === false) return false;
    if (only.size && ![...only].some((o) => p.id === o || p.id.includes(o) || (p.label || '').includes(o))) return false;
    if (!force && (p.smoke?.keyElements?.length || 0) > 0) return false;
    return true;
  });
  const batch = limit ? targets.slice(0, limit) : targets;
  if (!batch.length) {
    console.log('无待建议页面（keyElements 已配置则用 --force 覆盖）');
    return;
  }

  console.log(`🧠 关键元素建议：${batch.length} 页（每页 1 次 LLM 调用，ego snapshot 前置）`);
  const budget = createAiBudget({ maxCalls: batch.length + 1, deadline: Date.now() + 30 * 60_000 });
  let updated = 0;

  for (const p of batch) {
    const url = /^https?:\/\//i.test(p.route) ? p.route : new URL(p.route, base).toString();
    let snapshot = '';
    try {
      const snap = await egoSnapshot(url, p.id);
      snapshot = snap.snapshot;
    } catch (err) {
      if (err instanceof EgoUnavailableError || err instanceof EgoUserControllingError) {
        console.error(`❌ ${err.message}`);
        process.exit(err instanceof EgoUnavailableError ? 2 : 3);
      }
      console.warn(`⚠️  ${p.id} ego snapshot 失败，跳过: ${String((err as Error)?.message || err).slice(0, 120)}`);
      continue;
    }
    if (!snapshot.trim()) {
      console.warn(`⚠️  ${p.id} 快照为空（可能落在登录页），跳过`);
      continue;
    }

    const prompt = [
      `页面：${p.label}（${p.route}）`,
      `快照（截断）：`,
      snapshot.slice(0, 8_000),
    ].join('\n');

    try {
      budget.assertAvailable();
      budget.consumeCall();
      const sugg = await completeJson<Suggestion>(prompt, {
        system: SYSTEM_PROMPT,
        temperature: 0.2,
        maxTokens: 800,
        budget,
      });
      const keyElements = (sugg.keyElements || [])
        .map((s) => String(s || '').trim())
        .filter(Boolean)
        .slice(0, 6);
      if (!keyElements.length) {
        console.warn(`⚠️  ${p.id} 建议为空，跳过`);
        continue;
      }
      console.log(`✅ ${p.id}（${sugg.pageType || 'other'}）: ${keyElements.join('、')}`);
      if (!dryRun) {
        p.smoke.keyElements = keyElements;
        p.smoke.keyElementsAiSuggested = true;
        updated++;
      }
    } catch (err) {
      console.warn(`⚠️  ${p.id} LLM 建议失败: ${String((err as Error)?.message || err).slice(0, 160)}`);
      break; // budget 或网络问题，避免逐页空转
    }
  }

  if (!dryRun && updated) {
    fs.writeFileSync(catalogPath, JSON.stringify(catalog, null, 2), 'utf8');
    console.log(`\n💾 已写回 ${path.relative(root, catalogPath)}（更新 ${updated} 页，keyElementsAiSuggested=true 待人审）`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
