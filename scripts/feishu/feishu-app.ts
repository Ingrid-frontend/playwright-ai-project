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
