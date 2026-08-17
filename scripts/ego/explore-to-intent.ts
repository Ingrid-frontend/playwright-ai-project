#!/usr/bin/env tsx
/**
 * Explore：ego Snapshot 代操 → 语义轨迹 → Intent YAML 预览（不落 Playwright）
 *
 *   npm run ego:explore -- --goal="进入审批列表" --entry=/main/approve --env=stage
 */
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { stringify as stringifyYaml } from 'yaml';
import { completeJson } from '../../src/ai/llm-client.js';
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
import { validateTestIntent } from '../../src/types/test-intent.js';
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

  const env = getArgValue('env') || process.env.PLAYWRIGHT_ENV || 'stage';
  const entry = getArgValue('entry');
  const maxSteps = Math.max(1, Number(getArgValue('max-steps') || 8));
  const spaceName = getArgValue('space') || `explore:${sanitizeName(goal)}`;
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const outDir = path.resolve(
    getArgValue('out') || path.join('results', 'ego-explore', `${stamp}-${sanitizeName(goal)}`),
  );
  fs.mkdirSync(outDir, { recursive: true });

  const entryUrl = resolveUrl(env, entry);
  console.log(`🧭 explore goal=${goal}`);
  console.log(`🌐 entry=${entryUrl || '(当前页)'}`);
  console.log(`📦 space=${spaceName}`);

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
      console.error(`❌ ${err.message}`);
      process.exit(2);
    }
    if (err instanceof EgoUserControllingError) {
      console.error(`⏸️  ${err.message}`);
      process.exit(3);
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
      { system: buildExploreDecideSystemPrompt(), temperature: 0.2, maxTokens: 1500 },
    );

    if (decision.done) {
      console.log(`✅ 探索结束: ${decision.reason}`);
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
      console.log(`⚠️  步骤失败: ${note}`);
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
    console.log(`→ ${i + 1}. ${history[history.length - 1]}${note ? ` (${note})` : ''}`);

    if (note && /验证码|登录|captcha|login/i.test(note)) break;
  }

  trace.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(outDir, 'trace.json'), `${JSON.stringify(trace, null, 2)}\n`);

  const draft = await completeJson<Record<string, unknown>>(buildExploreToIntentPrompt(trace), {
    system: buildExploreToIntentSystemPrompt(),
    temperature: 0.1,
    maxTokens: 4000,
  });

  if (!draft.env) draft.env = env;
  if (!draft.entry && entry) draft.entry = entry;
  if (!draft.goal) draft.goal = goal;

  let intent;
  try {
    intent = validateTestIntent(draft);
  } catch (err) {
    console.error(`❌ Intent 校验失败: ${err instanceof Error ? err.message : err}`);
    fs.writeFileSync(path.join(outDir, 'intent.draft.json'), `${JSON.stringify(draft, null, 2)}\n`);
    process.exit(1);
  }

  const yamlText = stringifyYaml(intent);
  fs.writeFileSync(path.join(outDir, 'intent.preview.yaml'), yamlText.endsWith('\n') ? yamlText : `${yamlText}\n`);
  fs.writeFileSync(path.join(outDir, 'intent.json'), `${JSON.stringify(intent, null, 2)}\n`);

  console.log(`\n📁 产出: ${outDir}`);
  console.log(`   - trace.json`);
  console.log(`   - intent.preview.yaml`);

  const saveTo = getArgValue('save');
  if (saveTo) {
    const abs = path.isAbsolute(saveTo)
      ? saveTo
      : path.resolve(process.cwd(), saveTo.startsWith('tests/definitions/') ? saveTo : path.join('tests/definitions', saveTo));
    if (!abs.includes(`${path.sep}tests${path.sep}definitions${path.sep}`)) {
      console.error('❌ --save 仅允许写入 tests/definitions/');
      process.exit(1);
    }
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, yamlText.endsWith('\n') ? yamlText : `${yamlText}\n`);
    console.log(`💾 已保存: ${path.relative(process.cwd(), abs)}`);
  }

  if (!hasFlag('keep-tab')) {
    try {
      await egoJson(spaceName, [
        `await completeTaskSpace(task.id, { keep: false })`,
        `const __result = { ok: true }`,
      ]);
    } catch {
      /* ignore */
    }
  }
}

main().catch((e) => {
  console.error('❌', e instanceof Error ? e.message : e);
  process.exit(1);
});
