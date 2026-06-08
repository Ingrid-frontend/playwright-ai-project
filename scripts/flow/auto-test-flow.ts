import { execSync } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import {
  browserToRunSegment,
  recordLastGreenRun,
} from '../report/baseline-manager.js';
import type { UiIssuesReport } from '../report/ui-issues.js';
import {
  assertSpecEnvMatch,
  getLegacyEnvDefault,
  parseEnvAndDateCategoryFromRawOrProcessed,
  specMatchesEnv,
} from '../../src/utils/test-env-path.js';

type FeishuMode = 'interactive' | 'text' | 'links' | 'none';

type CliOptions = {
  feishuMode: FeishuMode;
  createFeishuDoc: boolean;
  /** 依次执行的 Playwright project（默认 Chromium optimized + WebKit optimized-webkit） */
  playwrightProjects: string[];
  /** 显式指定录制根目录（相对 cwd）；未传则看 RAW_RECORDINGS_DIR，再自动回退 */
  rawRecordingsDir?: string;
  /** 指定 raw 或 optimized spec 路径（跳过「仅最新一条」逻辑） */
  specPath?: string;
  /** 批量：处理 raw-recordings 下全部可用 .spec.ts */
  batch: boolean;
  /** compare-screenshots --gate */
  compareGate: boolean;
};

/** 供飞书通知与最终退出码：反映「执行 / 对比 / 飞书文档」真实结果（录制、优化在此前失败会直接 throw） */
type AutoTestNotifySummary = {
  recordSkipped: boolean;
  testPassed: boolean;
  comparePassed: boolean;
  feishuDocAttempted: boolean;
  feishuDocPassed: boolean;
  uiIssues?: UiIssuesReport['summary'];
};

function buildNotifyResultMarkdown(s: AutoTestNotifySummary): string {
  const lines = [
    '**测试结果**：',
    s.recordSkipped ? '⏭️ 录制：跳过（CI）' : '✅ 录制：成功',
    '✅ 优化：成功',
    `${s.testPassed ? '✅' : '❌'} 执行：${s.testPassed ? '成功' : '失败'}`,
    `${s.comparePassed ? '✅' : '❌'} 对比：${s.comparePassed ? '成功' : '失败'}`,
  ];
  if (s.feishuDocAttempted) {
    lines.push(`${s.feishuDocPassed ? '✅' : '❌'} 飞书文档：${s.feishuDocPassed ? '成功' : '失败'}`);
  }
  if (s.uiIssues) {
    lines.push(
      `**UI 问题**：blocker ${s.uiIssues.blocker} · warning ${s.uiIssues.warning} · 共 ${s.uiIssues.total} 项`,
    );
    lines.push(`报告：results/screenshot-comparison.html · results/ui-issues.json`);
  }
  return lines.join('\n');
}

function notifyCardHeader(s: AutoTestNotifySummary): { title: string; template: string } {
  const allOk =
    s.testPassed && s.comparePassed && (!s.feishuDocAttempted || s.feishuDocPassed);
  if (allOk) {
    return { title: '🎉 Playwright AI 测试完成', template: 'green' };
  }
  return { title: '⚠️ Playwright AI 测试未完成', template: 'red' };
}

function printHelp(): void {
  console.log(`用法: tsx scripts/flow/auto-test-flow.ts [选项]

录制 → 优化 → 执行 → 截图对比 →（可选）飞书文档 / 飞书通知

选项:
  --feishu-mode=<interactive|text|links|none>  飞书通知样式（默认 interactive）
  --create-feishu-doc                           流程末尾执行 npm run create-feishu-doc
  --playwright-project=<a>[,<b>...]          执行用例的 project，逗号分隔（默认 optimized,optimized-webkit）
  --raw-recordings-dir=<path>                 原始录制根目录（相对项目根；优先于环境变量）
  --spec=<path>                               指定 raw 或 optimized spec（跳过「仅最新录制」）
  --batch                                     批量：优化并执行 raw-recordings 下全部用例
  --gate                                      截图对比启用 --gate（blocker 时失败）
  -h, --help                                  显示帮助

环境变量 FEISHU_MODE 与 --feishu-mode 相同；命令行优先。
环境变量 RAW_RECORDINGS_DIR：指定原始录制根目录；未设置且未传 --raw-recordings-dir 时，使用 tests/raw-recordings（须存在且含可用 .spec.ts，不含 original/）。

feishu-mode 说明:
  interactive  简单卡片（默认）
  text         纯文本 webhook
  links        卡片 + 链接按钮（默认禁用 GitHub；需 ENABLE_GITHUB=1 才会生成 GitHub 链接）
  none         不发送飞书
`);
}

