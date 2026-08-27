const fs = require('fs');
const path = require('path');

async function fetchJson(url, opts) {
  const res = await fetch(url, opts);
  const text = await res.text();
  try {
    return { ok: res.ok, data: JSON.parse(text.replace(/^\uFEFF/, '')) };
  } catch {
    return { ok: res.ok, data: null, raw: text };
  }
}

function readAppCreds(repoRoot) {
  let appId = (process.env.FEISHU_APP_ID || '').trim();
  let appSecret = (process.env.FEISHU_APP_SECRET || '').trim();
  if (!appId || !appSecret) {
    try {
      const cfg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'feishu-config.json'), 'utf8'));
      appId = appId || cfg.appId || '';
      appSecret = appSecret || cfg.appSecret || '';
    } catch {
      /* ignore */
    }
  }
  return { appId, appSecret };
}

async function getAccessToken(repoRoot) {
  const { appId, appSecret } = readAppCreds(repoRoot);
  if (!appId || !appSecret) throw new Error('未配置 FEISHU_APP_ID / FEISHU_APP_SECRET');
  const { data } = await fetchJson('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });
  if (!data || data.code !== 0 || !data.tenant_access_token) {
    throw new Error(`获取 token 失败: ${data?.msg || 'unknown'}`);
  }
  return data.tenant_access_token;
}

async function replyText(repoRoot, messageId, text) {
  if (!messageId) return false;
  const token = await getAccessToken(repoRoot);
  const { data } = await fetchJson(
    `https://open.feishu.cn/open-apis/im/v1/messages/${messageId}/reply`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        msg_type: 'text',
        content: JSON.stringify({ text }),
      }),
    },
  );
  if (!data || data.code !== 0) {
    console.log(`[feishu-im] reply 失败: ${data?.msg || 'unknown'}`);
    return false;
  }
  return true;
}

async function sendChatText(repoRoot, chatId, text) {
  if (!chatId) return false;
  const token = await getAccessToken(repoRoot);
  const { data } = await fetchJson(
    'https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        receive_id: chatId,
        msg_type: 'text',
        content: JSON.stringify({ text }),
      }),
    },
  );
  if (!data || data.code !== 0) {
    console.log(`[feishu-im] send 失败: ${data?.msg || 'unknown'}`);
    return false;
  }
  return true;
}

async function sendChatCard(repoRoot, chatId, card) {
  if (!chatId) return false;
  const token = await getAccessToken(repoRoot);
  const { data } = await fetchJson(
    'https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        receive_id: chatId,
        msg_type: 'interactive',
        content: JSON.stringify(card),
      }),
    },
  );
  if (!data || data.code !== 0) {
    console.log(`[feishu-im] card 失败: ${data?.msg || 'unknown'}`);
    return false;
  }
  return true;
}

module.exports = { replyText, sendChatText, sendChatCard, getAccessToken };
