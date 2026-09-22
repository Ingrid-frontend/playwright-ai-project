const fs = require('fs');
const path = require('path');
const { processScope, observeProcess, processGroupAlive, stopProcessTree } = require('./kill-proc');

// Includes dynamically assigned keys from flow-run-factory / flow-golden-cli.
const SESSION_PROC_KEYS = [
  'recordProc', 'runProc', 'repoPipelineProc', 'repoTestProc', 'repoCompareProc',
  'repoRerunProc', 'aiValidateProc', 'intentRunProc', 'egoAuditProc', 'egoExploreProc',
  'flowConfigProc', 'approvalFlowProc', 'requestFlowProc', 'expenseFlowProc',
  'replayRunProc', 'replaySummaryProc', 'uiAuditProc', 'debugBrowserProc',
];
const lifecycles = new WeakMap();

function getSessionLifecycle(session) {
  let state = lifecycles.get(session);
  if (state) return state;
  state = {
    cancelled: false,
    tasks: new Set(),
    processes: new Set(),
    trackProcess(proc) {
      if (!proc || typeof proc.once !== 'function' || typeof proc.kill !== 'function') return;
      const observed = observeProcess(proc);
      if (observed.closed && !processGroupAlive(proc)) return;
      if (state.processes.has(proc)) return;
      state.processes.add(proc);
      observed.close.then(() => {
        if (!processGroupAlive(proc)) state.processes.delete(proc);
      });
      if (state.cancelled) stopProcessTree(proc);
    },
  };
  lifecycles.set(session, state);
  // Preserve ownership even if a cancel handler clears or overwrites a proc field before close.
  for (const key of SESSION_PROC_KEYS) {
    let value = session[key] || null;
    state.trackProcess(value);
    Object.defineProperty(session, key, {
      enumerable: true,
      configurable: true,
      get: () => value,
      set: (proc) => { value = proc; state.trackProcess(proc); },
    });
  }
  return state;
}

function runSessionTask(session, task) {
  const state = getSessionLifecycle(session);
  if (state.cancelled) return Promise.resolve();
  const pending = processScope.run(state, () => Promise.resolve().then(() => {
    if (!state.cancelled) return task();
  }));
  state.tasks.add(pending);
  pending.then(() => state.tasks.delete(pending), () => state.tasks.delete(pending));
  return pending;
}

async function drainSession(session, options) {
  const state = getSessionLifecycle(session);
  state.cancelled = true;
  session.cancelled = true;
  const cancelKeys = new Set([
    'optimizeCancelled', 'repoBatchCancelled',
    ...SESSION_PROC_KEYS.map((key) => key.replace(/Proc$/, 'Cancelled')),
    ...Object.keys(session).filter((key) => key.endsWith('Cancelled')),
  ]);
  for (const key of cancelKeys) {
    // An in-flight continuation must not reset cancellation after its next await.
    Object.defineProperty(session, key, {
      enumerable: true, configurable: true, get: () => true, set: () => {},
    });
  }
  session.recording = false;
  session.optimizeController?.abort();
  clearInterval(session._simInterval);
  session._simInterval = null;
  for (const [key, proc] of Object.entries(session)) {
    if (key.endsWith('Proc')) state.trackProcess(proc);
  }
  // Waiting tasks also covers LLM/fetch/fs work without a child process. No timeout may
  // turn "still using the directory" into permission to delete it.
  while (state.processes.size || state.tasks.size) {
    const processes = [...state.processes];
    await Promise.all([
      ...processes.map((proc) => stopProcessTree(proc, options).then(() => state.processes.delete(proc))),
      ...[...state.tasks].map((task) => task.catch(() => {})),
    ]);
  }
}

function createSessionStore(opts) {
  const {
    studioDir,
    draftOptimizedRelative,
    defaultPlaywrightEnv,
  } = opts;
  const SESSION_WORK_ROOT = path.join(studioDir, '.pw-studio');
  const sessions = new Map();
  let disposingAll = false;
  let allDisposals;

  function ensureSessionWorkRoot() {
    fs.mkdirSync(SESSION_WORK_ROOT, { recursive: true });
  }

  function makeSession() {
    if (disposingAll) throw new Error('Studio 正在清理会话');
    ensureSessionWorkRoot();
    const session = {
      recording: false,
      recordProc: null,
      runProc: null,
      optimizeRunning: false,
      optimizeCancelled: false,
      optimizeController: null,
      runCancelled: false,
      rawCode: '',
      optCode: '',
      runResult: null,
      tmpDir: fs.mkdtempSync(path.join(SESSION_WORK_ROOT, 'run-')),
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
      intentRunProc: null,
      intentRunCancelled: false,
      intentRunSeq: 0,
      egoAuditProc: null,
      egoAuditCancelled: false,
      egoAuditSeq: 0,
      egoExploreProc: null,
      egoExploreCancelled: false,
      egoExploreSeq: 0,
      repoBatchCancelled: false,
      repoBatchRunning: false,
      lastBatchRunComplete: false,
      lastSavedRelative: null,
      draftRelativePath: null,
      draftOptimizedRelative,
      suggestedFormalRelative: null,
      lastPrimaryOptimizedRelative: null,
      optimizedSpecs: [],
      playwrightEnv: process.env.PLAYWRIGHT_ENV || defaultPlaywrightEnv,
      accountProfile: process.env.PLAYWRIGHT_ACCOUNT || 'default',
    };
    getSessionLifecycle(session);
    return session;
  }

  function disposeSession(sessionId, options) {
    const session = sessions.get(sessionId);
    if (!session) return Promise.resolve();
    const state = getSessionLifecycle(session);
    clearTimeout(state.cleanupTimer);
    state.cleanupTimer = null;
    if (!state.disposing) {
      state.disposing = (async () => {
        await drainSession(session, options);
        fs.rmSync(session.tmpDir, { recursive: true, force: true });
        if (sessions.get(sessionId) === session) sessions.delete(sessionId);
      })();
    }
    return state.disposing;
  }

  function disposeAll(options) {
    disposingAll = true;
    if (!allDisposals) {
      allDisposals = Promise.allSettled([...sessions.keys()].map((id) => disposeSession(id, options)))
        .then((results) => {
          const errors = results.filter((result) => result.status === 'rejected').map((result) => result.reason);
          if (errors.length) throw new AggregateError(errors, 'Studio 会话清理失败');
        });
    }
    return allDisposals;
  }

  function scheduleCleanup(sessionId, onError, { graceMs = 60000, ...options } = {}) {
    const session = sessions.get(sessionId);
    if (!session) return;
    const state = getSessionLifecycle(session);
    if (disposingAll || state.disposing || state.cleanupTimer) return;
    state.cleanupTimer = setTimeout(() => {
      disposeSession(sessionId, options).catch(onError);
    }, graceMs);
  }

  return { sessions, makeSession, disposeSession, disposeAll, scheduleCleanup, SESSION_WORK_ROOT };
}

module.exports = { createSessionStore, runSessionTask, SESSION_PROC_KEYS };