function parseCli(argv: string[]): CliOptions {
  const envMode = process.env.FEISHU_MODE?.toLowerCase();
  let feishuMode: FeishuMode = 'interactive';
  if (
    envMode &&
    (envMode === 'interactive' || envMode === 'text' || envMode === 'links' || envMode === 'none')
  ) {
    feishuMode = envMode;
  }

  let createFeishuDoc = false;
  let playwrightProjects: string[] = ['optimized', 'optimized-webkit'];
  let rawRecordingsDir: string | undefined;
  let specPath: string | undefined;
  let batch = false;
  let compareGate = false;

  for (const arg of argv) {
    if (arg === '-h' || arg === '--help') {
      printHelp();
      process.exit(0);
    }
    if (arg === '--create-feishu-doc') {
      createFeishuDoc = true;
      continue;
    }
    if (arg.startsWith('--feishu-mode=')) {
      const v = arg.slice('--feishu-mode='.length).toLowerCase();
      if (v !== 'interactive' && v !== 'text' && v !== 'links' && v !== 'none') {
        console.error(`❌ 无效的 --feishu-mode: ${v}`);
        process.exit(1);
      }
      feishuMode = v;
      continue;
    }
    if (arg.startsWith('--playwright-project=')) {
      const raw = arg.slice('--playwright-project='.length).trim();
      const list = raw
        ? raw
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : [];
      playwrightProjects = list.length > 0 ? list : ['optimized', 'optimized-webkit'];
      continue;
    }
    if (arg.startsWith('--raw-recordings-dir=')) {
      const v = arg.slice('--raw-recordings-dir='.length).trim();
      if (!v) {
        console.error('❌ --raw-recordings-dir 不能为空');
        process.exit(1);
      }
      rawRecordingsDir = v;
      continue;
    }
    if (arg.startsWith('--spec=')) {
      specPath = arg.slice('--spec='.length).trim();
      continue;
    }
    if (arg === '--batch') {
      batch = true;
      continue;
    }
    if (arg === '--gate') {
      compareGate = true;
      continue;
    }
  }

  return { feishuMode, createFeishuDoc, playwrightProjects, rawRecordingsDir, specPath, batch, compareGate };
}

