const fs = require('fs');
const path = require('path');
const { listFlowReplays, runFlowReplay, deleteFlowReplays } = require('./flow-replay-list');
const { runReplaySummary } = require('./replay-summary');

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
    runIntent,
    listIntentDefinitions,
    getIntentDefinition,
    saveIntentDefinition,
    deleteIntentDefinitions,
    cancelIntentRun,
    applyHealSuggest,
    sendTrustReport,
    runEgoAudit,
    runEgoNlFlow,
    runEgoExplore,
    runNlToIntent,
    cancelEgoAudit,
    cancelEgoExplore,
    runRepoCompareReport,
    openRepoCompareReport,
    sendCompareReportStatus,
    runRepoPromoteBaseline,
    runRepoVisualReview,
    sendRepoUiIssues,
    cancelRepoCompare,
    runRepoRerunKeepScreenshots,
    cancelRepoRerun,
    runStyleDriftFullFlow,
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

    'ai:validate': async (ws, session, _sessionId, msg) => {
      await runEgoNlFlow(ws, session, {
        ...msg,
        engine: msg.engine || 'ego',
        audit: msg.audit === true,
        headed: Boolean(msg.headed),
        keepTab: Boolean(msg.keepTab),
      }, {
        resolveRepoRoot,
        spawn,
        buildRepoSpawnEnv,
        getSessionPlaywrightEnv,
        getSessionAccountProfile,
      });
    },

    'cancel:ai-validate': async (_ws, session) => {
      cancelEgoAudit(session);
    },

    'intent:list': async (ws) => {
      const repoRoot = resolveRepoRoot();
      send(ws, 'intent:list:done', { items: listIntentDefinitions(repoRoot) });
    },

    'replay:list': async (ws) => {
      const repoRoot = resolveRepoRoot();
      send(ws, 'replay:list:done', { items: listFlowReplays(repoRoot) });
    },

    'replay:delete': async (ws, _session, _sessionId, msg) => {
      const repoRoot = resolveRepoRoot();
      const outRels = Array.isArray(msg.outRels) ? msg.outRels : msg.outRel ? [msg.outRel] : [];
      if (!outRels.length) {
        send(ws, 'error', { message: '请选择要删除的流程回放' });
        send(ws, 'replay:delete:done', { ok: false, message: '未选择条目' });
        return;
      }
      const result = deleteFlowReplays(repoRoot, outRels);
      const ok = result.deleted.length > 0;
      send(ws, 'replay:delete:done', {
        ok,
        deleted: result.deleted,
        skipped: result.skipped,
        message: ok
          ? `已删除 ${result.deleted.length} 条`
          : result.skipped[0]?.reason || '删除失败',
      });
      send(ws, 'replay:list:done', { items: listFlowReplays(repoRoot) });
    },

    'replay:run': async (ws, session, _sessionId, msg) => {
      await runFlowReplay(ws, session, msg, {
        resolveRepoRoot,
        spawn,
        buildRepoSpawnEnv,
        getSessionPlaywrightEnv,
        getSessionAccountProfile,
        runIntent,
      });
    },

    'replay:summary': async (ws, session, _sessionId, msg) => {
      await runReplaySummary(ws, session, msg, {
        resolveRepoRoot,
        spawn,
        buildRepoSpawnEnv,
      });
    },

    'intent:get': async (ws, _session, _sessionId, msg) => {
      const repoRoot = resolveRepoRoot();
      const result = getIntentDefinition(repoRoot, msg.path || msg.intent);
      const seq = msg.seq;
      if (result.error) {
        send(ws, 'error', { message: result.error });
        send(ws, 'intent:get:done', { ok: false, message: result.error, seq });
        return;
      }
      send(ws, 'intent:get:done', { ok: true, path: result.path, text: result.text, seq });
    },

    'intent:save': async (ws, _session, _sessionId, msg) => {
      const repoRoot = resolveRepoRoot();
      const result = saveIntentDefinition(repoRoot, msg);
      if (result.error) {
        send(ws, 'error', { message: result.error });
        send(ws, 'intent:save:done', { ok: false, message: result.error });
        return;
      }
      send(ws, 'intent:save:done', { ok: true, path: result.path });
      send(ws, 'intent:list:done', { items: listIntentDefinitions(repoRoot) });
    },

    'intent:delete': async (ws, _session, _sessionId, msg) => {
      const repoRoot = resolveRepoRoot();
      const paths = Array.isArray(msg.paths) ? msg.paths : msg.path ? [msg.path] : [];
      if (!paths.length) {
        send(ws, 'error', { message: '请选择要删除的 YAML 用例' });
        send(ws, 'intent:delete:done', { ok: false, message: '未选择条目' });
        return;
      }
      const result = deleteIntentDefinitions(repoRoot, paths);
      const ok = result.deleted.length > 0;
      send(ws, 'intent:delete:done', {
        ok,
        deleted: result.deleted,
        skipped: result.skipped,
        message: ok
          ? `已删除 ${result.deleted.length} 条`
          : result.skipped[0]?.reason || '删除失败',
      });
      send(ws, 'intent:list:done', { items: listIntentDefinitions(repoRoot) });
    },

    'intent:run': async (ws, session, _sessionId, msg) => {
      await runIntent(ws, session, msg, {
        resolveRepoRoot,
        spawn,
        buildRepoSpawnEnv,
        getSessionPlaywrightEnv,
        getSessionAccountProfile,
        runRepoCompareReport,
      });
    },

    'heal:suggest:apply': async (ws, session, _sessionId, msg) => {
      await applyHealSuggest(ws, session, msg, {
        resolveRepoRoot,
        spawn,
        buildRepoSpawnEnv,
      });
    },

    'trust:report': async (ws) => {
      sendTrustReport(ws, { resolveRepoRoot });
    },

    'style-drift:run-full': async (ws, session, _sessionId, msg) => {
      await runStyleDriftFullFlow(ws, session, msg, {
        resolveRepoRoot,
        spawn,
        buildRepoSpawnEnv,
        getSessionPlaywrightEnv,
        getSessionAccountProfile,
        runRepoCompareReport,
        runIntent,
      });
    },

    'cancel:intent-run': async (_ws, session) => {
      cancelIntentRun(session);
    },

    'ego:explore': async (ws, session, _sessionId, msg) => {
      await runEgoExplore(ws, session, msg, {
        resolveRepoRoot,
        spawn,
        buildRepoSpawnEnv,
        getSessionPlaywrightEnv,
      });
    },

    'cancel:ego-explore': async (_ws, session) => {
      cancelEgoExplore(session);
    },

    'intent:from-nl': async (ws, session, _sessionId, msg) => {
      await runNlToIntent(ws, session, msg, {
        resolveRepoRoot,
        spawn,
        buildRepoSpawnEnv,
        getSessionPlaywrightEnv,
      });
    },

    'ego:audit': async (ws, session, _sessionId, msg) => {
      await runEgoAudit(ws, session, msg, {
        resolveRepoRoot,
        spawn,
        buildRepoSpawnEnv,
        getSessionPlaywrightEnv,
        assertAllowedOptimizedSpec,
      });
    },

    'ego:nl-run': async (ws, session, _sessionId, msg) => {
      await runEgoNlFlow(ws, session, msg, {
        resolveRepoRoot,
        spawn,
        buildRepoSpawnEnv,
        getSessionPlaywrightEnv,
        getSessionAccountProfile,
      });
    },

    'cancel:ego-audit': async (_ws, session) => {
      cancelEgoAudit(session);
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

    'repo:visual-review': async (ws, session, _sessionId, msg) => {
      await runRepoVisualReview(ws, session, msg, {
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
