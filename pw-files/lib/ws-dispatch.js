const fs = require('fs');
const path = require('path');
const { createStudioHandlers } = require('./ws-handlers-studio');
const { createRepoHandlers } = require('./ws-handlers-repo');
const { createJobsHandlers } = require('./ws-handlers-jobs');
const { runSessionTask } = require('./session');

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
    // Restart owns the whole store, not this session. Adapt the legacy synchronous handler.
    'studio:restart': async (ws, _session, _sessionId, msg) => {
      if (!ctx.restartStudio) {
        send(ws, 'error', { message: '重启不可用' });
        return;
      }
      const busy = ctx.countBusyStudioSessions?.() || 0;
      if (busy && !msg.force) {
        send(ws, 'studio:restart:blocked', { busy });
        return;
      }
      const result = await ctx.restartStudio(ws);
      if (!result.ok) {
        send(ws, 'error', { message: result.error === 'restarting' ? '服务正在重启' : '重启失败' });
      }
    },
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
    try {
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }
      if (!msg || Object.getPrototypeOf(msg) !== Object.prototype ||
          typeof msg.type !== 'string' || !msg.type.trim()) return;
      if (session.cancelled) return;

      console.log(`[${now()}] MSG ${msg.type}`);
      const fn = Object.prototype.hasOwnProperty.call(handlers, msg.type) ? handlers[msg.type] : null;
      if (!fn) {
        send(ws, 'error', { message: `未知指令: ${msg.type}（请重启 Studio 加载最新服务）` });
        return;
      }
      // Tracking restart would make disposeAll await the task that is awaiting disposeAll.
      if (msg.type === 'studio:restart') await fn(ws, session, sessionId, msg);
      else await runSessionTask(session, () => fn(ws, session, sessionId, msg));
    } catch (err) {
      console.error(`[${now()}] WS handler error:`, errText(err));
      send(ws, 'error', { message: errText(err) || '服务器处理消息失败' });
    }
  }

  return { sendHello, handleMessage };
}

module.exports = { createWsDispatcher };