async function sendFeishuNotification(mode: FeishuMode, summary: AutoTestNotifySummary): Promise<void> {
  if (mode === 'none') {
    console.log('ℹ️  feishu-mode=none，跳过飞书通知');
    return;
  }

  const githubEnabled = process.env.ENABLE_GITHUB === '1';
  if (mode === 'links' && !githubEnabled) {
    console.log('ℹ️  未启用 GitHub 链接（ENABLE_GITHUB!=1），降级为 interactive');
    mode = 'interactive';
  }

  const webhookUrl = process.env.FEISHU_WEBHOOK_URL;
  const webhookSecret = process.env.FEISHU_WEBHOOK_SECRET;

  console.log('🔍 飞书通知配置检查：');
  console.log('  - Webhook URL:', webhookUrl ? '已配置' : '未配置');
  console.log('  - Webhook Secret:', webhookSecret ? '已配置' : '未配置');

  if (!webhookUrl) {
    console.log('⚠️  未配置飞书 Webhook URL，跳过通知');
    return;
  }

  const resultMd = buildNotifyResultMarkdown(summary);
  const { title: cardTitle, template: cardTemplate } = notifyCardHeader(summary);

  const timestamp = Math.floor(Date.now() / 1000);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  let body: object;

  if (mode === 'text') {
    const headline = cardTitle.includes('未完成') ? '⚠️ Playwright AI 流程结束' : '🎉 Playwright AI 测试完成';
    body = {
      msg_type: 'text',
      content: {
        text: `${headline}\n\n${resultMd}`,
      },
    };
  } else if (mode === 'links') {
    const githubRepository = process.env.GITHUB_REPOSITORY || 'Ingrid-frontend/playwright-ai-project';
    const githubRunId = process.env.GITHUB_RUN_ID || '';
    const githubRunUrl = `https://github.com/${githubRepository}/actions/runs/${githubRunId}`;
    const [owner, repo] = githubRepository.split('/');
    const githubPagesUrl = `https://${owner}.github.io/${repo}/screenshot-comparison.html`;

    const message = {
      msg_type: 'interactive' as const,
      card: {
        header: {
          title: {
            tag: 'plain_text' as const,
            content: cardTitle,
          },
          template: cardTemplate as 'green' | 'red',
        },
        elements: [
          {
            tag: 'div' as const,
            text: {
              tag: 'lark_md' as const,
              content: resultMd,
            },
          },
          {
            tag: 'action' as const,
            actions: [
              {
                tag: 'button' as const,
                text: { tag: 'plain_text' as const, content: '🌐 在线预览' },
                type: 'primary' as const,
                url: githubPagesUrl,
              },
              {
                tag: 'button' as const,
                text: { tag: 'plain_text' as const, content: '📥 下载报告' },
                type: 'default' as const,
                url: githubRunUrl,
              },
            ],
          },
          {
            tag: 'div' as const,
            text: {
              tag: 'lark_md' as const,
              content: '**飞书文档**：',
            },
          },
          {
            tag: 'action' as const,
            actions: [] as Array<Record<string, unknown>>,
          },
        ],
      },
    };

    const feishuDocUrlPath = 'results/feishu-doc-url.txt';
    if (fs.existsSync(feishuDocUrlPath)) {
      try {
        const feishuDocUrl = fs.readFileSync(feishuDocUrlPath, 'utf-8').trim();
        if (feishuDocUrl) {
          const lastElement = message.card.elements[message.card.elements.length - 1];
          if (lastElement && 'actions' in lastElement && Array.isArray(lastElement.actions)) {
            lastElement.actions.push({
              tag: 'button',
              text: {
                tag: 'plain_text',
                content: '📄 飞书文档',
              },
              type: 'primary',
              url: feishuDocUrl,
            });
          }
        }
      } catch {
        console.log('⚠️  无法读取飞书文档链接');
      }
    }

    body = message;
    console.log('📤 发送飞书消息（links 卡片）');
    console.log('  - GitHub 运行链接:', githubRunUrl);
    console.log('  - GitHub Pages 链接:', githubPagesUrl);
  } else {
    body = {
      msg_type: 'interactive',
      card: {
        header: {
          title: {
            tag: 'plain_text',
            content: cardTitle,
          },
          template: cardTemplate,
        },
        elements: [
          {
            tag: 'div',
            text: {
              tag: 'lark_md',
              content: resultMd,
            },
          },
        ],
      },
    };
    console.log('📤 发送飞书消息（interactive）');
  }

  if (webhookSecret) {
    const bodyString = JSON.stringify(body);
    const signString = `${timestamp}\n${bodyString}`;
    const sign = crypto.createHmac('sha256', webhookSecret).update(signString).digest('base64');
    headers['X-Lark-Request-Timestamp'] = String(timestamp);
    headers['X-Lark-Signature'] = sign;
    console.log('  - 已添加请求签名');
  } else {
    console.log('  - 未配置 FEISHU_WEBHOOK_SECRET，不附加签名');
  }

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    console.log('📥 飞书响应：', response.status, response.statusText);
    const responseText = await response.text();
    if (response.ok) {
      console.log('✅ 飞书通知发送成功');
    } else {
      console.log('❌ 飞书通知发送失败:', responseText);
    }
  } catch (error) {
    console.log('❌ 飞书通知发送异常:', error);
  }
}

