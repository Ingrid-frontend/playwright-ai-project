const { spawn } = require('child_process');
const path = require('path');

const PROC_KEYS = [
  'recordProc',
  'runProc',
  'repoPipelineProc',
  'repoTestProc',
  'repoCompareProc',
  'repoRerunProc',
  'aiValidateProc',
  'intentRunProc',
  'egoAuditProc',
  'egoExploreProc',
  'requestFlowProc',
  'approvalFlowProc',
  'uiAuditProc',
  'debugBrowserProc',
  'replayRunProc',
];

function isSessionBusy(session) {
  if (!session) return false;
  if (session.recording || session.optimizeRunning || session.repoBatchRunning) return true;
  return PROC_KEYS.some((k) => {
    const proc = session[k];
    return proc && proc.exitCode == null && !proc.killed;
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
  const { studioDir, send, cancelAll } = opts;
  let pending = false;

  function broadcast(wss, type, payload) {
    if (!wss?.clients) return;
    for (const client of wss.clients) {
      if (client.readyState === 1) send(client, type, payload);
    }
  }

  function spawnNext() {
    const script = path.join(studioDir, 'server.js');
    spawn(process.execPath, [script], {
      cwd: studioDir,
      env: process.env,
      detached: true,
      stdio: 'ignore',
    }).unref();
  }

  function shutdown(server, wss) {
    broadcast(wss, 'studio:restarting', { at: new Date().toISOString() });
    setTimeout(() => {
      try {
        for (const client of wss.clients) {
          client.close(1012, 'restarting');
        }
      } catch {
        /* ignore */
      }
      wss.close(() => {
        server.close(() => process.exit(0));
      });
      setTimeout(() => process.exit(0), 2500);
    }, 120);
  }

  function restart(ws, sessions, server, wss) {
    if (pending) return { ok: false, error: 'restarting' };
    pending = true;
    const busy = countBusySessions(sessions);
    cancelAll(sessions, ws);
    spawnNext();
    shutdown(server, wss);
    return { ok: true, busy };
  }

  return { restart, countBusySessions };
}

module.exports = { createStudioRestart, isSessionBusy, countBusySessions };
