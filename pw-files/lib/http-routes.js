const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const express = require('express');
const { stripAnsi } = require('./ws-safe');
const {
  buildFigmaResultPayload,
  listFigmaResultDirs,
} = require('./figma-payload');

function resolveFeishuWebhookUrl(resolveRepoRoot) {
  const fromEnv = (process.env.FEISHU_WEBHOOK_URL || '').trim();
  if (fromEnv) return fromEnv;
  const repoRoot = resolveRepoRoot();
  const configPath = path.join(repoRoot, 'feishu-config.json');
  try {
    if (fs.existsSync(configPath)) {
      const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (cfg.webhookUrl) return String(cfg.webhookUrl).trim();
    }
  } catch {
    /* ignore */
  }
  const envPath = path.join(repoRoot, '.env');
  try {
    if (fs.existsSync(envPath)) {
      const lines = fs.readFileSync(envPath, 'utf8').split('\n');
      for (const line of lines) {
        const m = line.match(/^\s*FEISHU_WEBHOOK_URL\s*=\s*(.*)$/);
        if (!m) continue;
        return m[1].trim().replace(/^["']|["']$/g, '');
      }
    }
  } catch {
    /* ignore */
  }
  return '';
}

function registerHttpRoutes(app, deps) {
  const { resolveRepoRoot, sessions } = deps;

  app.get('/api/figma/result', (req, res) => {
    const repoRoot = resolveRepoRoot();
    const rel = String(req.query.rel || '').trim();
    const payload = buildFigmaResultPayload(repoRoot, rel);
    if (!payload) return res.status(404).json({ ok: false, message: '未找到对比结果' });
    return res.json(payload);
  });

  app.get('/api/figma/latest', (req, res) => {
    const repoRoot = resolveRepoRoot();
    const root = path.join(repoRoot, 'results', 'figma-compare');
    const dirs = listFigmaResultDirs(root, false);
    if (!dirs.length) return res.status(404).json({ ok: false, message: '暂无对比记录' });
    const payload = buildFigmaResultPayload(repoRoot, `results/figma-compare/${dirs[0].name}`);
    if (!payload) return res.status(404).json({ ok: false, message: '未找到对比结果' });
    return res.json(payload);
  });

  app.get('/api/figma/latest-report', (req, res) => {
    const repoRoot = resolveRepoRoot();
    const root = path.join(repoRoot, 'results', 'figma-compare');
    const dirs = listFigmaResultDirs(root, true);
    if (!dirs.length) return res.status(404).json({ ok: false, message: '暂无规范对比报告' });
    const payload = buildFigmaResultPayload(repoRoot, `results/figma-compare/${dirs[0].name}`);
    if (!payload?.reportUrl) return res.status(404).json({ ok: false, message: '未找到对比报告' });
    return res.json(payload);
  });

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
    const webhookUrl = resolveFeishuWebhookUrl(resolveRepoRoot);
    if (!webhookUrl) {
      return res.status(400).json({ ok: false, error: '未配置 FEISHU_WEBHOOK_URL' });
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
          env: { ...process.env, FEISHU_WEBHOOK_URL: webhookUrl },
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

  const FEISHU_VERIFICATION_TOKEN = process.env.FEISHU_VERIFICATION_TOKEN || '';

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
