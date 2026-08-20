/**
 * Playwright Studio — Backend Server
 * 
 * 依赖：
 *   npm install express ws @anthropic-ai/sdk @playwright/test
 *
 * 运行：
 *   ANTHROPIC_API_KEY=sk-xxx node server.js
 *   或 DEEPSEEK_API_KEY=sk-xxx node server.js（可与 Claude 并存，由前端或默认策略选择）
 *   也可在网页侧栏输入密钥（仅存当前 WebSocket 会话内存，不写盘、不写入日志）
 */

const http = require('http');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const express = require('express');
const { WebSocketServer } = require('ws');
const Anthropic = require('@anthropic-ai/sdk');
const repoEnv = require('./repo-env');
const {
  normalizeDateCategoryList,
  isDateCategoryDirSegment,
} = require(path.join(__dirname, '../src/utils/date-category.cjs'));
const {
  specMatchesEnv,
  buildOptimizedRel,
  parseRawOriginalRel,
  listKnownEnvs,
  isKnownEnv,
  assertSpecEnvMatch,
  rewriteOptimizedSpecImports,
} = require(path.join(__dirname, '../src/utils/test-env-path.cjs'));
const { cleanSpecScreenshots } = require(path.join(__dirname, '../src/utils/clean-spec-screenshots.cjs'));
const specMeta = require(path.join(__dirname, '../src/utils/spec-meta.cjs'));
const {
  DEFAULT_PLAYWRIGHT_ENV,
  resolveRepoRoot,
  loadRepoEnvironments,
  getSessionPlaywrightEnv,
  getSessionAccountProfile,
  getEnvEntryResolved,
  buildRepoSpawnEnv,
  buildStudioRunEnv,
  fixPlaywrightBrowsersEnv,
} = require('./lib/repo-context');
const { send, logLine, now, errText } = require('./lib/ws-safe');
const { registerHttpRoutes, registerStudioStatic } = require('./lib/http-routes');
const { createSessionStore } = require('./lib/session');
const { createSpecSessionHelpers } = require('./lib/spec-session');
const { createWsDispatcher } = require('./lib/ws-dispatch');
const { loadEnvFile } = require('./lib/load-env-file');
const { getLlmStartupLines } = require('./lib/llm-env-status');
const { buildHtmlReport } = require('./lib/report-html');
const { runRepoPromoteBaseline, runRepoVisualReview } = require('./lib/repo-baseline');
const { runFigmaCompare } = require('./lib/figma-compare');
const { runIntent, listIntentDefinitions, getIntentDefinition, saveIntentDefinition, deleteIntentDefinitions } = require('./lib/intent-run');
const { applyHealSuggest, sendTrustReport } = require('./lib/intent-boundary');
const { runStyleDriftFullFlow } = require('./lib/style-drift-run');
const { runEgoAudit } = require('./lib/ego-audit');
const { runEgoNlFlow } = require('./lib/ego-nl-run');
const { runEgoExplore } = require('./lib/ego-explore');
const { runNlToIntent } = require('./lib/nl-to-intent');
const {
  openRepoCompareReport,
  runRepoCompareReport,
} = require('./lib/compare-report-actions');
const { runRepoRerunKeepScreenshots } = require('./lib/repo-rerun-keep');
const {
  REPO_OPTIMIZED_PROJECTS,
  DEFAULT_REPO_TEST_PROJECTS,
  normalizeRepoTestProjects,
  appendRepoTestProjectArgs,
  formatRepoTestProjectsLog,
} = require('./lib/repo-test-projects');
const {
  loadDateCategoriesFile,
  configGetDateCategories,
  configSaveDateCategories,
} = require('./lib/date-categories');
const {
  getRepoPlaywrightCli,
  assertAllowedSavePath,
  assertAllowedOptimizedSpec,
} = require('./lib/repo-paths');
const { listOptimizedSpecs, listOptimizedSpecEntries } = require('./lib/repo-optimized-list');
const {
  resolveOptimizedSpecsAfterPipeline,
  readOptimizedCodeAfterPipeline,
} = require('./lib/repo-optimized-pipeline');
const { resolveRecordingPathViaRepo } = require('./lib/recording-path');
const { suggestRepoSavePath, repoSave } = require('./lib/repo-save');
const { repoCommitArtifacts } = require('./lib/repo-commit-artifacts');
const { runRepoPipeline } = require('./lib/repo-pipeline');
const { runRepoTest } = require('./lib/repo-test');
const {
  executeRepoSpecForBatch,
  runRepoBatchTest,
} = require('./lib/repo-batch-test');
const {
  cancelRepoPipeline,
  cancelRepoTest,
  cancelRepoBatch,
  cancelRepoCompare,
  cancelIntentRun,
  cancelEgoAudit,
  cancelEgoExplore,
  cancelRepoRerun,
  cancelOptimize,
  cancelRun,
} = require('./lib/cancel-actions');
const { createAccountEnvActions } = require('./lib/account-env');
const { generateSampleScript, simulateRecording } = require('./lib/recording-utils');
const { createRecordingActions } = require('./lib/recording');
const { generateReport } = require('./lib/studio-report');
const { runScript } = require('./lib/studio-run');
const { streamDeepSeekChat } = require('./lib/deepseek');
const {
  getOptimizeApiKeys,
  resolveOptimizeProvider,
  logOptimizeProviderChoice,
} = require('./lib/optimize-utils');
const {
  parsePlaywrightFailures,
  logPlaywrightFailureReport,
  headedFailurePlaceholder,
} = require('./lib/failure-report');
const {
  TEST_JOBS_CONFIG_REL,
  loadTestJobsConfigFile,
  readJobLockFile,
  readLatestJobRunFile,
} = require('./lib/test-jobs-fs');
const {
  mergeTestJobDef,
  matchesAnyJobPattern,
  normalizeJobSpecPatterns,
  relPathForJobSpecMatch,
} = require('./lib/test-jobs-config');
const { createTestJobsActions } = require('./lib/test-jobs-actions');
const { createTestJobsSpecActions } = require('./lib/test-jobs-spec-actions');
const { optimizeCode, simulateOptimize } = require('./lib/studio-optimize');
const {
  DRAFT_OPTIMIZED_RELATIVE,
  isDraftOptimizedPath,
  hasDraftRecordingInRepo,
  hasDraftOptimizedInRepo,
  syncDraftOptimizedFromEditor,
  isPlaceholderRecordingPath,
  ensureDraftRecordingPath,
  removeDraftRecordingIfAny,
  removeDraftOptimizedArtifacts,
} = require('./lib/draft-paths');
const {
  COMPARE_REPORT_REL,
  getCompareReportStatus,
  resolveRepoPublicReadFile,
  sendRepoUiIssues,
  sendCompareReportStatus,
} = require('./lib/compare-report-status');

