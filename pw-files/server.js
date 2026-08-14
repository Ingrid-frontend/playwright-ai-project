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
const os = require('os');
const { execFile, spawn } = require('child_process');
const express = require('express');
const { WebSocketServer } = require('ws');
const Anthropic = require('@anthropic-ai/sdk');
const repoEnv = require('./repo-env');
const { postprocessRecordedScript } = require(path.join(__dirname, '../src/utils/strip-login-from-recording.cjs'));
const { annotateStorageStateMeta } = require(path.join(__dirname, '../src/utils/storage-state-meta.cjs'));
const { extractFromCode } = require(path.join(__dirname, '../src/utils/extract-login-account.cjs'));
const {
  normalizeDateCategoryList,
  isDateCategoryDirSegment,
} = require(path.join(__dirname, '../src/utils/date-category.cjs'));
const {
  specMatchesEnv,
  buildOptimizedRel,
  parseEnvFromSpecRel,
  parseRawOriginalRel,
  listKnownEnvs,
  isKnownEnv,
  assertSpecEnvMatch,
  getLegacyEnvDefault,
  rewriteOptimizedSpecImports,
} = require(path.join(__dirname, '../src/utils/test-env-path.cjs'));
const { cleanSpecScreenshots } = require(path.join(__dirname, '../src/utils/clean-spec-screenshots.cjs'));
const specMeta = require(path.join(__dirname, '../src/utils/spec-meta.cjs'));
const {
  DEFAULT_PLAYWRIGHT_ENV,
  resolveRepoRoot,
  loadRepoEnvironments,
  getSessionPlaywrightEnv,
  getEnvEntry,
  getSessionAccountProfile,
  getEnvEntryResolved,
  buildRepoSpawnEnv,
  buildStudioRunEnv,
  fixPlaywrightBrowsersEnv,
} = require('./lib/repo-context');
const { send, logLine, now, stripAnsi, errText } = require('./lib/ws-safe');
const { registerHttpRoutes } = require('./lib/http-routes');
const { mapFigmaCropUrls } = require('./lib/figma-payload');
const { buildHtmlReport } = require('./lib/report-html');
const { runRepoPromoteBaseline } = require('./lib/repo-baseline');
const { runFigmaCompare } = require('./lib/figma-compare');
const { runAiNativeValidate } = require('./lib/ai-native-validate');
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
  DATE_CATEGORIES_REL,
  resolveDateCategoriesPath,
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
  findOptimizedCandidatesForRawTarget,
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
  cancelAiValidate,
  cancelRepoRerun,
  cancelOptimize,
  cancelRun,
} = require('./lib/cancel-actions');
const { createAccountEnvActions } = require('./lib/account-env');
const { generateSampleScript, simulateRecording } = require('./lib/recording-utils');
const { createRecordingActions } = require('./lib/recording');
const { simulateRun, generateReport } = require('./lib/studio-report');
const { runScript } = require('./lib/studio-run');
const { streamDeepSeekChat } = require('./lib/deepseek');
const {
  getOptimizeApiKeys,
  resolveOptimizeProvider,
  logOptimizeProviderChoice,
} = require('./lib/optimize-utils');
const {
  findLastFailedStep,
  parsePlaywrightFailures,
  logPlaywrightFailureReport,
  headedFailurePlaceholder,
} = require('./lib/failure-report');
const {
  TEST_JOBS_CONFIG_REL,
  isJobProcessAlive,
  loadTestJobsConfigFile,
  readJobLockFile,
  readLatestJobRunFile,
} = require('./lib/test-jobs-fs');
const {
  KNOWN_JOB_ENV_IDS,
  mergeTestJobDef,
  globToRegExpJob,
  matchesAnyJobPattern,
  normalizeJobSpecPatterns,
  relPathForJobSpecMatch,
} = require('./lib/test-jobs-config');
const { createTestJobsActions } = require('./lib/test-jobs-actions');
const { optimizeCode, simulateOptimize } = require('./lib/studio-optimize');
const {
  STUDIO_DRAFT_STEM,
  LEGACY_STUDIO_DRAFT_STEM,
  DRAFT_OPTIMIZED_RELATIVE,
  isDraftRecordingPath,
  isDraftOptimizedPath,
  hasDraftRecordingInRepo,
  hasDraftOptimizedInRepo,
  syncDraftOptimizedFromEditor,
  buildDraftRecordingRelative,
  isPlaceholderRecordingPath,
  ensureDraftRecordingPath,
  removeDraftRecordingIfAny,
  removeDraftOptimizedArtifacts,
} = require('./lib/draft-paths');
const {
  COMPARE_REPORT_REL,
  compareReportOpenPath,
  getCompareReportStatus,
  repoHasScreenshotPng,
  resolveRepoPublicReadFile,
  sendCompareReportReady,
  sendRepoUiIssues,
  sendCompareReportStatus,
} = require('./lib/compare-report-status');

