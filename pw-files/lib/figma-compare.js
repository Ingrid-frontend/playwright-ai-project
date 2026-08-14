const fs = require('fs');
const path = require('path');
const { send, logLine, stripAnsi } = require('./ws-safe');
const { mapFigmaCropUrls } = require('./figma-payload');

async function runFigmaCompare(ws, session, msg = {}, deps) {
  const {
    resolveRepoRoot,
    spawn,
    buildRepoSpawnEnv,
    getSessionPlaywrightEnv,
    getSessionAccountProfile,
  } = deps;
  const repoRoot = resolveRepoRoot();
  if (!fs.existsSync(path.join(repoRoot, 'playwright.config.ts'))) {
    send(ws, 'error', { message: '未找到项目根，无法执行 Figma 对比' });
    send(ws, 'figma:compare:done', { ok: false, message: '未找到项目根' });
    return;
  }
  const figmaUrl = String(msg.figmaUrl || '').trim();
  const targetUrl = String(msg.targetUrl || '').trim();
  if (!figmaUrl) {
    send(ws, 'error', { message: '请先粘贴 Figma 链接' });
    send(ws, 'figma:compare:done', { ok: false, message: '缺少 Figma 链接' });
    return;
  }

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const outRel = `results/figma-compare/${ts}`;
  const outAbs = path.join(repoRoot, outRel);
  fs.mkdirSync(outAbs, { recursive: true });

  if (session.repoFigmaProc) {
    try { session.repoFigmaProc.kill('SIGTERM'); } catch { /* ignore */ }
  }
  session.repoFigmaProc = null;
  session.figmaCompareSeq = (session.figmaCompareSeq || 0) + 1;
  const seq = session.figmaCompareSeq;
  send(ws, 'figma:compare:start', { outRel, seq });
  logLine(ws, '[figma] 开始导出设计稿并对比…', 'info');

  const tsxBin = path.join(repoRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'tsx.cmd' : 'tsx');
  const args = [
    'scripts/figma/figma-spec-compare.ts',
    `--figma=${figmaUrl}`,
    `--out=${outRel}`,
  ];
  if (targetUrl) args.push(`--url=${targetUrl}`);
  const envId = getSessionPlaywrightEnv(session);
  const profile = getSessionAccountProfile(session, repoRoot);
  args.push(`--env=${envId}`);
  args.push(`--profile=${profile}`);
  if (msg.refreshDesign) args.push('--refresh');

  const proc = spawn(tsxBin, args, {
    cwd: repoRoot,
    env: buildRepoSpawnEnv(session),
    shell: false,
  });
  session.repoFigmaProc = proc;
  let stdout = '';
  proc.stdout.on('data', (d) => {
    const t = stripAnsi(d.toString());
    stdout += t;
    if (t.trim()) logLine(ws, t.trimEnd(), 'dim');
  });
  proc.stderr.on('data', (d) => {
    const t = stripAnsi(d.toString());
    if (t.trim()) logLine(ws, t.trimEnd(), 'warn');
  });

  const exitCode = await new Promise((resolve) => proc.on('close', resolve));
  session.repoFigmaProc = null;
  if (session.figmaCompareSeq !== seq) return;

  const designAbs = path.join(outAbs, 'design.png');
  const liveAbs = path.join(outAbs, 'live.png');
  const diffAbs = path.join(outAbs, 'diff.png');
  const hasOutput = fs.existsSync(designAbs) && fs.existsSync(liveAbs);

  if (exitCode !== 0 && !hasOutput) {
    logLine(ws, '[figma] 对比失败', 'err');
    const errLine = stdout.split('\n').filter((l) => /对比失败|❌|Error|error|权限|token|Token/i.test(l)).pop();
    const message = errLine ? errLine.trim().slice(0, 200) : 'Figma 对比执行失败，请查看日志';
    send(ws, 'figma:compare:done', { ok: false, message, seq });
    return;
  }

  let result = null;
  try {
    const jsonPath = path.join(outAbs, 'result.json');
    if (fs.existsSync(jsonPath)) {
      result = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    } else {
      result = JSON.parse(stdout.split('\n').filter((l) => l.trim().startsWith('{')).pop());
    }
  } catch { /* ignore */ }

  const base = `/results/figma-compare/${ts}`;
  const payload = result || { outRel };
  payload.ok = true;
  payload.outRel = outRel;
  payload.seq = seq;
  payload.designUrl = base + '/design.png';
  payload.liveUrl = base + '/live.png';
  if (fs.existsSync(diffAbs)) payload.diffUrl = base + '/diff.png';
  if (fs.existsSync(path.join(outAbs, 'report.html'))) payload.reportUrl = base + '/report.html';
  if (fs.existsSync(path.join(outAbs, 'report.md'))) payload.reportMdUrl = base + '/report.md';
  if (fs.existsSync(path.join(outAbs, 'design-spec.json'))) payload.specJsonUrl = base + '/design-spec.json';
  if (payload.crops) payload.crops = mapFigmaCropUrls(base, payload.crops);
  if (exitCode !== 0) {
    const errLine = stdout.split('\n').filter((l) => /对比失败|❌|Error|error/i.test(l)).pop();
    payload.warning = errLine ? errLine.trim().slice(0, 120) : `进程退出码 ${exitCode}`;
  }
  send(ws, 'figma:compare:done', payload);
  logLine(ws, '[figma] 对比完成，结果见中间「设计稿对比」面板', 'ok');
}

module.exports = { runFigmaCompare };