/** @returns 是否执行成功；continueOnError 为 false 时失败会抛错，无返回值 */
function runCommand(command: string, description: string, continueOnError: boolean = false): boolean {
  console.log(`\n📋 ${description}`);
  console.log(`🔧 执行命令: ${command}`);
  try {
    execSync(command, { stdio: 'inherit' });
    console.log(`✅ ${description} 完成`);
    return true;
  } catch (error) {
    console.error(`❌ ${description} 失败`);
    if (continueOnError) {
      console.log(`⚠️  继续执行后续步骤...`);
      return false;
    }
    throw error;
  }
}

function findFiles(dir: string, pattern: RegExp): string[] {
  const files: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...findFiles(fullPath, pattern));
    } else if (pattern.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

/** 与 optimize-raw-recordings 一致：跳过 original/ 备份，只选真实录制用例 */
function isRawRecordingSpecPath(fullPath: string, rawRoot: string): boolean {
  const rel = path.relative(rawRoot, fullPath);
  return !rel.startsWith(`original${path.sep}`) && rel !== 'original';
}

/** 与本次录制对应的优化产物（basename 匹配），优先当前环境 */
function findOptimizedSpecForRawRecording(rawSpecPath: string, optimizedRoot: string): string | null {
  const stem = path.basename(rawSpecPath, '.spec.ts');
  const wantBase = `${stem}.optimized.spec.ts`;
  const meta = parseEnvAndDateCategoryFromRawOrProcessed(rawSpecPath);
  const runtimeEnv = process.env.PLAYWRIGHT_ENV?.trim() || meta.env || getLegacyEnvDefault();
  const candidates = findFiles(optimizedRoot, /\.optimized\.spec\.ts$/).filter(
    (p) => path.basename(p) === wantBase,
  );
  if (candidates.length === 0) return null;
  const envMatched = candidates.filter((p) => {
    const rel = path.relative(process.cwd(), p).replace(/\\/g, '/');
    return specMatchesEnv(rel, meta.env || runtimeEnv);
  });
  const pool = envMatched.length ? envMatched : candidates;
  if (pool.length === 1) return pool[0];
  return pool.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
}

/** 解析录制根目录：CLI > RAW_RECORDINGS_DIR > 默认路径回退（首个含可用 .spec.ts 的目录） */
function resolveRawRecordingsRoot(cliDir: string | undefined): string {
  const fromCli = cliDir?.trim();
  const fromEnv = process.env.RAW_RECORDINGS_DIR?.trim();
  const explicit = fromCli || fromEnv;

  if (explicit) {
    const abs = path.resolve(process.cwd(), explicit);
    if (!fs.existsSync(abs)) {
      throw new Error(
        `录制目录不存在: ${abs}（来自 ${fromCli ? '--raw-recordings-dir' : 'RAW_RECORDINGS_DIR'}）`,
      );
    }
    if (!fs.statSync(abs).isDirectory()) {
      throw new Error(`录制路径不是目录: ${abs}`);
    }
    const specs = findFiles(abs, /\.spec\.ts$/).filter((p) => isRawRecordingSpecPath(p, abs));
    if (specs.length === 0) {
      throw new Error(`录制目录中未找到可用的 .spec.ts（已跳过 original/）: ${abs}`);
    }
    console.log(
      `📂 使用录制根目录: ${path.relative(process.cwd(), abs) || '.'}（${fromCli ? 'CLI' : 'RAW_RECORDINGS_DIR'}）`,
    );
    return abs;
  }

  const defaultRawRoot = 'tests/raw-recordings';
  const abs = path.resolve(process.cwd(), defaultRawRoot);
  if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) {
    const specs = findFiles(abs, /\.spec\.ts$/).filter((p) => isRawRecordingSpecPath(p, abs));
    if (specs.length > 0) {
      console.log(`📂 使用录制根目录: ${defaultRawRoot}`);
      return abs;
    }
  }

  throw new Error(
    `未找到可用录制文件。请将用例放在 tests/raw-recordings/，或设置 RAW_RECORDINGS_DIR / --raw-recordings-dir。\n` +
      `已检查: ${defaultRawRoot}（须含非 original 的 .spec.ts）`,
  );
}

