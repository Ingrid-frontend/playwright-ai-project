// Offline only: fake WS, child processes, filesystem and clock; never starts Studio or a browser.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { EventEmitter } = require('node:events');

const root = path.resolve(__dirname, '../..');
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

class Clock {
  now = 0;
  next = 0;
  timers = new Map();
  setTimeout = (fn, ms) => {
    const id = ++this.next;
    this.timers.set(id, { at: this.now + ms, fn });
    return id;
  };
  clearTimeout = (id) => this.timers.delete(id);
  async tick(ms) {
    const end = this.now + ms;
    await flush();
    for (;;) {
      const next = [...this.timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      this.now = next[1].at;
      this.timers.delete(next[0]);
      next[1].fn();
      await flush();
    }
    this.now = end;
    await flush();
  }
}

class FakeProc extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  killed = false;
  exitCode = null;
  signalCode = null;
  signals = [];
  constructor(pid, groups) {
    super();
    this.pid = pid;
    this.groups = groups;
    groups.set(pid, this);
  }
  kill(signal) {
    this.killed = true;
    this.signals.push(signal);
    return true;
  }
  close(code = 0, childrenRemain = false) {
    this.exitCode = code;
    if (!childrenRemain) this.groups.delete(this.pid);
    this.emit('close', code);
  }
}

class FakeWs extends EventEmitter {
  readyState = 1;
  messages = [];
  send(text) { this.messages.push(JSON.parse(text)); }
  close() { this.readyState = 3; this.emit('close'); }
}

function load(relative, overrides, clock, fakeProcess) {
  const filename = path.join(root, relative);
  const originalRequire = createRequire(filename);
  const req = (id) => Object.prototype.hasOwnProperty.call(overrides, id) ? overrides[id] : originalRequire(id);
  req.resolve = overrides.resolve || originalRequire.resolve;
  const mod = { exports: {} };
  const wrapper = vm.runInThisContext(`(function(require, module, exports, __dirname, process, setTimeout, clearTimeout, clearInterval, fetch) {\n${fs.readFileSync(filename, 'utf8')}\n})`, { filename });
  wrapper(req, mod, mod.exports, path.dirname(filename), fakeProcess,
    clock.setTimeout, clock.clearTimeout, clock.clearTimeout,
    overrides.fetch || (() => { throw new Error('network disabled in offline verification'); }));
  return mod.exports;
}

function harness() {
  const clock = new Clock();
  const groups = new Map();
  const spawned = [];
  const dirs = new Set();
  const removed = [];
  let localTsx = true;
  const spawn = (cmd, args, opts) => {
    assert.notEqual(cmd, 'npx');
    assert.notEqual(cmd, 'npx.cmd');
    const proc = new FakeProc(1000 + spawned.length, groups);
    spawned.push({ cmd, args, opts, proc });
    return proc;
  };
  const fakeProcess = {
    platform: 'darwin', execPath: '/fake/node', env: {},
    kill(pid, signal) {
      const proc = groups.get(-pid);
      if (!proc) throw Object.assign(new Error('not found'), { code: 'ESRCH' });
      if (signal !== 0) proc.kill(signal);
    },
  };
  const fakeFs = {
    existsSync: (abs) => abs.endsWith('node_modules/tsx/dist/cli.mjs') ? localTsx : dirs.has(abs),
    mkdirSync: (abs) => dirs.add(abs),
    mkdtempSync: (prefix) => { const dir = `${prefix}${dirs.size}`; dirs.add(dir); return dir; },
    rmSync: (abs) => { removed.push(abs); dirs.delete(abs); },
  };
  const kill = load('pw-files/lib/kill-proc.js', {
    fs: fakeFs, child_process: { spawn },
    resolve: () => { throw new Error('no local tsx'); },
  }, clock, fakeProcess);
  const sessions = load('pw-files/lib/session.js', { fs: fakeFs, './kill-proc': kill }, clock, fakeProcess);
  const store = sessions.createSessionStore({ studioDir: '/fake/studio', defaultPlaywrightEnv: 'dev' });
  const make = (id) => { const session = store.makeSession(); store.sessions.set(id, session); return session; };
  return { clock, groups, spawned, dirs, removed, fakeFs, fakeProcess, kill, sessions, store, make,
    rawSpawn: spawn, setLocalTsx: (value) => { localTsx = value; } };
}

