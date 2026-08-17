const { createWsDispatcher } = require('../../pw-files/lib/ws-dispatch');

function pass(name) {
  console.log(`  ✓ ${name}`);
}

const calls = [];
const session = { playwrightEnv: 'stage', lastUrl: null, accountProfile: 'default' };

const dispatcher = createWsDispatcher({
  send: (ws, type, payload) => calls.push({ type, payload }),
  now: () => 'now',
  errText: (e) => String(e?.message || e),
  logLine: () => {},
  studioDir: process.cwd(),
  resolveRepoRoot: () => process.cwd(),
  listOptimizedSpecEntries: () => [],
  getSessionPlaywrightEnv: (s) => s.playwrightEnv,
  hasDraftOptimizedInRepo: () => false,
  hasDraftRecordingInRepo: () => false,
  loadDateCategoriesFile: () => ({ dateCategories: [], description: '' }),
  normalizeDateCategoryList: (v) => v || [],
  specMeta: { summarizeProfileCounts: () => ({}) },
  DRAFT_OPTIMIZED_RELATIVE: 'tests/optimized/studio-unsaved-draft.optimized.spec.ts',
  REPO_OPTIMIZED_PROJECTS: ['optimized'],
  DEFAULT_REPO_TEST_PROJECTS: ['optimized'],
  ANTHROPIC_API_KEY: null,
  DEEPSEEK_API_KEY: null,
  getCompareReportStatus: () => ({ hasReport: false, hasScreenshots: false, openPath: null, reportRel: 'results/screenshot-comparison.html' }),
  COMPARE_REPORT_REL: 'results/screenshot-comparison.html',
  sendEnvInfo: () => calls.push({ type: 'env:info' }),
  startRecording: async () => calls.push({ type: 'startRecording' }),
  stopRecording: async () => calls.push({ type: 'stopRecording' }),
  setSessionPlaywrightEnv: (_ws, s, env) => {
    s.playwrightEnv = env;
    calls.push({ type: 'env:set', payload: env });
  },
  setSessionAccountProfile: () => {},
  runAccountLogin: async () => {},
  clearSessionStorage: () => {},
  optimizeCode: async () => {},
  getOptimizeApiKeys: () => ({}),
  resolveOptimizeProvider: () => ({ provider: 'demo' }),
  logOptimizeProviderChoice: () => {},
  streamDeepSeekChat: async () => {},
  simulateOptimize: async () => {},
  Anthropic: class {},
  runScript: async () => {},
  PLAYWRIGHT_CLI: 'cli.js',
  buildStudioRunEnv: () => process.env,
  spawn: () => {},
  logPlaywrightFailureReport: () => {},
  cancelOptimize: () => {},
  cancelRun: () => {},
  generateReport: () => {},
  buildHtmlReport: () => '',
  repoSave: async () => {},
  resolveRecordingPathViaRepo: () => '',
  isPlaceholderRecordingPath: () => false,
  assertAllowedSavePath: () => {},
  repoCommitArtifacts: async () => {},
  isDraftOptimizedPath: () => false,
  assertAllowedOptimizedSpec: () => {},
  parseRawOriginalRel: () => ({}),
  buildOptimizedRel: () => '',
  isDateCategoryDirSegment: () => true,
  rewriteOptimizedSpecImports: (s) => s,
  writeSpecMetaForSession: () => {},
  removeDraftRecordingIfAny: () => {},
  removeDraftOptimizedArtifacts: () => {},
  suggestRepoSavePath: async () => {},
  runRepoPipeline: async () => {},
  ensureDraftRecordingPath: () => '',
  buildRepoSpawnEnv: () => process.env,
  resolveOptimizedSpecsAfterPipeline: () => [],
  readOptimizedCodeAfterPipeline: () => '',
  getSessionAccountProfile: () => 'default',
  runRepoTest: async () => {},
  syncDraftOptimizedFromEditor: () => {},
  assertSpecEnvMatch: () => {},
  resolveSpecAccountProfile: () => 'default',
  ensureSpecAccountReady: async () => ({ ok: true }),
  getRepoPlaywrightCli: () => 'cli.js',
  normalizeRepoTestProjects: (v) => v,
  formatRepoTestProjectsLog: () => '',
  appendRepoTestProjectArgs: (args) => args,
  parsePlaywrightFailures: () => [],
  headedFailurePlaceholder: () => '',
  runRepoBatchTest: async () => {},
  ensureAccountLoginForProfile: async () => ({ ok: true }),
  executeRepoSpecForBatch: async () => {},
  repoLoadOptimized: async () => {},
  repoDeleteOptimizedSpecs: async () => {},
  repoCleanSpecScreenshots: async () => {},
  configGetDateCategories: async () => {},
  configSaveDateCategories: async () => {},
  cancelRepoPipeline: () => {},
  cancelRepoTest: () => {},
  cancelRepoBatch: () => {},
  runFigmaCompare: async () => {},
  runAiNativeValidate: async () => {},
  cancelAiValidate: () => {},
  runRepoCompareReport: async () => {},
  openRepoCompareReport: async () => {},
  sendCompareReportStatus: () => {},
  runRepoPromoteBaseline: async () => {},
  runRepoVisualReview: async () => {},
  sendRepoUiIssues: async () => {},
  cancelRepoCompare: () => {},
  runRepoRerunKeepScreenshots: async () => {},
  cancelRepoRerun: () => {},
  handleJobsList: async () => {},
  handleJobsStatus: async () => {},
  handleJobsPreview: async () => {},
  handleJobsRun: async () => {},
  handleJobsStop: async () => {},
});

