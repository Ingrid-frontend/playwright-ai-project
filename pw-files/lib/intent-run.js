const fs = require('fs');
const path = require('path');
const { send, logLine, stripAnsi, errText } = require('./ws-safe');

function resolveIntentPath(repoRoot, intentRel) {
  const rel = String(intentRel || '').trim().replace(/\\/g, '/');
  if (!rel) return { error: '请指定 Intent YAML 路径' };
  if (path.isAbsolute(rel) || rel.includes('..')) {
    return { error: 'Intent 路径必须是仓库内相对路径' };
  }
  const allowed =
    rel.startsWith('tests/definitions/') ||
    rel.startsWith('results/intent-studio/') ||
    rel.startsWith('results/intent-runs/') ||
    rel.startsWith('results/ego-explore/');
  if (!allowed) {
    return { error: 'Intent 路径仅允许 tests/definitions/ 或 results/intent-* / ego-explore' };
  }
  if (!/\.ya?ml$/i.test(rel)) {
    return { error: 'Intent 文件必须是 .yaml / .yml' };
  }
  const abs = path.join(repoRoot, rel);
  if (!fs.existsSync(abs)) {
    return { error: `文件不存在: ${rel}` };
  }
  return { abs, rel };
}

function listIntentDefinitions(repoRoot) {
  const dir = path.join(repoRoot, 'tests', 'definitions');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => /\.ya?ml$/i.test(name))
    .sort()
    .map((name) => ({
      name,
      path: `tests/definitions/${name}`,
    }));
}

function getIntentDefinition(repoRoot, intentRel) {
  const resolved = resolveIntentPath(repoRoot, intentRel);
  if (resolved.error) return { error: resolved.error };
  if (!resolved.rel.startsWith('tests/definitions/')) {
    return { error: '仅可加载 tests/definitions/ 下的定义' };
  }
  const text = fs.readFileSync(resolved.abs, 'utf-8');
  return { path: resolved.rel, text };
}

function saveIntentDefinition(repoRoot, msg = {}) {
  let rel = String(msg.path || msg.name || '').trim().replace(/\\/g, '/');
  if (!rel) return { error: '请指定保存路径或文件名' };
  if (!rel.includes('/')) rel = `tests/definitions/${rel}`;
  if (!rel.startsWith('tests/definitions/') || rel.includes('..') || path.isAbsolute(rel)) {
    return { error: '仅允许保存到 tests/definitions/' };
  }
  if (!/\.ya?ml$/i.test(rel)) rel = `${rel}.yaml`;
  const text = String(msg.yamlText || msg.text || '');
  if (!text.trim()) return { error: 'YAML 内容为空' };
  const abs = path.join(repoRoot, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text.endsWith('\n') ? text : `${text}\n`, 'utf-8');
  return { path: rel };
}

