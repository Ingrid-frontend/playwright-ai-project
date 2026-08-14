const fs = require('fs');
const path = require('path');
const { createStudioHandlers } = require('./ws-handlers-studio');
const { createRepoHandlers } = require('./ws-handlers-repo');
const { createJobsHandlers } = require('./ws-handlers-jobs');

function flattenWsCtx(ctx) {
  const { studio, repo, jobs, ...rest } = ctx;
  return { ...rest, ...(studio || {}), ...(repo || {}), ...(jobs || {}) };
}

function createWsDispatcher(rawCtx) {
  const ctx = flattenWsCtx(rawCtx);
  const {
    send,
    now,
    errText,
    resolveRepoRoot,
    listOptimizedSpecEntries,
    getSessionPlaywrightEnv,
    hasDraftOptimizedInRepo,
    hasDraftRecordingInRepo,
    loadDateCategoriesFile,
    normalizeDateCategoryList,
    specMeta,
    DRAFT_OPTIMIZED_RELATIVE,
    REPO_OPTIMIZED_PROJECTS,
    DEFAULT_REPO_TEST_PROJECTS,
    ANTHROPIC_API_KEY,
    DEEPSEEK_API_KEY,
    getCompareReportStatus,
    COMPARE_REPORT_REL,
    sendEnvInfo,
  } = ctx;

  const handlers = {
    ...createStudioHandlers(ctx),
    ...createRepoHandlers(ctx),
    ...createJobsHandlers(ctx),
  };

  function sendHello(ws, session) {
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
  }

  async function handleMessage(ws, session, sessionId, raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    console.log(`[${now()}] MSG ${msg.type}`);

    try {
      const fn = handlers[msg.type];
      if (!fn) {
        send(ws, 'error', { message: `未知指令: ${msg.type}（请重启 Studio 加载最新服务）` });
        return;
      }
      await fn(ws, session, sessionId, msg);
    } catch (err) {
      console.error(`[${now()}] WS handler error:`, errText(err));
      send(ws, 'error', { message: errText(err) || '服务器处理消息失败' });
    }
  }

  return { sendHello, handleMessage };
}

module.exports = { createWsDispatcher };
