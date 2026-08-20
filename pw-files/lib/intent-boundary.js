const fs = require('fs');
const path = require('path');
const { send, logLine, stripAnsi, errText } = require('./ws-safe');

const TRUST_DIR_REL = 'results/history/intent-trust';

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
}

function safeKey(key) {
  return (
    String(key || '')
      .trim()
      .replace(/[^\w\u4e00-\u9fa5./-]+/g, '-')
      .replace(/\/+/g, '__')
      .replace(/^-+|-+$/g, '')
      .slice(0, 120) || 'intent'
  );
}

function toRepoRel(repoRoot, abs) {
  const rel = path.relative(repoRoot, abs).replace(/\\/g, '/');
  if (!rel || rel.startsWith('..')) return undefined;
  return rel;
}

function loadHealSuggestFromRun(repoRoot, runRel) {
  const rel = String(runRel || '').trim().replace(/\\/g, '/');
  if (!rel || rel.includes('..') || path.isAbsolute(rel)) return null;
  if (!rel.startsWith('results/intent-runs/') && !rel.startsWith('results/ego-studio/')) {
    return null;
  }
  const abs = path.join(repoRoot, rel, 'heal-suggest.json');
  if (!fs.existsSync(abs)) return null;
  const report = readJson(abs);
  if (!report) return null;
  return {
    ...report,
    jsonRel: toRepoRel(repoRoot, abs),
    mdRel: toRepoRel(repoRoot, path.join(repoRoot, rel, 'heal-suggest.md')),
  };
}

function loadTrustRecord(repoRoot, opts = {}) {
  const dir = path.join(repoRoot, TRUST_DIR_REL);
  const candidates = [];
  if (opts.scriptKey) candidates.push(opts.scriptKey);
  if (opts.intentRel) candidates.push(opts.intentRel);
  if (opts.name) candidates.push(opts.name);

  for (const key of candidates) {
    const file = path.join(dir, `${safeKey(key)}.json`);
    if (fs.existsSync(file)) {
      const rec = readJson(file);
      if (rec) return rec;
    }
  }

  if (!fs.existsSync(dir) || !opts.name) return null;
  const hit = fs
    .readdirSync(dir)
    .filter((n) => n.endsWith('.json') && !n.startsWith('_'))
    .map((n) => readJson(path.join(dir, n)))
    .find((r) => r && r.name === opts.name);
  return hit || null;
}

function collectRunBoundary(repoRoot, outAbs, intentRel) {
  const intentMeta = readJson(path.join(outAbs, 'intent.json')) || {};
  const outRel = toRepoRel(repoRoot, outAbs);
  const healSuggest = outRel ? loadHealSuggestFromRun(repoRoot, outRel) : null;
  const trust = loadTrustRecord(repoRoot, {
    scriptKey: intentMeta.scriptKey,
    intentRel,
    name: intentMeta.name,
  });
  const failureSummaryRel = fs.existsSync(path.join(outAbs, 'failure-summary.md'))
    ? toRepoRel(repoRoot, path.join(outAbs, 'failure-summary.md'))
    : undefined;
  return {
    trust,
    healSuggest,
    reviewRequired: intentMeta.reviewRequired === true,
    failureSummaryRel,
  };
}

function listTrustRecords(repoRoot) {
  const dir = path.join(repoRoot, TRUST_DIR_REL);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((n) => n.endsWith('.json') && !n.startsWith('_'))
    .map((n) => readJson(path.join(dir, n)))
    .filter((r) => r && r.intentKey)
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
}

function resolveApplyIntentPath(repoRoot, intentRel) {
  const rel = String(intentRel || '').trim().replace(/\\/g, '/');
  if (!rel || rel.includes('..') || path.isAbsolute(rel)) {
    return { error: 'Intent 路径必须是仓库内相对路径' };
  }
  const allowed =
    rel.startsWith('tests/definitions/') ||
    rel.startsWith('results/intent-studio/') ||
    rel.startsWith('results/ego-studio/') ||
    rel.startsWith('results/ego-explore/');
  if (!allowed) {
    return { error: '仅允许写回 definitions 或临时 Intent 产物路径' };
  }
  const abs = path.join(repoRoot, rel);
  if (!fs.existsSync(abs)) return { error: `文件不存在: ${rel}` };
  return { abs, rel };
}

