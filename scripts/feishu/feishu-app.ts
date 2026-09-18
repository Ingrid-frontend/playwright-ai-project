import fs from 'fs';
import { fetchWithRetry } from './feishu-utils.js';

export interface FeishuAppConfig {
  appId: string;
  appSecret: string;
}

export function loadFeishuAppConfig(): FeishuAppConfig | null {
  let appId = process.env.FEISHU_APP_ID?.trim() || '';
  let appSecret = process.env.FEISHU_APP_SECRET?.trim() || '';

  if (!appId || !appSecret) {
    try {
      const cfg = JSON.parse(fs.readFileSync('feishu-config.json', 'utf-8')) as {
        appId?: string;
        appSecret?: string;
      };
      appId = appId || cfg.appId || '';
      appSecret = appSecret || cfg.appSecret || '';
    } catch {
      /* ignore */
    }
  }

  if (!appId || !appSecret) return null;
  return { appId, appSecret };
}

export async function getFeishuAccessToken(config: FeishuAppConfig): Promise<string> {
  const res = await fetchWithRetry('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: config.appId, app_secret: config.appSecret }),
  });
  const data = (await res.json()) as { code: number; msg?: string; tenant_access_token?: string };
  if (data.code !== 0 || !data.tenant_access_token) {
    throw new Error(`获取 token 失败: ${data.msg || 'unknown'}`);
  }
  return data.tenant_access_token;
}

export async function uploadMessageImage(token: string, png: Buffer, fileName = 'chart.png'): Promise<string> {
  const form = new FormData();
  form.append('image_type', 'message');
  form.append('image', new Blob([new Uint8Array(png)], { type: 'image/png' }), fileName);

  const res = await fetchWithRetry('https://open.feishu.cn/open-apis/im/v1/images', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const data = (await res.json()) as { code: number; msg?: string; data?: { image_key?: string } };
  if (data.code !== 0 || !data.data?.image_key) {
    throw new Error(`上传图片失败: ${data.msg || 'unknown'}`);
  }
  return data.data.image_key;
}

export type FeishuNotifyPayload =
  | { msg_type: 'text'; content: { text: string } }
  | {
      msg_type: 'interactive';
      card: {
        header: { title: { tag: string; content: string }; template: string };
        elements: unknown[];
      };
    };

export type NotifyChannel = 'customer' | 'internal';

export function resolveFeishuChatId(channel?: NotifyChannel): string {
  // 客户群只认专用变量，缺省不回退到内部群，避免客户卡片错发内部
  if (channel === 'customer') {
    return process.env.FEISHU_CHAT_ID_CUSTOMER?.trim() || '';
  }
  // 内部群优先专用变量，缺省回退到通用 FEISHU_CHAT_ID（即当前内部群）
  const namedInternal = channel === 'internal' ? process.env.FEISHU_CHAT_ID_INTERNAL?.trim() || '' : '';
  const fromEnv = namedInternal || process.env.FEISHU_CHAT_ID?.trim() || '';
  if (fromEnv) return fromEnv;
  try {
    const cfg = JSON.parse(fs.readFileSync('feishu-config.json', 'utf-8')) as { chatId?: string };
    return cfg.chatId?.trim() || '';
  } catch {
    return '';
  }
}

export function resolveFeishuWebhookUrl(): string {
  const fromEnv = process.env.FEISHU_WEBHOOK_URL?.trim() || '';
  if (fromEnv) return fromEnv;
  try {
    const cfg = JSON.parse(fs.readFileSync('feishu-config.json', 'utf-8')) as { webhookUrl?: string };
    return cfg.webhookUrl?.trim() || '';
  } catch {
    return '';
  }
}

export function canSendFeishuNotify(): boolean {
  if (resolveFeishuChatId() && loadFeishuAppConfig()) return true;
  return Boolean(resolveFeishuWebhookUrl());
}

export async function sendFeishuNotify(payload: FeishuNotifyPayload, channel?: NotifyChannel): Promise<boolean> {
  const chatId = resolveFeishuChatId(channel);
  const app = loadFeishuAppConfig();

  if (channel === 'customer' && !chatId) {
    console.log('⚠️  未配置 FEISHU_CHAT_ID_CUSTOMER，跳过客户群通知（不回退内部群/Webhook）');
    return false;
  }

  if (chatId && app) {
    const token = await getFeishuAccessToken(app);
    const content =
      payload.msg_type === 'text' ? JSON.stringify(payload.content) : JSON.stringify(payload.card);
    const res = await fetchWithRetry(
      'https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          receive_id: chatId,
          msg_type: payload.msg_type,
          content,
        }),
      },
    );
    const data = (await res.json()) as { code: number; msg?: string; data?: { message_id?: string } };
    if (data.code === 0) {
      console.log(`✅ 飞书通知发送成功（自建应用 → ${chatId}）`);
      return true;
    }
    console.log(`❌ 飞书自建应用发信失败: code=${data.code} msg=${data.msg}`);
    return false;
  }

  if (channel === 'customer') {
    console.log('⚠️  客户群通知需应用凭证 + FEISHU_CHAT_ID_CUSTOMER，不走 Webhook 回退，跳过');
    return false;
  }

  const webhookUrl = resolveFeishuWebhookUrl();
  if (!webhookUrl) {
    console.log('⚠️  未配置 FEISHU_CHAT_ID+应用凭证，也未配置 FEISHU_WEBHOOK_URL，跳过通知');
    return true;
  }

  const webhookSecret = process.env.FEISHU_WEBHOOK_SECRET?.trim();
  const timestamp = Math.floor(Date.now() / 1000);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (webhookSecret) {
    const crypto = await import('crypto');
    const bodyString = JSON.stringify(payload);
    headers['X-Lark-Request-Timestamp'] = String(timestamp);
    headers['X-Lark-Signature'] = crypto
      .createHmac('sha256', webhookSecret)
      .update(`${timestamp}\n${bodyString}`)
      .digest('base64');
  }

  const res = await fetchWithRetry(webhookUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  if (res.ok) {
    console.log('✅ 飞书通知发送成功（Webhook）');
    return true;
  }
  console.log(`❌ 飞书 Webhook 发信失败: ${res.status} ${text}`);
  return false;
}
