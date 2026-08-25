import fs from 'fs';
import path from 'path';

export type ApiFailureNotice = {
  kind: string;
  url: string;
  fullUrl?: string;
  method: string;
  status?: number;
  bodySummary?: string;
  errorText?: string;
  curl?: string;
};

type FeishuCfg = {
  chatId?: string;
  webhookUrl?: string;
  appId?: string;
  appSecret?: string;
};

function readFeishuCfg(): FeishuCfg {
  const cfg: FeishuCfg = {
    chatId: process.env.FEISHU_CHAT_ID?.trim() || '',
    webhookUrl: process.env.FEISHU_WEBHOOK_URL?.trim() || '',
    appId: process.env.FEISHU_APP_ID?.trim() || '',
    appSecret: process.env.FEISHU_APP_SECRET?.trim() || '',
  };
  if (cfg.chatId && cfg.appId && cfg.appSecret) return cfg;
  if (cfg.webhookUrl) return cfg;

  for (const rel of ['feishu-config.json', '../feishu-config.json']) {
    const p = path.resolve(process.cwd(), rel);
    if (!fs.existsSync(p)) continue;
    try {
      const file = JSON.parse(fs.readFileSync(p, 'utf-8')) as FeishuCfg;
      return {
        chatId: cfg.chatId || file.chatId || '',
        webhookUrl: cfg.webhookUrl || file.webhookUrl || '',
        appId: cfg.appId || file.appId || '',
        appSecret: cfg.appSecret || file.appSecret || '',
      };
    } catch {
      /* ignore */
    }
  }
  return cfg;
}

function canSendFeishu(): boolean {
  const cfg = readFeishuCfg();
  return Boolean((cfg.chatId && cfg.appId && cfg.appSecret) || cfg.webhookUrl);
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

function buildMarkdown(failures: ApiFailureNotice[], label: string): string {
  const blocks = failures.map((f, i) => {
    const head = `**${i + 1}. [${f.kind}] ${f.method} ${f.fullUrl || f.url}**`;
    const meta = [
      f.status != null ? `status=${f.status}` : '',
      f.errorText ? `error=${f.errorText}` : '',
      f.bodySummary ? `body=${truncate(f.bodySummary, 500)}` : '',
    ]
      .filter(Boolean)
      .join(' · ');
    const curl = f.curl ? `\n\`\`\`bash\n${f.curl}\n\`\`\`` : '';
    return `${head}\n${meta}${curl}`;
  });
  return `**${label}** · ${failures.length} 个接口失败\n\n${blocks.join('\n\n')}`;
}

async function getAccessToken(appId: string, appSecret: string): Promise<string> {
  const res = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });
  const data = (await res.json()) as { code?: number; msg?: string; tenant_access_token?: string };
  if (data.code !== 0 || !data.tenant_access_token) {
    throw new Error(data.msg || '获取飞书 token 失败');
  }
  return data.tenant_access_token;
}

async function sendByApp(cfg: FeishuCfg, content: string): Promise<void> {
  const token = await getAccessToken(cfg.appId!, cfg.appSecret!);
  const card = {
    header: {
      title: { tag: 'plain_text', content: '接口失败 · curl 复现' },
      template: 'red',
    },
    elements: [{ tag: 'div', text: { tag: 'lark_md', content: truncate(content, 28000) } }],
  };
  const res = await fetch('https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      receive_id: cfg.chatId,
      msg_type: 'interactive',
      content: JSON.stringify(card),
    }),
  });
  const data = (await res.json()) as { code?: number; msg?: string };
  if (data.code !== 0) throw new Error(data.msg || '飞书发信失败');
}

async function sendByWebhook(cfg: FeishuCfg, content: string): Promise<void> {
  const card = {
    header: {
      title: { tag: 'plain_text', content: '接口失败 · curl 复现' },
      template: 'red',
    },
    elements: [{ tag: 'div', text: { tag: 'lark_md', content: truncate(content, 28000) } }],
  };
  const res = await fetch(cfg.webhookUrl!, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ msg_type: 'interactive', card }),
  });
  if (!res.ok) {
    throw new Error(`Webhook 失败: ${res.status} ${await res.text()}`);
  }
}

export async function sendApiFailuresToFeishu(failures: ApiFailureNotice[], label: string): Promise<boolean> {
  if (process.env.API_FAILURE_FEISHU === '0') return false;
  if (!failures.length || !canSendFeishu()) return false;

  const cfg = readFeishuCfg();
  const content = buildMarkdown(failures, label);
  try {
    if (cfg.chatId && cfg.appId && cfg.appSecret) {
      await sendByApp(cfg, content);
    } else if (cfg.webhookUrl) {
      await sendByWebhook(cfg, content);
    } else {
      return false;
    }
    console.log(`[api-guard] 已发送 ${failures.length} 个失败接口 curl 到飞书`);
    return true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[api-guard] 飞书通知失败: ${msg}`);
    return false;
  }
}
