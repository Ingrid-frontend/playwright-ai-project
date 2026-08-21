const fs = require('fs');
const path = require('path');
const { send, logLine, stripAnsi, errText } = require('./ws-safe');

const UI_AUDIT_DIR_REL = path.join('results', 'ui-audit');
const UI_AUDIT_REPORT_REL = path.join(UI_AUDIT_DIR_REL, 'index.html');
const UI_AUDIT_SUMMARY_REL = path.join(UI_AUDIT_DIR_REL, 'summary.json');

function uiAuditOpenPath() {
  return `/repo-report/${UI_AUDIT_REPORT_REL.split(path.sep).join('/')}`;
}

function readUiAuditSummary(repoRoot) {
  const abs = path.join(repoRoot, UI_AUDIT_SUMMARY_REL);
  if (!fs.existsSync(abs)) return null;
  try {
    return JSON.parse(fs.readFileSync(abs, 'utf-8'));
  } catch {
    return null;
  }
}

function getUiAuditStatus(repoRoot) {
  const hasReport = fs.existsSync(path.join(repoRoot, UI_AUDIT_REPORT_REL));
  const summary = readUiAuditSummary(repoRoot);
  return {
    hasReport,
    openPath: hasReport ? uiAuditOpenPath() : null,
    reportRel: UI_AUDIT_REPORT_REL,
    summary: summary
      ? {
          mode: summary.mode,
          total: summary.total,
          pass: summary.pass,
          review: summary.review,
          fail: summary.fail,
          skipped: summary.skipped,
          generatedAt: summary.generatedAt,
        }
      : null,
  };
}

function sendUiAuditStatus(ws, repoRoot) {
  send(ws, 'ui-audit:status', getUiAuditStatus(repoRoot));
}

/** 打开已有审计报告；不存在时提示先运行 */
function openExistingUiAuditReport(ws, resolveRepoRoot) {
  const repoRoot = resolveRepoRoot();
  const abs = path.join(repoRoot, UI_AUDIT_REPORT_REL);
  if (!fs.existsSync(abs)) {
    send(ws, 'error', { message: '暂无 AI UI 审计报告，请先运行审计' });
    send(ws, 'ui-audit:run:done', { ok: false });
    return;
  }
  send(ws, 'ui-audit:run:done', {
    ok: true,
    openedExisting: true,
    openPath: uiAuditOpenPath(),
    ...getUiAuditStatus(repoRoot),
  });
  logLine(ws, `[ui-audit] 报告就绪: ${uiAuditOpenPath()}`, 'ok');
}

/** 与 scripts/report/ui-audit-analyzer.ts 的 resolveVisionApiKey 保持同一回退链 */
function resolveVisionApiKey(env) {
  const keys = ['AI_API_KEY', 'AI_TEST_OPENAI_API_KEY', 'OPENAI_API_KEY'];
  for (const k of keys) {
    const v = String(env[k] || '').trim();
    if (v) return v;
  }
  return '';
}

/**
 * 运行 npm run ui-audit。
 * 无 AI_API_KEY 时脚本自身会降级为 mock 规则分析，这里只做提示不阻断。
 */
