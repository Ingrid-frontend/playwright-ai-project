#!/usr/bin/env tsx
/**
 * Explore：ego Snapshot 代操 → 语义轨迹 → Intent YAML 预览（不落 Playwright）
 *
 *   npm run ego:explore -- --goal="进入审批列表" --entry=/main/approve --env=stage
 *
 * 探索主流程抽为 exploreToIntent() 供 batch-explore 复用；本文件 CLI 壳保留。
 */
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { stringify as stringifyYaml } from 'yaml';
import { completeJson, type AiBudget } from '../../src/ai/llm-client.js';
import {
  buildExploreDecidePrompt,
  buildExploreDecideSystemPrompt,
  buildExploreToIntentPrompt,
  buildExploreToIntentSystemPrompt,
  type ExploreDecision,
  type ExploreTrace,
  type ExploreTraceStep,
} from '../../src/ai/prompts/explore-to-intent.js';
import {
  findCandidates,
  formatNodesForPrompt,
  parseSnapshotText,
  summarizeSnapshot,
} from '../../src/runtime/ego-snapshot.js';
import { validateTestIntent, type TestIntent } from '../../src/types/test-intent.js';
import { getBaseEnvConfig } from '../../src/utils/env-config.js';
import { EGO_RESULT_PREFIX, runEgoJson, EgoUnavailableError, EgoUserControllingError } from '../../src/utils/ego-browser.js';

dotenv.config({ path: path.join(process.cwd(), '.env') });

function getArgValue(name: string): string | undefined {
  const args = process.argv.slice(2);
  const prefix = `--${name}=`;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === `--${name}` && i + 1 < args.length) return args[i + 1];
    if (arg.startsWith(prefix)) return arg.slice(prefix.length);
  }
  return undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.slice(2).some((arg) => arg === `--${name}`);
}

function jsString(value: string): string {
  return JSON.stringify(value);
}

