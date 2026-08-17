const fs = require('fs');
const path = require('path');

function createSessionStore(opts) {
  const {
    studioDir,
    draftOptimizedRelative,
    defaultPlaywrightEnv,
  } = opts;
  const SESSION_WORK_ROOT = path.join(studioDir, '.pw-studio');
  const sessions = new Map();

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
  }

  return { sessions, makeSession, SESSION_WORK_ROOT };
}

module.exports = { createSessionStore };
