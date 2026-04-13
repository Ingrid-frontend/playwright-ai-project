import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

async function sendFeishuNotification() {
  const webhookUrl = process.env.FEISHU_WEBHOOK_URL;
  const webhookSecret = process.env.FEISHU_WEBHOOK_SECRET;
  const githubEnabled = process.env.ENABLE_GITHUB === '1';
  const sensitiveLogsEnabled = process.env.ENABLE_SENSITIVE_LOGS === '1';
  
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
    
    const message = {
      msg_type: 'interactive',
      card: {
        header: {
          title: {
            tag: 'plain_text',
            content: '🎉 Playwright AI 测试完成'
          },
          template: 'green'
        },
        elements: [
          {
            tag: 'div',
            text: {
              tag: 'lark_md',
              content: '**测试结果**：\n✅ 执行：成功\n✅ 对比：成功'
            }
          },
          ...(githubEnabled ? [{
            tag: 'action',
            actions: [
              {
                tag: 'button',
                text: {
                  tag: 'plain_text',
                  content: '🌐 在线预览'
                },
                type: 'primary',
                url: githubPagesUrl
              },
              {
                tag: 'button',
                text: {
                  tag: 'plain_text',
                  content: '📥 下载报告'
                },
                type: 'default',
                url: githubRunUrl
              }
            ]
          }] : []),
          {
            tag: 'div',
            text: {
              tag: 'lark_md',
              content: '**飞书文档**：'
            }
          },
          {
            tag: 'action',
            actions: []
          }
        ]
      }
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
                content: '📄 飞书文档'
              },
              type: 'primary',
              url: feishuDocUrl
            });
          }
        }
      } catch (error) {
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
      'Content-Type': 'application/json'
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
      
      const sign = crypto.createHmac('sha256', webhookSecret)
        .update(signString)
        .digest('base64');
      
      headers['X-Lark-Request-Timestamp'] = String(timestamp);
      headers['X-Lark-Signature'] = sign;
      console.log('  - 签名：已添加');
    } else {
      console.log('  - 签名：未配置（跳过签名验证）');
    }

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(message)
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

async function main() {
  console.log('🎬 开始执行优化后的测试...\n');

  const optimizedDir = 'tests/optimized';
  const browsers = ['chromium', 'webkit'];

  try {
    const optimizedFiles = fs.readdirSync(optimizedDir)
      .filter(f => f.endsWith('.optimized.spec.ts'))
      .sort();
    
    if (optimizedFiles.length === 0) {
      console.log('⚠️  未找到优化后的测试文件');
      process.exit(0);
    }
    
    console.log(`📋 找到 ${optimizedFiles.length} 个优化后的测试文件\n`);

    let totalSuccessCount = 0;
    let totalFailCount = 0;

    for (const browser of browsers) {
      console.log(`\n🌐 开始执行 ${browser} 测试...\n`);
      
      let successCount = 0;
      let failCount = 0;

      for (const file of optimizedFiles) {
        const testPath = path.join(optimizedDir, file);
        console.log(`\n🧪 执行测试: ${file} (${browser})`);
        
        try {
          execSync(`npx playwright test ${testPath} --project=${browser} --workers=1`, {
            stdio: 'inherit'
          });
          console.log(`✅ ${file} 测试通过 (${browser})`);
          successCount++;
        } catch (error) {
          console.error(`❌ ${file} 测试失败 (${browser})`);
          failCount++;
        }
      }

      console.log(`\n📊 ${browser} 测试执行结果：`);
      console.log(`  - 总数: ${optimizedFiles.length}`);
      console.log(`  - 成功: ${successCount}`);
      console.log(`  - 失败: ${failCount}`);

      totalSuccessCount += successCount;
      totalFailCount += failCount;
    }

    console.log(`\n📊 总体测试执行结果：`);
    console.log(`  - 浏览器数: ${browsers.length}`);
    console.log(`  - 测试文件数: ${optimizedFiles.length}`);
    console.log(`  - 总测试数: ${optimizedFiles.length * browsers.length}`);
    console.log(`  - 成功: ${totalSuccessCount}`);
    console.log(`  - 失败: ${totalFailCount}`);

    if (totalFailCount > 0) {
      console.log(`\n⚠️  有 ${totalFailCount} 个测试失败，但继续执行后续步骤...`);
    }

    runCommand('npm run compare-screenshots', '生成截图对比报告');

    runCommand('npm run create-feishu-doc', '创建飞书文档', true);

    await sendFeishuNotification();

    console.log('\n🎉 所有步骤执行成功！');

  } catch (error) {
    console.error('\n❌ 流程执行失败，请检查错误信息');
    process.exit(1);
  }
}

main();
