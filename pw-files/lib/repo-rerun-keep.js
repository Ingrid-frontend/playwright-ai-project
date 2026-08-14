const fs = require('fs');
const path = require('path');
const { send, logLine, stripAnsi, errText } = require('./ws-safe');
const {
  COMPARE_REPORT_REL,
  compareReportOpenPath,
} = require('./compare-report-status');

async function runRepoRerunKeepScreenshots(ws, session, msg, deps) {
  const {
    resolveRepoRoot,
    spawn,
    buildRepoSpawnEnv,
    getSessionPlaywrightEnv,
    isDraftOptimizedPath,
    syncDraftOptimizedFromEditor,
    assertAllowedOptimizedSpec,
    assertSpecEnvMatch,
  } = deps;

  if (session.repoRerunProc) {
    send(ws, 'error', { message: '已有追加 run 任务在运行' });
    return;
  }
  const repoRoot = resolveRepoRoot();
  if (!fs.existsSync(path.join(repoRoot, 'playwright.config.ts'))) {
    send(ws, 'error', { message: '未找到项目根' });
    send(ws, 'repo:rerun-keep:done', { ok: false });
    return;
  }

  const specRels = [];
  if (Array.isArray(msg.specRelatives)) {
    for (const s of msg.specRelatives) {
      const rel = String(s || '').trim().replace(/\\/g, '/');
      if (rel) specRels.push(rel);
    }
  } else if (msg.specRelative) {
    const rel = String(msg.specRelative).trim().replace(/\\/g, '/');
    if (rel) specRels.push(rel);
  }
  if (specRels.length === 0) {
    send(ws, 'error', { message: '请先选择测试用例' });
    send(ws, 'repo:rerun-keep:done', { ok: false });
    return;
  }

  for (const specRel of specRels) {
    if (isDraftOptimizedPath(specRel) && typeof msg.optimizedCode === 'string' && msg.optimizedCode.trim()) {
      try {
        syncDraftOptimizedFromEditor(repoRoot, msg.optimizedCode, specRel);
      } catch (e) {
        send(ws, 'error', { message: `同步草稿用例失败: ${errText(e)}` });
        send(ws, 'repo:rerun-keep:done', { ok: false });
        return;
      }
    }
    try {
      assertAllowedOptimizedSpec(repoRoot, specRel);
    } catch (e) {
      send(ws, 'error', { message: errText(e) });
      send(ws, 'repo:rerun-keep:done', { ok: false });
      return;
    }
    if (!isDraftOptimizedPath(specRel)) {
      try {
        assertSpecEnvMatch(specRel, getSessionPlaywrightEnv(session), repoRoot);
      } catch (e) {
        send(ws, 'error', { message: errText(e) });
        send(ws, 'repo:rerun-keep:done', { ok: false });
        return;
      }
    }
  }

  session.repoRerunCancelled = false;
  send(ws, 'repo:rerun-keep:start', { specRelatives: specRels });
  logLine(ws, `[repo] 保留截图追加 run（${specRels.length} 个用例）…`, 'info');

  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const args = ['run', 'rerun-regression-keep', '--', `--env=${getSessionPlaywrightEnv(session)}`];
  for (const rel of specRels) args.push(`--spec=${rel}`);

  const proc = spawn(npmCmd, args, {
    cwd: repoRoot,
    env: buildRepoSpawnEnv(session),
    shell: false,
  });
  session.repoRerunProc = proc;
  proc.stdout.on('data', (d) => {
    const t = stripAnsi(d.toString());
    if (t.trim()) logLine(ws, t.trimEnd(), 'dim');
  });
  proc.stderr.on('data', (d) => {
    const t = stripAnsi(d.toString());
    if (t.trim()) logLine(ws, t.trimEnd(), 'warn');
  });

  const exitCode = await new Promise((resolve) => {
    proc.on('close', (c) => {
      session.repoRerunProc = null;
      resolve(c == null ? 1 : c);
    });
  });

  if (session.repoRerunCancelled) {
    send(ws, 'repo:rerun-keep:done', { ok: false, cancelled: true });
    logLine(ws, '[repo] 追加 run 已取消', 'warn');
    return;
  }
  if (exitCode !== 0) {
    send(ws, 'error', { message: `追加 run 退出码 ${exitCode}` });
    send(ws, 'repo:rerun-keep:done', { ok: false, exitCode });
    return;
  }

  const absReport = path.join(repoRoot, COMPARE_REPORT_REL);
  send(ws, 'repo:rerun-keep:done', {
    ok: true,
    openPath: fs.existsSync(absReport) ? compareReportOpenPath() : null,
  });
  logLine(ws, '[repo] 追加 run 全流程完成', 'ok');
}

module.exports = { runRepoRerunKeepScreenshots };
