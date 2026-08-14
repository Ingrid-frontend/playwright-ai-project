const fs = require('fs');
const path = require('path');

function createRepoHandlers(ctx) {
  const {
    send,
    resolveRepoRoot,
    resolveRecordingPathViaRepo,
    isPlaceholderRecordingPath,
    assertAllowedSavePath,
    spawn,
    repoSave,
    repoCommitArtifacts,
    isDraftOptimizedPath,
    DRAFT_OPTIMIZED_RELATIVE,
    assertAllowedOptimizedSpec,
    parseRawOriginalRel,
    buildOptimizedRel,
    isDateCategoryDirSegment,
    rewriteOptimizedSpecImports,
    writeSpecMetaForSession,
    removeDraftRecordingIfAny,
    removeDraftOptimizedArtifacts,
    getSessionPlaywrightEnv,
    suggestRepoSavePath,
    listOptimizedSpecEntries,
    specMeta,
    runRepoPipeline,
    ensureDraftRecordingPath,
    buildRepoSpawnEnv,
    resolveOptimizedSpecsAfterPipeline,
    readOptimizedCodeAfterPipeline,
    getSessionAccountProfile,
    runRepoTest,
    syncDraftOptimizedFromEditor,
    assertSpecEnvMatch,
    resolveSpecAccountProfile,
    ensureSpecAccountReady,
    getRepoPlaywrightCli,
    normalizeRepoTestProjects,
    formatRepoTestProjectsLog,
    appendRepoTestProjectArgs,
    logPlaywrightFailureReport,
    parsePlaywrightFailures,
    headedFailurePlaceholder,
    runRepoBatchTest,
    ensureAccountLoginForProfile,
    executeRepoSpecForBatch,
    repoLoadOptimized,
    repoDeleteOptimizedSpecs,
    repoCleanSpecScreenshots,
    configGetDateCategories,
    configSaveDateCategories,
    normalizeDateCategoryList,
    cancelRepoPipeline,
    cancelRepoTest,
    cancelRepoBatch,
    runFigmaCompare,
    runAiNativeValidate,
    cancelAiValidate,
    runRepoCompareReport,
    openRepoCompareReport,
    sendCompareReportStatus,
    runRepoPromoteBaseline,
    sendRepoUiIssues,
    cancelRepoCompare,
    runRepoRerunKeepScreenshots,
    cancelRepoRerun,
  } = ctx;

  return {
    'repo:save': async (ws, session, _sessionId, msg) => {
      await repoSave(ws, session, msg, {
        resolveRepoRoot,
        resolveRecordingPathViaRepo,
        isPlaceholderRecordingPath,
        assertAllowedSavePath,
        spawn,
      });
    },

    'repo:commit-artifacts': async (ws, session, _sessionId, msg) => {
      await repoCommitArtifacts(ws, session, msg, {
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
      });
    },

    'repo:suggest-path': async (ws, session, _sessionId, msg) => {
      await suggestRepoSavePath(ws, session, msg, {
        resolveRepoRoot,
        resolveRecordingPathViaRepo,
        getSessionPlaywrightEnv,
        spawn,
      });
    },

    'repo:list-optimized': async (ws, session, _sessionId, msg) => {
      const repoRoot = resolveRepoRoot();
      if (!fs.existsSync(path.join(repoRoot, 'playwright.config.ts'))) {
        send(ws, 'error', { message: '未找到项目根，无法列出 optimized 用例' });
        return;
      }
      const accountProfile = msg.accountProfile != null ? String(msg.accountProfile).trim() : null;
      const optimizedSpecEntries = listOptimizedSpecEntries(repoRoot, {
        limit: msg.limit ?? 40,
        env: getSessionPlaywrightEnv(session),
        accountProfile: accountProfile || undefined,
      });
      send(ws, 'repo:list-optimized:done', {
        optimizedSpecs: optimizedSpecEntries.map((e) => e.rel),
        optimizedSpecEntries,
        profileCounts: specMeta.summarizeProfileCounts(
          listOptimizedSpecEntries(repoRoot, { limit: 200, env: getSessionPlaywrightEnv(session) }),
        ),
        repoRoot,
      });
    },

    'repo:pipeline': async (ws, session, _sessionId, msg) => {
      await runRepoPipeline(ws, session, msg, {
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
      });
    },

    'repo:test': async (ws, session, _sessionId, msg) => {
      await runRepoTest(ws, session, msg, {
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
      });
    },

    'repo:batch-test': async (ws, session, _sessionId, msg) => {
      await runRepoBatchTest(ws, session, msg, {
        resolveRepoRoot,
        isDraftOptimizedPath,
        normalizeRepoTestProjects,
        formatRepoTestProjectsLog,
        specMeta,
        ensureAccountLoginForProfile,
        getSessionPlaywrightEnv,
        executeRepoSpecForBatch,
        assertAllowedOptimizedSpec,
        assertSpecEnvMatch,
        getRepoPlaywrightCli,
        appendRepoTestProjectArgs,
        spawn,
        buildRepoSpawnEnv,
        logPlaywrightFailureReport,
        parsePlaywrightFailures,
        headedFailurePlaceholder,
      });
    },

    'repo:load-optimized': async (ws, _session, _sessionId, msg) => {
      await repoLoadOptimized(ws, msg);
    },

    'repo:delete-spec': async (ws, session, _sessionId, msg) => {
      await repoDeleteOptimizedSpecs(ws, session, msg);
    },

    'repo:clean-screenshots': async (ws, session, _sessionId, msg) => {
      await repoCleanSpecScreenshots(ws, session, msg);
    },

    'config:get-date-categories': async (ws) => {
      await configGetDateCategories(ws, {
        resolveRepoRoot,
        normalizeDateCategoryList,
      });
    },

    'config:save-date-categories': async (ws, _session, _sessionId, msg) => {
      await configSaveDateCategories(ws, msg, {
        resolveRepoRoot,
        normalizeDateCategoryList,
      });
    },

    'cancel:repo-pipeline': async (_ws, session) => {
      cancelRepoPipeline(session);
    },

    'cancel:repo-test': async (_ws, session) => {
      cancelRepoTest(session);
    },

    'cancel:repo-batch-test': async (_ws, session) => {
      cancelRepoBatch(session);
    },

    'figma:compare': async (ws, session, _sessionId, msg) => {
      await runFigmaCompare(ws, session, msg, {
        resolveRepoRoot,
        spawn,
        buildRepoSpawnEnv,
        getSessionPlaywrightEnv,
        getSessionAccountProfile,
      });
    },

    'ai:validate': async (ws, session, _sessionId, msg) => {
      await runAiNativeValidate(ws, session, msg, {
        resolveRepoRoot,
        spawn,
        buildRepoSpawnEnv,
        getSessionPlaywrightEnv,
        getSessionAccountProfile,
      });
    },

    'cancel:ai-validate': async (_ws, session) => {
      cancelAiValidate(session);
    },

    'repo:compare-report': async (ws, session) => {
      await runRepoCompareReport(ws, session, {
        resolveRepoRoot,
        spawn,
        buildRepoSpawnEnv,
      });
    },

    'repo:open-compare-report': async (ws, session, _sessionId, msg) => {
      await openRepoCompareReport(
        ws,
        session,
        { regenerate: Boolean(msg.regenerate) },
        { resolveRepoRoot, spawn, buildRepoSpawnEnv },
      );
    },

    'repo:compare-report:status': async (ws) => {
      sendCompareReportStatus(ws, resolveRepoRoot());
    },

    'repo:promote-baseline': async (ws, session, _sessionId, msg) => {
      await runRepoPromoteBaseline(ws, session, msg, {
        resolveRepoRoot,
        buildRepoSpawnEnv,
        spawn,
      });
    },

    'repo:ui-issues': async (ws) => {
      await sendRepoUiIssues(ws, resolveRepoRoot);
    },

    'cancel:repo-compare': async (_ws, session) => {
      cancelRepoCompare(session);
    },

    'repo:rerun-keep-screenshots': async (ws, session, _sessionId, msg) => {
      await runRepoRerunKeepScreenshots(ws, session, msg, {
        resolveRepoRoot,
        spawn,
        buildRepoSpawnEnv,
        getSessionPlaywrightEnv,
        isDraftOptimizedPath,
        syncDraftOptimizedFromEditor,
        assertAllowedOptimizedSpec,
        assertSpecEnvMatch,
      });
    },

    'cancel:repo-rerun-keep': async (_ws, session) => {
      cancelRepoRerun(session);
    },
  };
}

module.exports = { createRepoHandlers };
