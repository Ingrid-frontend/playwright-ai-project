const fs = require('fs');
const path = require('path');
const { send, logLine, errText } = require('./ws-safe');

async function repoCommitArtifacts(ws, session, msg, deps) {
  const {
    resolveRepoRoot,
    isDraftOptimizedPath,
    DRAFT_OPTIMIZED_RELATIVE,
    assertAllowedOptimizedSpec,
    isPlaceholderRecordingPath,
    resolveRecordingPathViaRepo,
    getSessionPlaywrightEnv,
    spawn,
    parseRawOriginalRel,
    buildOptimizedRel,
    isDateCategoryDirSegment,
    assertAllowedSavePath,
    rewriteOptimizedSpecImports,
    writeSpecMetaForSession,
    removeDraftRecordingIfAny,
    removeDraftOptimizedArtifacts,
  } = deps;

  const repoRoot = resolveRepoRoot();
  if (!fs.existsSync(path.join(repoRoot, 'playwright.config.ts'))) {
    send(ws, 'error', {
      message: '未找到项目根（含 playwright.config.ts）。请设置 PLAYWRIGHT_REPO_ROOT 或将 pw-files 放在仓库子目录下。',
    });
    return;
  }
  const rawCode = typeof msg.code === 'string' ? msg.code : session.rawCode;
  if (!rawCode || !String(rawCode).trim()) {
    send(ws, 'error', { message: '保存失败：录制脚本为空' });
    return;
  }
  let optimizedRelative = String(msg.optimizedRelative || '').trim().replace(/\\/g, '/');
  if (isDraftOptimizedPath(optimizedRelative)) {
    optimizedRelative = '';
  }
  if (!optimizedRelative && Array.isArray(session.optimizedSpecs)) {
    const formal = session.optimizedSpecs.find((s) => !isDraftOptimizedPath(s));
    optimizedRelative = formal || '';
  }
  const optCode = typeof msg.optimizedCode === 'string' ? msg.optimizedCode : '';
  let optContent = optCode.trim();
  if (!optContent) {
    const readFrom =
      optimizedRelative || session.draftOptimizedRelative || DRAFT_OPTIMIZED_RELATIVE;
    try {
      optContent = fs.readFileSync(assertAllowedOptimizedSpec(repoRoot, readFrom), 'utf8');
    } catch (e) {
      send(ws, 'error', { message: `无法读取优化脚本: ${errText(e)}` });
      return;
    }
  }
  if (!optContent.trim()) {
    send(ws, 'error', { message: '优化脚本为空' });
    return;
  }

  let relativePath = (msg.relativePath || '').trim().replace(/\\/g, '/');
  if (isPlaceholderRecordingPath(relativePath)) {
    try {
      const resolved = await resolveRecordingPathViaRepo(repoRoot, {
        code: rawCode,
        name: msg.name,
        description: msg.description,
        target: 'original',
        playwrightEnv: getSessionPlaywrightEnv(session),
      }, spawn);
      relativePath = resolved.relativePath;
      logLine(ws, `[repo] 录制落盘: ${relativePath}`, 'dim');
    } catch (e) {
      send(ws, 'error', { message: `无法解析录制保存路径: ${errText(e)}` });
      return;
    }
  }
  if (!optimizedRelative) {
    const parsed = parseRawOriginalRel(relativePath, repoRoot);
    const stem = path.basename(relativePath.replace(/\\/g, '/'), '.spec.ts');
    if (parsed) {
      optimizedRelative = buildOptimizedRel({
        playwrightEnv: parsed.env,
        dateCategory: parsed.dateCategory,
        stem,
        repoRoot,
      });
    } else {
      const norm = relativePath.replace(/\\/g, '/');
      const parts = norm.split('/');
      const dateCategory = parts[parts.length - 2];
      optimizedRelative =
        parts.includes('original') && isDateCategoryDirSegment(dateCategory)
          ? buildOptimizedRel({
              playwrightEnv: getSessionPlaywrightEnv(session),
              dateCategory,
              stem,
              repoRoot,
            })
          : `tests/optimized/${stem}.optimized.spec.ts`;
    }
  }
  let rawAbs;
  let optAbs;
  try {
    rawAbs = assertAllowedSavePath(repoRoot, relativePath);
    optAbs = assertAllowedOptimizedSpec(repoRoot, optimizedRelative);
  } catch (e) {
    send(ws, 'error', { message: errText(e) });
    return;
  }
  fs.mkdirSync(path.dirname(rawAbs), { recursive: true });
  fs.writeFileSync(rawAbs, rawCode, 'utf8');
  fs.mkdirSync(path.dirname(optAbs), { recursive: true });
  optContent = rewriteOptimizedSpecImports(optContent, optimizedRelative, repoRoot);
  fs.writeFileSync(optAbs, optContent, 'utf8');

  try {
    writeSpecMetaForSession(repoRoot, session, {
      rawRel: relativePath,
      optimizedRel: optimizedRelative,
      rawCode,
      optCode: optContent,
    });
  } catch (e) {
    logLine(ws, `[repo] 元数据写入失败: ${errText(e)}`, 'warn');
  }

  session.lastSavedRelative = relativePath;
  session.lastPrimaryOptimizedRelative = optimizedRelative;
  session.rawCode = rawCode;
  session.optCode = optContent;
  removeDraftRecordingIfAny(repoRoot, session);
  const removedDraftOptimized = removeDraftOptimizedArtifacts(repoRoot);
  session.draftOptimizedRelative = DRAFT_OPTIMIZED_RELATIVE;

  logLine(ws, `[repo] 已保存录制: ${relativePath}`, 'ok');
  logLine(ws, `[repo] 已保存优化: ${optimizedRelative}`, 'ok');
  if (removedDraftOptimized.length) {
    logLine(ws, `[repo] 已清理草稿: ${removedDraftOptimized.join(', ')}`, 'dim');
  }
  send(ws, 'repo:commit-artifacts:done', {
    relativePath,
    optimizedRelative,
    removedDraftOptimized,
    repoRoot,
  });
}

module.exports = { repoCommitArtifacts };
