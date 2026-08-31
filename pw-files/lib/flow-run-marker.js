const fs = require('fs');
const path = require('path');

const RUN_MARKER_FILE = '.run-marker.json';
const FLOW_IDS = ['request-flow', 'approval-flow'];
const RUN_SEGMENT_RE = /^run-(chromium|webkit|firefox|safari|edge)-/;

function readJsonSafe(p) {
  if (!p || !fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch {
    return null;
  }
}

function sanitizeMarker(s) {
  return String(s || '')
    .trim()
    .replace(/[^\w\u4e00-\u9fa5-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

function makeRunMarker(opts = {}) {
  const custom = sanitizeMarker(opts.custom || process.env.FLOW_RUN_MARKER || '');
  if (custom) return custom;
  const slug = sanitizeMarker(opts.roleSlug || 'flow').slice(0, 24) || 'flow';
  const ts = String(opts.startedAt || new Date().toISOString())
    .replace(/[:.]/g, '')
    .slice(0, 15);
  const rand = Math.random().toString(36).slice(2, 6);
  return `${slug}-${ts}-${rand}`;
}

function writeRunMarkerFile(runDir, marker, extra = {}) {
  if (!runDir || !marker) return;
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(
    path.join(runDir, RUN_MARKER_FILE),
    JSON.stringify({ marker, ...extra }, null, 2),
    'utf-8',
  );
}

function readRunMarkerFile(runDir) {
  const data = readJsonSafe(path.join(runDir, RUN_MARKER_FILE));
  return data?.marker ? String(data.marker) : '';
}

function specSlug(spec) {
  const base = path.basename(String(spec || ''), path.extname(String(spec || ''))).replace(/\.spec$/, '');
  return base.replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]+/g, '-').slice(0, 60) || 'flow';
}

function scriptKeyFromManifest(m) {
  if (m.scriptKey) return m.scriptKey;
  const base = `flows/${m.flowId}/${m.env || 'dev'}/${specSlug(m.spec)}`;
  const slug = String(m.roleSlug || '').trim();
  return slug ? `${base}/by-account/${slug}` : base;
}

function screenshotRunDir(repoRoot, hit) {
  return path.join(repoRoot, 'screenshots', hit.scriptKey, hit.runSegment || 'run-chromium-flow', hit.runId);
}

function flowRunDir(repoRoot, flowId, runId) {
  return path.join(repoRoot, 'results', 'flow-runs', flowId, runId);
}

function walkScreenshotRuns(repoRoot, onHit) {
  const root = path.join(repoRoot, 'screenshots', 'flows');
  if (!fs.existsSync(root)) return;
  const walk = (dir, parts) => {
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      const st = fs.statSync(p);
      if (!st.isDirectory()) continue;
      const next = parts.concat(name);
      if (RUN_SEGMENT_RE.test(name)) {
        for (const runId of fs.readdirSync(p)) {
          const runDir = path.join(p, runId);
          if (!fs.statSync(runDir).isDirectory()) continue;
          const scriptKey = next.slice(0, -1).join('/');
          onHit({
            flowId: next[1],
            scriptKey,
            runSegment: name,
            runId,
            runDir,
            marker: readRunMarkerFile(runDir),
          });
        }
        continue;
      }
      walk(p, next);
    }
  };
  walk(root, ['flows']);
}

function loadManifestHits(repoRoot) {
  const hits = new Map();
  const keyOf = (h) => `${h.flowId}::${h.scriptKey}::${h.runId}`;

  for (const flowId of FLOW_IDS) {
    const base = path.join(repoRoot, 'results', 'flow-runs', flowId);
    if (!fs.existsSync(base)) continue;
    for (const runId of fs.readdirSync(base)) {
      const manifestPath = path.join(base, runId, 'manifest.json');
      if (!fs.existsSync(manifestPath)) continue;
      const m = readJsonSafe(manifestPath);
      if (!m) continue;
      const hit = {
        flowId,
        runId: m.runId || runId,
        scriptKey: scriptKeyFromManifest(m),
        runMarker: m.runMarker || '',
        startedAt: m.startedAt,
        finishedAt: m.finishedAt,
        ok: m.ok,
        env: m.env,
        spec: m.spec,
        roleSlug: m.roleSlug,
      };
      hits.set(keyOf(hit), hit);
    }

    const histDir = path.join(base, 'history');
    if (!fs.existsSync(histDir)) continue;
    for (const name of fs.readdirSync(histDir).filter((f) => f.endsWith('.json'))) {
      const rows = readJsonSafe(path.join(histDir, name));
      if (!Array.isArray(rows)) continue;
      for (const m of rows) {
        if (!m?.runId) continue;
        const hit = {
          flowId,
          runId: m.runId,
          scriptKey: scriptKeyFromManifest(m),
          runMarker: m.runMarker || '',
          startedAt: m.startedAt,
          finishedAt: m.finishedAt,
          ok: m.ok,
          env: m.env,
          spec: m.spec,
          roleSlug: m.roleSlug,
        };
        const k = keyOf(hit);
        if (!hits.has(k)) hits.set(k, hit);
      }
    }
  }

  walkScreenshotRuns(repoRoot, (shot) => {
    const k = `${shot.flowId}::${shot.scriptKey}::${shot.runId}`;
    const cur = hits.get(k) || {
      flowId: shot.flowId,
      runId: shot.runId,
      scriptKey: shot.scriptKey,
      runMarker: '',
    };
    if (!cur.runMarker && shot.marker) cur.runMarker = shot.marker;
    hits.set(k, cur);
  });

  return [...hits.values()].sort((a, b) => String(b.startedAt || '').localeCompare(String(a.startedAt || '')));
}

function matchQuery(hit, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  const parts = [
    hit.runMarker,
    hit.runId,
    hit.scriptKey,
    hit.roleSlug,
    hit.env,
    hit.spec,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return parts.includes(q);
}

function searchFlowRuns(repoRoot, query) {
  return loadManifestHits(repoRoot).filter((h) => matchQuery(h, query));
}

function removeFromHistory(repoRoot, flowId, runId) {
  const histDir = path.join(repoRoot, 'results', 'flow-runs', flowId, 'history');
  if (!fs.existsSync(histDir)) return;
  for (const name of fs.readdirSync(histDir).filter((f) => f.endsWith('.json'))) {
    const p = path.join(histDir, name);
    const rows = readJsonSafe(p);
    if (!Array.isArray(rows)) continue;
    const next = rows.filter((r) => r?.runId !== runId);
    if (next.length === rows.length) continue;
    if (next.length) fs.writeFileSync(p, JSON.stringify(next, null, 2), 'utf-8');
    else fs.unlinkSync(p);
  }
}

function refreshLastRun(repoRoot, flowId, deletedRunId) {
  const lastPath = path.join(repoRoot, 'results', 'flow-runs', flowId, 'last-run.json');
  const last = readJsonSafe(lastPath);
  if (!last || last.runId !== deletedRunId) return;
  const remain = loadManifestHits(repoRoot).filter((h) => h.flowId === flowId && h.runId !== deletedRunId);
  if (!remain.length) {
    if (fs.existsSync(lastPath)) fs.unlinkSync(lastPath);
    return;
  }
  const latest = remain.sort((a, b) => String(b.startedAt || '').localeCompare(String(a.startedAt || '')))[0];
  const manifestPath = path.join(repoRoot, 'results', 'flow-runs', flowId, latest.runId, 'manifest.json');
  const m = readJsonSafe(manifestPath);
  if (m) fs.writeFileSync(lastPath, JSON.stringify(m, null, 2), 'utf-8');
}

function deleteFlowRun(repoRoot, hit) {
  const runDir = screenshotRunDir(repoRoot, hit);
  if (fs.existsSync(runDir)) fs.rmSync(runDir, { recursive: true, force: true });

  const metaDir = flowRunDir(repoRoot, hit.flowId, hit.runId);
  if (fs.existsSync(metaDir)) fs.rmSync(metaDir, { recursive: true, force: true });

  const diffDir = path.join(repoRoot, 'results', 'diffs', hit.scriptKey);
  if (fs.existsSync(diffDir)) {
    try {
      fs.rmSync(diffDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }

  removeFromHistory(repoRoot, hit.flowId, hit.runId);
  refreshLastRun(repoRoot, hit.flowId, hit.runId);
}

function deleteFlowRunsByMarker(repoRoot, query, opts = {}) {
  const hits = searchFlowRuns(repoRoot, query);
  const deleted = [];
  const skipped = [];
  for (const hit of hits) {
    if (!opts.force && !hit.runMarker && !matchQuery({ ...hit, runMarker: hit.runId }, query)) {
      skipped.push({ ...hit, reason: '无标记，跳过' });
      continue;
    }
    if (!opts.dryRun) deleteFlowRun(repoRoot, hit);
    deleted.push(hit);
  }
  return { deleted, skipped, total: hits.length };
}

module.exports = {
  RUN_MARKER_FILE,
  makeRunMarker,
  writeRunMarkerFile,
  readRunMarkerFile,
  searchFlowRuns,
  deleteFlowRun,
  deleteFlowRunsByMarker,
  loadManifestHits,
};
