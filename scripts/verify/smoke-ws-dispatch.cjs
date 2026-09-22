const assert = require('node:assert/strict');
const { createWsDispatcher } = require('../../pw-files/lib/ws-dispatch');
const { processScope } = require('../../pw-files/lib/kill-proc');
const { isTrustedStudioRequest } = require('../../pw-files/lib/studio-access');

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

  for (const value of [null, [], true, 1, 'run', {}, { type: null }, { type: 1 }, { type: '' }, { type: '  ' }]) {
    calls.length = 0;
    await dispatcher.handleMessage(ws, session, 'sid', JSON.stringify(value));
    if (calls.length) throw new Error('非法消息结构不应分发');
  }
  pass('invalid message envelopes');

  for (const type of ['constructor', '__proto__', 'toString']) {
    calls.length = 0;
    await dispatcher.handleMessage(ws, session, 'sid', JSON.stringify({ type }));
    if (!calls.some((c) => c.type === 'error' && c.payload.message.includes('未知指令'))) {
      throw new Error('原型属性不应作为指令分发');
    }
  }
  pass('prototype command names');

  for (const fail of [() => { throw new Error('sync failure'); }, async () => { throw new Error('async failure'); }]) {
    const errors = [];
    const failingDispatcher = createWsDispatcher({
      send: (_ws, type, payload) => errors.push({ type, payload }),
      now: () => 'now', errText: (err) => err.message,
      setSessionPlaywrightEnv: fail,
    });
    await failingDispatcher.handleMessage(ws, {}, 'sid', '{"type":"env:set"}');
    if (errors.length !== 1 || errors[0].type !== 'error') throw new Error('handler 异常未统一捕获');
  }
  pass('sync and async handler errors');

  const restartCalls = [];
  let releaseRestart;
  let restartStarted = 0;
  const restartGate = new Promise((resolve) => { releaseRestart = resolve; });
  const restartDispatcher = createWsDispatcher({
    send: (_ws, type, payload) => restartCalls.push({ type, payload }),
    now: () => 'now', errText: (err) => err.message,
    countBusyStudioSessions: () => 2,
    restartStudio: async () => {
      assert.equal(processScope.getStore(), undefined, 'restart must not own a session task');
      restartStarted++;
      return restartGate;
    },
  });
  await restartDispatcher.handleMessage(ws, {}, 'restart', '{"type":"studio:restart"}');
  assert.equal(restartStarted, 0);
  assert.equal(restartCalls[0].type, 'studio:restart:blocked');
  restartCalls.length = 0;
  let restartFinished = false;
  const restartWork = restartDispatcher.handleMessage(ws, {}, 'restart', '{"type":"studio:restart","force":true}')
    .then(() => { restartFinished = true; });
  await Promise.resolve();
  assert.equal(restartStarted, 1);
  assert.equal(restartFinished, false);
  assert.deepEqual(restartCalls, [], 'a Promise must not be mistaken for a failed result');
  releaseRestart({ ok: true });
  await restartWork;
  assert.equal(restartFinished, true);
  assert.deepEqual(restartCalls, []);
  for (const restartStudio of [
    async () => ({ ok: false, error: 'restarting' }),
    async () => { throw new Error('drain failed'); },
  ]) {
    restartCalls.length = 0;
    const failingRestart = createWsDispatcher({
      send: (_ws, type, payload) => restartCalls.push({ type, payload }),
      now: () => 'now', errText: (err) => err.message, restartStudio,
    });
    await failingRestart.handleMessage(ws, {}, 'restart', '{"type":"studio:restart"}');
    assert.equal(restartCalls.length, 1);
    assert.equal(restartCalls[0].type, 'error');
  }
  pass('restart awaits drain outside session tracking');

  // Node ws CLI callers must explicitly use { origin: 'http://127.0.0.1:3001' }.
  const cliRequest = { method: 'GET', headers: { host: '127.0.0.1:3001' } };
  assert.equal(isTrustedStudioRequest(cliRequest, 3001, { websocket: true }), false);
  cliRequest.headers.origin = 'http://127.0.0.1:3001';
  assert.equal(isTrustedStudioRequest(cliRequest, 3001, { websocket: true }), true);
  for (const origin of ['null', 'http://evil.example', 'http://127.0.0.1:3002']) {
    assert.equal(isTrustedStudioRequest({ ...cliRequest, headers: { ...cliRequest.headers, origin } }, 3001,
      { websocket: true }), false);
  }
  assert.equal(isTrustedStudioRequest({ ...cliRequest, headers: { ...cliRequest.headers, host: 'evil.example:3001' } },
    3001, { websocket: true }), false);
  pass('local CLI WS explicitly supplies a trusted same-origin header');

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
