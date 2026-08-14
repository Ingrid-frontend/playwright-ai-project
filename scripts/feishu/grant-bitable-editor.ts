#!/usr/bin/env tsx
/**
 * 用应用身份给指定用户开通多维表格编辑权限
 * （适用于 Base 所有者是 @自动化测试 等应用机器人的场景）
 *
 * 用法:
 *   FEISHU_USER_OPEN_ID=ou_xxx npm run feishu:grant-bitable-editor
 *   npm run feishu:grant-bitable-editor -- --open-id=ou_xxx
 *   npm run feishu:grant-bitable-editor -- --email=you@company.com
 *   npm run feishu:grant-bitable-editor -- --mobile=13800138000
 *
 * 应用需开通 drive:permission（获取与编辑云空间权限）
 * 邮箱/手机号查询需开通 contact:user.id:readonly
 */
import dotenv from 'dotenv';
import {
  explainMissingBitableConfig,
  fetchWithRetry,
  loadBitableRuntimeConfig,
} from './index.js';

dotenv.config();

type FeishuResp<T> = { code: number; msg?: string; data?: T };

async function getToken(appId: string, appSecret: string): Promise<string> {
  const res = await fetchWithRetry('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });
  const data = await res.json() as FeishuResp<{ tenant_access_token?: string }> & { tenant_access_token?: string };
  const token = data.tenant_access_token ?? data.data?.tenant_access_token;
  if (!token) throw new Error(`获取 token 失败: ${data.msg || '未知错误'}`);
  return token;
}

async function resolveOpenIdByContact(token: string, input: { email?: string; mobile?: string }): Promise<string> {
  const body: { emails?: string[]; mobiles?: string[] } = {};
  if (input.email) body.emails = [input.email];
  if (input.mobile) body.mobiles = [input.mobile];
  const res = await fetchWithRetry(
    'https://open.feishu.cn/open-apis/contact/v3/users/batch_get_id?user_id_type=open_id',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
  const data = await res.json() as FeishuResp<{ user_list?: Array<{ email?: string; mobile?: string; user_id?: string }> }>;
  if (data.code !== 0) {
    throw new Error(`查 open_id 失败: ${data.msg}（需开通 contact:user.id:readonly）`);
  }
  const openId = data.data?.user_list?.[0]?.user_id;
  const label = input.mobile || input.email || '';
  if (!openId) throw new Error(`未找到 ${label} 对应的用户（确认手机号/邮箱已在企业通讯录且应用有可见范围）`);
  return openId;
}

async function grantEdit(token: string, appToken: string, openId: string): Promise<void> {
  const res = await fetchWithRetry(
    `https://open.feishu.cn/open-apis/drive/v1/permissions/${appToken}/members?type=bitable`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ member_type: 'openid', member_id: openId, perm: 'edit' }),
    },
  );
  const data = await res.json() as FeishuResp<unknown>;
  if (data.code !== 0) {
    throw new Error(`授权失败 code=${data.code} msg=${data.msg}`);
  }
}

async function main(): Promise<void> {
  const config = loadBitableRuntimeConfig();
  if (!config) {
    console.log(`❌ ${explainMissingBitableConfig()}`);
    process.exit(1);
  }

  const argOpenId = process.argv.find((item) => item.startsWith('--open-id='))?.slice('--open-id='.length);
  const argEmail = process.argv.find((item) => item.startsWith('--email='))?.slice('--email='.length);
  const argMobile = process.argv.find((item) => item.startsWith('--mobile='))?.slice('--mobile='.length);
  const lookupOnly = process.argv.includes('--lookup');
  const token = await getToken(config.appId, config.appSecret);

  let openId = argOpenId || process.env.FEISHU_USER_OPEN_ID || '';
  if (!openId && argEmail) openId = await resolveOpenIdByContact(token, { email: argEmail });
  if (!openId && argMobile) openId = await resolveOpenIdByContact(token, { mobile: argMobile });
  if (!openId) {
    console.log('❌ 请提供 open_id、邮箱或手机号：');
    console.log('   npm run feishu:grant-bitable-editor -- --open-id=ou_xxx');
    console.log('   npm run feishu:grant-bitable-editor -- --email=you@company.com');
    console.log('   npm run feishu:grant-bitable-editor -- --mobile=13800138000');
    console.log('   仅查 open_id：加 --lookup');
    process.exit(1);
  }

  if (lookupOnly) {
    console.log(`open_id: ${openId}`);
    return;
  }

  console.log(`🔐 正在为 ${openId} 开通多维表格编辑权限…`);
  await grantEdit(token, config.appToken, openId);
  console.log('✅ 已授权「可编辑」');
  console.log(`   刷新 Base 页面后应可新建仪表盘：`);
  console.log(`   https://feishu.cn/base/${config.appToken}`);
}

main().catch((error: unknown) => {
  console.error('❌', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
