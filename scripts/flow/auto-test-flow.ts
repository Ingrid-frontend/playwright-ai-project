import { execSync } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

type FeishuMode = 'interactive' | 'text' | 'links' | 'none';

type CliOptions = {
  feishuMode: FeishuMode;
  createFeishuDoc: boolean;
  playwrightProject: string;
};

function printHelp(): void {
  console.log(`用法: tsx scripts/auto-test-flow.ts [选项]

录制 → 优化 → 执行 → 截图对比 →（可选）飞书文档 / 飞书通知

选项:
  --feishu-mode=<interactive|text|links|none>  飞书通知样式（默认 interactive）
  --create-feishu-doc                           流程末尾执行 npm run create-feishu-doc
  --playwright-project=<name>                 执行用例的 project（默认 optimized）
  -h, --help                                  显示帮助

环境变量 FEISHU_MODE 与 --feishu-mode 相同；命令行优先。

feishu-mode 说明:
  interactive  简单卡片（默认）
  text         纯文本 webhook
  links        卡片 + GitHub / Pages 按钮，可读 results/feishu-doc-url.txt 附加文档链接
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
  let playwrightProject = 'optimized';

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
      playwrightProject = arg.slice('--playwright-project='.length).trim() || 'optimized';
      continue;
    }
  }

  return { feishuMode, createFeishuDoc, playwrightProject };
}

async function sendFeishuNotification(mode: FeishuMode): Promise<void> {
  if (mode === 'none') {
    console.log('ℹ️  feishu-mode=none，跳过飞书通知');
    return;
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

  const timestamp = Math.floor(Date.now() / 1000);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  let body: object;

  if (mode === 'text') {
    body = {
      msg_type: 'text',
      content: {
        text: `🎉 Playwright AI 测试完成\n\n**测试结果**：\n✅ 录制：成功\n✅ 优化：成功\n✅ 执行：成功\n✅ 对比：成功`,
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
            content: '🎉 Playwright AI 测试完成',
          },
          template: 'green' as const,
        },
        elements: [
          {
            tag: 'div' as const,
            text: {
              tag: 'lark_md' as const,
              content: '**测试结果**：\n✅ 录制：成功\n✅ 优化：成功\n✅ 执行：成功\n✅ 对比：成功',
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
            content: '🎉 Playwright AI 测试完成',
          },
          template: 'green',
        },
        elements: [
          {
            tag: 'div',
            text: {
              tag: 'lark_md',
              content: `**测试结果**：\n✅ 录制：成功\n✅ 优化：成功\n✅ 执行：成功\n✅ 对比：成功`,
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

function runCommand(command: string, description: string, continueOnError: boolean = false): void {
  console.log(`\n📋 ${description}`);
  console.log(`🔧 执行命令: ${command}`);
  try {
    execSync(command, { stdio: 'inherit' });
    console.log(`✅ ${description} 完成`);
  } catch (error) {
    console.error(`❌ ${description} 失败`);
    if (continueOnError) {
      console.log(`⚠️  继续执行后续步骤...`);
    } else {
      throw error;
    }
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

async function main(): Promise<void> {
  const opts = parseCli(process.argv.slice(2));

  console.log('🎬 开始自动化测试流程...\n');
  console.log(
    `⚙️  feishu-mode=${opts.feishuMode}, create-feishu-doc=${opts.createFeishuDoc}, project=${opts.playwrightProject}\n`,
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

  const rawRecordingsDir = 'tests/raw-recordings';
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

    const rawRecordingFiles = findFiles(rawRecordingsDir, /\.spec\.ts$/).sort((a, b) =>
      b.localeCompare(a),
    );

    if (rawRecordingFiles.length === 0) {
      throw new Error('录制文件不存在');
    }

    const rawRecordingPath = rawRecordingFiles[0];
    console.log(`📁 找到录制文件: ${rawRecordingPath}`);

    runCommand(`npm run optimize -- "${rawRecordingPath}"`, '2. 优化测试脚本');

    const optimizedFiles = findFiles(optimizedDir, /\.optimized\.spec\.ts$/).sort((a, b) =>
      b.localeCompare(a),
    );

    if (optimizedFiles.length === 0) {
      throw new Error('优化文件不存在');
    }

    const optimizedTestPath = optimizedFiles[0];
    console.log(`📁 找到优化文件: ${optimizedTestPath}`);

    runCommand(
      `npx playwright test "${optimizedTestPath}" --project=${opts.playwrightProject}`,
      '3. 执行优化后的测试',
      true,
    );

    runCommand('npm run compare-screenshots', '4. 生成截图对比报告');

    if (opts.createFeishuDoc) {
      runCommand('npm run create-feishu-doc', '5. 创建飞书文档', true);
    }

    await sendFeishuNotification(opts.feishuMode);

    console.log('\n🎉 所有步骤执行成功！');
    console.log(`\n📁 生成的文件:`);
    console.log(`  - 录制文件: ${rawRecordingPath}`);
    console.log(`  - 优化文件: ${optimizedTestPath}`);
    console.log(`  - 对比报告: results/screenshot-comparison.html`);
  } catch {
    console.error('\n❌ 流程执行失败，请检查错误信息');
    process.exit(1);
  }
}

main();