function scriptKeyFromOptimizedPath(optimizedTestPath: string): string {
  const rel = path.relative(path.join(process.cwd(), 'tests/optimized'), path.resolve(optimizedTestPath));
  const parts = rel.split(path.sep).filter(Boolean);
  const file = parts.pop() || '';
  const stem = file.replace(/\.optimized\.spec\.ts$/, '').replace(/\.spec\.ts$/, '');
  if (parts.length) return `${parts.join('/')}/${stem}`;
  return stem;
}

function findLatestRunTimestamp(scriptKey: string, browser: string): string | null {
  const runDir = path.join(process.cwd(), 'screenshots', scriptKey, browserToRunSegment(browser));
  if (!fs.existsSync(runDir)) return null;
  const runs = fs
    .readdirSync(runDir)
    .filter((f) => fs.statSync(path.join(runDir, f)).isDirectory())
    .sort((a, b) => fs.statSync(path.join(runDir, b)).mtimeMs - fs.statSync(path.join(runDir, a)).mtimeMs);
  return runs[0] || null;
}

function recordLastGreenForScript(scriptKey: string, browsers: string[]): void {
  for (const browser of browsers) {
    const ts = findLatestRunTimestamp(scriptKey, browser);
    if (ts) recordLastGreenRun(scriptKey, browser, ts);
  }
}

function readUiIssuesSummary(): UiIssuesReport['summary'] | undefined {
  const p = path.join(process.cwd(), 'results/ui-issues.json');
  if (!fs.existsSync(p)) return undefined;
  try {
    const report = JSON.parse(fs.readFileSync(p, 'utf-8')) as UiIssuesReport;
    return report.summary;
  } catch {
    return undefined;
  }
}

function resolveRawSpecs(
  opts: CliOptions,
  rawRecordingsDir: string,
): string[] {
  if (opts.specPath) {
    const abs = path.resolve(process.cwd(), opts.specPath);
    if (!fs.existsSync(abs)) throw new Error(`--spec 路径不存在: ${abs}`);
    if (abs.includes('.optimized.')) {
      throw new Error('--spec 请指向 raw 录制 .spec.ts；optimized 请直接 playwright test');
    }
    return [abs];
  }
  const all = findFiles(rawRecordingsDir, /\.spec\.ts$/)
    .filter((p) => isRawRecordingSpecPath(p, rawRecordingsDir))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  if (opts.batch) return all;
  if (all.length === 0) throw new Error('录制文件不存在');
  return [all[0]];
}

async function processOneRecording(
  rawRecordingPath: string,
  optimizedDir: string,
  opts: CliOptions,
): Promise<{
  optimizedTestPath: string;
  testPassed: boolean;
}> {
  console.log(`\n📁 处理录制: ${rawRecordingPath}`);
  runCommand(`npm run optimize-raw-recordings -- "${rawRecordingPath}"`, '优化测试脚本（raw → optimized）');

  const optimizedTestPath = findOptimizedSpecForRawRecording(rawRecordingPath, optimizedDir);
  if (!optimizedTestPath) {
    throw new Error(`未找到优化产物: ${rawRecordingPath}`);
  }
  console.log(`📁 优化文件: ${optimizedTestPath}`);

  const optimizedRel = path.relative(process.cwd(), optimizedTestPath).replace(/\\/g, '/');
  const runtimeEnv = process.env.PLAYWRIGHT_ENV?.trim() || getLegacyEnvDefault();
  assertSpecEnvMatch(optimizedRel, runtimeEnv);

  const projectArgs = opts.playwrightProjects.map((p) => `--project=${p}`).join(' ');
  const testPassed = runCommand(
    `npx playwright test "${optimizedTestPath}" ${projectArgs}`,
    '执行优化后的测试',
    true,
  );

  if (testPassed) {
    const scriptKey = scriptKeyFromOptimizedPath(optimizedTestPath);
    recordLastGreenForScript(scriptKey, ['chrome', 'webkit']);
  }

  return { optimizedTestPath, testPassed };
}

