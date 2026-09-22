// Pure request checks: only the HTTP loopback origin served by Studio is trusted.
function localAuthority(value, port) {
  if (typeof value !== 'string') return null;
  const match = /^(localhost|127\.0\.0\.1)(?::([1-9]\d{0,4}))?$/i.exec(value);
  if (!match || Number(match[2] || 80) !== port) return null;
  return match[1].toLowerCase();
}

function isTrustedStudioRequest(req, port, { websocket = false } = {}) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) return false;
  const headers = req.headers || {};
  const host = localAuthority(headers.host, port);
  if (!host) return false;
  // Reject ambiguous duplicate headers rather than relying on Node's first value.
  for (const name of ['host', 'origin']) {
    let count = 0;
    for (let i = 0; i < (req.rawHeaders || []).length; i += 2) {
      if (String(req.rawHeaders[i]).toLowerCase() === name) count++;
    }
    if (count > 1) return false;
  }
  const origin = headers.origin;
  if (origin == null) {
    // CLI WebSockets and mutating HTTP requests must also supply an explicit Origin.
    return !websocket && ['GET', 'HEAD'].includes(req.method) &&
      !['cross-site', 'same-site'].includes(headers['sec-fetch-site']);
  }
  if (typeof origin !== 'string' || !origin.startsWith('http://')) return false;
  return localAuthority(origin.slice('http://'.length), port) === host;
}

module.exports = { isTrustedStudioRequest };
