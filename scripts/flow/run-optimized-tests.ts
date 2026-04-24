import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

type RunSummary = {
  testPassed: boolean;
  comparePassed: boolean;
  feishuDocAttempted: boolean;
  feishuDocPassed: boolean;
};

function printHelp(): void {
  console.log(`用法: tsx scripts/flow/run-optimized-tests.ts [选项]

递归执行目录下所有 *.optimized.spec.ts，可按多个 Playwright project 各跑一遍。

选项:
  --projects=<a,b>          逗号分隔的 project 名（默认 optimized，与 playwright.config 一致）
  --optimized-dir=<path>    扫描根目录（默认 tests/optimized；可用环境变量 OPTIMIZED_TESTS_DIR）
  --stop, -s                某一用例失败后不再执行后续用例（仍会继续对比/飞书步骤）
  --verbose, -v             playwright 附加 --reporter=list
  --clean                   预留：文档中的清理失败截图；当前版本仅打印提示后跳过
  -h, --help                显示帮助
`);
}

function parseCli(argv: string[]): {
  verbose: boolean;
  stopOnError: boolean;
  clean: boolean;
  projects: string[];
  optimizedDir: string;
} {
  let verbose = false;
  let stopOnError = false;
  let clean = false;
  let projects: string[] = [];
  const envDir = process.env.OPTIMIZED_TESTS_DIR?.trim();
  let optimizedDir = envDir && envDir.length > 0 ? envDir : 'tests/optimized';

  for (const arg of argv) {
    if (arg === '-h' || arg === '--help') {
      printHelp();
      process.exit(0);
    }
    if (arg === '--verbose' || arg === '-v') {
      verbose = true;
      continue;
    }
    if (arg === '--stop' || arg === '-s') {
      stopOnError = true;
      continue;
    }
    if (arg === '--clean') {
      clean = true;
      continue;
    }
    if (arg.startsWith('--projects=')) {
      projects = arg
        .slice('--projects='.length)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      continue;
    }
    if (arg.startsWith('--optimized-dir=')) {
      const v = arg.slice('--optimized-dir='.length).trim();
      if (v) optimizedDir = v;
      continue;
    }
  }

  if (projects.length === 0) {
    projects = ['optimized'];
  }

  return { verbose, stopOnError, clean, projects, optimizedDir };
}

function findOptimizedSpecFiles(rootDir: string): string[] {
  const absRoot = path.resolve(process.cwd(), rootDir);
  const out: string[] = [];

  function walk(dir: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(full);
      } else if (ent.name.endsWith('.optimized.spec.ts')) {
        out.push(full);
      }
    }
  }

  if (fs.existsSync(absRoot) && fs.statSync(absRoot).isDirectory()) {
    walk(absRoot);
  }

  return out.sort((a, b) => a.localeCompare(b));
}

