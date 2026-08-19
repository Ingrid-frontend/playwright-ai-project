const fs = require('fs');
const path = require('path');
const { send, logLine, errText } = require('./ws-safe');

async function runStyleDriftFullFlow(ws, session, msg = {}, deps) {
  const {
    resolveRepoRoot,
    spawn,
    buildRepoSpawnEnv,
    getSessionPlaywrightEnv,
    runRepoCompareReport,
    runIntent,
  } = deps;
  const repoRoot = resolveRepoRoot();
  const intentRel = String(msg.intent || '').trim();
  if (!intentRel) {
    send(ws, 'error', { message: '请先选择或填写 Intent YAML 路径' });
    send(ws, 'style-drift:run-full:done', { ok: false, message: '缺少 Intent YAML' });
    return;
  }
  const gate = Boolean(msg.gate);

  send(ws, 'style-drift:run-full:start', { intent: intentRel, gate });
  logLine(ws, `[style-drift] 全流程开始 · ${intentRel}`, 'info');

  try {
    await runIntent(ws, session, {
      intent: intentRel,
      engine: String(msg.engine || 'ego').toLowerCase() === 'pw' ? 'pw' : 'ego',
      heal: false,
      compareAfter: false,
      headed: Boolean(msg.headed),
    }, deps);

    if (session.intentRunCancelled) return;

    logLine(ws, '[style-drift] 运行 compare-screenshots…', 'info');
    await runRepoCompareReport(ws, session, {
      resolveRepoRoot,
      spawn,
      buildRepoSpawnEnv,
      extraArgs: gate ? ['--gate'] : [],
    });

    let triage = { confirmed: 0, pending: 0, ignored: 0 };
    const issuesPath = path.join(repoRoot, 'results/ui-issues.json');
    if (fs.existsSync(issuesPath)) {
      try {
        const report = JSON.parse(fs.readFileSync(issuesPath, 'utf-8'));
        triage = report.summary?.triage || triage;
      } catch {
        /* ignore */
      }
    }

    send(ws, 'style-drift:run-full:done', {
      ok: true,
      intent: intentRel,
      triage,
      reportPath: 'results/ui-regression/compare-report.html',
      issuesPath: 'results/ui-issues.json',
    });
    logLine(ws, `[style-drift] 完成 confirmed=${triage.confirmed} pending=${triage.pending} ignored=${triage.ignored}`, 'ok');
  } catch (err) {
    send(ws, 'style-drift:run-full:done', { ok: false, message: errText(err) });
    logLine(ws, `[style-drift] 失败: ${errText(err)}`, 'err');
  }
}

module.exports = { runStyleDriftFullFlow };