async function runIntent(ws, session, msg = {}, deps) {
  const {
    resolveRepoRoot,
    spawn,
    buildRepoSpawnEnv,
    getSessionPlaywrightEnv,
    getSessionAccountProfile,
    runRepoCompareReport,
  } = deps;
  const repoRoot = resolveRepoRoot();
  if (!fs.existsSync(path.join(repoRoot, 'playwright.config.ts'))) {
    send(ws, 'error', { message: '未找到项目根，无法执行 Intent' });
    send(ws, 'intent:run:done', { ok: false, message: '未找到项目根' });
    return;
  }

  let intentRel = String(msg.intent || '').trim();
  const yamlText = String(msg.yamlText || '').trim();
  if (yamlText) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const outRel = `results/intent-studio/${ts}.yaml`;
    const outAbs = path.join(repoRoot, outRel);
    fs.mkdirSync(path.dirname(outAbs), { recursive: true });
    fs.writeFileSync(outAbs, `${yamlText}\n`, 'utf-8');
    intentRel = outRel;
    logLine(ws, `[intent] 已写入临时 YAML: ${outRel}`, 'info');
  }

  const resolved = resolveIntentPath(repoRoot, intentRel);
  if (resolved.error) {
    send(ws, 'error', { message: resolved.error });
    send(ws, 'intent:run:done', { ok: false, message: resolved.error });
    return;
  }

  const env = String(msg.env || getSessionPlaywrightEnv(session) || 'stage').trim();
  const profile = getSessionAccountProfile(session, repoRoot);
  const headed = Boolean(msg.headed);
  const heal = msg.heal !== false;
  const engine = String(msg.engine || 'ego').toLowerCase() === 'ego' ? 'ego' : 'pw';
  const compareAfter = Boolean(msg.compareAfter);
  const keepTab = Boolean(msg.keepTab);
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const outRel = `results/intent-runs/${stamp}-studio`;
  const outAbs = path.join(repoRoot, outRel);
  fs.mkdirSync(outAbs, { recursive: true });

  if (session.intentRunProc) {
    try {
      session.intentRunProc.kill('SIGTERM');
    } catch {
      /* ignore */
    }
  }
  session.intentRunProc = null;
  session.intentRunCancelled = false;
  session.intentRunSeq = (session.intentRunSeq || 0) + 1;
  const seq = session.intentRunSeq;
  send(ws, 'intent:run:start', {
    outRel,
    seq,
    env,
    profile,
    intent: resolved.rel,
    heal,
    headed,
    engine,
    compareAfter,
  });
  logLine(
    ws,
    `[intent] 运行 ${resolved.rel} · engine=${engine} · env=${env} · heal=${heal ? 'on' : 'off'}`,
    'info',
  );

  const tsxBin = path.join(
    repoRoot,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'tsx.cmd' : 'tsx',
  );
  const args = [
    'scripts/ai/run-intent.ts',
    `--intent=${resolved.abs}`,
    `--engine=${engine}`,
    `--env=${env}`,
    `--profile=${profile}`,
    `--out=${outAbs}`,
  ];
  if (headed) args.push('--headed');
  if (!heal) args.push('--no-heal');
  if (keepTab) args.push('--keep-tab');

  const proc = spawn(tsxBin, args, {
    cwd: repoRoot,
    env: buildRepoSpawnEnv(session),
    shell: false,
  });
  session.intentRunProc = proc;

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
      if (session.intentRunProc === proc) session.intentRunProc = null;
      resolve({ code: null, error: errText(error) });
    });
    proc.on('close', (code) => {
      if (session.intentRunProc === proc) session.intentRunProc = null;
      resolve({ code, error: null });
    });
  });

  if (session.intentRunCancelled || session.intentRunSeq !== seq) return;

  const resultPath = path.join(outAbs, 'result.json');
  let result = null;
  if (fs.existsSync(resultPath)) {
    try {
      result = JSON.parse(fs.readFileSync(resultPath, 'utf-8'));
    } catch {
      /* ignore */
    }
  }

  let compareOk;
  let triage;
  if (compareAfter && runResult.code === 0 && typeof runRepoCompareReport === 'function') {
    logLine(ws, '[intent] 触发截图对比…', 'info');
    try {
      await runRepoCompareReport(ws, session, {
        resolveRepoRoot,
        spawn,
        buildRepoSpawnEnv,
      });
      compareOk = true;
      const issuesPath = path.join(repoRoot, 'results/ui-issues.json');
      if (fs.existsSync(issuesPath)) {
        try {
          triage = JSON.parse(fs.readFileSync(issuesPath, 'utf-8')).summary?.triage;
        } catch {
          /* ignore */
        }
      }
    } catch (err) {
      compareOk = false;
      logLine(ws, `[intent] 对比失败: ${errText(err)}`, 'warn');
    }
  }

  const ok = runResult.code === 0 && result?.passed === true;
  const payload = {
    ok,
    outRel,
    seq,
    intent: resolved.rel,
    engine,
    passed: result?.passed ?? false,
    steps: Array.isArray(result?.steps) ? result.steps : [],
    screenshotDir: result?.screenshotDir,
    error: result?.error || (runResult.error ? String(runResult.error) : undefined),
    exitCode: runResult.code,
    compareAfter,
    compareOk,
    triage,
    message: ok ? undefined : result?.error || runResult.error || 'Intent 未通过',
  };
  send(ws, 'intent:run:done', payload);
  logLine(ws, ok ? '[intent] 通过' : '[intent] 未通过', ok ? 'ok' : 'err');
}

module.exports = {
  runIntent,
  listIntentDefinitions,
  getIntentDefinition,
  saveIntentDefinition,
  resolveIntentPath,
};
