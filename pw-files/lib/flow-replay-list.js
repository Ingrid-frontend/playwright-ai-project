const fs = require('fs');
const path = require('path');
const { send, logLine, stripAnsi, errText } = require('./ws-safe');

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function listDirs(abs) {
  if (!fs.existsSync(abs)) return [];
  return fs
    .readdirSync(abs, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
}

function prettyTitle(dirName) {
  return dirName.replace(/^\d{4}-\d{2}-\d{2}T[\d-]+-?/, '').trim() || dirName;
}

function detectEngine(dirAbs, dirName, result) {
  if (result?.engine === 'ego' || result?.engine === 'pw') return result.engine;
  if (fs.existsSync(path.join(dirAbs, 'generated.ts'))) return 'pw';
  if (/-pw(?:-|$)/i.test(dirName)) return 'pw';
  if (fs.existsSync(path.join(dirAbs, 'intent.preview.yaml'))) return 'ego';
  if (/-ego(?:-|$)/i.test(dirName)) return 'ego';
  return 'ego';
}

function findScript(dirAbs, repoRoot) {
  const names = ['script.ego.js', 'intent.preview.yaml', 'generated.ts', 'intent.yaml'];
  for (const name of names) {
    const abs = path.join(dirAbs, name);
    if (!fs.existsSync(abs)) continue;
    let text = '';
    try {
      text = fs.readFileSync(abs, 'utf8');
    } catch {
      text = '';
    }
    if (text.length > 80_000) text = `${text.slice(0, 80_000)}\n…`;
    return {
      scriptRel: path.relative(repoRoot, abs).replace(/\\/g, '/'),
      scriptKind: name.endsWith('.ts') ? 'ts' : name.endsWith('.js') ? 'js' : 'yaml',
      scriptText: text,
    };
  }
  return { scriptRel: '', scriptKind: '', scriptText: '' };
}

function yamlField(text, key) {
  const m = String(text || '').match(new RegExp(`^\\s*${key}:\\s*(.+)$`, 'm'));
  return m ? m[1].trim().replace(/^['"]|['"]$/g, '') : '';
}

function findMeta(dirAbs, dirName, intent, script) {
  let entry = intent?.entry ? String(intent.entry) : '';
  let env = intent?.env ? String(intent.env) : '';
  const yamlText =
    script.scriptKind === 'yaml'
      ? script.scriptText
      : ['intent.preview.yaml', 'intent.yaml']
          .map((name) => {
            const p = path.join(dirAbs, name);
            try {
              return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
            } catch {
              return '';
            }
          })
          .find(Boolean) || '';
  if (yamlText) {
    entry = entry || yamlField(yamlText, 'entry');
    env = env || yamlField(yamlText, 'env');
  }
  if (!entry && /approve|审批/i.test(dirName)) entry = '/main/approve';
  return { entry, env };
}

function collectRoot(repoRoot, relRoot) {
  const absRoot = path.join(repoRoot, relRoot);
  const items = [];
  for (const name of listDirs(absRoot)) {
    const dirAbs = path.join(absRoot, name);
    const flowRun = path.join(dirAbs, 'run', 'flow.html');
    const flowRoot = path.join(dirAbs, 'flow.html');
    const flowAbs = fs.existsSync(flowRun) ? flowRun : fs.existsSync(flowRoot) ? flowRoot : '';
    if (!flowAbs) continue;
    const result =
      readJson(path.join(path.dirname(flowAbs), 'result.json')) || readJson(path.join(dirAbs, 'result.json'));
    const intent = readJson(path.join(dirAbs, 'intent.json')) || readJson(path.join(dirAbs, 'run', 'intent.json'));
    const script = findScript(dirAbs, repoRoot);
    let mtime = 0;
    try {
      mtime = fs.statSync(flowAbs).mtimeMs;
    } catch {
      mtime = 0;
    }
    const steps = Array.isArray(result?.steps) ? result.steps : [];
    const failed = steps.find((s) => s && s.passed === false && !s.skipped);
    const flowDir = path.dirname(flowAbs);
    const hasVideo =
      fs.existsSync(path.join(flowDir, 'flow.webm')) ||
      fs.existsSync(path.join(dirAbs, 'flow.webm')) ||
      fs.existsSync(path.join(dirAbs, 'run', 'flow.webm'));
    items.push({
      engine: detectEngine(dirAbs, name, result),
      title: (intent && intent.name) || prettyTitle(name),
      passed: typeof result?.passed === 'boolean' ? result.passed : null,
      replayRel: path.relative(repoRoot, flowAbs).replace(/\\/g, '/'),
      outRel: `${relRoot}/${name}`,
      mtime,
      stepCount: steps.length || null,
      failedStepLabel: failed ? String(failed.id || failed.error || 'failed') : '',
      hasVideo,
      startedAt: result?.startedAt ? String(result.startedAt) : '',
      finishedAt: result?.finishedAt ? String(result.finishedAt) : '',
      ...script,
      ...findMeta(dirAbs, name, intent, script),
    });
  }
  return items;
}

function listFlowReplays(repoRoot, { limit = 16 } = {}) {
  const items = [
    ...collectRoot(repoRoot, 'results/ego-studio'),
    ...collectRoot(repoRoot, 'results/intent-runs'),
  ];
  items.sort((a, b) => b.mtime - a.mtime);
  const n = Math.max(1, Number(limit) || 16);
  return items.slice(0, n).map(({ mtime, scriptText, ...rest }) => ({
    ...rest,
    scriptText,
  }));
}

/** 汇总用：不含 scriptText，支持更大 lookback */
function collectReplaySummaryRows(repoRoot, { lookback = 20 } = {}) {
  const items = [
    ...collectRoot(repoRoot, 'results/ego-studio'),
    ...collectRoot(repoRoot, 'results/intent-runs'),
  ];
  items.sort((a, b) => b.mtime - a.mtime);
  const n = Math.max(1, Number(lookback) || 20);
  return items.slice(0, n).map(({ scriptText, ...rest }) => rest);
}

function allowedReplayRel(rel) {
  const n = String(rel || '').replace(/\\/g, '/');
  if (!n || n.includes('..') || path.isAbsolute(n)) return '';
  if (n.startsWith('results/ego-studio/') || n.startsWith('results/intent-runs/')) return n;
  return '';
}

/** 仅允许删 screenshots/<...>/run-*-optimized/<timestamp> 这一层，不碰 baseline / 用例根目录 */
function resolveLinkedScreenshotRunDirs(repoRoot, runDirAbs) {
  const candidates = [];
  const result =
    readJson(path.join(runDirAbs, 'result.json')) ||
    readJson(path.join(runDirAbs, 'run', 'result.json'));
  if (result?.screenshotDir) candidates.push(String(result.screenshotDir));
  for (const name of ['screenshots-path.txt', path.join('run', 'screenshots-path.txt')]) {
    const p = path.join(runDirAbs, name);
    if (!fs.existsSync(p)) continue;
    try {
      const line = fs.readFileSync(p, 'utf8').trim().split(/\r?\n/)[0];
      if (line) candidates.push(line);
    } catch {
      /* ignore */
    }
  }

  const out = [];
  const seen = new Set();
  const screenshotsRoot = path.resolve(repoRoot, 'screenshots');
  for (const raw of candidates) {
    let abs = String(raw || '').trim();
    if (!abs) continue;
    if (!path.isAbsolute(abs)) abs = path.resolve(repoRoot, abs);
    abs = path.resolve(abs);
    if (!abs.startsWith(screenshotsRoot + path.sep)) continue;
    const rel = path.relative(repoRoot, abs).split(path.sep).join('/');
    if (rel.includes('..') || !rel.startsWith('screenshots/')) continue;
    if (rel.startsWith('screenshots-baseline/')) continue;
    const parts = rel.split('/').filter(Boolean);
    // screenshots / intent / env / name / run-xxx-optimized / timestamp
    if (parts.length < 6) continue;
    const runSeg = parts[parts.length - 2];
    const tsSeg = parts[parts.length - 1];
    if (!/^run-(chromium|webkit|firefox|safari|edge)-optimized$/i.test(runSeg)) continue;
    if (!/^\d{4}-\d{2}-\d{2}/.test(tsSeg)) continue;
    if (seen.has(rel)) continue;
    seen.add(rel);
    out.push({ abs, rel });
  }
  return out;
}

/** 批量删除流程回放目录（按 outRel），并清理关联的 intent 截图 run 目录 */
function deleteFlowReplays(repoRoot, outRels = []) {
  const deleted = [];
  const deletedScreenshots = [];
  const skipped = [];
  const seen = new Set();
  for (const raw of outRels) {
    const rel = allowedReplayRel(raw);
    if (!rel) {
      skipped.push({ outRel: String(raw || ''), reason: '非法路径' });
      continue;
    }
    if (seen.has(rel)) continue;
    seen.add(rel);
    // 只删运行根目录，禁止删到更深层或根本身
    const parts = rel.split('/').filter(Boolean);
    if (parts.length < 3) {
      skipped.push({ outRel: rel, reason: '路径过短' });
      continue;
    }
    const abs = path.join(repoRoot, rel);
    if (!fs.existsSync(abs)) {
      skipped.push({ outRel: rel, reason: '不存在' });
      continue;
    }
    let st;
    try {
      st = fs.statSync(abs);
    } catch {
      skipped.push({ outRel: rel, reason: '无法读取' });
      continue;
    }
    if (!st.isDirectory()) {
      skipped.push({ outRel: rel, reason: '不是目录' });
      continue;
    }

    const shotDirs = resolveLinkedScreenshotRunDirs(repoRoot, abs);
    try {
      fs.rmSync(abs, { recursive: true, force: true });
      deleted.push(rel);
    } catch (err) {
      skipped.push({ outRel: rel, reason: errText(err) || '删除失败' });
      continue;
    }

    for (const shot of shotDirs) {
      try {
        if (fs.existsSync(shot.abs)) {
          fs.rmSync(shot.abs, { recursive: true, force: true });
          deletedScreenshots.push(shot.rel);
        }
      } catch (err) {
        skipped.push({
          outRel: rel,
          reason: `回放已删，截图清理失败 ${shot.rel}: ${errText(err) || '未知错误'}`,
        });
      }
    }
  }
  return { deleted, deletedScreenshots, skipped };
}

async function runFlowReplay(ws, session, msg = {}, deps) {
  const {
    resolveRepoRoot,
    spawn,
    buildRepoSpawnEnv,
    getSessionPlaywrightEnv,
    getSessionAccountProfile,
    runIntent,
  } = deps;
  const repoRoot = resolveRepoRoot();
  const outRel = allowedReplayRel(msg.outRel);
  if (!outRel) {
    send(ws, 'error', { message: '只能重跑 results/ego-studio 或 results/intent-runs 下的产物' });
    send(ws, 'replay:run:done', { ok: false, message: '非法路径' });
    return;
  }
  const dirAbs = path.join(repoRoot, outRel);
  const script = findScript(dirAbs, repoRoot);
  if (!script.scriptRel) {
    send(ws, 'error', { message: '未找到可执行脚本' });
    send(ws, 'replay:run:done', { ok: false, message: '未找到脚本', outRel });
    return;
  }
  const intent = readJson(path.join(dirAbs, 'intent.json')) || readJson(path.join(dirAbs, 'run', 'intent.json'));
  const meta = findMeta(dirAbs, path.basename(dirAbs), intent, script);
  const env = String(msg.env || meta.env || getSessionPlaywrightEnv(session) || 'stage').trim();
  const rawEngine = msg.engine || (script.scriptKind === 'ts' ? 'pw' : 'ego');
  const engine = String(rawEngine).toLowerCase() === 'pw' ? 'pw' : 'ego';

  if (script.scriptKind === 'yaml') {
    await runIntent(
      ws,
      session,
      {
        intent: script.scriptRel,
        engine: engine === 'pw' ? 'pw' : 'ego',
        env,
        heal: msg.heal !== false,
        headed: Boolean(msg.headed),
        keepTab: Boolean(msg.keepTab),
      },
      deps,
    );
    return;
  }

  if (script.scriptKind === 'js') {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const runOutRel = `results/ego-studio/${stamp}-approve-filter-rerun`;
    const runAbs = path.join(repoRoot, runOutRel);
    fs.mkdirSync(runAbs, { recursive: true });
    session.replayRunSeq = (session.replayRunSeq || 0) + 1;
    const seq = session.replayRunSeq;
    send(ws, 'replay:run:start', { seq, outRel: runOutRel, engine: 'ego', env, scriptRel: script.scriptRel });
    logLine(ws, `[replay] 运行 ${script.scriptRel} · engine=ego-js · env=${env}`, 'info');

    const spawnEnv = { ...buildRepoSpawnEnv(session) };
    spawnEnv.HL_STUDIO_ROOT = repoRoot;
    spawnEnv.HL_STUDIO_OUT = runAbs;
    const homeBin = path.join(require('os').homedir(), '.local/bin');
    if (spawnEnv.PATH && !String(spawnEnv.PATH).includes(homeBin)) {
      spawnEnv.PATH = homeBin + path.delimiter + spawnEnv.PATH;
    }

    if (session.replayRunProc) {
      try {
        session.replayRunProc.kill('SIGTERM');
      } catch {
        /* ignore */
      }
    }
    const proc = spawn('ego-browser', ['nodejs'], {
      cwd: repoRoot,
      env: spawnEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    session.replayRunProc = proc;
    try {
      fs.createReadStream(path.join(repoRoot, script.scriptRel)).pipe(proc.stdin);
    } catch (error) {
      send(ws, 'error', { message: '无法读取 ego 脚本' });
      send(ws, 'replay:run:done', { ok: false, message: errText(error), outRel: runOutRel });
      return;
    }
    const runResult = await new Promise((resolve) => {
      proc.stdout.on('data', (d) => {
        const text = stripAnsi(d.toString()).trimEnd();
        if (text) logLine(ws, text, 'dim');
      });
      proc.stderr.on('data', (d) => {
        const text = stripAnsi(d.toString()).trimEnd();
        if (text) logLine(ws, text, 'warn');
      });
      proc.on('error', (error) => {
        if (session.replayRunProc === proc) session.replayRunProc = null;
        resolve({ code: null, error: errText(error) });
      });
      proc.on('close', (code) => {
        if (session.replayRunProc === proc) session.replayRunProc = null;
        resolve({ code, error: null });
      });
    });
    if (session.replayRunSeq !== seq) return;

    const result = readJson(path.join(runAbs, 'run', 'result.json')) || readJson(path.join(runAbs, 'result.json'));
    const ok = runResult.code === 0 && result?.passed !== false;
    const payload = {
      ok,
      seq,
      engine: 'ego',
      outRel: runOutRel,
      intent: script.scriptRel,
      passed: result?.passed ?? false,
      steps: Array.isArray(result?.steps) ? result.steps : [],
      videoRel: result?.videoRel,
      replayRel: result?.replayRel || `${runOutRel}/run/flow.html`,
      error: result?.error || (runResult.error ? String(runResult.error) : undefined),
      exitCode: runResult.code,
      message: ok ? undefined : result?.error || runResult.error || '执行未通过',
    };
    send(ws, 'replay:run:done', payload);
    logLine(ws, ok ? '[replay] 通过' : '[replay] 未通过', ok ? 'ok' : 'err');
    return;
  }

  const profile = getSessionAccountProfile(session, repoRoot);
  const entry = String(msg.entry || meta.entry || '').trim();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const runOutRel = `results/ego-studio/${stamp}-rerun`;
  const runAbs = path.join(repoRoot, runOutRel);
  fs.mkdirSync(runAbs, { recursive: true });
  try {
    fs.copyFileSync(path.join(repoRoot, script.scriptRel), path.join(runAbs, 'generated.ts'));
  } catch {
    /* ignore */
  }

  session.replayRunSeq = (session.replayRunSeq || 0) + 1;
  const seq = session.replayRunSeq;
  send(ws, 'replay:run:start', { seq, outRel: runOutRel, engine: 'pw', env, scriptRel: script.scriptRel });
  logLine(ws, `[replay] 运行 ${script.scriptRel} · engine=pw · env=${env}`, 'info');

  const tsxBin = path.join(
    repoRoot,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'tsx.cmd' : 'tsx',
  );
  const args = [
    'scripts/ai/run-playwright-script.ts',
    `--script=${path.join(repoRoot, script.scriptRel)}`,
    `--env=${env}`,
    `--profile=${profile}`,
    `--out=${runAbs}`,
  ];
  if (entry) args.push(`--entry=${entry}`);
  if (msg.headed) args.push('--headed');

  if (session.replayRunProc) {
    try {
      session.replayRunProc.kill('SIGTERM');
    } catch {
      /* ignore */
    }
  }
  const proc = spawn(tsxBin, args, {
    cwd: repoRoot,
    env: buildRepoSpawnEnv(session),
    shell: false,
  });
  session.replayRunProc = proc;
  const runResult = await new Promise((resolve) => {
    proc.stdout.on('data', (d) => {
      const text = stripAnsi(d.toString()).trimEnd();
      if (text) logLine(ws, text, 'dim');
    });
    proc.stderr.on('data', (d) => {
      const text = stripAnsi(d.toString()).trimEnd();
      if (text) logLine(ws, text, 'warn');
    });
    proc.on('error', (error) => {
      if (session.replayRunProc === proc) session.replayRunProc = null;
      resolve({ code: null, error: errText(error) });
    });
    proc.on('close', (code) => {
      if (session.replayRunProc === proc) session.replayRunProc = null;
      resolve({ code, error: null });
    });
  });
  if (session.replayRunSeq !== seq) return;

  const result = readJson(path.join(runAbs, 'result.json'));
  const ok = runResult.code === 0 && result?.passed !== false;
  const payload = {
    ok,
    seq,
    engine: 'pw',
    outRel: runOutRel,
    intent: script.scriptRel,
    passed: result?.passed ?? false,
    steps: Array.isArray(result?.steps) ? result.steps : [],
    videoRel: result?.videoRel,
    replayRel: result?.replayRel,
    failureBundleRel: result?.failureBundleRel,
    failureSummaryRel: result?.failureSummaryRel,
    error: result?.error || (runResult.error ? String(runResult.error) : undefined),
    exitCode: runResult.code,
    message: ok ? undefined : result?.error || runResult.error || '执行未通过',
  };
  send(ws, 'replay:run:done', payload);
  logLine(ws, ok ? '[replay] 通过' : '[replay] 未通过', ok ? 'ok' : 'err');
}

module.exports = { listFlowReplays, collectReplaySummaryRows, runFlowReplay, deleteFlowReplays, allowedReplayRel };