async function sendFeishuNotification(summary: RunSummary): Promise<void> {
  const webhookUrl = process.env.FEISHU_WEBHOOK_URL;
  const webhookSecret = process.env.FEISHU_WEBHOOK_SECRET;
  const githubEnabled = process.env.ENABLE_GITHUB === '1';
  const sensitiveLogsEnabled = process.env.ENABLE_SENSITIVE_LOGS === '1';

  const allOk =
    summary.testPassed &&
    summary.comparePassed &&
    (!summary.feishuDocAttempted || summary.feishuDocPassed);

  console.log('🔍 飞书通知配置检查：');
  console.log('  - Webhook URL:', webhookUrl ? '已配置' : '未配置');
  console.log('  - Webhook Secret:', webhookSecret ? '已配置' : '未配置');

  if (!webhookUrl) {
    console.log('⚠️  未配置飞书 Webhook URL，跳过通知');
    return;
  }

  try {
    const timestamp = Math.floor(Date.now() / 1000);

    const githubRepository = process.env.GITHUB_REPOSITORY || 'Ingrid-frontend/playwright-ai-project';
    const githubRunId = process.env.GITHUB_RUN_ID || '';
    const githubRunUrl = githubEnabled ? `https://github.com/${githubRepository}/actions/runs/${githubRunId}` : '';
    const [owner, repo] = githubRepository.split('/');
    const githubPagesUrl = githubEnabled ? `https://${owner}.github.io/${repo}/screenshot-comparison.html` : '';

    const resultLines = [
      '**测试结果**：',
      `${summary.testPassed ? '✅' : '❌'} 执行：${summary.testPassed ? '成功' : '失败'}`,
      `${summary.comparePassed ? '✅' : '❌'} 对比：${summary.comparePassed ? '成功' : '失败'}`,
    ];
    if (summary.feishuDocAttempted) {
      resultLines.push(
        `${summary.feishuDocPassed ? '✅' : '❌'} 飞书文档：${summary.feishuDocPassed ? '成功' : '失败'}`,
      );
    }

    const message = {
      msg_type: 'interactive',
      card: {
        header: {
          title: {
            tag: 'plain_text',
            content: allOk ? '🎉 Playwright AI 测试完成' : '⚠️ Playwright AI 测试未完成',
          },
          template: allOk ? 'green' : 'red',
        },
        elements: [
          {
            tag: 'div',
            text: {
              tag: 'lark_md',
              content: resultLines.join('\n'),
            },
          },
          ...(githubEnabled
            ? [
                {
                  tag: 'action',
                  actions: [
                    {
                      tag: 'button',
                      text: {
                        tag: 'plain_text',
                        content: '🌐 在线预览',
                      },
                      type: 'primary',
                      url: githubPagesUrl,
                    },
                    {
                      tag: 'button',
                      text: {
                        tag: 'plain_text',
                        content: '📥 下载报告',
                      },
                      type: 'default',
                      url: githubRunUrl,
                    },
                  ],
                },
              ]
            : []),
          {
            tag: 'div',
            text: {
              tag: 'lark_md',
              content: '**飞书文档**：',
            },
          },
          {
            tag: 'action',
            actions: [] as { tag: string; text: { tag: string; content: string }; type: string; url: string }[],
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

    console.log('📤 发送飞书消息：');
    console.log('  - 消息类型:', message.msg_type);
    console.log('  - 时间戳:', timestamp, '(秒级)');
    if (githubEnabled) {
      console.log('  - GitHub 运行链接:', githubRunUrl);
      console.log('  - GitHub Pages 链接:', githubPagesUrl);
    } else {
      console.log('  - GitHub 链接：已禁用（ENABLE_GITHUB!=1）');
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (webhookSecret) {
      const crypto = await import('crypto');
      const bodyString = JSON.stringify(message);
      const signString = `${timestamp}\n${bodyString}`;

      if (sensitiveLogsEnabled) {
        console.log('  - 签名字符串:', signString);
        console.log('  - Body 字符串长度:', bodyString.length);
        console.log('  - Body 字符串:', bodyString);
      } else {
        console.log('  - 签名：已启用（敏感日志默认关闭，可设置 ENABLE_SENSITIVE_LOGS=1 查看细节）');
      }

      const sign = crypto.createHmac('sha256', webhookSecret).update(signString).digest('base64');

      headers['X-Lark-Request-Timestamp'] = String(timestamp);
      headers['X-Lark-Signature'] = sign;
      console.log('  - 签名：已添加');
    } else {
      console.log('  - 签名：未配置（跳过签名验证）');
    }

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(message),
    });

    console.log('📥 飞书响应：');
    console.log('  - 状态码:', response.status);
    console.log('  - 状态文本:', response.statusText);

    const responseText = await response.text();
    console.log('  - 响应内容:', responseText);

    if (response.ok) {
      console.log('✅ 飞书通知发送成功');
    } else {
      console.log('❌ 飞书通知发送失败');
      console.log('❌ 响应状态:', response.status, response.statusText);
      console.log('❌ 响应内容:', responseText);
    }
  } catch (error) {
    console.log('❌ 飞书通知发送异常:', error);
  }
}

function runCommandBool(command: string, description: string): boolean {
  console.log(`\n📋 ${description}`);
  console.log(`🔧 执行命令: ${command}`);
  try {
    execSync(command, { stdio: 'inherit' });
    console.log(`✅ ${description} 完成`);
    return true;
  } catch {
    console.error(`❌ ${description} 失败`);
    return false;
  }
}

async function main(): Promise<void> {
  const { verbose, stopOnError, clean, projects, optimizedDir } = parseCli(process.argv.slice(2));

  console.log('🎬 开始执行优化后的测试...\n');
  console.log(
    `⚙️  projects=${projects.join(',')}, dir=${optimizedDir}, stop=${stopOnError}, verbose=${verbose}\n`,
  );

  if (clean) {
    console.log('ℹ️  --clean（按文档清理失败用例截图）当前版本未实现，已跳过；可手动清理 screenshots / test-results。\n');
  }

  const absOptimizedDir = path.resolve(process.cwd(), optimizedDir);

  if (!fs.existsSync(absOptimizedDir) || !fs.statSync(absOptimizedDir).isDirectory()) {
    console.error(`❌ 优化测试目录不存在或不是目录: ${absOptimizedDir}`);
    process.exit(1);
  }

  const specAbsPaths = findOptimizedSpecFiles(optimizedDir);

  if (specAbsPaths.length === 0) {
    console.log('⚠️  未找到优化后的测试文件（递归 *.optimized.spec.ts）');
    process.exit(0);
  }

  console.log(`📋 找到 ${specAbsPaths.length} 个优化后的测试文件\n`);

  let totalSuccessCount = 0;
  let totalFailCount = 0;
  let aborted = false;

  for (const project of projects) {
    console.log(`\n🌐 开始执行 project「${project}」...\n`);

    let successCount = 0;
    let failCount = 0;

    for (const absPath of specAbsPaths) {
      const relPath = path.relative(process.cwd(), absPath);
      console.log(`\n🧪 执行测试: ${relPath} (${project})`);

      const reporter = verbose ? '--reporter=list' : '';
      try {
        execSync(`npx playwright test "${relPath}" --project=${project} --workers=1 ${reporter}`.trim(), {
          stdio: 'inherit',
        });
        console.log(`✅ ${relPath} 测试通过 (${project})`);
        successCount++;
      } catch {
        console.error(`❌ ${relPath} 测试失败 (${project})`);
        failCount++;
        if (stopOnError) {
          aborted = true;
          break;
        }
      }
    }

    console.log(`\n📊 project「${project}」执行结果：`);
    console.log(`  - 总数: ${specAbsPaths.length}`);
    console.log(`  - 成功: ${successCount}`);
    console.log(`  - 失败: ${failCount}`);

    totalSuccessCount += successCount;
    totalFailCount += failCount;

    if (aborted) {
      console.log('\n⏹️  已启用 --stop，后续 project / 用例不再执行。');
      break;
    }
  }

  console.log(`\n📊 总体测试执行结果：`);
  console.log(`  - project 数: ${projects.length}`);
  console.log(`  - 测试文件数: ${specAbsPaths.length}`);
  console.log(`  - 已执行用次数: ${totalSuccessCount + totalFailCount}`);
  console.log(`  - 成功: ${totalSuccessCount}`);
  console.log(`  - 失败: ${totalFailCount}`);

  const testPassed = totalFailCount === 0;

  const comparePassed = runCommandBool('npm run compare-screenshots', '生成截图对比报告');
  const feishuDocPassed = runCommandBool('npm run create-feishu-doc', '创建飞书文档');

  await sendFeishuNotification({
    testPassed,
    comparePassed,
    feishuDocAttempted: true,
    feishuDocPassed,
  });

  const flowAllOk = testPassed && comparePassed && feishuDocPassed;

  if (flowAllOk) {
    console.log('\n🎉 所有步骤执行成功！');
  } else {
    console.error('\n⚠️ 流程已结束，但存在失败步骤（见上方日志与飞书摘要）');
    process.exit(1);
  }
}

main();
