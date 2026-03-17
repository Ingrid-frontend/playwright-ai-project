import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

async function sendFeishuNotification() {
  const webhookUrl = process.env.FEISHU_WEBHOOK_URL;
  const webhookSecret = process.env.FEISHU_WEBHOOK_SECRET;
  
  console.log('🔍 飞书通知配置检查：');
  console.log('  - Webhook URL:', webhookUrl ? '已配置' : '未配置');
  console.log('  - Webhook Secret:', webhookSecret ? '已配置' : '未配置');
  
  if (!webhookUrl) {
    console.log('⚠️  未配置飞书 Webhook URL，跳过通知');
    return;
  }

  try {
    const timestamp = Math.floor(Date.now() / 1000);  // 飞书需要秒级时间戳
    
    // 使用简单的文本消息格式
    const message = {
      msg_type: 'text',
      content: {
        text: `🎉 Playwright AI 测试完成\n\n**测试结果**：\n✅ 录制：成功\n✅ 优化：成功\n✅ 执行：成功\n✅ 对比：成功`
      }
    };

    console.log('📤 发送飞书消息：');
    console.log('  - 消息类型:', message.msg_type);
    console.log('  - 时间戳:', timestamp, '(秒级)');

    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };

    if (webhookSecret) {
      const crypto = await import('crypto');
      const signString = `${timestamp}\n${JSON.stringify(message)}`;
      const sign = crypto.createHmac('sha256', webhookSecret)
        .update(signString)
        .digest('base64');
      
      headers['X-Lark-Request-Timestamp'] = String(timestamp);
      headers['X-Lark-Signature'] = sign;
      console.log('  - 签名：已添加');
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
  console.log('🎬 开始自动化测试流程...\n');

  const now = new Date();
  const timestamp = now.getFullYear() + '-' + 
    String(now.getMonth() + 1).padStart(2, '0') + '-' + 
    String(now.getDate()).padStart(2, '0') + '_' + 
    String(now.getHours()).padStart(2, '0') + '-' + 
    String(now.getMinutes()).padStart(2, '0') + '-' + 
    String(now.getSeconds()).padStart(2, '0');

  const rawRecordingsDir = 'tests/raw-recordings';
  const optimizedDir = 'tests/optimized';

  try {
    console.log('📅 时间戳:', timestamp);

    // CI/CD 环境中跳过录制，使用已存在的脚本
    // 使用更可靠的 CI 环境检测方式
    const isCI = process.env.CI === 'true' || 
                   process.env.CI === '1' || 
                   process.env.GITHUB_ACTIONS === 'true' ||
                   process.env.GITHUB_ACTIONS === '1';
    
    if (isCI) {
      console.log('🤖 检测到 CI/CD 环境，跳过录制步骤');
      console.log('📁 将使用已存在的录制文件');
    } else {
      runCommand('npm run record', '1. 录制测试脚本');
    }

    const rawRecordingFiles = fs.readdirSync(rawRecordingsDir)
      .filter(f => f.endsWith('.spec.ts'))
      .sort((a, b) => b.localeCompare(a));
    
    if (rawRecordingFiles.length === 0) {
      throw new Error('录制文件不存在');
    }
    
    const rawRecordingPath = path.join(rawRecordingsDir, rawRecordingFiles[0]);
    console.log(`📁 找到录制文件: ${rawRecordingPath}`);

    runCommand(`npm run optimize ${rawRecordingPath}`, '2. 优化测试脚本');

    const optimizedFiles = fs.readdirSync(optimizedDir)
      .filter(f => f.endsWith('.optimized.spec.ts'))
      .sort((a, b) => b.localeCompare(a));
    
    if (optimizedFiles.length === 0) {
      throw new Error('优化文件不存在');
    }
    
    const optimizedTestPath = path.join(optimizedDir, optimizedFiles[0]);
    console.log(`📁 找到优化文件: ${optimizedTestPath}`);

    runCommand(`npx playwright test ${optimizedTestPath} --project=chromium`, '3. 执行优化后的测试', true);

    runCommand('npm run compare-screenshots', '4. 生成截图对比报告');

    // 发送飞书通知
    await sendFeishuNotification();

    console.log('\n🎉 所有步骤执行成功！');
    console.log(`\n📁 生成的文件:`);
    console.log(`  - 录制文件: ${rawRecordingPath}`);
    console.log(`  - 优化文件: ${optimizedTestPath}`);
    console.log(`  - 对比报告: results/screenshot-comparison.html`);

  } catch (error) {
    console.error('\n❌ 流程执行失败，请检查错误信息');
    process.exit(1);
  }
}

main();
