const fs = require('fs');
const path = require('path');
const { send, logLine, errText } = require('./ws-safe');

function createTestJobsSpecActions(deps) {
  const {
    resolveRepoRoot,
    isDraftOptimizedPath,
    specMeta,
    assertAllowedOptimizedSpec,
    cleanSpecScreenshots,
    listOptimizedSpecEntries,
    getSessionPlaywrightEnv,
  } = deps;

  async function repoLoadOptimized(ws, msg) {
    const repoRoot = resolveRepoRoot();
    const specRel = String(msg.specRelative || '').trim().replace(/\\/g, '/');
    if (!specRel) {
      send(ws, 'error', { message: '请指定 specRelative' });
      return;
    }
    try {
      const abs = assertAllowedOptimizedSpec(repoRoot, specRel);
      if (!fs.existsSync(abs)) {
        send(ws, 'error', { message: `文件不存在: ${specRel}` });
        return;
      }
      const code = fs.readFileSync(abs, 'utf8');
      send(ws, 'repo:load-optimized:done', { specRelative: specRel, code });
    } catch (e) {
      send(ws, 'error', { message: errText(e) });
    }
  }

  async function repoDeleteOptimizedSpecs(ws, session, msg) {
    const repoRoot = resolveRepoRoot();
    if (!fs.existsSync(path.join(repoRoot, 'playwright.config.ts'))) {
      send(ws, 'error', { message: '未找到项目根，无法删除用例' });
      return;
    }
    const list = Array.isArray(msg.specRelatives)
      ? msg.specRelatives
      : msg.specRelative
        ? [msg.specRelative]
        : [];
    const specs = [...new Set(list.map((s) => String(s || '').trim().replace(/\\/g, '/')).filter(Boolean))];
    if (!specs.length) {
      send(ws, 'error', { message: '请指定要删除的 tests/optimized/.../*.optimized.spec.ts' });
      return;
    }

    const deleted = [];
    const failed = [];
    for (const specRel of specs) {
      if (isDraftOptimizedPath(specRel)) {
        failed.push({ specRelative: specRel, error: '不允许删除草稿用例' });
        continue;
      }
      try {
        const abs = assertAllowedOptimizedSpec(repoRoot, specRel);
        if (!fs.existsSync(abs)) {
          failed.push({ specRelative: specRel, error: '文件不存在' });
          continue;
        }
        fs.unlinkSync(abs);
        specMeta.deleteSpecMetaFile(repoRoot, specRel);
        deleted.push(specRel);
        logLine(ws, `[repo] 已删除用例: ${specRel}`, 'ok');
      } catch (e) {
        failed.push({ specRelative: specRel, error: errText(e) });
      }
    }

    const optimizedSpecEntries = listOptimizedSpecEntries(repoRoot, {
      limit: 40,
      env: getSessionPlaywrightEnv(session),
    });
    send(ws, 'repo:delete-spec:done', {
      deleted,
      failed,
      optimizedSpecs: optimizedSpecEntries.map((e) => e.rel),
      optimizedSpecEntries,
      profileCounts: specMeta.summarizeProfileCounts(optimizedSpecEntries),
      repoRoot,
    });
    if (deleted.length && failed.length) {
      logLine(ws, `[repo] 删除完成：成功 ${deleted.length}，失败 ${failed.length}`, 'warn');
    } else if (failed.length) {
      logLine(ws, `[repo] 删除失败 ${failed.length} 项`, 'err');
    }
  }

  async function repoCleanSpecScreenshots(ws, session, msg) {
    const repoRoot = resolveRepoRoot();
    if (!fs.existsSync(path.join(repoRoot, 'playwright.config.ts'))) {
      send(ws, 'error', { message: '未找到项目根，无法清理截图' });
      return;
    }

    const mode = msg.mode === 'latest' ? 'latest' : 'all';
    const list = Array.isArray(msg.specRelatives)
      ? msg.specRelatives
      : msg.specRelative
        ? [msg.specRelative]
        : [];
    const specs = [...new Set(list.map((s) => String(s || '').trim().replace(/\\/g, '/')).filter(Boolean))];
    if (!specs.length) {
      send(ws, 'error', { message: '请指定要清理截图的 tests/optimized/.../*.optimized.spec.ts' });
      return;
    }

    const results = [];
    const failed = [];
    for (const specRel of specs) {
      try {
        assertAllowedOptimizedSpec(repoRoot, specRel);
        const result = cleanSpecScreenshots(repoRoot, specRel, { mode, cleanDiffs: true });
        results.push(result);
        if (result.removed.length) {
          const detail =
            mode === 'latest'
              ? `${result.removedRuns} 个 run 目录`
              : result.screenshotDir || specRel;
          logLine(ws, `[repo] 已清理截图 (${mode}): ${specRel} · ${detail}`, 'ok');
        } else {
          logLine(ws, `[repo] 无需清理 (${mode}): ${specRel} — ${result.message || '无截图'}`, 'dim');
        }
      } catch (e) {
        failed.push({ specRelative: specRel, error: errText(e) });
        logLine(ws, `[repo] 清理截图失败 ${specRel}: ${errText(e)}`, 'err');
      }
    }

    send(ws, 'repo:clean-screenshots:done', { mode, results, failed });
  }

  return {
    repoLoadOptimized,
    repoDeleteOptimizedSpecs,
    repoCleanSpecScreenshots,
  };
}

module.exports = { createTestJobsSpecActions };