function resolveApplyRunDir(repoRoot, runRel) {
  const rel = String(runRel || '').trim().replace(/\\/g, '/');
  if (!rel || rel.includes('..') || path.isAbsolute(rel)) {
    return { error: '运行目录必须是仓库内相对路径' };
  }
  if (!rel.startsWith('results/intent-runs/') && !rel.startsWith('results/ego-studio/')) {
    return { error: '运行目录仅允许 results/intent-runs 或 results/ego-studio' };
  }
  const abs = path.join(repoRoot, rel);
  if (!fs.existsSync(abs)) return { error: `目录不存在: ${rel}` };
  return { abs, rel };
}

async function applyHealSuggest(ws, session, msg = {}, deps) {
  const { resolveRepoRoot, spawn, buildRepoSpawnEnv } = deps;
  const repoRoot = resolveRepoRoot();
  const run = resolveApplyRunDir(repoRoot, msg.runRel || msg.run);
  if (run.error) {
    send(ws, 'error', { message: run.error });
    send(ws, 'heal:suggest:apply:done', { ok: false, message: run.error });
    return;
  }
  const intent = resolveApplyIntentPath(repoRoot, msg.intent || msg.intentRel);
  if (intent.error) {
    send(ws, 'error', { message: intent.error });
    send(ws, 'heal:suggest:apply:done', { ok: false, message: intent.error });
    return;
  }

  const suggest = loadHealSuggestFromRun(repoRoot, run.rel);
  if (!suggest?.patches?.length) {
    const message = '没有可写回的自愈补丁（需先有 heal-suggest.json）';
    send(ws, 'error', { message });
    send(ws, 'heal:suggest:apply:done', { ok: false, message });
    return;
  }

  const accepted = suggest.patches.filter((p) => p.accepted);
  if (!accepted.length) {
    const message = '没有「已采纳」的补丁可写回';
    send(ws, 'error', { message });
    send(ws, 'heal:suggest:apply:done', { ok: false, message });
    return;
  }

  send(ws, 'heal:suggest:apply:start', {
    runRel: run.rel,
    intent: intent.rel,
    patchCount: accepted.length,
  });
  logLine(ws, `[heal] 写回 ${accepted.length} 条补丁 → ${intent.rel}`, 'info');

  const tsxBin = path.join(
    repoRoot,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'tsx.cmd' : 'tsx',
  );
  const args = [
    'scripts/ai/heal-suggest.ts',
    `--run=${run.abs}`,
    `--intent=${intent.abs}`,
    '--apply',
  ];
  const proc = spawn(tsxBin, args, {
    cwd: repoRoot,
    env: typeof buildRepoSpawnEnv === 'function' ? buildRepoSpawnEnv(session) : process.env,
    shell: false,
  });

  let stdout = '';
  const code = await new Promise((resolve) => {
    proc.stdout.on('data', (d) => {
      const text = stripAnsi(d.toString()).trimEnd();
      stdout += `${text}\n`;
      if (text) logLine(ws, text, 'dim');
    });
    proc.stderr.on('data', (d) => {
      const text = stripAnsi(d.toString()).trimEnd();
      if (text) logLine(ws, text, 'warn');
    });
    proc.on('error', (error) => resolve({ code: null, error: errText(error) }));
    proc.on('close', (c) => resolve({ code: c, error: null }));
  });

  if (code.code !== 0) {
    const message = code.error || `heal:suggest 退出码 ${code.code}`;
    send(ws, 'heal:suggest:apply:done', { ok: false, message, runRel: run.rel, intent: intent.rel });
    return;
  }

  let yamlText;
  try {
    yamlText = fs.readFileSync(intent.abs, 'utf-8');
  } catch {
    yamlText = undefined;
  }

  send(ws, 'heal:suggest:apply:done', {
    ok: true,
    runRel: run.rel,
    intent: intent.rel,
    patchCount: accepted.length,
    yamlText,
    stdout: stdout.trim(),
  });
  logLine(ws, `[heal] 已写回 ${intent.rel}`, 'ok');
}

function sendTrustReport(ws, deps) {
  const { resolveRepoRoot } = deps;
  const repoRoot = resolveRepoRoot();
  const records = listTrustRecords(repoRoot);
  send(ws, 'trust:report:done', {
    ok: true,
    records,
    watchCount: records.filter((r) => r.suggestedTrustLevel === 'watch' || (r.alerts || []).length).length,
  });
}

module.exports = {
  loadHealSuggestFromRun,
  loadTrustRecord,
  collectRunBoundary,
  listTrustRecords,
  applyHealSuggest,
  sendTrustReport,
  TRUST_DIR_REL,
};
