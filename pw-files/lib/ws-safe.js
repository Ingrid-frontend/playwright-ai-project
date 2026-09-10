// ANSI 转义序列必须匹配 ESC(\x1B) 控制字符本身，此处控制字符是刻意的
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;

function stripAnsi(text) {
  return String(text).replace(ANSI_RE, '');
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
