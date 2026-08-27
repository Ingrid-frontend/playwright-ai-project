const { spawn } = require('child_process');
const path = require('path');
const { replyText } = require('./feishu-im');

function parseMessageText(content) {
  if (!content) return '';
  if (typeof content === 'string') {
    try {
      const j = JSON.parse(content);
      return String(j.text || j).trim();
    } catch {
      return content.trim();
    }
  }
  return String(content.text || '').trim();
}

function matchCommand(text) {
  const t = String(text || '').trim();
  if (!t) return null;
  if (/申请单|request[\s-]?flow/i.test(t)) {
    return { flowId: 'request-flow', spec: 'request/full-flow.spec.ts', label: '申请单流程' };
  }
  if (/审批|approval[\s-]?flow/i.test(t)) {
    return { flowId: 'approval-flow', spec: 'approval/full-flow.spec.ts', label: '审批流程' };
  }
  return null;
}

function verifyToken(req, expected) {
  if (!expected) return true;
  const header = req.headers['x-lark-request-token'];
  if (header && header === expected) return true;
  const body = req.body || {};
  if (body.token && body.token === expected) return true;
  const headerToken = body.header?.token;
  if (headerToken && headerToken === expected) return true;
  return false;
}

function spawnFlowRun(repoRoot, chatId, messageId, flowId, spec, envId) {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const args = [
    'run',
    'flow:run',
    '--',
    `--flow=${flowId}`,
    `--spec=${spec}`,
    `--env=${envId}`,
    `--chat-id=${chatId}`,
  ];
  if (messageId) args.push(`--message-id=${messageId}`);
  const child = spawn(npm, args, {
    cwd: repoRoot,
    stdio: 'ignore',
    detached: true,
    env: { ...process.env, PLAYWRIGHT_ENV: envId },
  });
  child.unref();
}

async function handleMessageEvent(repoRoot, event, envId) {
  const message = event?.message || {};
  if (message.message_type !== 'text') return;
  const text = parseMessageText(message.content);
  const cmd = matchCommand(text);
  if (!cmd) return;

  const chatId = message.chat_id || '';
  const messageId = message.message_id || '';
  const env = envId || process.env.PLAYWRIGHT_ENV || 'uat';

  await replyText(
    repoRoot,
    messageId,
    `已接受，${env} 环境「${cmd.label}」执行中，完成后将通知本会话并写入本周周报。`,
  );

  spawnFlowRun(repoRoot, chatId, messageId, cmd.flowId, cmd.spec, env);
}

function handleFeishuEventPost(req, res, deps) {
  const repoRoot = deps.resolveRepoRoot();
  const body = req.body || {};
  const verificationToken = (process.env.FEISHU_VERIFICATION_TOKEN || '').trim();

  if (body.type === 'url_verification' && body.challenge) {
    console.log('[feishu-events] URL 验证');
    return res.json({ challenge: body.challenge });
  }

  if (body.encrypt && !process.env.FEISHU_ENCRYPT_KEY) {
    console.log('[feishu-events] 收到加密事件，未配置 FEISHU_ENCRYPT_KEY');
    return res.status(200).json({ msg: 'encrypt not configured' });
  }

  if (!verifyToken(req, verificationToken)) {
    console.log('[feishu-events] 令牌验证失败');
    return res.status(403).json({ error: 'Invalid token' });
  }

  const eventType = body.header?.event_type || body.type || '';
  if (eventType === 'url_verification' && body.challenge) {
    return res.json({ challenge: body.challenge });
  }

  res.status(200).json({ msg: 'ok' });

  if (eventType === 'im.message.receive_v1') {
    const envId = process.env.PLAYWRIGHT_ENV || 'uat';
    handleMessageEvent(repoRoot, body.event, envId).catch((e) => {
      console.error('[feishu-events] 处理消息失败:', e.message || e);
    });
  }
}

module.exports = { handleFeishuEventPost, matchCommand };
