const fs = require('fs');
const path = require('path');
const { send, logLine, stripAnsi, errText } = require('./ws-safe');

async function executeRepoSpecForBatch(ws, session, specRel, headed, projects, profileOverride, deps, runtimeEnv) {
  const {
    resolveRepoRoot,
    assertAllowedOptimizedSpec,
    isDraftOptimizedPath,
    assertSpecEnvMatch,
    getSessionPlaywrightEnv,
    getRepoPlaywrightCli,
    appendRepoTestProjectArgs,
    spawn,
    buildRepoSpawnEnv,
    logPlaywrightFailureReport,
    parsePlaywrightFailures,
    headedFailurePlaceholder,
  } = deps;
  const repoRoot = resolveRepoRoot();
  let absSpec;
  try {
    absSpec = assertAllowedOptimizedSpec(repoRoot, specRel);
  } catch (e) {
    const err = errText(e);
    return {
      exitCode: 1,
      passed: 0,
      failed: 1,
      total: 1,
      error: err,
      failures: [{ title: specRel, location: specRel, status: 'error', message: err, hint: '请检查用例路径是否在 tests/optimized 下。' }],
    };
  }
  if (!fs.existsSync(absSpec)) {
    const err = `文件不存在: ${specRel}`;
    return {
      exitCode: 1,
      passed: 0,
      failed: 1,
      total: 1,
      error: err,
      failures: [{ title: specRel, location: specRel, status: 'error', message: err, hint: '' }],
    };
  }
  if (!isDraftOptimizedPath(specRel)) {
    try {
      const match = assertSpecEnvMatch(
        specRel,
        runtimeEnv || getSessionPlaywrightEnv(session),
        repoRoot,
      );
      if (match && match.ok === false) {
        const err =
          match.specEnv && match.runtimeEnv
            ? `用例环境「${match.specEnv}」与当前运行环境「${match.runtimeEnv}」不一致: ${specRel}`
            : `用例环境与当前运行环境不一致: ${specRel}`;
        return {
          exitCode: 1,
          passed: 0,
          failed: 1,
          total: 1,
          error: err,
          failures: [{ title: specRel, location: specRel, status: 'error', message: err, hint: '批量执行会按用例环境自动切换；若仍失败请检查路径与登录态。' }],
        };
      }
    } catch (e) {
      const err = errText(e);
      return {
        exitCode: 1,
        passed: 0,
        failed: 1,
        total: 1,
        error: err,
        failures: [{ title: specRel, location: specRel, status: 'error', message: err, hint: '请切换侧栏环境或选择当前环境下的用例。' }],
      };
    }
  }
  const cli = getRepoPlaywrightCli(repoRoot);
  if (!cli) {
    const err = '未安装 @playwright/test';
    return {
      exitCode: 1,
      passed: 0,
      failed: 1,
      total: 1,
      error: err,
      failures: [{ title: specRel, location: specRel, status: 'error', message: err, hint: '请在项目根执行 npm install' }],
    };
  }

  session.repoTestCancelled = false;
  const args = [cli, 'test', specRel];
  appendRepoTestProjectArgs(args, projects);
  if (headed) args.push('--headed');
  else args.push('--reporter=json');

  const proc = spawn(process.execPath, args, {
    cwd: repoRoot,
    env: buildRepoSpawnEnv(session, profileOverride, runtimeEnv),
  });
  session.repoTestProc = proc;

  let stdout = '';
  proc.stdout.on('data', (d) => {
    stdout += d.toString();
  });
  proc.stderr.on('data', (d) => {
    const t = stripAnsi(d.toString()).trim();
    if (t) logLine(ws, `[batch] ${t}`, 'dim');
  });

  const exitCode = await new Promise((resolve) => {
    proc.on('close', (c) => {
      session.repoTestProc = null;
      resolve(c == null ? 1 : c);
    });
  });

  if (session.repoBatchCancelled || session.repoTestCancelled) {
    return { exitCode: 130, passed: 0, failed: 0, total: 0, cancelled: true };
  }

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
      }
    } catch {
      passed = exitCode === 0 ? 1 : 0;
      failed = exitCode === 0 ? 0 : 1;
      total = 1;
      if (exitCode !== 0) failures = parsePlaywrightFailures({ suites: [] }, session, exitCode);
    }
  } else {
    passed = exitCode === 0 ? 1 : 0;
    failed = exitCode === 0 ? 0 : 1;
    total = 1;
    if (exitCode !== 0 || failed > 0) failures = headedFailurePlaceholder(specRel);
  }

  return { exitCode, passed, failed, total, failures };
}

