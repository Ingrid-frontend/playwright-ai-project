function stripAnsi(text) {
  return String(text).replace(/\x1b\[[0-9;]*m/g, '');
}

function errText(err) {
  if (err == null) return '';
  if (typeof err === 'string') return stripAnsi(err);
  return stripAnsi(err.message || err.value || err.stack || String(err));
}

function now() {
  return new Date().toLocaleTimeString('zh-CN');
}

function send(ws, type, data = {}) {
  if (ws.readyState === 1) {
    try {
      ws.send(JSON.stringify({ type, ...data }));
    } catch (e) {
      console.warn('[studio] ws.send failed:', errText(e));
    }
  }
}

function logLine(ws, text, level = 'dim') {
  send(ws, 'run:log', { text, level });
}

module.exports = {
  stripAnsi,
  errText,
  now,
  send,
  logLine,
};
