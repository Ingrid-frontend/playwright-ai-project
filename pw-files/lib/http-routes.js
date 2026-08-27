const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const express = require('express');
const { stripAnsi } = require('./ws-safe');

function resolveFeishuNotifyReady(resolveRepoRoot) {
  const repoRoot = resolveRepoRoot();
  const readEnv = (key) => {
    const fromProcess = (process.env[key] || '').trim();
    if (fromProcess) return fromProcess;
    const envPath = path.join(repoRoot, '.env');
    try {
      if (!fs.existsSync(envPath)) return '';
      const lines = fs.readFileSync(envPath, 'utf8').split('\n');
      for (const line of lines) {
        const m = line.match(new RegExp(`^\\s*${key}\\s*=\\s*(.*)$`));
        if (!m) continue;
        return m[1].trim().replace(/^["']|["']$/g, '');
      }
    } catch {
      /* ignore */
    }
    return '';
  };

  const chatId = readEnv('FEISHU_CHAT_ID');
  const appId = readEnv('FEISHU_APP_ID');
  const appSecret = readEnv('FEISHU_APP_SECRET');
  if (chatId && appId && appSecret) return true;

  if (readEnv('FEISHU_WEBHOOK_URL')) return true;

  const configPath = path.join(repoRoot, 'feishu-config.json');
  try {
    if (fs.existsSync(configPath)) {
      const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (cfg.chatId && cfg.appId && cfg.appSecret) return true;
      if (cfg.webhookUrl) return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

const { handleFeishuEventPost } = require('./feishu-events');

function registerHttpRoutes(app, deps) {
  const { resolveRepoRoot, sessions } = deps;

  app.get('/download/spec', (req, res) => {
    const sessionId = req.query.sid;
    const session = sessions.get(sessionId);
    if (!session || !session.optCode) return res.status(404).send('Not found');
    res.setHeader('Content-Disposition', 'attachment; filename="recorded.spec.ts"');
    res.setHeader('Content-Type', 'text/plain');
    res.send(session.optCode);
  });

  app.get('/download/report', (req, res) => {
    const sessionId = req.query.sid;
    const session = sessions.get(sessionId);
    const file = path.join(session?.tmpDir || '', 'report.html');
    if (!session || !fs.existsSync(file)) return res.status(404).send('Not found');
    res.sendFile(file);
  });

  app.post('/api/feishu/send', async (req, res) => {
    if (!resolveFeishuNotifyReady(resolveRepoRoot)) {
      return res.status(400).json({
        ok: false,
        error: '未配置飞书通知：请设置 FEISHU_CHAT_ID + FEISHU_APP_ID/SECRET，或 FEISHU_WEBHOOK_URL',
      });
    }
    const repoRoot = resolveRepoRoot();
    const script = path.join(repoRoot, 'scripts/feishu/send-latest-card.ts');
    if (!fs.existsSync(script)) {
      return res.status(500).json({ ok: false, error: '未找到 scripts/feishu/send-latest-card.ts' });
    }
    const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    try {
      await new Promise((resolve, reject) => {
        const proc = spawn(npx, ['tsx', script], {
          cwd: repoRoot,
          env: { ...process.env },
          shell: false,
        });
        let out = '';
        let err = '';
        proc.stdout.on('data', (d) => {
          out += d.toString();
        });
        proc.stderr.on('data', (d) => {
          err += d.toString();
        });
        const timer = setTimeout(() => {
          proc.kill();
          reject(new Error('发送飞书卡片超时'));
        }, 90000);
        proc.on('error', (e) => {
          clearTimeout(timer);
          reject(e);
        });
        proc.on('close', (code) => {
          clearTimeout(timer);
          if (code !== 0) {
            reject(new Error(stripAnsi(err || out || `退出码 ${code}`).slice(0, 300)));
            return;
          }
          resolve();
        });
      });
      return res.json({ ok: true });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.post('/api/feishu/flow-weekly-doc', express.json(), async (req, res) => {
    const flowId = String(req.body?.flow || 'request-flow').trim();
    if (flowId !== 'request-flow' && flowId !== 'approval-flow') {
      return res.status(400).json({ ok: false, error: 'flow 须为 request-flow 或 approval-flow' });
    }
    const appId = (process.env.FEISHU_APP_ID || '').trim();
    const appSecret = (process.env.FEISHU_APP_SECRET || '').trim();
    if (!appId || !appSecret) {
      return res.status(400).json({
        ok: false,
        error: '未配置飞书文档：请设置 FEISHU_APP_ID + FEISHU_APP_SECRET',
      });
    }
    const repoRoot = resolveRepoRoot();
    const lastRunPath = path.join(repoRoot, 'results', 'flow-runs', flowId, 'last-run.json');
    if (!fs.existsSync(lastRunPath)) {
      return res.status(400).json({
        ok: false,
        error: '暂无运行记录，请先执行一次流程用例',
      });
    }
    const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const args = ['run', 'feishu:flow-weekly-doc', '--', `--flow=${flowId}`];
    try {
      await new Promise((resolve, reject) => {
        const proc = spawn(npmCmd, args, { cwd: repoRoot, env: { ...process.env }, shell: false });
        let out = '';
        let err = '';
        proc.stdout.on('data', (d) => {
          out += d.toString();
        });
        proc.stderr.on('data', (d) => {
          err += d.toString();
        });
        const timer = setTimeout(() => {
          proc.kill();
          reject(new Error('写入飞书周报超时'));
        }, 120000);
        proc.on('error', (e) => {
          clearTimeout(timer);
          reject(e);
        });
        proc.on('close', (code) => {
          clearTimeout(timer);
          if (code !== 0) {
            reject(new Error(stripAnsi(err || out || `退出码 ${code}`).slice(0, 400)));
            return;
          }
          resolve();
        });
      });
      const urlFile = path.join(repoRoot, 'results', 'feishu-docs', `${flowId}-week-url.txt`);
      let url = '';
      if (fs.existsSync(urlFile)) {
        url = fs.readFileSync(urlFile, 'utf8').trim();
      }
      return res.json({ ok: true, url, flow: flowId });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.post('/api/visual-review', express.json(), async (req, res) => {
    const body = req.body || {};
    const verdict = String(body.verdict || '').trim();
    const scriptKey = String(body.scriptKey || body.script || '').trim();
    const runTs = String(body.runTimestamp || body.run || '').trim();
    const step = String(body.stepFileName || body.step || '').trim();
    const browser = String(body.browser || 'chrome').trim().toLowerCase();
    const issueId = String(body.issueId || '').trim();
    if (!verdict || !scriptKey || !runTs || !step) {
      return res.status(400).json({ ok: false, error: '需要 verdict、scriptKey、runTimestamp、stepFileName' });
    }
    const repoRoot = resolveRepoRoot();
    const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const args = [
      'run',
      'visual-review',
      '--',
      `--verdict=${verdict}`,
      `--script=${scriptKey}`,
      `--run=${runTs}`,
      `--step=${step}`,
      `--browser=${browser}`,
    ];
    if (issueId) args.push(`--issueId=${issueId}`);
    try {
      await new Promise((resolve, reject) => {
        const proc = spawn(npmCmd, args, { cwd: repoRoot, shell: false });
        let err = '';
        let out = '';
        proc.stdout.on('data', (d) => {
          out += d.toString();
        });
        proc.stderr.on('data', (d) => {
          err += d.toString();
        });
        proc.on('close', (code) => {
          if (code !== 0) {
            reject(new Error(stripAnsi(err || out || `退出码 ${code}`).slice(0, 300)));
            return;
          }
          resolve();
        });
        proc.on('error', reject);
      });
      return res.json({ ok: true });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  const FEISHU_VERIFICATION_TOKEN = process.env.FEISHU_VERIFICATION_TOKEN || '';

  app.post('/feishu/events', express.json(), (req, res) => {
    handleFeishuEventPost(req, res, deps);
  });

  app.post('/feishu/callback', express.json(), (req, res) => {
    const body = req.body || {};

    if (body.type === 'url_verification') {
      console.log('[feishu-callback] URL 验证');
      return res.json({ challenge: body.challenge || '' });
    }

    const requestToken = req.headers['x-lark-request-token'];
    if (FEISHU_VERIFICATION_TOKEN && requestToken !== FEISHU_VERIFICATION_TOKEN) {
      console.log('[feishu-callback] 令牌验证失败');
      return res.status(403).json({ error: 'Invalid token' });
    }

    const action = body.action || {};
    const openId = body.open_id || '';
    const userName = body.user ? (body.user.name || '') : '';
    let value = {};
    try {
      value = typeof action.value === 'string' ? JSON.parse(action.value) : (action.value || {});
    } catch { value = { raw: action.value }; }

    const actionType = value.action || 'unknown';
    console.log(`[feishu-callback] action=${actionType}, user=${userName || openId}`);

    let responseMsg = '';
    let responseTemplate = 'green';

    switch (actionType) {
      case 'rerun_failed': {
        responseMsg = `已接受请求，正在重跑失败用例（由 ${userName || openId} 触发）`;
        console.log(`[feishu-callback] → 触发重跑: ${responseMsg}`);
        setTimeout(() => {
          const repoRoot = resolveRepoRoot();
          const child = spawn('npm', ['run', 'test-job', '--', 'run', '--id=rerun-failed', '--trigger=manual'], {
            cwd: repoRoot,
            stdio: 'ignore',
            detached: true,
            env: { ...process.env, PLAYWRIGHT_ENV: process.env.PLAYWRIGHT_ENV || 'stage' },
          });
          child.unref();
        }, 100);
        break;
      }
      case 'approve_baseline': {
        responseMsg = `已接受请求，正在晋升基线（由 ${userName || openId} 批准）`;
        console.log(`[feishu-callback] → 晋升基线: ${responseMsg}`);
        setTimeout(() => {
          const { execSync } = require('child_process');
          try {
            execSync('npm run promote-baseline', { cwd: resolveRepoRoot(), stdio: 'pipe' });
          } catch (e) {
            console.error('[feishu-callback] 晋升失败:', e.message);
          }
        }, 100);
        break;
      }
      default:
        responseMsg = `未知操作: ${actionType}`;
        responseTemplate = 'red';
    }

    res.json({
      code: 0,
      msg: 'ok',
      data: {
        card: {
          header: {
            title: { tag: 'plain_text', content: actionType === 'unknown' ? '⚠️ 未知操作' : '✅ 操作已触发' },
            template: responseTemplate,
          },
          elements: [
            { tag: 'div', text: { tag: 'lark_md', content: responseMsg } },
            ...(actionType === 'approve_baseline' ? [{
              tag: 'div',
              text: { tag: 'lark_md', content: '基线晋升将在后台执行，请稍后在报告中查看结果。' },
            }] : []),
            ...(actionType === 'rerun_failed' ? [{
              tag: 'div',
              text: { tag: 'lark_md', content: '重跑将在后台执行，完成后会再次推送通知。' },
            }] : []),
          ],
        },
      },
    });
  });
}

function registerStudioStatic(app, expressLib, deps) {
  const { studioDir, resolveRepoRoot, resolveRepoPublicReadFile } = deps;

  app.use((req, res, next) => {
    if (req.method !== 'GET' || !req.path.startsWith('/repo-report/')) return next();
    const repoRoot = resolveRepoRoot();
    const tail = req.path.slice('/repo-report/'.length);
    let abs;
    try {
      abs = resolveRepoPublicReadFile(repoRoot, tail);
    } catch {
      res.status(400).send('Bad path');
      return;
    }
    if (!abs || !fs.existsSync(abs)) {
      res.status(404).send('Not found');
      return;
    }
    res.sendFile(abs, (err) => {
      if (err && !res.headersSent) res.status(500).send(String(err.message || err));
    });
  });

  app.use(expressLib.static(path.join(studioDir, 'public'), {
    setHeaders(res, filePath) {
      if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
    },
  }));
  app.use('/results', expressLib.static(path.join(studioDir, '..', 'results')));
  app.use('/screenshots', expressLib.static(path.join(studioDir, '..', 'screenshots')));
  app.use(expressLib.json());
}

module.exports = { registerHttpRoutes, registerStudioStatic };