const PORT = process.env.PORT || 3001;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const DEEPSEEK_API_BASE = (process.env.DEEPSEEK_API_BASE || 'https://api.deepseek.com').replace(/\/$/, '');
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
/** 直接执行 CLI，避免 spawn(..., { shell: true }) + 参数数组触发 Node DEP0190 */
const PLAYWRIGHT_CLI = path.join(__dirname, 'node_modules', '@playwright', 'test', 'cli.js');

// repo-context / ws-safe 见 ./lib/
const {
  sendAccountInfo,
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
  handleJobsPreview,
  handleJobsList,
  handleJobsStatus,
  handleJobsRun,
  handleJobsStop,
  repoLoadOptimized,
  repoDeleteOptimizedSpecs,
  repoCleanSpecScreenshots,
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
  cleanSpecScreenshots,
  listOptimizedSpecEntries,
  getSessionPlaywrightEnv,
});

function resolveSpecAccountProfile(repoRoot, specRel) {
  return specMeta.resolveOptimizedSpecMeta(repoRoot, specRel).accountProfile;
}

function writeSpecMetaForSession(repoRoot, session, { rawRel, optimizedRel, rawCode, optCode }) {
  const envId = getSessionPlaywrightEnv(session);
  const profile = getSessionAccountProfile(session, repoRoot);
  const storageRel = repoEnv.resolveStorageStateRel(repoRoot, envId, profile);
  const storageAbs = path.join(repoRoot, storageRel);
  const sessionMeta = {
    playwrightEnv: envId,
    accountProfile: profile,
    code: rawCode || optCode || '',
    storageAbs: fs.existsSync(storageAbs) ? storageAbs : null,
    storageStateRel: storageRel,
    recordSource: 'studio',
    rawOriginalRel: rawRel || null,
    optimizedRel: optimizedRel || null,
  };
  if (rawRel) {
    specMeta.writeRawSpecMetaFromSession(repoRoot, rawRel, sessionMeta);
  }
  if (optimizedRel) {
    const meta = specMeta.copyRawMetaToOptimized(repoRoot, rawRel || optimizedRel, optimizedRel, {
      playwrightEnv: envId,
      accountProfile: profile,
      code: rawCode || optCode,
      storageAbs: sessionMeta.storageAbs,
      recordSource: 'studio',
    });
    try {
      const abs = path.join(repoRoot, optimizedRel);
      if (fs.existsSync(abs)) {
        const withHeader = specMeta.appendSpecMetaHeaderToCode(fs.readFileSync(abs, 'utf8'), meta);
        fs.writeFileSync(abs, withHeader, 'utf8');
      }
    } catch {
      /* ignore header append */
    }
  }
}

async function ensureAccountLoginForProfile(ws, session, profileId) {
  const repoRoot = resolveRepoRoot();
  const envId = getSessionPlaywrightEnv(session);
  const profile = repoEnv.resolveAccountProfile(repoRoot, envId, profileId);
  const storageRel = repoEnv.resolveStorageStateRel(repoRoot, envId, profile);
  if (repoEnv.storageExists(repoRoot, storageRel)) {
    return { ok: true, profile, skipped: true };
  }
  logLine(ws, `[account] 档案 ${profile} 无登录态，正在登录…`, 'warn');
  const savedProfile = session.accountProfile;
  session.accountProfile = profile;
  try {
    await runAccountLogin(ws, session);
    const ok = repoEnv.storageExists(repoRoot, storageRel);
    return { ok, profile, skipped: false };
  } finally {
    session.accountProfile = savedProfile;
  }
}

async function ensureSpecAccountReady(ws, session, specRel) {
  if (isDraftOptimizedPath(specRel)) return { ok: true, profile: null };
  const repoRoot = resolveRepoRoot();
  const meta = specMeta.resolveOptimizedSpecMeta(repoRoot, specRel);
  if (!meta.accountProfile || meta.accountProfile === specMeta.UNKNOWN_PROFILE) {
    return { ok: true, profile: null };
  }
  return ensureAccountLoginForProfile(ws, session, meta.accountProfile);
}