const PORT = process.env.PORT || 3001;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
/** 直接执行 CLI，避免 spawn(..., { shell: true }) + 参数数组触发 Node DEP0190 */
const PLAYWRIGHT_CLI = path.join(__dirname, 'node_modules', '@playwright', 'test', 'cli.js');

// repo-context / ws-safe 见 ./lib/
const {
  sendEnvInfo,
  clearSessionStorage,
  setSessionAccountProfile,
  runAccountLogin,
  setSessionPlaywrightEnv,
} = createAccountEnvActions({
  repoEnv,
  resolveRepoRoot,
  getSessionPlaywrightEnv,
  getSessionAccountProfile,
  getEnvEntryResolved,
  getRepoPlaywrightCli,
  spawn,
  buildRepoSpawnEnv,
  loadRepoEnvironments,
  DEFAULT_PLAYWRIGHT_ENV,
  listOptimizedSpecs,
  listOptimizedSpecEntries,
  specMeta,
});
const { startRecording, stopRecording } = createRecordingActions({
  repoEnv,
  resolveRepoRoot,
  getSessionPlaywrightEnv,
  getSessionAccountProfile,
  getEnvEntryResolved,
  runAccountLogin,
  getRepoPlaywrightCli,
  PLAYWRIGHT_CLI,
  buildRepoSpawnEnv,
  generateSampleScript,
  simulateRecording,
  spawn,
});
const {
  repoLoadOptimized,
  repoDeleteOptimizedSpecs,
  repoCleanSpecScreenshots,
} = createTestJobsSpecActions({
  resolveRepoRoot,
  isDraftOptimizedPath,
  specMeta,
  assertAllowedOptimizedSpec,
  cleanSpecScreenshots,
  listOptimizedSpecEntries,
  getSessionPlaywrightEnv,
});
const {
  handleJobsPreview,
  handleJobsList,
  handleJobsStatus,
  handleJobsRun,
  handleJobsStop,
} = createTestJobsActions({
  resolveRepoRoot,
  isDraftOptimizedPath,
  specMatchesEnv,
  specMeta,
  normalizeJobSpecPatterns,
  relPathForJobSpecMatch,
  matchesAnyJobPattern,
  mergeTestJobDef,
  loadTestJobsConfigFile,
  readJobLockFile,
  readLatestJobRunFile,
  TEST_JOBS_CONFIG_REL,
  listKnownEnvs,
  isKnownEnv,
  assertAllowedOptimizedSpec,
});

const {
  resolveSpecAccountProfile,
  writeSpecMetaForSession,
  ensureAccountLoginForProfile,
  ensureSpecAccountReady,
} = createSpecSessionHelpers({
  specMeta,
  repoEnv,
  getSessionPlaywrightEnv,
  getSessionAccountProfile,
  resolveRepoRoot,
  logLine,
  runAccountLogin,
  isDraftOptimizedPath,
});

