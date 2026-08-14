const fs = require('fs');
const path = require('path');
const { send, logLine, stripAnsi, errText } = require('./ws-safe');

async function runAiNativeValidate(ws, session, msg = {}, deps) {
  const {
    resolveRepoRoot,
    spawn,
    buildRepoSpawnEnv,
    getSessionPlaywrightEnv,
    getSessionAccountProfile,
  } = deps;
  const repoRoot = resolveRepoRoot();
  if (!fs.existsSync(path.join(repoRoot, 'playwright.config.ts'))) {
    send(ws, 'error', { message: '未找到项目根，无法执行 AI 验证' });
    send(ws, 'ai:validate:done', { ok: false, message: '未找到项目根' });
    return;
  }

  const caseDescription = String(msg.caseDescription || '').trim();
  if (!caseDescription) {
    send(ws, 'error', { message: '请先填写自然语言测试步骤' });
    send(ws, 'ai:validate:done', { ok: false, message: '缺少测试步骤' });
    return;
  }

  const env = String(msg.env || getSessionPlaywrightEnv(session) || 'stage').trim();
  const profile = getSessionAccountProfile(session, repoRoot);
  const entry = String(msg.entry || '').trim();
  const provider = String(msg.provider || '').trim();
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const outRel = `results/ai-native-studio/${ts}`;
  const outAbs = path.join(repoRoot, outRel);
  fs.mkdirSync(outAbs, { recursive: true });
  const scriptPath = path.join(outAbs, 'generated.ts');
  const runDir = path.join(outAbs, 'run');

  if (session.aiValidateProc) {
    try {
      session.aiValidateProc.kill('SIGTERM');
    } catch {
      /* ignore */
    }
  }
  session.aiValidateProc = null;
  session.aiValidateCancelled = false;
  session.aiValidateSeq = (session.aiValidateSeq || 0) + 1;
  const seq = session.aiValidateSeq;
  send(ws, 'ai:validate:start', { outRel, seq, env, profile });
  logLine(ws, '[ai-validate] 正在调用 API 生成 Playwright 脚本…', 'info');

  const tsxBin = path.join(
    repoRoot,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'tsx.cmd' : 'tsx',
  );
  const genArgs = [
    'scripts/ai/generate-playwright-script.ts',
    `--case=${caseDescription}`,
    `--env=${env}`,
    `--out=${scriptPath}`,
  ];
  if (entry) genArgs.push(`--entry=${entry}`);
  if (provider) genArgs.push(`--provider=${provider}`);

  const runChild = async (args) => {
    const proc = spawn(tsxBin, args, {
      cwd: repoRoot,
      env: buildRepoSpawnEnv(session),
      shell: false,
    });
    session.aiValidateProc = proc;
    return new Promise((resolve) => {
      proc.stdout.on('data', (d) => {
        const text = stripAnsi(d.toString()).trimEnd();
        if (text) logLine(ws, text, 'dim');
      });
      proc.stderr.on('data', (d) => {
        const text = stripAnsi(d.toString()).trimEnd();
        if (text) logLine(ws, text, 'warn');
      });
      proc.on('error', (error) => {
        if (session.aiValidateProc === proc) session.aiValidateProc = null;
        resolve({ code: null, error: errText(error) });
      });
      proc.on('close', (code) => {
        if (session.aiValidateProc === proc) session.aiValidateProc = null;
        resolve({ code, error: null });
      });
    });
  };

  const genResult = await runChild(genArgs);
  if (session.aiValidateCancelled || session.aiValidateSeq !== seq) return;
  if (genResult.error || genResult.code !== 0 || !fs.existsSync(scriptPath)) {
    const message = genResult.error || 'Playwright 脚本生成失败';
    logLine(ws, `[ai-validate] ${message}`, 'err');
    send(ws, 'ai:validate:done', { ok: false, outRel, seq, message });
    return;
  }

  logLine(ws, '[ai-validate] Playwright 脚本已生成，开始执行…', 'info');
  const runArgs = [
    'scripts/ai/run-playwright-script.ts',
    `--script=${scriptPath}`,
    `--env=${env}`,
    `--profile=${profile}`,
    `--out=${runDir}`,
  ];

  const runResult = await runChild(runArgs);
  if (session.aiValidateCancelled || session.aiValidateSeq !== seq) return;

  const resultPath = path.join(runDir, 'result.json');
  let result = null;
  if (fs.existsSync(resultPath)) {
    try {
      result = JSON.parse(fs.readFileSync(resultPath, 'utf-8'));
    } catch {
      /* ignore */
    }
  }

  const ok = runResult.code === 0 && result?.passed === true;
  const payload = {
    ok,
    outRel,
    seq,
    passed: result?.passed ?? false,
    steps: [{ id: 'script', passed: ok, error: result?.error }],
    error: result?.error || (runResult.error ? String(runResult.error) : undefined),
    exitCode: runResult.code,
  };
  send(ws, 'ai:validate:done', payload);
  logLine(ws, ok ? '[ai-validate] 验证通过' : '[ai-validate] 验证未通过', ok ? 'ok' : 'err');
}

module.exports = { runAiNativeValidate };