async function runUiAudit(ws, session, msg = {}, deps) {
  const { resolveRepoRoot, spawn, buildRepoSpawnEnv } = deps;
  const repoRoot = resolveRepoRoot();

  if (!fs.existsSync(path.join(repoRoot, 'playwright.config.ts'))) {
    send(ws, 'error', { message: '未找到项目根，无法运行 AI UI 审计' });
    send(ws, 'ui-audit:run:done', { ok: false });
    return;
  }

  const limit = Math.max(1, Math.min(100, Number(msg.limit) || 12));
  const scriptFilter = String(msg.script || '').trim();
  const gate = Boolean(msg.gate);
  const mockOnly = Boolean(msg.mock);

  const args = ['run', 'ui-audit', '--', `--limit=${limit}`];
  if (scriptFilter) args.push(`--script=${scriptFilter}`);
  if (gate) args.push('--gate');

  const env = buildRepoSpawnEnv(session);
  if (mockOnly) env.AI_AUDIT_MOCK = '1';

  const usingAi = !mockOnly && Boolean(resolveVisionApiKey(env));
  session.uiAuditCancelled = false;

  send(ws, 'ui-audit:run:start', { limit, script: scriptFilter, gate, mode: usingAi ? 'ai' : 'mock' });
  logLine(
    ws,
    `[ui-audit] 开始审计 · limit=${limit}${scriptFilter ? ` · script=${scriptFilter}` : ''} · ${usingAi ? 'AI 视觉分析' : 'mock 规则分析'}`,
    'info',
  );
  if (!usingAi && !mockOnly) {
    logLine(ws, '[ui-audit] 未检测到 AI_API_KEY，已降级为 mock 规则分析', 'warn');
  }

  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  let proc;
  try {
    proc = spawn(npmCmd, args, { cwd: repoRoot, env, shell: false });
  } catch (err) {
    send(ws, 'error', { message: `启动 ui-audit 失败: ${errText(err)}` });
    send(ws, 'ui-audit:run:done', { ok: false });
    return;
  }

  session.uiAuditProc = proc;
  proc.stdout.on('data', (d) => {
    const t = stripAnsi(d.toString());
    if (t.trim()) logLine(ws, t.trimEnd(), 'dim');
  });
  proc.stderr.on('data', (d) => {
    const t = stripAnsi(d.toString());
    if (t.trim()) logLine(ws, t.trimEnd(), 'warn');
  });

  const exitCode = await new Promise((resolve) => proc.on('close', resolve));
  session.uiAuditProc = null;

  if (session.uiAuditCancelled) {
    logLine(ws, '[ui-audit] 审计已取消', 'warn');
    send(ws, 'ui-audit:run:done', { ok: false, cancelled: true });
    return;
  }

  const status = getUiAuditStatus(repoRoot);

  // --gate 命中衰退时退出码为 1，属于"审计成功且发现问题"，不算执行失败
  const gateBlocked = gate && exitCode === 1 && status.summary && status.summary.fail > 0;
  if (exitCode !== 0 && !gateBlocked) {
    send(ws, 'error', { message: `ui-audit 退出码 ${exitCode}` });
    send(ws, 'ui-audit:run:done', { ok: false, exitCode, ...status });
    return;
  }

  if (!status.hasReport) {
    send(ws, 'error', { message: '未生成 results/ui-audit/index.html（screenshots/ 下可能缺少 .meta.json 配对）' });
    send(ws, 'ui-audit:run:done', { ok: false, ...status });
    return;
  }

  const s = status.summary;
  if (s) {
    logLine(
      ws,
      `[ui-audit] 完成 · 🟢 ${s.pass} 🟡 ${s.review} 🔴 ${s.fail} ⚪ ${s.skipped}`,
      s.fail > 0 ? 'err' : s.review > 0 ? 'warn' : 'ok',
    );
    if (s.skipped > 0 && s.mode === 'mock') {
      logLine(
        ws,
        `[ui-audit] ${s.skipped} 个步骤缺少判定依据未审计；配置 AI_API_KEY 可启用 AI 视觉分析`,
        'warn',
      );
    }
  }

  send(ws, 'ui-audit:run:done', {
    ok: true,
    gateBlocked: Boolean(gateBlocked),
    openPath: uiAuditOpenPath(),
    ...status,
  });
}

function cancelUiAudit(session) {
  session.uiAuditCancelled = true;
  if (session.uiAuditProc) {
    try {
      session.uiAuditProc.kill('SIGTERM');
    } catch {
      /* ignore */
    }
  }
}

module.exports = {
  UI_AUDIT_DIR_REL,
  UI_AUDIT_REPORT_REL,
  UI_AUDIT_SUMMARY_REL,
  uiAuditOpenPath,
  readUiAuditSummary,
  getUiAuditStatus,
  sendUiAuditStatus,
  openExistingUiAuditReport,
  runUiAudit,
  cancelUiAudit,
};