const groupedDispatcher = createWsDispatcher({
  send: (ws, type, payload) => calls.push({ type, payload }),
  now: () => 'now',
  errText: (e) => String(e?.message || e),
  logLine: () => {},
  studioDir: process.cwd(),
  resolveRepoRoot: () => process.cwd(),
  listOptimizedSpecEntries: () => [],
  getSessionPlaywrightEnv: (s) => s.playwrightEnv,
  hasDraftOptimizedInRepo: () => false,
  hasDraftRecordingInRepo: () => false,
  loadDateCategoriesFile: () => ({ dateCategories: [], description: '' }),
  normalizeDateCategoryList: (v) => v || [],
  specMeta: { summarizeProfileCounts: () => ({}) },
  DRAFT_OPTIMIZED_RELATIVE: 'tests/optimized/studio-unsaved-draft.optimized.spec.ts',
  REPO_OPTIMIZED_PROJECTS: ['optimized'],
  DEFAULT_REPO_TEST_PROJECTS: ['optimized'],
  ANTHROPIC_API_KEY: null,
  DEEPSEEK_API_KEY: null,
  getCompareReportStatus: () => ({ hasReport: false, hasScreenshots: false, openPath: null, reportRel: 'results/screenshot-comparison.html' }),
  COMPARE_REPORT_REL: 'results/screenshot-comparison.html',
  sendEnvInfo: () => calls.push({ type: 'env:info' }),
  studio: {
    setSessionPlaywrightEnv: (_ws, s, env) => {
      s.playwrightEnv = env;
      calls.push({ type: 'env:set', payload: env });
    },
  },
  repo: {},
  jobs: {},
});

async function main() {
  const ws = {};
  dispatcher.sendHello(ws, session);
  if (!calls.some((c) => c.type === 'repo:info')) throw new Error('sendHello 未发送 repo:info');
  if (!calls.some((c) => c.type === 'env:info')) throw new Error('sendHello 未发送 env:info');
  pass('sendHello');

  calls.length = 0;
  await dispatcher.handleMessage(ws, session, 'sid', 'not-json');
  if (calls.length !== 0) throw new Error('非法 JSON 不应分发');
  pass('invalid json');

  calls.length = 0;
  await dispatcher.handleMessage(ws, session, 'sid', JSON.stringify({ type: 'no-such-cmd' }));
  if (!calls.some((c) => c.type === 'error' && String(c.payload?.message || '').includes('未知指令'))) {
    throw new Error('未知指令未返回 error');
  }
  pass('unknown command');

  calls.length = 0;
  await dispatcher.handleMessage(ws, session, 'sid', JSON.stringify({ type: 'env:set', env: 'uat' }));
  if (session.playwrightEnv !== 'uat') throw new Error('env:set 未写入 session');
  if (!calls.some((c) => c.type === 'env:set' && c.payload === 'uat')) throw new Error('env:set 未调用');
  pass('env:set');

  calls.length = 0;
  const groupedSession = { playwrightEnv: 'stage' };
  await groupedDispatcher.handleMessage(ws, groupedSession, 'sid', JSON.stringify({ type: 'env:set', env: 'dev' }));
  if (groupedSession.playwrightEnv !== 'dev') throw new Error('grouped ctx env:set 未写入 session');
  pass('grouped ctx');

  const { createTestJobsActions } = require('../../pw-files/lib/test-jobs-actions');
  const { createTestJobsSpecActions } = require('../../pw-files/lib/test-jobs-spec-actions');
  const jobs = createTestJobsActions({
    resolveRepoRoot: () => process.cwd(),
    isDraftOptimizedPath: () => false,
    specMatchesEnv: () => true,
    specMeta: { enrichOptimizedSpecEntry: () => ({}), summarizeProfileCounts: () => ({}) },
    normalizeJobSpecPatterns: (v) => v,
    relPathForJobSpecMatch: (v) => v,
    matchesAnyJobPattern: () => false,
    mergeTestJobDef: (_cfg, def) => def,
    loadTestJobsConfigFile: () => ({ jobs: [] }),
    readJobLockFile: () => null,
    readLatestJobRunFile: () => null,
    TEST_JOBS_CONFIG_REL: 'config/test-jobs.json',
    listKnownEnvs: () => ['stage'],
    isKnownEnv: () => true,
    assertAllowedOptimizedSpec: () => '',
  });
  const specs = createTestJobsSpecActions({
    resolveRepoRoot: () => process.cwd(),
    isDraftOptimizedPath: () => false,
    specMeta: { deleteSpecMetaFile: () => {}, summarizeProfileCounts: () => ({}) },
    assertAllowedOptimizedSpec: () => '',
    cleanSpecScreenshots: () => ({ removed: [] }),
    listOptimizedSpecEntries: () => [],
    getSessionPlaywrightEnv: () => 'stage',
  });
  for (const name of ['handleJobsPreview', 'handleJobsList', 'handleJobsStatus', 'handleJobsRun', 'handleJobsStop']) {
    if (typeof jobs[name] !== 'function') throw new Error(`jobs factory 缺少 ${name}`);
  }
  for (const name of ['repoLoadOptimized', 'repoDeleteOptimizedSpecs', 'repoCleanSpecScreenshots']) {
    if (typeof specs[name] !== 'function') throw new Error(`spec factory 缺少 ${name}`);
  }
  pass('jobs factories');

  console.log('\n✅ smoke-ws-dispatch 通过');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