async function verifyDisconnect() {
  const h = harness();
  const session = h.make('one');
  const other = h.make('two');
  const ws = new FakeWs();
  const errors = [];
  ws.on('close', () => h.store.scheduleCleanup('one', (error) => errors.push(error)));
  const procs = h.sessions.SESSION_PROC_KEYS.map((key) => {
    const proc = h.kill.spawnTracked('/fake/tool', [], {});
    session[key] = proc;
    return proc;
  });
  // A cancel handler can clear the field without actually reaping the process.
  procs[0].kill('SIGTERM');
  session.recordProc = null;
  const replaced = session.replayRunProc;
  session.replayRunProc = h.kill.spawnTracked('/fake/replacement', [], {});
  procs.push(session.replayRunProc);
  assert.ok(procs.includes(replaced));
  let unrelated;
  const otherProc = h.kill.spawnTracked('/fake/other-session', [], {});
  other.runProc = otherProc;
  const pendingWork = deferred();
  let lateSpawnBlocked = false;
  const work = h.sessions.runSessionTask(session, async () => {
    // Shared Jobs use raw child_process.spawn even when invoked inside a WS handler.
    unrelated = h.rawSpawn('/fake/shared-job', [], {});
    // No session proc field: account-login and similar helper processes use this path.
    procs.push(h.kill.spawnTracked('/fake/login', [], {}));
    await pendingWork.promise;
    assert.ok(h.dirs.has(session.tmpDir), 'non-proc work must retain its directory');
    assert.throws(() => h.kill.spawnTracked('/fake/late-step', [], {}), /会话已取消/);
    lateSpawnBlocked = true;
  });
  await flush();
  ws.close();
  ws.emit('close'); // repeated close must not schedule a second cleanup
  await h.clock.tick(59999);
  assert.equal(session.cancelled, undefined);
  assert.equal(h.removed.length, 0);
  await h.clock.tick(1);
  assert.equal(session.cancelled, true);
  assert.equal(session.optimizeCancelled, true);
  assert.equal(session.repoBatchCancelled, true);
  session.flowConfigCancelled = false;
  assert.equal(session.flowConfigCancelled, true, 'a continuation cannot reset cancellation');
  for (const proc of procs) assert.ok(proc.signals.includes('SIGTERM'));
  await h.clock.tick(3000);
  for (const proc of procs) assert.ok(proc.signals.includes('SIGKILL'), 'killed flag must not suppress KILL');
  assert.equal(h.removed.length, 0, 'sending KILL is not close');
  assert.deepEqual(unrelated.signals, []);
  assert.deepEqual(otherProc.signals, []);
  for (const proc of procs) proc.close();
  await flush();
  assert.equal(h.removed.length, 0, 'non-proc task still active');
  pendingWork.resolve();
  await work;
  await h.store.disposeSession('one');
  assert.equal(lateSpawnBlocked, true);
  assert.deepEqual(h.removed, [session.tmpDir]);
  assert.equal(h.store.sessions.has('one'), false);
  assert.equal(h.store.sessions.has('two'), true);
  assert.deepEqual(errors, []);

  // Parent close alone must not hide a surviving detached process group.
  const treeSession = h.make('tree');
  const tree = h.kill.spawnTracked('/fake/tree', [], {});
  treeSession.runProc = tree;
  tree.close(0, true);
  await flush();
  const cleanup = h.store.disposeSession('tree');
  await h.clock.tick(3000);
  assert.ok(tree.signals.includes('SIGKILL'));
  assert.ok(h.dirs.has(treeSession.tmpDir));
  h.groups.delete(tree.pid);
  await h.clock.tick(100);
  await cleanup;
  assert.equal(h.dirs.has(treeSession.tmpDir), false);

  // A cooperative child closes during TERM; no unnecessary KILL follows.
  const graceful = h.make('graceful');
  const child = h.kill.spawnTracked('/fake/graceful', [], {});
  graceful.runProc = child;
  const done = h.store.disposeSession('graceful');
  child.close();
  await done;
  await h.clock.tick(3000);
  assert.deepEqual(child.signals, ['SIGTERM']);
}

