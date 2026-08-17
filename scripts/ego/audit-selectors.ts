#!/usr/bin/env tsx
/**
 * 用 ego lite 体检 optimized spec 的选择器健康度。
 *
 * 价值：ego lite 复用当前用户的浏览器登录态，无需 npm run login /
 * storage/loginState/*.json，也不必跑完 90s 的完整用例，就能回答
 * “这些定位链在今天的真实页面上还成立吗”。
 *
 * 用法:
 *   npm run ego:audit -- tests/optimized/stage/260814/x.optimized.spec.ts
 *   npm run ego:audit -- <spec> --url=/main/approve --json=results/ego-audit.json
 *   npm run ego:audit -- <spec> --keep-tab     # 体检后保留页面供人工查看
 */
import fs from 'fs';
import path from 'path';
import { runEgoJson, EgoUnavailableError, EgoUserControllingError, EGO_RESULT_PREFIX } from '../../src/utils/ego-browser.js';
import { scanSpecSelectors } from '../../src/utils/spec-selectors.js';
import {
  buildProbeSource,
  mergeFrameResults,
  type FrameProbeOutput,
  type ProbeStepResult,
} from '../../src/utils/ego-selector-probe.js';
import { getBaseEnvConfig } from '../../src/utils/env-config.js';
import { isLoginLikeText } from '../../src/utils/login-detection.js';

type ProbePayload = { url: string; frames: FrameProbeOutput[] };

/** 检测到登录页时：把控制权交还用户并保留页面，让用户能直接登录 */
async function handOffForLogin(taskName: string): Promise<boolean> {
  const script = [
    `const task = await useOrCreateTaskSpace(${JSON.stringify(taskName)})`,
    `const r = await handOffTaskSpace(task.id)`,
    `cliLog(${JSON.stringify(EGO_RESULT_PREFIX)} + JSON.stringify({ done: !!(r && r.done), skipped: r && r.skipped }))`,
  ].join('\n');
  try {
    const { data } = await runEgoJson<{ done: boolean; skipped?: string }>(script, { timeoutMs: 60_000 });
    return data.done;
  } catch {
    return false;
  }
}

function parseArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const arg = process.argv.find((a) => a.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : undefined;
}

function printHelp(): void {
  console.log(`用法: npm run ego:audit -- <optimized.spec.ts> [选项]

选项:
  --url=<path|url>   体检页面（默认取 spec 里的 page.goto 目标）
  --env=<env>        环境名，用于解析 baseURL（默认 stage）
  --json=<file>      结果写入 JSON
  --settle=<sec>     打开页面后额外等待秒数（默认 3）
  --keep-tab         体检后保留 task space 与页面
`);
}

const VERDICT_LABEL: Record<ProbeStepResult['verdict'], string> = {
  ok: '✅ 健康',
  missing: '❌ 未匹配',
  ambiguous: '⚠️  多重匹配',
  invisible: '⚠️  存在但不可见',
};