// ── Setup ───────────────────────────────────────────────────────────────
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use((req, res, next) => {
  if (req.method !== 'GET' || !req.path.startsWith('/repo-report/')) return next();
  const repoRoot = resolveRepoRoot();
  const tail = req.path.slice('/repo-report/'.length);
  let abs;
  try {
    abs = resolveRepoPublicReadFile(repoRoot, tail);
  } catch {
    res.status(400).send('Bad path');
    return;
  }
  if (!abs || !fs.existsSync(abs)) {
    res.status(404).send('Not found');
    return;
  }
  res.sendFile(abs, (err) => {
    if (err && !res.headersSent) res.status(500).send(String(err.message || err));
  });
});

app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
  },
}));
app.use("/results", express.static(path.join(__dirname, "..", "results")));
app.use("/screenshots", express.static(path.join(__dirname, "..", "screenshots")));
app.use(express.json());

// ── State per connection ────────────────────────────────────────────────
const sessions = new Map();
registerHttpRoutes(app, { resolveRepoRoot, sessions });
/** 会话工作目录放在项目内，便于 Playwright 从测试文件解析 node_modules/@playwright/test */
const SESSION_WORK_ROOT = path.join(__dirname, '.pw-studio');

function ensureSessionWorkRoot() {
  fs.mkdirSync(SESSION_WORK_ROOT, { recursive: true });
}

function makeSession() {
  ensureSessionWorkRoot();
  return {
    recording: false,
    recordProc: null,
    runProc: null,
    optimizeRunning: false,
    optimizeCancelled: false,
    runCancelled: false,
    rawCode: '',
    optCode: '',
    runResult: null,
    tmpDir: fs.mkdtempSync(path.join(SESSION_WORK_ROOT, 'run-')),
    /** 界面传入的密钥，优先于环境变量；null 表示使用环境变量 */
    apiKeys: { anthropic: null, deepseek: null },
    repoPipelineProc: null,
    repoTestProc: null,
    repoPipelineCancelled: false,
    repoTestCancelled: false,
    repoCompareProc: null,
    repoCompareCancelled: false,
    repoRerunProc: null,
    repoRerunCancelled: false,
    aiValidateProc: null,
    aiValidateCancelled: false,
    aiValidateSeq: 0,
    repoBatchCancelled: false,
    repoBatchRunning: false,
    lastBatchRunComplete: false,
    lastSavedRelative: null,
    draftRelativePath: null,
    draftOptimizedRelative: DRAFT_OPTIMIZED_RELATIVE,
    suggestedFormalRelative: null,
    lastPrimaryOptimizedRelative: null,
    optimizedSpecs: [],
    playwrightEnv: process.env.PLAYWRIGHT_ENV || DEFAULT_PLAYWRIGHT_ENV,
    accountProfile: process.env.PLAYWRIGHT_ACCOUNT || 'default',
  };
}

// ── Helpers（send/logLine/now/stripAnsi/errText 见 ./lib/ws-safe.js）────

