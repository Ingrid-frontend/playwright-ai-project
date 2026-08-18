const fs = require('fs');
const path = require('path');
const { send, logLine, stripAnsi, errText } = require('./ws-safe');

async function runNlToIntent(ws, session, msg = {}, deps) {
  const { resolveRepoRoot, spawn, buildRepoSpawnEnv, getSessionPlaywrightEnv } = deps;
  const repoRoot = resolveRepoRoot();
  if (!fs.existsSync(path.join(repoRoot, 'playwright.config.ts'))) {
    send(ws, 'error', { message: '未找到项目根' });
    send(ws, 'intent:from-nl:done', { ok: false, message: '未找到项目根' });
    return;
  }

  const caseDescription = String(msg.caseDescription || '').trim();
  if (!caseDescription) {
    send(ws, 'error', { message: '缺少自然语言步骤' });
    send(ws, 'intent:from-nl:done', { ok: false, message: '缺少自然语言步骤' });
    return;
  }

  const env = String(msg.env || getSessionPlaywrightEnv(session) || 'stage').trim();
  const entry = String(msg.entry || '').trim();
  const outRel = String(msg.outRel || '').trim();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const workRel = outRel || `results/nl-to-intent/${stamp}-studio`;
  const workAbs = path.join(repoRoot, workRel);
  fs.mkdirSync(workAbs, { recursive: true });

  send(ws, 'intent:from-nl:start', { outRel: workRel });
  logLine(ws, '[nl→intent] 正在生成 YAML 预览…', 'info');

  const tsxBin = path.join(
    repoRoot,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'tsx.cmd' : 'tsx',
  );
  const args = [
    'scripts/ai/nl-to-intent.ts',
    `--case=${caseDescription}`,
    `--env=${env}`,
    `--out=${workAbs}`,
  ];
  if (entry) args.push(`--entry=${entry}`);
  if (outRel) {
    const scriptPath = path.join(repoRoot, outRel, 'generated.ts');
    const runDir = path.join(repoRoot, outRel, 'run');
    if (fs.existsSync(scriptPath)) args.push(`--script=${scriptPath}`);
    if (fs.existsSync(runDir)) args.push(`--run-dir=${runDir}`);
  }

  const proc = spawn(tsxBin, args, {
    cwd: repoRoot,
    env: buildRepoSpawnEnv(session),
    shell: false,
  });

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
      resolve({ code: null, error: errText(error) });
    });
    proc.on('close', (code) => {
      resolve({ code, error: null });
    });
  });

  const previewPath = path.join(workAbs, 'intent.preview.yaml');
  let previewYaml = '';
  if (fs.existsSync(previewPath)) {
    previewYaml = fs.readFileSync(previewPath, 'utf-8');
  }

  const ok = runResult.code === 0 && Boolean(previewYaml.trim());
  send(ws, 'intent:from-nl:done', {
    ok,
    outRel: workRel,
    previewYaml,
    previewRel: ok ? `${workRel}/intent.preview.yaml` : undefined,
    message: ok ? undefined : runResult.error || '未能生成 Intent 预览',
  });
  logLine(ws, ok ? '[nl→intent] 完成' : '[nl→intent] 失败', ok ? 'ok' : 'err');
}

module.exports = { runNlToIntent };