async function verifyRegistry() {
  const h = harness();
  const catalog = { abs: '/fake/catalog.ts', rel: 'fake/catalog.ts' };
  const fakeRepoEnv = {
    resolveStorageStateRelDirect: () => '', findAvailableProfileStorage: () => null,
  };
  let writes = 0;
  const flowActions = load('pw-files/lib/flow-config-actions.js', {
    fs: h.fakeFs, './kill-proc': h.kill,
    './catalog-form-io': {
      resolveCatalogAbs: () => catalog,
      readCatalogForm: () => ({ tabs: ['列表'] }),
      writeCatalogForm: (_abs, form) => { writes++; return form; },
    },
    './failure-report': { createPlaywrightLogSink: () => ({ feed() {} }) },
    './flow-run-common': { readLastFlowRun: () => null },
    '../repo-env': fakeRepoEnv,
  }, h.clock, h.fakeProcess);
  const deps = { resolveRepoRoot: () => '/fake/repo', getSessionPlaywrightEnv: () => 'dev',
    getSessionAccountProfile: () => 'default', buildRepoSpawnEnv: () => ({}) };
  const flows = [{ id: 'request-flow', label: '申请单', domain: 'request', entry: '/main/request' }];
  const reply = (proc, text = JSON.stringify(flows), code = 0) => {
    const data = Buffer.from(text);
    // Split inside a multibyte UTF-8 character too; collection must be byte-safe.
    for (const byte of data) proc.stdout.emit('data', Buffer.from([byte]));
    proc.close(code);
  };
  const lastProc = () => h.spawned[h.spawned.length - 1].proc;
  const ws = new FakeWs();
  let resolved = false;
  const listing = flowActions.sendFlowConfigList(ws, deps).then(() => { resolved = true; });
  await flush();
  assert.equal(resolved, false);
  let responsive = false;
  h.clock.setTimeout(() => { responsive = true; }, 0);
  await h.clock.tick(0);
  assert.equal(responsive, true, 'registry must not block other callbacks');
  assert.equal(h.spawned[0].cmd, '/fake/node');
  assert.match(h.spawned[0].args[0], /node_modules\/tsx\/dist\/cli\.mjs$/);
  assert.equal(h.spawned[0].opts.detached, true);
  reply(lastProc());
  await listing;
  assert.deepEqual(ws.messages.pop().flows, flows);

  const status = flowActions.sendFlowConfigStatus(ws, { flowId: 'request-flow' }, deps);
  reply(lastProc());
  await status;
  assert.equal(ws.messages.pop().label, '申请单');
  const save = flowActions.saveFlowConfigCatalog(ws, { flowId: 'request-flow', tabs: ['列表'] }, deps);
  assert.equal(writes, 0);
  reply(lastProc());
  await save;
  assert.equal(writes, 1);
  assert.equal(ws.messages.filter((msg) => msg.type === 'flow:config:catalog-save:done').pop().ok, true);
  const tryRun = flowActions.runFlowConfigTryRun(ws, {}, { flowId: 'request-flow' }, deps);
  reply(lastProc());
  await tryRun;
  assert.equal(ws.messages.pop().message, '该流程尚未接入 Golden 试跑');

  const setup = flowActions.runFlowConfigSetup(ws, {}, { label: '申请单' }, deps);
  assert.match(h.spawned[h.spawned.length - 1].args[1], /resolve-flow-entry\.ts$/);
  reply(lastProc(), '{"entry":"/main/request"}');
  await setup;
  assert.equal(ws.messages.pop().step, 'login');

  fakeRepoEnv.resolveStorageStateRelDirect = () => 'storage.json';
  fakeRepoEnv.storageExists = () => true;
  h.dirs.add('/fake/repo/request-flow');
  const completeSetup = flowActions.runFlowConfigSetup(ws, {}, { label: '申请单' }, deps);
  reply(lastProc(), '{"entry":"/main/request"}');
  await flush();
  assert.match(h.spawned[h.spawned.length - 1].args[1], /probe-live-page\.ts$/);
  reply(lastProc(), '');
  await flush();
  assert.match(h.spawned[h.spawned.length - 1].args[1], /gen-catalog-from-probe\.ts$/);
  reply(lastProc(), '');
  await flush();
  assert.match(h.spawned[h.spawned.length - 1].args[1], /flow-registry-json\.ts$/);
  reply(lastProc());
  await completeSetup;
  const configured = ws.messages.filter((msg) => msg.type === 'flow:config:setup:done').pop();
  assert.equal(configured.ok, true);
  assert.equal(configured.catalogRel, catalog.rel);

  for (const [text, code] of [['not-json', 0], ['', 0], ['null', 0], ['{}', 0], ['[]', 2]]) {
    const result = flowActions.sendFlowConfigList(ws, deps);
    lastProc().stderr.emit('data', Buffer.from('registry failed'));
    reply(lastProc(), text, code);
    await result;
    assert.equal(ws.messages.pop().ok, false);
  }
  for (const stream of ['stdout', 'stderr']) {
    const result = flowActions.sendFlowConfigList(ws, deps);
    const proc = lastProc();
    proc[stream].emit('data', Buffer.alloc(4 * 1024 * 1024 + 1));
    await result;
    assert.match(ws.messages.pop().message, /输出超出限制/);
    assert.deepEqual(proc.signals, ['SIGKILL']);
    proc.close();
  }
  const timeout = flowActions.sendFlowConfigList(ws, deps);
  const timedOut = lastProc();
  await h.clock.tick(15000);
  await timeout;
  assert.match(ws.messages.pop().message, /查询超时/);
  assert.deepEqual(timedOut.signals, ['SIGKILL']);
  timedOut.close();

  const timedSession = h.make('registry-timeout');
  const scopedQuery = h.sessions.runSessionTask(timedSession, () => flowActions.sendFlowConfigList(ws, deps));
  await flush();
  const scopedProc = lastProc();
  await h.clock.tick(15000);
  await scopedQuery;
  const cleanup = h.store.disposeSession('registry-timeout');
  await flush();
  assert.ok(h.dirs.has(timedSession.tmpDir), 'timeout rejection must not lose process ownership');
  scopedProc.close();
  await cleanup;
  assert.equal(h.dirs.has(timedSession.tmpDir), false);

  const spawnError = flowActions.sendFlowConfigList(ws, deps);
  const failed = lastProc();
  failed.emit('error', new Error('spawn failed'));
  await spawnError;
  assert.equal(ws.messages.pop().ok, false);
  failed.close();
  h.setLocalTsx(false);
  const count = h.spawned.length;
  await flowActions.sendFlowConfigList(ws, deps);
  assert.match(ws.messages.pop().message, /本地 tsx/);
  assert.equal(h.spawned.length, count, 'missing local tsx must not fall back to npx');
  assert.equal(h.clock.timers.size, 0, 'settled queries must release deadline timers');

  // Real WS call sites must await the now-asynchronous dependencies.
  for (const [type, action] of [
    ['flow:config:list', 'sendFlowConfigList'], ['flow:config:status', 'sendFlowConfigStatus'],
    ['flow:config:catalog-save', 'saveFlowConfigCatalog'],
  ]) {
    const gate = deferred();
    const { createRepoHandlers } = load('pw-files/lib/ws-handlers-repo.js', {
      './flow-config-actions': { [action]: () => gate.promise },
    }, h.clock, h.fakeProcess);
    let finished = false;
    const pending = createRepoHandlers(deps)[type](ws, {}, 'sid', {}).then(() => { finished = true; });
    await flush();
    assert.equal(finished, false, `${type} must await registry`);
    gate.resolve();
    await pending;
  }
}

