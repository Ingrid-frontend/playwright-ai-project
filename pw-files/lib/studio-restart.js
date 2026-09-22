const { spawn } = require('child_process');
const path = require('path');
const { SESSION_PROC_KEYS } = require('./session');

function isSessionBusy(session) {
  if (!session) return false;
  if (session.recording || session.optimizeRunning || session.repoBatchRunning) return true;
  return SESSION_PROC_KEYS.some((k) => {
    const proc = session[k];
    return proc && proc.exitCode == null && proc.signalCode == null;
  });
}

function countBusySessions(sessions) {
  let n = 0;
  for (const session of sessions.values()) {
    if (isSessionBusy(session)) n++;
  }
  return n;
}

function createStudioRestart(opts) {
  const { studioDir, send, disposeAll } = opts;
  let pending = false;

  function broadcast(wss, type, payload) {
    if (!wss?.clients) return;
    for (const client of wss.clients) {
      if (client.readyState === 1) send(client, type, payload);
    }
  }

  function spawnNext() {
    const script = path.join(studioDir, 'server.js');
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [script], {
        cwd: studioDir,
        env: process.env,
        detached: true,
        stdio: 'ignore',
      });
      child.once('error', reject);
      child.once('spawn', () => { child.unref(); resolve(); });
    });
  }

  async function shutdown(server, wss) {
    // All session work has stopped. Closing sockets cannot abandon a task or its directory.
    // Terminate WS transports so an uncooperative peer cannot hold the old listener open.
    for (const client of wss.clients) client.terminate();
    await Promise.all([
      new Promise((resolve, reject) => wss.close((err) => err ? reject(err) : resolve())),
      new Promise((resolve, reject) => {
        server.close((err) => err ? reject(err) : resolve());
        server.closeIdleConnections?.();
      }),
    ]);
  }

  async function restart(_ws, sessions, server, wss) {
    if (pending) return { ok: false, error: 'restarting' };
    pending = true;
    const busy = countBusySessions(sessions);
    broadcast(wss, 'studio:restarting', { at: new Date().toISOString() });
    // Fail closed: on cleanup failure keep the old server and reject new work.
    // Never race child-process draining against a forced process.exit deadline.
    await disposeAll();
    await shutdown(server, wss);
    await spawnNext();
    process.exit(0);
    return { ok: true, busy };
  }

  return { restart, countBusySessions, isPending: () => pending };
}

module.exports = { createStudioRestart, isSessionBusy, countBusySessions };