function sanitizeName(name: string): string {
  return (
    name
      .trim()
      .replace(/[^\w\u4e00-\u9fa5-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'explore'
  );
}

function resolveUrl(env: string, pathOrUrl?: string): string | undefined {
  if (!pathOrUrl) return undefined;
  if (/^https?:\/\//i.test(pathOrUrl) || pathOrUrl.startsWith('data:')) return pathOrUrl;
  const base = getBaseEnvConfig(env)?.baseURL;
  if (!base) throw new Error(`环境 ${env} 未配置 baseURL`);
  return new URL(pathOrUrl, base).toString();
}

async function egoJson<T>(spaceName: string, body: string[], timeoutMs = 180_000): Promise<T> {
  const script = [
    `const task = await useOrCreateTaskSpace(${jsString(spaceName)})`,
    ...body,
    `cliLog(${jsString(EGO_RESULT_PREFIX)} + JSON.stringify(typeof __result !== 'undefined' ? __result : { ok: true }))`,
  ].join('\n');
  const { data } = await runEgoJson<T>(script, { timeoutMs });
  return data;
}

export type ExploreToIntentOptions = {
  goal: string;
  env?: string;
  entry?: string;
  maxSteps?: number;
  spaceName?: string;
  outDir?: string;
  keepTab?: boolean;
  /** 校验通过后写入 tests/definitions/ 的目标路径 */
  saveTo?: string;
  /** LLM 预算（批量场景传入共享预算） */
  budget?: AiBudget;
  /** 进度日志（缺省 console.log） */
  log?: (line: string) => void;
};

export type ExploreToIntentResult = {
  outDir: string;
  trace: ExploreTrace;
  intent: TestIntent;
  yamlText: string;
  savedTo?: string;
};

/** 探索主流程：ego 代操 → trace → LLM 编译 Intent YAML。batch-explore 与 CLI 共用。 */
export async function exploreToIntent(opts: ExploreToIntentOptions): Promise<ExploreToIntentResult> {
  const goal = opts.goal;
  if (!goal?.trim()) throw new Error('exploreToIntent 需要 goal');

  const env = opts.env || process.env.PLAYWRIGHT_ENV || 'stage';
  const entry = opts.entry;
  const maxSteps = Math.max(1, opts.maxSteps ?? 8);
  const spaceName = opts.spaceName || `explore:${sanitizeName(goal)}`;
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const outDir = path.resolve(
    opts.outDir || path.join('results', 'ego-explore', `${stamp}-${sanitizeName(goal)}`),
  );
  const log = opts.log || ((line: string) => console.log(line));
  fs.mkdirSync(outDir, { recursive: true });

  const entryUrl = resolveUrl(env, entry);
  log(`🧭 explore goal=${goal}`);
  log(`🌐 entry=${entryUrl || '(当前页)'}`);
  log(`📦 space=${spaceName}`);

  try {
    if (entryUrl) {
      await egoJson(spaceName, [
        `await openOrReuseTab(${jsString(entryUrl)}, { wait: true, timeout: 45 })`,
        `await waitForNetworkIdle({ timeout: 15 }).catch(() => {})`,
        `await wait(1)`,
        `const __result = { ok: true }`,
      ]);
    }
  } catch (err) {
    if (err instanceof EgoUnavailableError) {
      throw new Error(`ego 不可用: ${err.message}`);
    }
    if (err instanceof EgoUserControllingError) {
      throw new Error(`用户正在操控: ${err.message}`);
    }
    throw err;
  }

  const trace: ExploreTrace = {
    goal,
    env,
    entry,
    spaceName,
    startedAt: new Date().toISOString(),
    steps: [],
  };

  const history: string[] = [];
  const constraints = [
    '禁止 nth()',
    '优先可见文案',
    '不允许删除数据',
    '遇到验证码则停止',
  ];

  for (let i = 0; i < maxSteps; i++) {
    const page = await egoJson<{ snapshot: string; url: string }>(spaceName, [
      `const snap = await snapshotText()`,
      `const info = await pageInfo()`,
      `const __result = { snapshot: String(snap || ''), url: info.url || '' }`,
    ]);

    const nodes = parseSnapshotText(page.snapshot);
    const snapForLlm = summarizeSnapshot(
      `${formatNodesForPrompt(nodes)}\n\n${page.snapshot}`,
      10_000,
    );

    const decision = await completeJson<ExploreDecision>(
      buildExploreDecidePrompt({
        goal,
        entry,
        snapshot: snapForLlm,
        url: page.url,
        history,
        constraints,
      }),
      { system: buildExploreDecideSystemPrompt(), temperature: 0.2, maxTokens: 1500, budget: opts.budget },
    );

    if (decision.done) {
      log(`✅ 探索结束: ${decision.reason}`);
      break;
    }

    const semantic = {
      action: decision.action,
      description: decision.description,
      value: decision.value,
      path: decision.path,
      url: decision.url,
    };

    const beforeSummary = formatNodesForPrompt(nodes, 40);
    let note: string | undefined;

    try {
      if (decision.action === 'goto') {
        const url = resolveUrl(env, decision.url || decision.path);
        if (!url) throw new Error('goto 缺少 path/url');
        await egoJson(spaceName, [
          `await openOrReuseTab(${jsString(url)}, { wait: true, timeout: 45 })`,
          `await wait(1)`,
          `const __result = { ok: true }`,
        ]);
      } else if (decision.action === 'wait') {
        const sec = Math.max(0.2, (decision.timeoutMs || 1000) / 1000);
        await egoJson(spaceName, [`await wait(${sec})`, `const __result = { ok: true }`]);
      } else if (decision.action === 'click' || decision.action === 'fill' || decision.action === 'select') {
        const desc = decision.description || '';
        const candidates = findCandidates(nodes, desc);
        let ref = candidates[0]?.ref;
        if (!ref) {
          throw new Error(`Snapshot 中找不到: ${desc}`);
        }
        if (candidates.length > 1) {
          const exact = candidates.filter((c) => c.name.toLowerCase() === desc.toLowerCase());
          if (exact.length === 1) ref = exact[0].ref;
        }
        const lines: string[] = [];
        if (decision.action === 'click') {
          lines.push(`await click('@${ref}', { label: ${jsString(desc)} })`);
        } else if (decision.action === 'fill') {
          lines.push(`await fillInput('@${ref}', ${jsString(decision.value || '')})`);
        } else {
          lines.push(`await click('@${ref}', { label: ${jsString(desc)} })`);
          lines.push(`await wait(0.4)`);
          lines.push(`await typeText(${jsString(decision.value || '')})`);
        }
        lines.push(`await wait(0.6)`);
        lines.push(`const __result = { ok: true }`);
        await egoJson(spaceName, lines);
      }
    } catch (err) {
      note = err instanceof Error ? err.message : String(err);
      log(`⚠️  步骤失败: ${note}`);
    }

    const after = await egoJson<{ snapshot: string; url: string }>(spaceName, [
      `const snap = await snapshotText()`,
      `const info = await pageInfo()`,
      `const __result = { snapshot: String(snap || ''), url: info.url || '' }`,
    ]).catch(() => ({ snapshot: '', url: page.url }));

    const step: ExploreTraceStep = {
      index: i + 1,
      beforeSummary,
      afterSummary: formatNodesForPrompt(parseSnapshotText(after.snapshot), 40),
      url: after.url || page.url,
      semantic,
      note,
    };
    trace.steps.push(step);
    history.push(
      `${semantic.action} ${semantic.description || ''} ${semantic.value || ''} ${semantic.path || semantic.url || ''}`.trim(),
    );
    log(`→ ${i + 1}. ${history[history.length - 1]}${note ? ` (${note})` : ''}`);

    if (note && /验证码|登录|captcha|login/i.test(note)) break;
  }

  trace.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(outDir, 'trace.json'), `${JSON.stringify(trace, null, 2)}\n`);

  const draft = await completeJson<Record<string, unknown>>(buildExploreToIntentPrompt(trace), {
    system: buildExploreToIntentSystemPrompt(),
    temperature: 0.1,
    maxTokens: 4000,
    budget: opts.budget,
  });

  if (!draft.env) draft.env = env;
  if (!draft.entry && entry) draft.entry = entry;
  if (!draft.goal) draft.goal = goal;

  let intent: TestIntent;
  try {
    intent = validateTestIntent(draft);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    fs.writeFileSync(path.join(outDir, 'intent.draft.json'), `${JSON.stringify(draft, null, 2)}\n`);
    throw new Error(`Intent 校验失败: ${msg}`);
  }

  const yamlText = stringifyYaml(intent);
  fs.writeFileSync(path.join(outDir, 'intent.preview.yaml'), yamlText.endsWith('\n') ? yamlText : `${yamlText}\n`);
  fs.writeFileSync(path.join(outDir, 'intent.json'), `${JSON.stringify(intent, null, 2)}\n`);

  log(`\n📁 产出: ${outDir}`);
  log(`   - trace.json`);
  log(`   - intent.preview.yaml`);

  let savedTo: string | undefined;
  if (opts.saveTo) {
    const abs = path.isAbsolute(opts.saveTo)
      ? opts.saveTo
      : path.resolve(process.cwd(), opts.saveTo.startsWith('tests/definitions/') ? opts.saveTo : path.join('tests/definitions', opts.saveTo));
    if (!abs.includes(`${path.sep}tests${path.sep}definitions${path.sep}`)) {
      throw new Error('saveTo 仅允许写入 tests/definitions/');
    }
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, yamlText.endsWith('\n') ? yamlText : `${yamlText}\n`);
    log(`💾 已保存: ${path.relative(process.cwd(), abs)}`);
    savedTo = path.relative(process.cwd(), abs);
  }

  if (!opts.keepTab) {
    try {
      await egoJson(spaceName, [
        `await completeTaskSpace(task.id, { keep: false })`,
        `const __result = { ok: true }`,
      ]);
    } catch {
      /* ignore */
    }
  }

  return { outDir, trace, intent, yamlText, savedTo };
}

function printHelp(): void {
  console.log(`用法: npm run ego:explore -- --goal=<目标> [选项]

选项:
  --goal=<text>       探索目标（必需）
  --entry=<path|url>  入口
  --env=<env>         默认 stage
  --space=<name>      task space 名
  --max-steps=<n>     最大探索步数（默认 8）
  --out=<dir>         输出目录
  --keep-tab          结束后保留 Space
  --save=<file.yaml>  校验通过后写入 definitions 相对/绝对路径
  -h, --help
`);
}

async function main(): Promise<void> {
  if (hasFlag('help') || hasFlag('h')) {
    printHelp();
    return;
  }

  const goal = getArgValue('goal');
  if (!goal) {
    console.error('❌ 请提供 --goal=');
    printHelp();
    process.exit(1);
  }

  try {
    await exploreToIntent({
      goal,
      env: getArgValue('env') || process.env.PLAYWRIGHT_ENV || 'stage',
      entry: getArgValue('entry'),
      maxSteps: Number(getArgValue('max-steps') || 8),
      spaceName: getArgValue('space'),
      outDir: getArgValue('out'),
      keepTab: hasFlag('keep-tab'),
      saveTo: getArgValue('save'),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/ego 不可用/.test(msg)) {
      console.error(`❌ ${msg}`);
      process.exit(2);
    }
    if (/用户正在操控/.test(msg)) {
      console.error(`⏸️  ${msg}`);
      process.exit(3);
    }
    console.error('❌', msg);
    process.exit(1);
  }
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/ego/explore-to-intent.ts')) {
  main().catch((e) => {
    console.error('❌', e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
