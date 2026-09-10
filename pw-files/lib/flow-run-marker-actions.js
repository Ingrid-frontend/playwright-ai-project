const { send, logLine } = require('./ws-safe');
const { searchFlowRuns, deleteFlowRunsByMarker } = require('./flow-run-marker.js');

async function flowSearchRuns(ws, msg, repoRoot) {
  const query = String(msg.query || msg.marker || '').trim();
  if (!query) {
    send(ws, 'error', { message: '请提供 query 或 marker' });
    return;
  }
  const hits = searchFlowRuns(repoRoot, query);
  send(ws, 'flow:runs:search:done', { query, hits, total: hits.length });
  logLine(ws, `[flow] 搜索 run · ${query} · ${hits.length} 条`, hits.length ? 'info' : 'dim');
}

async function flowDeleteRuns(ws, msg, repoRoot) {
  const query = String(msg.marker || msg.query || '').trim();
  if (!query) {
    send(ws, 'error', { message: '请提供 marker 或 query' });
    return;
  }
  const dryRun = Boolean(msg.dryRun);
  const result = deleteFlowRunsByMarker(repoRoot, query, { dryRun });
  send(ws, 'flow:runs:delete:done', {
    query,
    dryRun,
    deleted: result.deleted,
    total: result.total,
  });
  const verb = dryRun ? '将删除' : '已删除';
  logLine(ws, `[flow] ${verb} ${result.deleted.length} 条 run · ${query}`, result.deleted.length ? 'ok' : 'dim');
}

module.exports = { flowSearchRuns, flowDeleteRuns };