async function verifyDownload() {
  const h = harness();
  const routes = new Map();
  const { registerHttpRoutes } = load('pw-files/lib/http-routes.js', {
    fs: h.fakeFs, './session': h.sessions,
    child_process: { spawn: () => { throw new Error('unexpected spawn'); } },
    express: { json: () => () => {} }, 'tsx/cjs/api': {}, './feishu-events': {},
  }, h.clock, h.fakeProcess);
  registerHttpRoutes({
    get: (route, handler) => routes.set(route, handler), post() {}, options() {},
  }, { resolveRepoRoot: () => '/fake/repo', sessions: h.store.sessions });
  const session = h.make('download');
  const file = path.join(session.tmpDir, 'report.html');
  h.dirs.add(file);
  let finishDownload;
  const errors = [];
  routes.get('/download/report')({ query: { sid: 'download' } }, {
    sendFile: (abs, callback) => { assert.equal(abs, file); finishDownload = callback; },
  }, (err) => errors.push(err));
  await flush();
  const cleanup = h.store.disposeSession('download');
  await flush();
  assert.ok(h.dirs.has(session.tmpDir), 'an active report download must retain the directory');
  finishDownload();
  await cleanup;
  assert.equal(h.dirs.has(session.tmpDir), false);
  assert.deepEqual(errors, []);
}