async function main(): Promise<void> {
  const opts = parseCli(process.argv.slice(2));

  console.log('🎬 开始自动化测试流程...\n');
  console.log(
    `⚙️  feishu-mode=${opts.feishuMode}, create-feishu-doc=${opts.createFeishuDoc}, projects=${opts.playwrightProjects.join(',')}\n`,
  );

  const now = new Date();
  const timestamp =
    now.getFullYear() +
    '-' +
    String(now.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(now.getDate()).padStart(2, '0') +
    '_' +
    String(now.getHours()).padStart(2, '0') +
    '-' +
    String(now.getMinutes()).padStart(2, '0') +
    '-' +
    String(now.getSeconds()).padStart(2, '0');

  const optimizedDir = 'tests/optimized';

  try {
    console.log('📅 时间戳:', timestamp);

    const isCI =
      process.env.CI === 'true' ||
      process.env.CI === '1' ||
      process.env.GITHUB_ACTIONS === 'true' ||
      process.env.GITHUB_ACTIONS === '1';

    if (isCI) {
      console.log('🤖 检测到 CI/CD 环境，跳过录制步骤');
      console.log('📁 将使用已存在的录制文件');
    } else {
      runCommand('npm run record', '1. 录制测试脚本');
    }

    // 录制完成后再解析目录：Codegen 写入 tests/raw-recordings
    const rawRecordingsDir = resolveRawRecordingsRoot(opts.rawRecordingsDir);

    const rawSpecs = resolveRawSpecs(opts, rawRecordingsDir);
    if (rawSpecs.length === 0) throw new Error('录制文件不存在');

    let testPassed = true;
    let comparePassed = true;
    let lastOptimized = '';
    let lastRaw = '';

    for (let i = 0; i < rawSpecs.length; i++) {
      const rawRecordingPath = rawSpecs[i];
      if (opts.batch && rawSpecs.length > 1) {
        console.log(`\n━━━ 批量 [${i + 1}/${rawSpecs.length}] ━━━`);
      }
      const result = await processOneRecording(rawRecordingPath, optimizedDir, opts);
      lastRaw = rawRecordingPath;
      lastOptimized = result.optimizedTestPath;
      testPassed = testPassed && result.testPassed;
    }

    const gateFlag = opts.compareGate ? ' -- --gate' : '';
    comparePassed = runCommand(
      `npm run compare-screenshots${gateFlag}`,
      '4. 生成截图对比报告',
      !opts.compareGate,
    );

    let feishuDocPassed = true;
    if (opts.createFeishuDoc) {
      feishuDocPassed = runCommand('npm run create-feishu-doc', '5. 创建飞书文档', true);
    }

    const uiIssues = readUiIssuesSummary();

    const notifySummary: AutoTestNotifySummary = {
      recordSkipped: isCI,
      testPassed,
      comparePassed,
      feishuDocAttempted: opts.createFeishuDoc,
      feishuDocPassed,
      uiIssues,
    };

    await sendFeishuNotification(opts.feishuMode, notifySummary);

    const flowAllOk =
      testPassed && comparePassed && (!opts.createFeishuDoc || feishuDocPassed);

    console.log(`\n📁 生成的文件:`);
    console.log(`  - 录制: ${lastRaw}`);
    console.log(`  - 优化: ${lastOptimized}`);
    console.log(`  - 对比报告: results/screenshot-comparison.html`);
    console.log(`  - UI 问题: results/ui-issues.json`);

    if (flowAllOk) {
      console.log('\n🎉 所有步骤执行成功！');
    } else {
      console.error('\n⚠️ 流程已结束，但存在失败步骤（见上方日志与飞书摘要）');
      process.exit(1);
    }
  } catch (e) {
    console.error('\n❌ 流程执行失败，请检查错误信息');
    if (e instanceof Error && e.message) {
      console.error(e.message);
    }
    process.exit(1);
  }
}

main();
