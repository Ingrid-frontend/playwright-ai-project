const fs = require('fs');
const path = require('path');
const { send, logLine, stripAnsi, errText } = require('./ws-safe');

async function runRepoPipeline(ws, session, msg, deps) {
  const {
    resolveRepoRoot,
    ensureDraftRecordingPath,
    resolveRecordingPathViaRepo,
    getSessionPlaywrightEnv,
    spawn,
    writeSpecMetaForSession,
    assertAllowedSavePath,
    buildRepoSpawnEnv,
    parseRawOriginalRel,
    resolveOptimizedSpecsAfterPipeline,
    DRAFT_OPTIMIZED_RELATIVE,
    readOptimizedCodeAfterPipeline,
    specMeta,
    getSessionAccountProfile,
    buildOptimizedRel,
  } = deps;

  const repoRoot = resolveRepoRoot();
  if (!fs.existsSync(path.join(repoRoot, 'playwright.config.ts'))) {
    send(ws, 'error', { message: '未找到项目根，无法运行 pipeline' });
    return;
  }
  let targetArg = (msg.targetRelative || '').trim().replace(/\\/g, '/');
  const pipelineCode = typeof msg.code === 'string' ? msg.code : '';
  if (pipelineCode.trim()) {
    try {
      const { draftRelative, formalHint } = await ensureDraftRecordingPath(repoRoot, session, {
        code: pipelineCode,
        name: msg.name,
        description: msg.description,
      }, {
        resolveRecordingPathViaRepo,
        getSessionPlaywrightEnv,
        spawn,
        writeSpecMetaForSession,
      });
      targetArg = draftRelative;
      session.draftRelativePath = draftRelative;
      session.suggestedFormalRelative = formalHint;
      logLine(ws, `[repo] 草稿已写入: ${draftRelative}`, 'dim');
    } catch (e) {
      send(ws, 'error', { message: errText(e) });
      return;
    }
  } else if (!targetArg) {
    targetArg = (session.draftRelativePath || session.lastSavedRelative || '').trim().replace(/\\/g, '/');
  }
  if (!targetArg) {
    send(ws, 'error', { message: '无可用录制脚本，请先录制或粘贴内容' });
    return;
  }
  try {
    if (targetArg.endsWith('.spec.ts')) assertAllowedSavePath(repoRoot, targetArg);
    else if (!targetArg.startsWith('tests/raw-recordings/original/')) {
      throw new Error('pipeline 目标须为 tests/raw-recordings/original/ 下的目录或 .spec.ts');
    }
  } catch (e) {
    send(ws, 'error', { message: errText(e) });
    return;
  }

  session.repoPipelineCancelled = false;
  const since = Date.now();
  send(ws, 'repo:pipeline:start', { targetRelative: targetArg });
  logLine(ws, `[repo] 运行 pipeline-raw-to-optimized → ${targetArg}`, 'info');

  let exitCode = 1;
  try {
    const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const proc = spawn(npmCmd, ['run', 'pipeline-raw-to-optimized', '--', targetArg], {
      cwd: repoRoot,
      env: buildRepoSpawnEnv(session),
      shell: false,
    });
    session.repoPipelineProc = proc;

    proc.stdout.on('data', (d) => {
      const lines = stripAnsi(d.toString()).split('\n');
      for (const line of lines) {
        if (line.trim()) logLine(ws, `[pipeline] ${line}`, 'dim');
      }
    });
    proc.stderr.on('data', (d) => {
      const lines = stripAnsi(d.toString()).split('\n');
      for (const line of lines) {
        if (line.trim()) logLine(ws, `[pipeline] ${line}`, 'warn');
      }
    });

    exitCode = await new Promise((resolve, reject) => {
      proc.on('error', (err) => {
        session.repoPipelineProc = null;
        reject(err);
      });
      proc.on('close', (code) => {
        session.repoPipelineProc = null;
        resolve(code == null ? 1 : code);
      });
    });

    if (session.repoPipelineCancelled) {
      send(ws, 'repo:pipeline:cancelled', {});
      logLine(ws, '[repo] pipeline 已取消', 'warn');
      return;
    }

    const pipelineEnv =
      parseRawOriginalRel(targetArg, repoRoot)?.env || getSessionPlaywrightEnv(session);
    const optimizedSpecs = resolveOptimizedSpecsAfterPipeline(
      repoRoot,
      since,
      targetArg,
      pipelineEnv,
    );
    session.optimizedSpecs = optimizedSpecs;
    const draftOptimizedRelative = optimizedSpecs[0] || DRAFT_OPTIMIZED_RELATIVE;
    session.draftOptimizedRelative = draftOptimizedRelative;
    session.lastPrimaryOptimizedRelative = draftOptimizedRelative;
    const optimizedCode = readOptimizedCodeAfterPipeline(
      repoRoot,
      draftOptimizedRelative,
      optimizedSpecs,
    );
    if (optimizedCode) session.optCode = optimizedCode;

    if (session.draftRelativePath) {
      try {
        writeSpecMetaForSession(repoRoot, session, {
          rawRel: session.draftRelativePath,
          rawCode: pipelineCode || session.rawCode,
        });
      } catch {
        /* ignore */
      }
    }
    for (const optRel of optimizedSpecs) {
      try {
        const rawRel = session.draftRelativePath || targetArg;
        specMeta.copyRawMetaToOptimized(repoRoot, rawRel, optRel, {
          playwrightEnv: pipelineEnv,
          accountProfile: getSessionAccountProfile(session, repoRoot),
          code: pipelineCode || session.rawCode,
          recordSource: 'pipeline',
        });
      } catch {
        /* ignore per-spec meta */
      }
    }

    let suggestedFormalRelative = session.suggestedFormalRelative || null;
    let suggestedFormalOptimized = null;
    if (suggestedFormalRelative) {
      try {
        const parsed = parseRawOriginalRel(suggestedFormalRelative, repoRoot);
        const stem = path.basename(suggestedFormalRelative.replace(/\\/g, '/'), '.spec.ts');
        if (parsed) {
          suggestedFormalOptimized = buildOptimizedRel({
            playwrightEnv: parsed.env,
            dateCategory: parsed.dateCategory,
            stem,
            repoRoot,
          });
        }
      } catch {
        /* ignore */
      }
    }

    send(ws, 'repo:pipeline:done', {
      exitCode,
      optimizedSpecs,
      primaryOptimizedRelative: draftOptimizedRelative,
      draftOptimizedRelative,
      optimizedCode,
      draftRelativePath: session.draftRelativePath || null,
      suggestedFormalRelative,
      suggestedFormalOptimized,
      repoRoot,
      hint: optimizedCode
        ? suggestedFormalOptimized
          ? `草稿已就绪；确认无误后点「保存到项目」→ ${suggestedFormalOptimized}`
          : '已加载优化脚本，调试完成后点「保存到项目」落盘正式用例'
        : optimizedSpecs.length
          ? '已找到用例文件但未读取到内容，请从下拉框重新选择'
          : '未找到 *.optimized.spec.ts，请确认 pipeline 已生成 tests/optimized 产物',
    });
    logLine(
      ws,
      `[repo] pipeline 结束 (exit ${exitCode})，候选: ${optimizedSpecs.length ? optimizedSpecs.join(', ') : '无'}${optimizedCode ? '，已载入优化脚本' : '，未载入优化脚本'}`,
      exitCode === 0 && optimizedCode ? 'ok' : 'warn',
    );
  } catch (e) {
    logLine(ws, `[repo] pipeline 异常: ${errText(e)}`, 'err');
    send(ws, 'repo:pipeline:done', {
      exitCode: 1,
      optimizedSpecs: session.optimizedSpecs || [],
      primaryOptimizedRelative: session.draftOptimizedRelative || DRAFT_OPTIMIZED_RELATIVE,
      draftOptimizedRelative: session.draftOptimizedRelative || DRAFT_OPTIMIZED_RELATIVE,
      optimizedCode: '',
      draftRelativePath: session.draftRelativePath || null,
      repoRoot,
      hint: errText(e),
    });
  }
}

module.exports = { runRepoPipeline };