function verifyAccess() {
  const { isTrustedStudioRequest: trusted } = require('../../pw-files/lib/studio-access');
  for (const hostname of ['localhost', '127.0.0.1']) {
    const host = `${hostname}:3001`;
    const req = { method: 'GET', headers: { host } };
    assert.equal(trusted(req, 3001), true);
    assert.equal(trusted(req, 3001, { websocket: true }), false, 'CLI WS must not get an Origin exemption');
    req.headers.origin = `http://${host}`; // Explicit Origin for local Node ws clients too.
    assert.equal(trusted(req, 3001, { websocket: true }), true);
    assert.equal(trusted({ ...req, method: 'POST' }, 3001), true);
    for (const origin of ['null', '', 'https://evil.example', 'http://evil.example:3001',
      'http://localhost:3002', 'http://localhost:3001.evil.example', 'http://localhost:3001/',
      'http://user@localhost:3001', 'http://127.1:3001', 'http://2130706433:3001',
      'http://localhost:3001?x', 'http://localhost:3001#x', ['http://localhost:3001']]) {
      assert.equal(trusted({ ...req, headers: { host, origin } }, 3001, { websocket: true }), false);
    }
    const alias = hostname === 'localhost' ? '127.0.0.1' : 'localhost';
    assert.equal(trusted({ ...req, headers: { host, origin: `http://${alias}:3001` } }, 3001,
      { websocket: true }), false, 'trusted aliases are still distinct origins');
  }
  for (const host of [undefined, '', 'evil.example:3001', 'localhost.evil.example:3001',
    'localhost', 'localhost:3002', '127.1:3001', 'localhost:3001@evil.example', 'localhost:3001/path',
    ['localhost:3001'], 'localhost:3001, evil.example']) {
    assert.equal(trusted({ method: 'GET', headers: { host, origin: 'http://localhost:3001' } }, 3001), false);
  }
  assert.equal(trusted({ method: 'POST', headers: { host: 'localhost:3001' } }, 3001), false);
  assert.equal(trusted({ method: 'GET', headers: { host: 'localhost:3001', 'sec-fetch-site': 'cross-site' } }, 3001), false);
  for (const name of ['Host', 'Origin']) {
    assert.equal(trusted({ method: 'GET', headers: { host: 'localhost:3001', origin: 'http://localhost:3001' },
      rawHeaders: [name, 'first', name.toLowerCase(), 'second'] }, 3001), false);
  }
  assert.equal(trusted({ method: 'GET', headers: { host: 'localhost', origin: 'http://localhost' } }, 80), true);
  const source = fs.readFileSync(path.join(root, 'pw-files/server.js'), 'utf8');
  assert.match(source, /server\.listen\(PORT, '127\.0\.0\.1'/);
  assert.match(source, /verifyClient:[\s\S]*isTrustedStudioRequest\(req, listenPort\(\), \{ websocket: true \}\)/);
  assert.ok(source.indexOf('app.use((req, res, next)') < source.indexOf('registerStudioStatic(app'));
  assert.match(source, /app\.use\(\(_req, res, next\) => \{\s*if \(studioRestart\.isPending\(\)\)/);
  assert.match(source, /ws\.on\('message', \(raw\) => \{\s*if \(studioRestart\.isPending\(\)\)/);
  assert.match(source, /createStudioRestart\(\{\s*studioDir: __dirname,\s*send,\s*disposeAll,/);
}

async function verifyRestart() {
  const h = harness();
  const events = [];
  const one = h.make('restart-one');
  const two = h.make('restart-two');
  one.runProc = h.kill.spawnTracked('/fake/run', [], {});
  two.replaySummaryProc = h.kill.spawnTracked('/fake/summary', [], {});
  const procs = [one.runProc, two.replaySummaryProc];
  const gate = deferred();
  const task = h.sessions.runSessionTask(one, () => gate.promise);
  await flush();
  h.store.scheduleCleanup('restart-one', (err) => { throw err; });
  const ws = new FakeWs();
  ws.terminate = () => { events.push('terminate'); ws.close(); };
  ws.on('close', () => h.store.scheduleCleanup('restart-one', (err) => { throw err; }));
  let closeHttp;
  let closeWs;
  const server = { close: (cb) => { events.push('close-http'); closeHttp = cb; }, closeIdleConnections() {} };
  const wss = { clients: new Set([ws]), close: (cb) => { events.push('close-ws'); closeWs = cb; } };
  h.fakeProcess.exit = (code) => { assert.equal(code, 0); events.push('exit'); };
  const { createStudioRestart } = load('pw-files/lib/studio-restart.js', {
    './session': h.sessions,
    child_process: { spawn: (...args) => {
      assert.equal(h.store.sessions.size, 0);
      events.push('spawn');
      const child = h.rawSpawn(...args);
      child.unref = () => events.push('unref');
      return child;
    } },
  }, h.clock, h.fakeProcess);
  const restart = createStudioRestart({ studioDir: '/fake/studio', send() {}, disposeAll: async () => {
    events.push('drain');
    await h.store.disposeAll();
    events.push('disposed');
  } });
  const { createWsDispatcher } = load('pw-files/lib/ws-dispatch.js', {
    './session': h.sessions,
    './ws-handlers-studio': { createStudioHandlers: () => ({}) },
    './ws-handlers-repo': { createRepoHandlers: () => ({}) },
    './ws-handlers-jobs': { createJobsHandlers: () => ({}) },
  }, h.clock, h.fakeProcess);
  const errors = [];
  const dispatcher = createWsDispatcher({ send: (_ws, type, payload) => errors.push({ type, payload }),
    now: () => 'now', errText: (err) => err.message, countBusyStudioSessions: () => 2,
    restartStudio: (client) => restart.restart(client, h.store.sessions, server, wss) });
  let finished = false;
  const work = dispatcher.handleMessage(ws, one, 'restart-one', '{"type":"studio:restart","force":true}')
    .then(() => { finished = true; });
  await flush();
  assert.equal(restart.isPending(), true);
  assert.equal(finished, false, 'dispatcher must await asynchronous restart');
  assert.throws(() => h.store.makeSession(), /清理会话/);
  let newTask = false;
  await h.sessions.runSessionTask(two, () => { newTask = true; });
  assert.equal(newTask, false);
  assert.deepEqual(await restart.restart(ws, h.store.sessions, server, wss), { ok: false, error: 'restarting' });
  await h.clock.tick(3000);
  assert.deepEqual(events, ['drain'], 'no hard exit, close or spawn before processes actually close');
  assert.equal(h.removed.length, 0);
  for (const proc of procs) proc.close();
  await flush();
  assert.ok(h.dirs.has(one.tmpDir), 'the non-process task still owns its directory');
  gate.resolve();
  await task;
  await flush();
  assert.equal(h.store.sessions.size, 0, 'restart itself must not be tracked and deadlock disposal');
  assert.equal(h.clock.timers.size, 0, 'disposeAll clears disconnect cleanup and process timers');
  assert.deepEqual(events, ['drain', 'disposed', 'terminate', 'close-ws', 'close-http']);
  closeWs();
  await flush();
  assert.equal(events.includes('spawn'), false);
  closeHttp();
  await flush();
  assert.equal(events[events.length - 1], 'spawn', 'spawn only after the old listener closes');
  assert.equal(events.includes('exit'), false, 'wait for successful child spawn');
  h.spawned[h.spawned.length - 1].proc.emit('spawn');
  await work;
  assert.equal(finished, true);
  assert.deepEqual(events.slice(-3), ['spawn', 'unref', 'exit']);
  assert.deepEqual(errors, []);

  const failed = harness();
  const bad = failed.make('bad');
  const waiting = failed.make('waiting');
  const outstanding = deferred();
  const waitingTask = failed.sessions.runSessionTask(waiting, () => outstanding.promise);
  await flush();
  const remove = failed.fakeFs.rmSync;
  failed.fakeFs.rmSync = (abs) => { if (abs === bad.tmpDir) throw new Error('cannot remove'); remove(abs); };
  const failRestart = createStudioRestart({ studioDir: '/fake/studio', send() {}, disposeAll: failed.store.disposeAll });
  let rejected = false;
  const fail = failRestart.restart(ws, failed.store.sessions, server, wss).catch((err) => {
    rejected = true;
    assert.match(err.message, /清理失败/);
  });
  await flush();
  assert.equal(rejected, false, 'a failed disposal must still wait for all other sessions');
  const before = [...events];
  outstanding.resolve();
  await waitingTask;
  await fail;
  assert.equal(rejected, true);
  assert.equal(failRestart.isPending(), true, 'cleanup failure stays closed to new work');
  assert.ok(failed.dirs.has(bad.tmpDir));
  assert.equal(failed.dirs.has(waiting.tmpDir), false);
  assert.deepEqual(events, before, 'cleanup failure must not close, spawn or exit');
}

function trackSignal(signal) {
  const listeners = new Set();
  const add = signal.addEventListener.bind(signal);
  const remove = signal.removeEventListener.bind(signal);
  signal.addEventListener = (type, fn, options) => {
    if (type === 'abort') listeners.add(fn);
    add(type, fn, options);
  };
  signal.removeEventListener = (type, fn, options) => {
    if (type === 'abort') listeners.delete(fn);
    remove(type, fn, options);
  };
  return listeners;
}

function fakeBody(chunks = []) {
  const counts = { reads: 0, cancelled: 0, released: 0 };
  const stalled = deferred();
  const reader = {
    read: () => {
      counts.reads++;
      if (!chunks.length) return stalled.promise;
      const chunk = chunks.shift();
      return Promise.resolve(chunk === null ? { done: true } : { done: false, value: Buffer.from(chunk) });
    },
    cancel: () => { counts.cancelled++; return Promise.resolve(); },
    releaseLock: () => { counts.released++; },
  };
  return { counts, reader, body: { getReader: () => reader } };
}

async function verifyDeepSeek() {
  const h = harness();
  for (const ok of [true, false]) {
    const body = fakeBody(['data: {"choices":[{"delta":{"content":"partial"}}]}\n']);
    const controller = new AbortController();
    const listeners = trackSignal(controller.signal);
    const chunks = [];
    const { streamDeepSeekChat } = load('pw-files/lib/deepseek.js', { fetch: async (_url, opts) => {
      assert.equal(opts.signal, controller.signal);
      return { ok, status: ok ? 200 : 500, body: body.body };
    } }, h.clock, h.fakeProcess);
    const streaming = streamDeepSeekChat('unchanged prompt', (text) => chunks.push(text), 'fake-key', { signal: controller.signal });
    await flush();
    assert.equal(body.counts.reads, 2, 'streaming body is stalled, not the initial fetch');
    controller.abort();
    await assert.rejects(streaming, (err) => err.name === 'AbortError');
    assert.deepEqual(chunks, ok ? ['partial'] : []);
    assert.equal(body.counts.cancelled, 1);
    assert.equal(body.counts.released, 1);
    assert.equal(listeners.size, 0);
  }
  const body = fakeBody(['data: {"choices":[{"delta":{"content":"done"}}]}\ndata: [DONE]\ndata: {"choices":[{"delta":{"content":"must not emit"}}]}\n']);
  const chunks = [];
  const controller = new AbortController();
  const listeners = trackSignal(controller.signal);
  const { streamDeepSeekChat } = load('pw-files/lib/deepseek.js', {
    fetch: async () => ({ ok: true, body: body.body }),
  }, h.clock, h.fakeProcess);
  await streamDeepSeekChat('unchanged prompt', (text) => chunks.push(text), 'fake-key', { signal: controller.signal });
  assert.deepEqual(chunks, ['done']);
  assert.deepEqual(body.counts, { reads: 1, cancelled: 1, released: 1 });
  assert.equal(listeners.size, 0);
}

async function verifyOptimize() {
  const { cancelOptimize } = require('../../pw-files/lib/cancel-actions');
  for (const provider of ['deepseek', 'claude']) {
    for (const ending of ['cancel', 'timeout', 'drain', 'success']) {
      const h = harness();
      const session = h.make('optimize');
      session.optCode = 'previous result';
      const ws = new FakeWs();
      const body = fakeBody(ending === 'success'
        ? ['data: {"choices":[{"delta":{"content":"optimized"}}]}\ndata: [DONE]\n'] : []);
      let signal;
      let listeners;
      let streamAborted = 0;
      let fallbacks = 0;
      const gate = deferred();
      const { streamDeepSeekChat } = load('pw-files/lib/deepseek.js', { fetch: async (_url, opts) => {
        signal = opts.signal;
        listeners = trackSignal(signal);
        return { ok: true, body: body.body };
      } }, h.clock, h.fakeProcess);
      const optimize = load('pw-files/lib/studio-optimize.js', {}, h.clock, h.fakeProcess);
      const deps = {
        getOptimizeApiKeys: () => ({ anthropic: 'fake', deepseek: 'fake' }),
        resolveOptimizeProvider: () => ({ provider }), logOptimizeProviderChoice() {}, logLine() {},
        streamDeepSeekChat, simulateOptimize: async () => { fallbacks++; },
        Anthropic: class {
          messages = { stream: (_params, options) => {
            signal = options.signal;
            listeners = trackSignal(signal);
            return {
              abort: () => { streamAborted++; gate.resolve(); },
              async *[Symbol.asyncIterator]() {
                if (ending !== 'success') await gate.promise;
                // Even a provider that returns partial data on abort must not publish success.
                yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'optimized' } };
              },
            };
          } };
        },
      };
      const task = h.sessions.runSessionTask(session, () => optimize.optimizeCode(ws, session, 'raw', {}, provider, {}, deps));
      await flush();
      if (ending !== 'success') {
        assert.ok(session.optimizeController);
        assert.ok(h.dirs.has(session.tmpDir));
      }
      if (ending === 'cancel') cancelOptimize(session);
      if (ending === 'timeout') await h.clock.tick(120000);
      if (ending === 'drain') await h.store.disposeAll();
      await task;
      assert.equal(fallbacks, 0, 'abort and timeout must never become demo success');
      assert.equal(session.optimizeRunning, false);
      assert.equal(session.optimizeController, null);
      assert.equal(h.clock.timers.size, 0);
      assert.equal(listeners.size, 0);
      if (provider === 'deepseek') {
        assert.equal(body.counts.cancelled, 1);
        assert.equal(body.counts.released, 1);
      } else if (ending !== 'success') assert.equal(streamAborted, 1);
      const done = ws.messages.filter((msg) => msg.type === 'optimize:done');
      if (ending === 'success') {
        assert.equal(done.length, 1);
        assert.equal(done[0].demo, false);
        assert.equal(session.optCode, 'optimized');
      } else {
        assert.equal(signal.aborted, true);
        assert.equal(done.length, 0);
        assert.equal(session.optCode, 'previous result');
        const cancelled = ws.messages.filter((msg) => msg.type === 'optimize:cancelled');
        assert.equal(cancelled.length, 1);
        assert.equal(cancelled[0].reason, ending === 'timeout' ? 'timeout' : 'cancelled');
      }
      if (ending === 'drain') {
        assert.equal(h.store.sessions.size, 0);
        assert.equal(h.dirs.has(session.tmpDir), false);
      }
    }
  }
  // SDK-raised timeout/abort errors are not ordinary API failures either.
  class APIConnectionTimeoutError extends Error {}
  class APIUserAbortError extends Error {}
  for (const error of [new APIConnectionTimeoutError('SDK timeout'), new APIUserAbortError('SDK abort'),
    Object.assign(new Error('fetch timeout'), { name: 'TimeoutError' }),
    Object.assign(new Error('fetch abort'), { name: 'AbortError' })]) {
    const h = harness();
    const session = h.make('api-cancelled');
    const ws = new FakeWs();
    const optimize = load('pw-files/lib/studio-optimize.js', {}, h.clock, h.fakeProcess);
    await optimize.optimizeCode(ws, session, 'raw', {}, 'deepseek', {}, {
      getOptimizeApiKeys: () => ({ deepseek: 'fake' }), resolveOptimizeProvider: () => ({ provider: 'deepseek' }),
      logOptimizeProviderChoice() {}, logLine() {}, streamDeepSeekChat: async () => { throw error; },
      simulateOptimize: async () => assert.fail('SDK cancellation must not invoke the demo'),
    });
    assert.equal(ws.messages.filter((msg) => msg.type === 'optimize:cancelled').length, 1);
    assert.equal(ws.messages.some((msg) => msg.type === 'optimize:done'), false);
    assert.equal(session.optCode, '');
    assert.equal(session.optimizeController, null);
    assert.equal(h.clock.timers.size, 0);
  }
  // Real API errors still use the existing demo, but that work shares the same budget.
  for (const ending of ['success', 'cancel', 'timeout']) {
    const h = harness();
    const session = h.make('demo');
    session.optCode = 'previous';
    const ws = new FakeWs();
    const optimize = load('pw-files/lib/studio-optimize.js', {}, h.clock, h.fakeProcess);
    const task = optimize.optimizeCode(ws, session, 'x'.repeat(160), {}, 'deepseek', {}, {
      getOptimizeApiKeys: () => ({ deepseek: 'fake' }), resolveOptimizeProvider: () => ({ provider: 'deepseek' }),
      logOptimizeProviderChoice() {}, logLine() {}, timeoutMs: ending === 'timeout' ? 10 : 1000,
      streamDeepSeekChat: async () => { throw new Error('API unavailable'); },
      simulateOptimize: optimize.simulateOptimize,
    });
    await flush();
    if (ending === 'cancel') cancelOptimize(session);
    await h.clock.tick(200);
    await task;
    const done = ws.messages.filter((msg) => msg.type === 'optimize:done');
    assert.equal(done.length, ending === 'success' ? 1 : 0);
    if (ending === 'success') assert.equal(done[0].demo, true);
    else assert.equal(session.optCode, 'previous');
    assert.equal(session.optimizeController, null);
    assert.equal(h.clock.timers.size, 0);
  }
}

async function main() {
  verifyAccess();
  await verifyDisconnect();
  await verifyRegistry();
  await verifyDownload();
  await verifyRestart();
  await verifyDeepSeek();
  await verifyOptimize();
  console.log('verify-studio-lifecycle: offline cases passed');
}
let finished = false;
process.once('beforeExit', () => {
  if (!finished) {
    console.error('offline verification left an unresolved promise');
    process.exitCode = 1;
  }
});
main().then(() => { finished = true; }, (error) => {
  finished = true;
  console.error(error);
  process.exitCode = 1;
});
