const fs = require('fs');
const path = require('path');
const { send, logLine, stripAnsi, errText } = require('./ws-safe');

async function runRepoTest(ws, session, msg, deps) {
  const {
    resolveRepoRoot,
    DRAFT_OPTIMIZED_RELATIVE,
    isDraftOptimizedPath,
    syncDraftOptimizedFromEditor,
    assertAllowedOptimizedSpec,
    assertSpecEnvMatch,
    getSessionPlaywrightEnv,
    getSessionAccountProfile,
    resolveSpecAccountProfile,
    ensureSpecAccountReady,
    getRepoPlaywrightCli,
    normalizeRepoTestProjects,
    formatRepoTestProjectsLog,
    appendRepoTestProjectArgs,
    spawn,
    buildRepoSpawnEnv,
    specMeta,
    logPlaywrightFailureReport,
    parsePlaywrightFailures,
    headedFailurePlaceholder,
  } = deps;

  const repoRoot = resolveRepoRoot();
  let specRel = (msg.specRelative || session.draftOptimizedRelative || DRAFT_OPTIMIZED_RELATIVE)
    .trim()
    .replace(/\\/g, '/');
  if (!specRel) {
    send(ws, 'error', { message: '请指定 specRelative（tests/optimized/.../*.optimized.spec.ts）' });
    return;
  }
  if (isDraftOptimizedPath(specRel) && typeof msg.optimizedCode === 'string' && msg.optimizedCode.trim()) {
    try {
      syncDraftOptimizedFromEditor(repoRoot, msg.optimizedCode, specRel);
    } catch (e) {
      send(ws, 'error', { message: `同步草稿用例失败: ${errText(e)}` });
      return;
    }
  }
  let absSpec;
  try {
    absSpec = assertAllowedOptimizedSpec(repoRoot, specRel);
  } catch (e) {
    send(ws, 'error', { message: errText(e) });
    return;
  }
  if (!fs.existsSync(absSpec)) {
    send(ws, 'error', { message: `文件不存在: ${specRel}` });
    return;
  }
  if (!isDraftOptimizedPath(specRel)) {
    try {
      assertSpecEnvMatch(specRel, getSessionPlaywrightEnv(session), repoRoot);
    } catch (e) {
      send(ws, 'error', { message: errText(e) });
      return;
    }
  }

  const specProfile = isDraftOptimizedPath(specRel)
    ? getSessionAccountProfile(session, repoRoot)
    : resolveSpecAccountProfile(repoRoot, specRel);
  const loginReady = await ensureSpecAccountReady(ws, session, specRel);
  if (!loginReady.ok) {
    send(ws, 'error', { message: `账号档案 ${loginReady.profile || specProfile} 登录失败，无法执行用例` });
    return;
  }

  const cli = getRepoPlaywrightCli(repoRoot);
  if (!cli) {
    send(ws, 'error', { message: '项目根未安装 @playwright/test，请在仓库根执行 npm install' });
    return;
  }

  session.repoTestCancelled = false;
  const testProjects = normalizeRepoTestProjects(msg.projects);
  send(ws, 'run:start');
  logLine(ws, `[repo] 项目内执行: ${specRel} --project=${formatRepoTestProjectsLog(testProjects)}`, 'info');

  const headed = Boolean(msg.headed);
  const startTime = Date.now();
  const args = [cli, 'test', specRel];
  appendRepoTestProjectArgs(args, testProjects);
  if (headed) args.push('--headed');
  else args.push('--reporter=json');

  logLine(ws, `[repo] PLAYWRIGHT_ENV=${getSessionPlaywrightEnv(session)}`, 'dim');
  if (specProfile && specProfile !== specMeta.UNKNOWN_PROFILE) {
    logLine(ws, `[repo] PLAYWRIGHT_ACCOUNT=${specProfile}`, 'dim');
  }
  const proc = spawn(process.execPath, args, {
    cwd: repoRoot,
    env: buildRepoSpawnEnv(
      session,
      specProfile && specProfile !== specMeta.UNKNOWN_PROFILE ? specProfile : undefined,
    ),
  });
  session.repoTestProc = proc;

  let stdout = '';
  proc.stdout.on('data', (d) => {
    stdout += d.toString();
  });
  proc.stderr.on('data', (d) => {
    const t = stripAnsi(d.toString()).trim();
    if (t) logLine(ws, t, 'dim');
  });

  const exitCode = await new Promise((resolve) => {
    proc.on('close', (c) => {
      session.repoTestProc = null;
      resolve(c == null ? 1 : c);
    });
  });

  if (session.repoTestCancelled) {
    send(ws, 'run:cancelled');
    return;
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  let passed = 0;
  let failed = 0;
  let total = 0;
  let failures = [];
  if (!headed) {
    try {
      const result = JSON.parse(stdout);
      const s = result.stats || {};
      const expected = Number(s.expected) || 0;
      const unexpected = Number(s.unexpected) || 0;
      const skipped = Number(s.skipped) || 0;
      const flaky = Number(s.flaky) || 0;
      passed = expected + flaky;
      failed = unexpected;
      total = expected + unexpected + skipped + flaky;
      if (exitCode !== 0 || failed > 0) {
        failures = logPlaywrightFailureReport(ws, result, session, exitCode);
      } else {
        session.lastRunFailures = [];
      }
    } catch {
      passed = exitCode === 0 ? 1 : 0;
      failed = exitCode === 0 ? 0 : 1;
      total = 1;
      if (exitCode !== 0) {
        failures = parsePlaywrightFailures({ suites: [] }, session, exitCode);
        session.lastRunFailures = failures;
      }
    }
  } else {
    logLine(ws, '[repo] 有界面模式已结束，请在浏览器窗口查看结果', 'info');
    passed = exitCode === 0 ? 1 : 0;
    failed = exitCode === 0 ? 0 : 1;
    total = 1;
    if (exitCode !== 0) {
      failures = headedFailurePlaceholder(specRel);
      session.lastRunFailures = failures;
    }
  }

  session.runResult = { passed, failed, total, duration, exitCode, runMode: headed ? 'headed' : 'headless' };
  send(ws, 'run:done', {
    passed,
    failed,
    total,
    duration,
    exitCode,
    runMode: headed ? 'headed' : 'headless',
    uiMode: false,
    failures,
    repoTest: true,
    specRelative: specRel,
    projects: testProjects,
    playwrightEnv: getSessionPlaywrightEnv(session),
    screenshotHint: path.join(repoRoot, 'screenshots'),
    playwrightReportDir: 'playwright-report',
    testResultsDir: 'test-results',
  });
  logLine(ws, `[repo] 截图目录: ${path.join(repoRoot, 'screenshots')}`, 'dim');
}

module.exports = { runRepoTest };
