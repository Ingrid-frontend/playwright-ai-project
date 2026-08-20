const fs = require('fs');
const path = require('path');
const { send, logLine, errText } = require('./ws-safe');

async function runChangeDetectionFullFlow(ws, session, msg = {}, deps) {
  const {
    resolveRepoRoot,
    spawn,
    buildRepoSpawnEnv,
    getSessionPlaywrightEnv,
    runRepoCompareReport,
    runIntent,
    runRepoPromoteBaseline,
  } = deps;
  const repoRoot = resolveRepoRoot();
  const intentRel = String(msg.intent || '').trim();
  if (!intentRel) {
    send(ws, 'error', { message: '请先选择或填写 Intent YAML 路径' });
    send(ws, 'change-detection:run-full:done', { ok: false, message: '缺少 Intent YAML' });
    return;
  }
  const gate = Boolean(msg.gate);
  const promote = Boolean(msg.promote);

  send(ws, 'change-detection:run-full:start', { intent: intentRel, gate, promote });
  logLine(ws, `[change-detection] 全流程开始 · ${intentRel}`, 'info');

  try {
    await runIntent(ws, session, {
      intent: intentRel,
      engine: String(msg.engine || 'ego').toLowerCase() === 'pw' ? 'pw' : 'ego',
      heal: false,
      compareAfter: false,
      headed: Boolean(msg.headed),
    }, deps);

    if (session.intentRunCancelled) return;

    logLine(ws, '[change-detection] 运行 compare-screenshots…', 'info');
    await runRepoCompareReport(ws, session, {
      resolveRepoRoot,
      spawn,
      buildRepoSpawnEnv,
      extraArgs: gate ? ['--gate'] : [],
    });

    let triage = { confirmed: 0, pending: 0, ignored: 0 };
    let changeSummary = { contentOnly: 0, structure: 0, selectorDrift: 0 };
    let baselineRevision;
    const issuesPath = path.join(repoRoot, 'results/ui-issues.json');
    if (fs.existsSync(issuesPath)) {
      try {
        const report = JSON.parse(fs.readFileSync(issuesPath, 'utf-8'));
        triage = report.summary?.triage || triage;
        for (const issue of report.issues || []) {
          if (issue.structureType === 'content-update') changeSummary.contentOnly++;
          if (issue.structureType === 'dom-drift') changeSummary.structure++;
          if (issue.structureType === 'selector-drift') changeSummary.selectorDrift++;
        }
        baselineRevision = report.baselineRevision;
      } catch {
        /* ignore */
      }
    }

    if (promote && runRepoPromoteBaseline) {
      const scriptKey = String(msg.scriptKey || '').trim();
      const runTs = String(msg.runTimestamp || '').trim();
      if (scriptKey && runTs) {
        logLine(ws, '[change-detection] 晋升 Golden 基线…', 'info');
        await runRepoPromoteBaseline(ws, session, {
          scriptKey,
          runTimestamp: runTs,
          browser: msg.browser || 'chrome',
        });
      } else {
        logLine(ws, '[change-detection] 跳过晋升：缺少 scriptKey/runTimestamp', 'warn');
      }
    }

    send(ws, 'change-detection:run-full:done', {
      ok: true,
      intent: intentRel,
      triage,
      changeSummary,
      baselineRevision,
      reportPath: 'results/ui-regression/compare-report.html',
      issuesPath: 'results/ui-issues.json',
    });
    logLine(
      ws,
      `[change-detection] 完成 content=${changeSummary.contentOnly} structure=${changeSummary.structure} selectorDrift=${changeSummary.selectorDrift}`,
      'ok',
    );
  } catch (err) {
    send(ws, 'change-detection:run-full:done', { ok: false, message: errText(err) });
    logLine(ws, `[change-detection] 失败: ${errText(err)}`, 'err');
  }
}

module.exports = { runChangeDetectionFullFlow };
