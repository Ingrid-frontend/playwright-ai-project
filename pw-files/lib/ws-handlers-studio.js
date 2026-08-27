const path = require('path');

function createStudioHandlers(ctx) {
  const {
    send,
    startRecording,
    stopRecording,
    setSessionPlaywrightEnv,
    setSessionAccountProfile,
    addGoldenProfileEntry,
    removeGoldenProfileEntry,
    runAccountLogin,
    clearSessionStorage,
    optimizeCode,
    getOptimizeApiKeys,
    resolveOptimizeProvider,
    logOptimizeProviderChoice,
    streamDeepSeekChat,
    simulateOptimize,
    Anthropic,
    ANTHROPIC_API_KEY,
    DEEPSEEK_API_KEY,
    logLine,
    runScript,
    PLAYWRIGHT_CLI,
    buildStudioRunEnv,
    spawn,
    logPlaywrightFailureReport,
    studioDir,
    cancelOptimize,
    cancelRun,
    generateReport,
    buildHtmlReport,
  } = ctx;

  return {
    'record:start': async (ws, session, _sessionId, msg) => {
      if (msg.env) session.playwrightEnv = String(msg.env);
      session.lastUrl = msg.url;
      await startRecording(ws, session, msg.url, {
        loginOnly: Boolean(msg.loginOnly),
        profile: msg.profile ? String(msg.profile).trim() : undefined,
      });
    },

    'env:set': async (ws, session, _sessionId, msg) => {
      setSessionPlaywrightEnv(ws, session, String(msg.env || ''));
    },

    'account:set': async (ws, session, _sessionId, msg) => {
      setSessionAccountProfile(ws, session, String(msg.profile || ''));
    },

    'account:login': async (ws, session, _sessionId, msg) => {
      await runAccountLogin(ws, session, msg.env, msg.profile);
    },

    'account:clear-storage': async (ws, session, _sessionId, msg) => {
      clearSessionStorage(ws, session, msg.profile);
    },

    'account:add-golden-profile': async (ws, session, _sessionId, msg) => {
      addGoldenProfileEntry(ws, session, msg.env, {
        label: msg.label,
        username: msg.username,
        password: msg.password,
      });
    },

    'account:remove-golden-profile': async (ws, session, _sessionId, msg) => {
      removeGoldenProfileEntry(ws, session, msg.env, msg.profile);
    },

    'record:stop': async (ws, session) => {
      await stopRecording(ws, session);
    },

    optimize: async (ws, session, _sessionId, msg) => {
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
    },

    run: async (ws, session, _sessionId, msg) => {
      await runScript(ws, session, msg.code, {
        ui: Boolean(msg.ui),
        headed: Boolean(msg.headed),
        debug: Boolean(msg.debug),
      }, {
        PLAYWRIGHT_CLI,
        buildStudioRunEnv,
        spawn,
        logPlaywrightFailureReport,
        studioNodeModulesDir: path.join(studioDir, 'node_modules'),
      });
    },

    'cancel:optimize': async (_ws, session) => {
      cancelOptimize(session);
    },

    'cancel:run': async (_ws, session) => {
      cancelRun(session);
    },

    report: async (ws, session) => {
      generateReport(ws, session, buildHtmlReport);
    },

    export: async (ws, _session, sessionId) => {
      send(ws, 'run:log', { text: `下载链接: /download/spec?sid=${sessionId}`, level: 'info' });
    },

    'export:html': async (ws, _session, sessionId) => {
      send(ws, 'run:log', { text: `下载链接: /download/report?sid=${sessionId}`, level: 'info' });
    },
  };
}

module.exports = { createStudioHandlers };
