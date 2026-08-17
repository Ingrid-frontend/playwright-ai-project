const fs = require('fs');
const path = require('path');
const { send, logLine, stripAnsi, errText } = require('./ws-safe');

async function runEgoExplore(ws, session, msg = {}, deps) {
  const {
    resolveRepoRoot,
    spawn,
    buildRepoSpawnEnv,
    getSessionPlaywrightEnv,
  } = deps;
  const repoRoot = resolveRepoRoot();
  if (!fs.existsSync(path.join(repoRoot, 'playwright.config.ts'))) {
    send(ws, 'error', { message: '未找到项目根' });
    send(ws, 'ego:explore:done', { ok: false, message: '未找到项目根' });
    return;
  }

  const goal = String(msg.goal || '').trim();
  if (!goal) {
    send(ws, 'error', { message: '请填写探索目标 goal' });
    send(ws, 'ego:explore:done', { ok: false, message: '缺少 goal' });
    return;
  }

  const env = String(msg.env || getSessionPlaywrightEnv(session) || 'stage').trim();
  const entry = String(msg.entry || '').trim();
  const space = String(msg.space || '').trim();
  const maxSteps = Math.max(1, Number(msg.maxSteps || 8));
  const keepTab = Boolean(msg.keepTab);
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const outRel = `results/ego-explore/${stamp}-studio`;
  const outAbs = path.join(repoRoot, outRel);
  fs.mkdirSync(outAbs, { recursive: true });

  if (session.egoExploreProc) {
    try {
      session.egoExploreProc.kill('SIGTERM');
    } catch {
      /* ignore */
    }
  }
  session.egoExploreProc = null;
  session.egoExploreCancelled = false;
  session.egoExploreSeq = (session.egoExploreSeq || 0) + 1;
  const seq = session.egoExploreSeq;

  send(ws, 'ego:explore:start', { outRel, seq, env, goal, entry, space });
  logLine(ws, `[explore] goal=${goal} · env=${env}`, 'info');

  const tsxBin = path.join(
    repoRoot,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'tsx.cmd' : 'tsx',
  );
  const args = [
    'scripts/ego/explore-to-intent.ts',
    `--goal=${goal}`,
    `--env=${env}`,
    `--out=${outAbs}`,
    `--max-steps=${maxSteps}`,
  ];
  if (entry) args.push(`--entry=${entry}`);
  if (space) args.push(`--space=${space}`);
  if (keepTab) args.push('--keep-tab');

  const proc = spawn(tsxBin, args, {
    cwd: repoRoot,
    env: buildRepoSpawnEnv(session),
    shell: false,
  });
  session.egoExploreProc = proc;

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
      if (session.egoExploreProc === proc) session.egoExploreProc = null;
      resolve({ code: null, error: errText(error) });
    });
    proc.on('close', (code) => {
      if (session.egoExploreProc === proc) session.egoExploreProc = null;
      resolve({ code, error: null });
    });
  });

  if (session.egoExploreCancelled || session.egoExploreSeq !== seq) return;

  const previewPath = path.join(outAbs, 'intent.preview.yaml');
  let previewYaml = '';
  if (fs.existsSync(previewPath)) {
    previewYaml = fs.readFileSync(previewPath, 'utf-8');
  }

  const ok = runResult.code === 0 && Boolean(previewYaml.trim());
  send(ws, 'ego:explore:done', {
    ok,
    outRel,
    seq,
    goal,
    previewYaml,
    previewRel: ok ? `${outRel}/intent.preview.yaml` : undefined,
    message: ok ? undefined : runResult.error || '探索未产出 Intent 预览',
    exitCode: runResult.code,
  });
  logLine(ws, ok ? '[explore] 完成' : '[explore] 失败', ok ? 'ok' : 'err');
}

module.exports = { runEgoExplore };
