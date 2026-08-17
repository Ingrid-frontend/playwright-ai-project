import dotenv from 'dotenv';
import { canSendFeishuNotify, resolveFeishuChatId, resolveFeishuWebhookUrl, sendFeishuNotify } from './index.js';

dotenv.config();

if (!canSendFeishuNotify()) {
  console.error('❌ 错误：未配置飞书通知通道');
  console.log('');
  console.log('💡 优先（自建应用）：');
  console.log('  FEISHU_APP_ID / FEISHU_APP_SECRET / FEISHU_CHAT_ID');
  console.log('');
  console.log('💡 或（群机器人 Webhook）：');
  console.log('  FEISHU_WEBHOOK_URL');
  process.exit(1);
}

const viaApp = Boolean(resolveFeishuChatId());
console.log('🎬 飞书通知测试');
console.log('');
console.log(`🔑 通道: ${viaApp ? '自建应用 IM' : 'Webhook'}`);
console.log('');

const testMessage = {
  msg_type: 'interactive' as const,
  card: {
    header: {
      title: {
        tag: 'plain_text',
        content: viaApp ? '🎉 飞书自建应用发信测试' : '🎉 飞书 Webhook 配置测试',
      },
      template: 'green',
    },
    elements: [
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: viaApp
            ? `✅ **测试成功！**\n\n消息由自建应用发出。\nchat_id: \`${resolveFeishuChatId()}\``
            : '✅ **测试成功！**\n\n你的飞书 Webhook URL 配置正确，可以正常接收消息。',
        },
      },
      { tag: 'hr' },
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content:
            '📋 **测试信息**：\n' +
            '- 测试时间：' +
            new Date().toLocaleString('zh-CN') +
            '\n' +
            `- 测试类型：${viaApp ? '自建应用 IM' : 'Webhook'}\n` +
            '- 测试状态：成功' +
            (viaApp ? '' : `\n- Webhook: ${resolveFeishuWebhookUrl() ? '已配置' : '未配置'}`),
        },
      },
    ],
  },
};

console.log('📤 发送测试消息...');
console.log('');

sendFeishuNotify(testMessage)
  .then((ok) => {
    if (ok) {
      console.log('');
      console.log('✅ 测试成功！请到目标群查看消息。');
      process.exit(0);
    }
    console.log('');
    console.log('❌ 测试失败');
    process.exit(1);
  })
  .catch((error: unknown) => {
    console.error('❌ 请求失败:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