function resolveTargetUrl(specGoto: string[], env: string, override?: string): string {
  const raw = override || specGoto[0] || '/';
  if (/^https?:\/\//i.test(raw)) return raw;
  const base = getBaseEnvConfig(env)?.baseURL;
  if (!base) throw new Error(`环境 ${env} 未配置 baseURL，请显式传 --url=https://...`);
  return new URL(raw, base).toString();
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2).filter((a) => a !== '--');
  if (argv.includes('-h') || argv.includes('--help') || argv.length === 0) {
    printHelp();
    process.exit(argv.length === 0 ? 1 : 0);
  }

  const specPath = argv.find((a) => !a.startsWith('--'));
  if (!specPath || !fs.existsSync(specPath)) {
    console.error(`❌ spec 不存在: ${specPath || '(未指定)'}`);
    process.exit(1);
  }

  const env = parseArg('env') || process.env.PLAYWRIGHT_ENV || 'stage';
  const settle = Number(parseArg('settle') || 3);
  const keepTab = argv.includes('--keep-tab');
  const jsonOut = parseArg('json');

  const scan = scanSpecSelectors(specPath);
  if (scan.steps.length === 0) {
    console.log('ℹ️  未从 spec 中解析出定位链，无需体检');
    if (scan.unparsed.length) {
      console.log('   以下表达式暂不支持解析：');
      for (const item of scan.unparsed) console.log(`   - ${specPath}:${item.line} ${item.raw}`);
    }
    return;
  }

  const targetUrl = resolveTargetUrl(scan.gotoTargets, env, parseArg('url'));
  const taskName = `audit selectors ${path.basename(specPath)}`;

  console.log(`🔍 体检: ${specPath}`);
  console.log(`🌐 页面: ${targetUrl}`);
  console.log(`🧩 定位链: ${scan.steps.length} 条${scan.unparsed.length ? `（${scan.unparsed.length} 条未解析）` : ''}`);

  const probeSource = buildProbeSource(scan.steps);
  // 逐 frame 注入：主 frame 与各 iframe（含跨域）都用 CDP 独立世界执行同一段复算
  const script = [
    `const task = await useOrCreateTaskSpace(${JSON.stringify(taskName)})`,
    `await openOrReuseTab(${JSON.stringify(targetUrl)}, { wait: true, timeout: 45 })`,
    `await waitForNetworkIdle({ timeout: 15 }).catch(() => {})`,
    `await wait(${JSON.stringify(settle)})`,
    `const probeSource = ${JSON.stringify(probeSource)}`,
    `const tree = await cdp('Page.getFrameTree')`,
    `const frameIds = []`,
    `const walk = (node) => { frameIds.push(node.frame.id); (node.childFrames || []).forEach(walk) }`,
    `walk(tree.frameTree)`,
    `const frames = []`,
    `for (const frameId of frameIds) {`,
    `  try {`,
    `    const world = await cdp('Page.createIsolatedWorld', { frameId, worldName: 'ego-selector-audit' })`,
    `    const evaluated = await cdp('Runtime.evaluate', { expression: probeSource, contextId: world.executionContextId, returnByValue: true, awaitPromise: false })`,
    `    if (evaluated && evaluated.result && evaluated.result.value) frames.push(evaluated.result.value)`,
    `  } catch (e) { /* frame 可能已销毁或不可注入 */ }`,
    `}`,
    `const info = await pageInfo()`,
    `cliLog(${JSON.stringify(EGO_RESULT_PREFIX)} + JSON.stringify({ url: info.url, frames }))`,
    keepTab
      ? `cliLog('task space 保留: ' + task.id)`
      : `await completeTaskSpace(task.id, { keep: false })`,
  ].join('\n');

  let payload: ProbePayload;
  try {
    const { data } = await runEgoJson<ProbePayload>(script, { timeoutMs: 180_000 });
    payload = data;
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

  const frames = payload.frames || [];
  if (frames.length === 0) {
    console.error('❌ 未能在任何 frame 中执行复算，请确认页面已加载完成');
    process.exit(1);
  }

  const loginFrame = frames.find((f) => isLoginLikeText(f.text));
  if (loginFrame) {
    console.error('\n⏸️  ego lite 中该环境尚未登录（检测到登录页），体检已中止。');
    console.error(`   页面: ${loginFrame.frameUrl}`);
    if (keepTab) {
      // 页面已保留，把控制权交还用户，否则用户点不动这个 task space
      const handedOff = await handOffForLogin(taskName);
      console.error(
        handedOff
          ? '   ✋ 已将该 task space 控制权交还给你，请在 ego lite 中登录，登录后重跑本命令。'
          : '   ⚠️  控制权交还失败，请在 ego lite 界面手动接管该 task space 后登录。',
      );
    } else {
      console.error('   请加 --keep-tab 重跑：页面会被保留且控制权交还给你，登录一次即可。');
      console.error(`   npm run ego:audit -- ${specPath} --keep-tab`);
    }
    console.error('   登录态会被后续体检复用，无需每次重复登录。');
    process.exit(4);
  }

  const results = mergeFrameResults(scan.steps, frames);
  console.log(`\n📄 实际页面: ${payload.url}（复算 ${frames.length} 个 frame）\n`);

  for (const r of results) {
    const flag = r.optional && r.verdict === 'missing' ? 'ℹ️  可跳过步骤未匹配' : VERDICT_LABEL[r.verdict];
    console.log(`${flag}  step-${r.index} 「${r.stepName}」 ${path.basename(specPath)}:${r.line}`);
    console.log(`   ${r.raw}`);
    console.log(`   匹配 total=${r.total} visible=${r.visible}${r.brokenAtPart ? ` 断在第 ${r.brokenAtPart} 段: ${r.brokenPart}` : ''}`);
    if (r.samples.length) console.log(`   命中示例: ${r.samples.join(' | ')}`);
    if (r.frameUrl && r.frameUrl !== payload.url) console.log(`   所在 frame: ${r.frameUrl}`);
    console.log('');
  }

  const blocking = results.filter((r) => r.verdict === 'missing' && !r.optional);
  const warnings = results.filter((r) => r.verdict === 'ambiguous' || r.verdict === 'invisible');

  console.log('— 汇总 —');
  console.log(`  健康: ${results.filter((r) => r.verdict === 'ok').length}`);
  console.log(`  必经步骤断裂: ${blocking.length}`);
  console.log(`  需人工确认: ${warnings.length}`);
  console.log('  说明: role/text 为近似复算，结论用于定位可疑步骤，最终以 Playwright 运行为准');

  if (jsonOut) {
    const outPath = path.resolve(process.cwd(), jsonOut);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(
      outPath,
      JSON.stringify({ spec: specPath, url: payload.url, scannedAt: new Date().toISOString(), results, unparsed: scan.unparsed }, null, 2),
    );
    console.log(`\n💾 已写入: ${outPath}`);
  }

  if (blocking.length > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error('❌', e instanceof Error ? e.message : e);
  process.exit(1);
});