async function runRepoBatchTest(ws, session, msg, deps) {
  const {
    resolveRepoRoot,
    isDraftOptimizedPath,
    normalizeRepoTestProjects,
    formatRepoTestProjectsLog,
    specMeta,
    ensureAccountLoginForProfile,
    getSessionPlaywrightEnv,
    executeRepoSpecForBatch,
  } = deps;
  const repoRoot = resolveRepoRoot();
  if (!fs.existsSync(path.join(repoRoot, 'playwright.config.ts'))) {
    send(ws, 'error', { message: '未找到项目根，无法批量执行' });
    return;
  }

  const specs = [
    ...new Set(
      (Array.isArray(msg.specRelatives) ? msg.specRelatives : [])
        .map((s) => String(s || '').trim().replace(/\\/g, '/'))
        .filter((s) => s && !isDraftOptimizedPath(s)),
    ),
  ];
  if (!specs.length) {
    send(ws, 'error', { message: '请至少选择一个测试用例' });
    return;
  }

  const stopOnError = Boolean(msg.stopOnError);
  const headed = Boolean(msg.headed);
  const testProjects = normalizeRepoTestProjects(msg.projects);
  session.repoBatchCancelled = false;
  session.repoBatchRunning = true;
  send(ws, 'repo:batch-test:start', { total: specs.length, projects: testProjects });
  logLine(
    ws,
    `[batch] 开始批量执行 ${specs.length} 个用例（${formatRepoTestProjectsLog(testProjects)}）`,
    'info',
  );

  const results = [];
  let stoppedEarly = false;

  const repoRootForBatch = resolveRepoRoot();
  const batchEntries = specs.map((rel) => {
    const entry = { rel, ...specMeta.enrichOptimizedSpecEntry(repoRootForBatch, rel) };
    if (!entry.playwrightEnv) {
      entry.playwrightEnv = getSessionPlaywrightEnv(session);
    }
    return entry;
  });
  const envGroups = specMeta.groupEntriesByPlaywrightEnv(batchEntries);
  const sessionEnv = getSessionPlaywrightEnv(session);
  let globalIndex = 0;
  for (const [envId, envEntries] of envGroups) {
    if (session.repoBatchCancelled) break;
    const runtimeEnv = envId && envId !== 'unknown' ? envId : sessionEnv;
    logLine(ws, `[batch] 环境组 ${runtimeEnv}（${envEntries.length} 个用例）· 切换登录态/baseURL`, 'info');
    send(ws, 'repo:batch-test:progress', {
      index: globalIndex,
      total: specs.length,
      phase: 'env',
      playwrightEnv: runtimeEnv,
      specRelative: null,
    });

    const profileGroups = specMeta.groupEntriesByAccountProfile(envEntries);
    for (const [profile, groupEntries] of profileGroups) {
      if (session.repoBatchCancelled) break;
      if (profile && profile !== specMeta.UNKNOWN_PROFILE) {
        logLine(ws, `[batch] 账号组 ${runtimeEnv}/${profile}（${groupEntries.length} 个用例）`, 'info');
        const loginReady = await ensureAccountLoginForProfile(ws, session, profile, runtimeEnv);
        if (!loginReady.ok) {
          for (const entry of groupEntries) {
            const err = `账号档案 ${runtimeEnv}/${profile} 登录失败`;
            const item = {
              specRelative: entry.rel,
              playwrightEnv: runtimeEnv,
              accountProfile: entry.accountProfile || null,
              exitCode: 1,
              passed: 0,
              failed: 1,
              total: 1,
              error: err,
              failures: [
                {
                  title: entry.rel,
                  location: entry.rel,
                  status: 'error',
                  message: err,
                  hint: '请先在侧栏完成该档案登录',
                },
              ],
            };
            results.push(item);
            send(ws, 'repo:batch-test:progress', {
              index: globalIndex,
              total: specs.length,
              specRelative: entry.rel,
              phase: 'done',
              playwrightEnv: runtimeEnv,
              ...item,
            });
            globalIndex++;
          }
          if (stopOnError) {
            stoppedEarly = true;
            break;
          }
          continue;
        }
      }

      const profileOverride =
        profile && profile !== specMeta.UNKNOWN_PROFILE ? profile : undefined;

      for (const entry of groupEntries) {
        if (session.repoBatchCancelled) break;
        const specRel = entry.rel;
        const i = globalIndex;
        send(ws, 'repo:batch-test:progress', {
          index: i,
          total: specs.length,
          specRelative: specRel,
          phase: 'running',
          playwrightEnv: runtimeEnv,
          accountProfile: entry.accountProfile || null,
        });
        const r = await executeRepoSpecForBatch(
          ws,
          session,
          specRel,
          headed,
          testProjects,
          profileOverride,
          deps,
          runtimeEnv,
        );
        const item = {
          specRelative: specRel,
          playwrightEnv: runtimeEnv,
          accountProfile: entry.accountProfile || null,
          ...r,
        };
        results.push(item);
        send(ws, 'repo:batch-test:progress', {
          index: i,
          total: specs.length,
          specRelative: specRel,
          phase: 'done',
          exitCode: r.exitCode,
          passed: r.passed,
          failed: r.failed,
          total: r.total,
          cancelled: Boolean(r.cancelled),
          error: r.error || null,
          failures: r.failures || [],
          playwrightEnv: runtimeEnv,
          accountProfile: entry.accountProfile || null,
        });
        globalIndex++;
        if (r.cancelled) break;
        const failedRun = r.exitCode !== 0 || (r.failed != null && r.failed > 0);
        if (failedRun) {
          logLine(ws, `[batch] 失败: [${runtimeEnv}] ${specRel}`, 'warn');
          if (stopOnError) {
            stoppedEarly = true;
            break;
          }
        } else {
          logLine(ws, `[batch] 完成: [${runtimeEnv}] ${specRel}`, 'ok');
          try {
            const { seedGoldenIfMissingAfterSuccess } = require('./repo-seed-golden');
            seedGoldenIfMissingAfterSuccess(ws, deps, {
              session,
              specRelative: specRel,
              projects: testProjects,
              playwrightEnv: runtimeEnv,
            });
          } catch (e) {
            logLine(ws, `[batch] Golden seed 未执行: ${e?.message || e}`, 'dim');
          }
        }
      }
      if (stoppedEarly || session.repoBatchCancelled) break;
    }
    if (stoppedEarly || session.repoBatchCancelled) break;
  }

  session.repoBatchRunning = false;
  const anyFail = results.some((r) => r.exitCode !== 0 || (r.failed != null && r.failed > 0));
  session.lastBatchRunComplete = !session.repoBatchCancelled && results.length > 0;
  send(ws, 'repo:batch-test:done', {
    results,
    cancelled: session.repoBatchCancelled,
    stoppedEarly,
    anyFail,
    projects: testProjects,
    playwrightEnv: getSessionPlaywrightEnv(session),
    headed,
    screenshotHint: path.join(repoRoot, 'screenshots'),
    playwrightReportDir: 'playwright-report',
    testResultsDir: 'test-results',
  });
  logLine(
    ws,
    `[batch] 结束：${results.length}/${specs.length} 项${session.repoBatchCancelled ? '（已取消）' : ''}`,
    anyFail ? 'warn' : 'ok',
  );
}

module.exports = { executeRepoSpecForBatch, runRepoBatchTest };