// ── Setup ───────────────────────────────────────────────────────────────
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

registerStudioStatic(app, express, {
  studioDir: __dirname,
  resolveRepoRoot,
  resolveRepoPublicReadFile,
});

const { sessions, makeSession } = createSessionStore({
  studioDir: __dirname,
  draftOptimizedRelative: DRAFT_OPTIMIZED_RELATIVE,
  defaultPlaywrightEnv: DEFAULT_PLAYWRIGHT_ENV,
});
registerHttpRoutes(app, { resolveRepoRoot, sessions });

const { sendHello, handleMessage } = createWsDispatcher({
  send,
  now,
  errText,
  logLine,
  studioDir: __dirname,
  resolveRepoRoot,
  spawn,
  specMeta,
  DRAFT_OPTIMIZED_RELATIVE,
  REPO_OPTIMIZED_PROJECTS,
  DEFAULT_REPO_TEST_PROJECTS,
  ANTHROPIC_API_KEY,
  DEEPSEEK_API_KEY,
  COMPARE_REPORT_REL,
  PLAYWRIGHT_CLI,
  Anthropic,
  listOptimizedSpecEntries,
  getSessionPlaywrightEnv,
  getSessionAccountProfile,
  hasDraftOptimizedInRepo,
  hasDraftRecordingInRepo,
  loadDateCategoriesFile,
  normalizeDateCategoryList,
  getCompareReportStatus,
  sendEnvInfo,
  studio: {
    startRecording,
    stopRecording,
    setSessionPlaywrightEnv,
    setSessionAccountProfile,
    runAccountLogin,
    clearSessionStorage,
    optimizeCode,
    getOptimizeApiKeys,
    resolveOptimizeProvider,
    logOptimizeProviderChoice,
    streamDeepSeekChat,
    simulateOptimize,
    runScript,
    buildStudioRunEnv,
    logPlaywrightFailureReport,
    cancelOptimize,
    cancelRun,
    generateReport,
    buildHtmlReport,
  },
  repo: {
    repoSave,
    resolveRecordingPathViaRepo,
    isPlaceholderRecordingPath,
    assertAllowedSavePath,
    repoCommitArtifacts,
    isDraftOptimizedPath,
    assertAllowedOptimizedSpec,
    parseRawOriginalRel,
    buildOptimizedRel,
    isDateCategoryDirSegment,
    rewriteOptimizedSpecImports,
    writeSpecMetaForSession,
    removeDraftRecordingIfAny,
    removeDraftOptimizedArtifacts,
    suggestRepoSavePath,
    runRepoPipeline,
    ensureDraftRecordingPath,
    buildRepoSpawnEnv,
    resolveOptimizedSpecsAfterPipeline,
    readOptimizedCodeAfterPipeline,
    runRepoTest,
    syncDraftOptimizedFromEditor,
    assertSpecEnvMatch,
    resolveSpecAccountProfile,
    ensureSpecAccountReady,
    getRepoPlaywrightCli,
    normalizeRepoTestProjects,
    formatRepoTestProjectsLog,
    appendRepoTestProjectArgs,
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
    cancelRepoPipeline,
    cancelRepoTest,
    cancelRepoBatch,
    runFigmaCompare,
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
  },
  jobs: {
    handleJobsList,
    handleJobsStatus,
    handleJobsPreview,
    handleJobsRun,
    handleJobsStop,
  },
});

wss.on('connection', (ws) => {
  const sessionId = Math.random().toString(36).slice(2);
  const session = makeSession();
  sessions.set(sessionId, session);
  sendHello(ws, session);
  console.log(`[${now()}] Client connected: ${sessionId}`);

  ws.on('message', (raw) => handleMessage(ws, session, sessionId, raw));
  ws.on('close', () => {
    console.log(`[${now()}] Client disconnected: ${sessionId}`);
    setTimeout(() => {
      try { fs.rmSync(session.tmpDir, { recursive: true, force: true }); } catch {}
      sessions.delete(sessionId);
    }, 60000);
  });
});

// ── Start ─────────────────────────────────────────────────────────────────
// Studio 进程读取项目根 .env（如 FIGMA_TOKEN / FEISHU_*），不覆盖已有环境变量
try { loadEnvFile(path.join(resolveRepoRoot(), '.env')); } catch { /* ignore */ }
fixPlaywrightBrowsersEnv(process.env);

server.listen(PORT, () => {
  console.log(`\n🎭 Playwright Studio`);
  console.log(`   http://localhost:${PORT}`);
  for (const line of getLlmStartupLines(process.env)) {
    console.log(line);
  }
  console.log('');
});
