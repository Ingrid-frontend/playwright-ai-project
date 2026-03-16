const webhookUrl = process.env.FEISHU_WEBHOOK_URL || '';

if (!webhookUrl) {
  console.error('❌ 错误：未配置 FEISHU_WEBHOOK_URL 环境变量');
  console.log('');
  console.log('💡 解决方案：');
  console.log('  1. 在 .env 文件中添加：FEISHU_WEBHOOK_URL=你的WebhookURL');
  console.log('  2. 或者在命令行中设置：export FEISHU_WEBHOOK_URL=你的WebhookURL');
  console.log('  3. 或者创建 feishu-config.json 文件');
  console.log('');
  console.log('📚 详细配置指南：docs/feishu-webhook-setup.md');
  process.exit(1);
}

console.log('🎬 飞书 Webhook 测试工具');
console.log('');
console.log(`🔑 Webhook URL: ${webhookUrl.substring(0, 50)}...`);
console.log('');

const testMessage = {
  msg_type: 'interactive',
  card: {
    header: {
      title: {
        tag: 'plain_text',
        content: '🎉 飞书 Webhook 配置测试'
      },
      template: 'green'
    },
    elements: [
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: '✅ **测试成功！**\n\n你的飞书 Webhook URL 配置正确，可以正常接收消息。'
        }
      },
      {
        tag: 'hr'
      },
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: '📋 **测试信息**：\n' +
            '- 测试时间：' + new Date().toLocaleString('zh-CN') + '\n' +
            '- 测试类型：Webhook 连接测试\n' +
            '- 测试状态：成功'
        }
      }
    ]
  }
};

console.log('📤 发送测试消息...');
console.log('');

fetch(webhookUrl, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify(testMessage)
})
  .then(async response => {
    console.log('📥 飞书响应：');
    console.log(`  - 状态码: ${response.status}`);
    console.log(`  - 状态文本: ${response.statusText}`);
    
    const responseText = await response.text();
    console.log(`  - 响应内容: ${responseText}`);
    console.log('');
    
    if (response.ok) {
      console.log('✅ 测试成功！');
      console.log('');
      console.log('💡 提示：');
      console.log('  1. 检查飞书群聊，应该能看到测试消息');
      console.log('  2. 如果没有收到消息，请检查：');
      console.log('     - Webhook URL 是否正确');
      console.log('     - 机器人是否在群聊中');
      console.log('     - 机器人是否被禁用');
      console.log('  3. 配置完成后，可以运行：npm run send-html-to-feishu');
    } else {
      console.log('❌ 测试失败');
      console.log('');
      console.log('💡 解决方案：');
      console.log('  1. 检查 Webhook URL 是否正确');
      console.log('  2. 检查网络连接是否正常');
      console.log('  3. 检查机器人是否被禁用');
      console.log('  4. 查看飞书开放平台文档：https://open.feishu.cn');
    }
  })
  .catch(error => {
    console.error('❌ 请求失败:', error.message);
    console.log('');
    console.log('💡 解决方案：');
    console.log('  1. 检查网络连接是否正常');
    console.log('  2. 检查是否能访问飞书 API');
    console.log('  3. 检查是否有防火墙或代理限制');
    console.log('  4. 尝试使用 curl 测试：');
    console.log(`     curl -X POST ${webhookUrl} \\`);
    console.log('       -H "Content-Type: application/json" \\');
    console.log('       -d \'{"msg_type":"text","content":{"text":"测试"}}\'');
  });