// ── WebSocket handler ─────────────────────────────────────────────────────
wss.on('connection', (ws) => {
  const sessionId = Math.random().toString(36).slice(2);
  const session = makeSession();
  sessions.set(sessionId, session);

  const root = resolveRepoRoot();
  const repoReady = fs.existsSync(path.join(root, 'playwright.config.ts'));
  const optimizedSpecEntries = repoReady
    ? listOptimizedSpecEntries(root, { limit: 40, env: getSessionPlaywrightEnv(session) })
    : [];
  const optimizedSpecs = optimizedSpecEntries.map((e) => e.rel);
  let draftOptimizedExists = false;
  let draftRecordingExists = false;
  let dateCategories = [];
  let dateCategoriesDescription = '';
  if (repoReady) {
    try {
      draftOptimizedExists = hasDraftOptimizedInRepo(root);
      draftRecordingExists = hasDraftRecordingInRepo(root);
    } catch {
      /* ignore */
    }
    try {
      const cfg = loadDateCategoriesFile(root);
      dateCategories = normalizeDateCategoryList(cfg.dateCategories || []);
      dateCategoriesDescription = cfg.description || '';
    } catch (e) {
      console.warn(`[${now()}] 读取 date-categories 失败:`, errText(e));
    }
  }
  send(ws, 'repo:info', {
    repoRoot: root,
    repoReady,
    optimizedSpecs,
    optimizedSpecEntries,
    profileCounts: specMeta.summarizeProfileCounts(optimizedSpecEntries),
    draftOptimizedRelative: DRAFT_OPTIMIZED_RELATIVE,
    draftOptimizedExists,
    draftRecordingExists,
    dateCategories,
    dateCategoriesDescription,
    browserProjects: REPO_OPTIMIZED_PROJECTS,
    defaultBrowserProjects: DEFAULT_REPO_TEST_PROJECTS,
    optimizeKeys: {
      anthropic: Boolean(ANTHROPIC_API_KEY),
      deepseek: Boolean(DEEPSEEK_API_KEY),
    },
    compareReport: repoReady ? getCompareReportStatus(root) : {
      hasReport: false,
      hasScreenshots: false,
      openPath: null,
      reportRel: COMPARE_REPORT_REL,
    },
  });
  sendEnvInfo(ws, session, root, repoReady);

  console.log(`[${now()}] Client connected: ${sessionId}`);

  ws.on('message', async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    console.log(`[${now()}] MSG ${msg.type}`);

    try {
    switch (msg.type) {
      case 'record:start':
        if (msg.env) session.playwrightEnv = String(msg.env);
        session.lastUrl = msg.url;
        await startRecording(ws, session, msg.url);
        break;

      case 'env:set':
        setSessionPlaywrightEnv(ws, session, String(msg.env || ''));
        break;

      case 'account:set':
        setSessionAccountProfile(ws, session, String(msg.profile || ''));
        break;

      case 'account:login':
        await runAccountLogin(ws, session);
        break;

      case 'account:clear-storage':
        clearSessionStorage(ws, session);
        break;

      case 'record:stop':
        await stopRecording(ws, session);
        break;

      case 'optimize':
        await optimizeCode(ws, session, msg.code, msg.opts || {}, msg.provider, msg, {
          getOptimizeApiKeys,
          resolveOptimizeProvider,
          logOptimizeProviderChoice,
          streamDeepSeekChat,
          simulateOptimize,
          Anthropic,
          envKeys: {
            anthropic: ANTHROPIC_API_KEY || null,
            deepseek: DEEPSEEK_API_KEY || null,
          },
          logLine,
        });
        break;

      case 'run':
        await runScript(ws, session, msg.code, {
          ui: Boolean(msg.ui),
          headed: Boolean(msg.headed),
          debug: Boolean(msg.debug),
        }, {
          PLAYWRIGHT_CLI,
          buildStudioRunEnv,
          spawn,
          logPlaywrightFailureReport,
          studioNodeModulesDir: path.join(__dirname, 'node_modules'),
        });
        break;

      case 'cancel:optimize':
        cancelOptimize(session);
        break;

      case 'cancel:run':
        cancelRun(session);
        break;

      case 'report':
        generateReport(ws, session, buildHtmlReport);
        break;

      case 'export':
        send(ws, 'run:log', { text: `下载链接: /download/spec?sid=${sessionId}`, level: 'info' });
        break;

      case 'export:html':
        send(ws, 'run:log', { text: `下载链接: /download/report?sid=${sessionId}`, level: 'info' });
        break;

      case 'repo:save':
        await repoSave(ws, session, msg, {
          resolveRepoRoot,
          resolveRecordingPathViaRepo,
          isPlaceholderRecordingPath,
          assertAllowedSavePath,
          spawn,
        });
        break;

      case 'repo:commit-artifacts':
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
        break;

      case 'repo:suggest-path':
        await suggestRepoSavePath(ws, session, msg, {
          resolveRepoRoot,
          resolveRecordingPathViaRepo,
          getSessionPlaywrightEnv,
          spawn,
        });
        break;

      case 'repo:list-optimized': {
        const repoRoot = resolveRepoRoot();
        if (!fs.existsSync(path.join(repoRoot, 'playwright.config.ts'))) {
          send(ws, 'error', { message: '未找到项目根，无法列出 optimized 用例' });
          break;
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
        break;
      }

      case 'repo:pipeline':
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
        break;

      case 'repo:test':
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
        break;

      case 'repo:batch-test':
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
        break;

      case 'repo:load-optimized':
        await repoLoadOptimized(ws, msg);
        break;

      case 'repo:delete-spec':
        await repoDeleteOptimizedSpecs(ws, session, msg);
        break;

      case 'repo:clean-screenshots':
        await repoCleanSpecScreenshots(ws, session, msg);
        break;

      case 'config:get-date-categories':
        await configGetDateCategories(ws, {
          resolveRepoRoot,
          normalizeDateCategoryList,
        });
        break;

      case 'config:save-date-categories':
        await configSaveDateCategories(ws, msg, {
          resolveRepoRoot,
          normalizeDateCategoryList,
        });
        break;

      case 'cancel:repo-pipeline':
        cancelRepoPipeline(session);
        break;

      case 'cancel:repo-test':
        cancelRepoTest(session);
        break;

      case 'cancel:repo-batch-test':
        cancelRepoBatch(session);
        break;

      case 'figma:compare':
        await runFigmaCompare(ws, session, msg, {
          resolveRepoRoot,
          spawn,
          buildRepoSpawnEnv,
          getSessionPlaywrightEnv,
          getSessionAccountProfile,
        });
        break;

      case 'ai:validate':
        await runAiNativeValidate(ws, session, msg, {
          resolveRepoRoot,
          spawn,
          buildRepoSpawnEnv,
          getSessionPlaywrightEnv,
          getSessionAccountProfile,
        });
        break;

      case 'cancel:ai-validate':
        cancelAiValidate(session);
        break;

      case 'repo:compare-report':
        await runRepoCompareReport(ws, session, {
          resolveRepoRoot,
          spawn,
          buildRepoSpawnEnv,
        });
        break;

      case 'repo:open-compare-report':
        await openRepoCompareReport(
          ws,
          session,
          { regenerate: Boolean(msg.regenerate) },
          { resolveRepoRoot, spawn, buildRepoSpawnEnv },
        );
        break;

      case 'repo:compare-report:status':
        sendCompareReportStatus(ws, resolveRepoRoot());
        break;

      case 'repo:promote-baseline':
        await runRepoPromoteBaseline(ws, session, msg, {
          resolveRepoRoot,
          buildRepoSpawnEnv,
          spawn,
        });
        break;

      case 'repo:ui-issues':
        await sendRepoUiIssues(ws, resolveRepoRoot);
        break;

      case 'cancel:repo-compare':
        cancelRepoCompare(session);
        break;

      case 'repo:rerun-keep-screenshots':
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
        break;

      case 'cancel:repo-rerun-keep':
        cancelRepoRerun(session);
        break;

      case 'jobs:list':
        await handleJobsList(ws);
        break;

      case 'jobs:status':
        await handleJobsStatus(ws, msg);
        break;

      case 'jobs:preview':
        await handleJobsPreview(ws, msg);
        break;

      case 'jobs:run':
        await handleJobsRun(ws, msg);
        break;

      case 'jobs:stop':
        await handleJobsStop(ws, msg);
        break;

      default:
        send(ws, 'error', { message: `未知指令: ${msg.type}（请重启 Studio 加载最新服务）` });
        break;
    }
    } catch (err) {
      console.error(`[${now()}] WS handler error:`, errText(err));
      send(ws, 'error', { message: errText(err) || '服务器处理消息失败' });
    }
  });

  ws.on('close', () => {
    console.log(`[${now()}] Client disconnected: ${sessionId}`);
    // Cleanup temp dir after delay
    setTimeout(() => {
      try { fs.rmSync(session.tmpDir, { recursive: true, force: true }); } catch {}
      sessions.delete(sessionId);
    }, 60000);
  });
});


function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  try {
    const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const key = m[1];
      if (process.env[key] !== undefined) continue;
      let val = m[2];
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      process.env[key] = val;
    }
  } catch { /* ignore */ }
}

// ── Start ─────────────────────────────────────────────────────────────────
// Studio 进程读取项目根 .env（如 FIGMA_TOKEN / FEISHU_*），不覆盖已有环境变量
try { loadEnvFile(path.join(resolveRepoRoot(), '.env')); } catch { /* ignore */ }
fixPlaywrightBrowsersEnv(process.env);

server.listen(PORT, () => {
  console.log(`\n🎭 Playwright Studio`);
  console.log(`   http://localhost:${PORT}`);
  console.log(`   ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY ? '✓ 已配置' : '✗ 未配置'}`);
  console.log(`   DEEPSEEK_API_KEY: ${DEEPSEEK_API_KEY ? '✓ 已配置' : '✗ 未配置'}`);
  if (!ANTHROPIC_API_KEY && !DEEPSEEK_API_KEY) {
    console.log('   （两者皆未配置时将使用演示模式；也可在网页侧栏输入密钥）');
  }
  console.log('');
});
