const fs = require('fs');
const path = require('path');
const { send, logLine, stripAnsi } = require('./ws-safe');
const {
  COMPARE_REPORT_REL,
  resolveCustomerReportRel,
  repoHasScreenshotPng,
  sendCompareReportReady,
  sendCustomerReportReady,
  deliveryPreviewOpenPath,
  customerReportOpenPath,
} = require('./compare-report-status');

function resolveEnvId(session, buildRepoSpawnEnv) {
  const envId = buildRepoSpawnEnv(session).PLAYWRIGHT_ENV;
  if (!envId) return '';
  return String(envId).trim().toLowerCase();
}

async function openRepoCompareReport(ws, session, { regenerate = false } = {}, deps) {
  const { resolveRepoRoot } = deps;
  const repoRoot = resolveRepoRoot();
  if (!fs.existsSync(path.join(repoRoot, 'playwright.config.ts'))) {
    send(ws, 'error', { message: '未找到项目根，无法打开对比报告' });
    send(ws, 'repo:compare-report:done', { ok: false });
    return;
  }

  const absReport = path.join(repoRoot, COMPARE_REPORT_REL);
  if (!regenerate && fs.existsSync(absReport)) {
    sendCompareReportReady(ws, { openedExisting: true });
    return;
  }

  if (!repoHasScreenshotPng(path.join(repoRoot, 'screenshots'))) {
    send(ws, 'error', {
      message: 'screenshots/ 下无 PNG，无法生成对比报告（无需执行用例，但需已有截图文件）',
    });
    send(ws, 'repo:compare-report:done', { ok: false });
    return;
  }

  await runRepoCompareReport(ws, session, deps);
}

async function runRepoCompareReport(ws, session, deps) {
  const { resolveRepoRoot, spawn, buildRepoSpawnEnv } = deps;
  const repoRoot = resolveRepoRoot();
  if (!fs.existsSync(path.join(repoRoot, 'playwright.config.ts'))) {
    send(ws, 'error', { message: '未找到项目根，无法生成对比报告' });
    send(ws, 'repo:compare-report:done', { ok: false });
    return;
  }

  session.repoCompareCancelled = false;
  send(ws, 'repo:compare-report:start', {});
  logLine(ws, '[repo] 运行 compare-screenshots…', 'info');

  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const extraArgs = Array.isArray(deps.extraArgs) ? deps.extraArgs : [];
  const proc = spawn(npmCmd, ['run', 'compare-screenshots', '--', ...extraArgs], {
    cwd: repoRoot,
    env: buildRepoSpawnEnv(session),
    shell: false,
  });
  session.repoCompareProc = proc;
  proc.stdout.on('data', (d) => {
    const t = stripAnsi(d.toString());
    if (t.trim()) logLine(ws, t.trimEnd(), 'dim');
  });
  proc.stderr.on('data', (d) => {
    const t = stripAnsi(d.toString());
    if (t.trim()) logLine(ws, t.trimEnd(), 'warn');
  });

  const exitCode = await new Promise((resolve) => {
    proc.on('close', resolve);
  });
  session.repoCompareProc = null;

  if (session.repoCompareCancelled) {
    logLine(ws, '[repo] 对比报告生成已取消', 'warn');
    send(ws, 'repo:compare-report:done', { ok: false, cancelled: true });
    return;
  }
  if (exitCode !== 0) {
    send(ws, 'error', { message: `compare-screenshots 退出码 ${exitCode}` });
    send(ws, 'repo:compare-report:done', { ok: false, exitCode });
    return;
  }

  const absReport = path.join(repoRoot, COMPARE_REPORT_REL);
  if (!fs.existsSync(absReport)) {
    send(ws, 'error', {
      message: '未生成 results/screenshot-comparison.html（screenshots/ 可能为空或无可对比步骤）',
    });
    send(ws, 'repo:compare-report:done', { ok: false });
    return;
  }

  sendCompareReportReady(ws, { openedExisting: false });
}

async function openRepoCustomerReport(ws, session, { regenerate = false } = {}, deps) {
  const { resolveRepoRoot, buildRepoSpawnEnv } = deps;
  const repoRoot = resolveRepoRoot();
  const envId = resolveEnvId(session, buildRepoSpawnEnv);
  if (!envId) {
    send(ws, 'error', { message: '请先选择运行环境，再生成客户交付包' });
    send(ws, 'repo:customer-report:done', { ok: false });
    return;
  }
  if (!fs.existsSync(path.join(repoRoot, 'playwright.config.ts'))) {
    send(ws, 'error', { message: '未找到项目根，无法打开客户报告' });
    send(ws, 'repo:customer-report:done', { ok: false });
    return;
  }

  const absReport = path.join(repoRoot, resolveCustomerReportRel(envId));
  if (!regenerate && fs.existsSync(absReport)) {
    sendCustomerReportReady(ws, {
      openedExisting: true,
      envId,
      previewOpenPath: deliveryPreviewOpenPath(),
    });
    return;
  }

  if (!repoHasScreenshotPng(path.join(repoRoot, 'screenshots'))) {
    send(ws, 'error', {
      message: 'screenshots/ 下无 PNG，无法生成客户报告',
    });
    send(ws, 'repo:customer-report:done', { ok: false });
    return;
  }

  await runRepoCustomerReport(ws, session, deps);
}

async function runRepoCustomerReport(ws, session, deps) {
  const { resolveRepoRoot, spawn, buildRepoSpawnEnv } = deps;
  const repoRoot = resolveRepoRoot();
  const envId = resolveEnvId(session, buildRepoSpawnEnv);
  if (!envId) {
    send(ws, 'error', { message: '请先选择运行环境，再生成客户交付包' });
    send(ws, 'repo:customer-report:done', { ok: false });
    return;
  }
  if (!fs.existsSync(path.join(repoRoot, 'playwright.config.ts'))) {
    send(ws, 'error', { message: '未找到项目根，无法生成客户报告' });
    send(ws, 'repo:customer-report:done', { ok: false });
    return;
  }

  session.repoCompareCancelled = false;
  send(ws, 'repo:customer-report:start', { envId });
  logLine(ws, `[repo] 运行 deliver:ready --env=${envId}…`, 'info');

  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const proc = spawn(npmCmd, ['run', 'deliver:ready', '--', `--env=${envId}`], {
    cwd: repoRoot,
    env: buildRepoSpawnEnv(session),
    shell: false,
  });
  session.repoCompareProc = proc;
  proc.stdout.on('data', (d) => {
    const t = stripAnsi(d.toString());
    if (t.trim()) logLine(ws, t.trimEnd(), 'dim');
  });
  proc.stderr.on('data', (d) => {
    const t = stripAnsi(d.toString());
    if (t.trim()) logLine(ws, t.trimEnd(), 'warn');
  });

  const exitCode = await new Promise((resolve) => {
    proc.on('close', resolve);
  });
  session.repoCompareProc = null;

  if (session.repoCompareCancelled) {
    logLine(ws, '[repo] 客户报告生成已取消', 'warn');
    send(ws, 'repo:customer-report:done', { ok: false, cancelled: true });
    return;
  }
  if (exitCode !== 0) {
    send(ws, 'error', { message: `deliver:ready 退出码 ${exitCode}` });
    send(ws, 'repo:customer-report:done', { ok: false, exitCode });
    return;
  }

  const absReport = path.join(repoRoot, resolveCustomerReportRel(envId));
  if (!fs.existsSync(absReport)) {
    send(ws, 'error', {
      message: `未生成 ${resolveCustomerReportRel(envId)}`,
    });
    send(ws, 'repo:customer-report:done', { ok: false });
    return;
  }

  sendCustomerReportReady(ws, {
    openedExisting: false,
    envId,
    openPath: customerReportOpenPath(envId),
    previewOpenPath: deliveryPreviewOpenPath(),
  });
}

async function runRepoDeliverFeishu(ws, session, deps) {
  const { resolveRepoRoot, spawn, buildRepoSpawnEnv } = deps;
  const repoRoot = resolveRepoRoot();
  const envId = resolveEnvId(session, buildRepoSpawnEnv);
  if (!envId) {
    send(ws, 'error', { message: '请先选择运行环境，再写入飞书' });
    send(ws, 'repo:deliver-feishu:done', { ok: false });
    return;
  }

  session.repoCompareCancelled = false;
  send(ws, 'repo:deliver-feishu:start', { envId });
  logLine(ws, `[repo] 运行 deliver:feishu --env=${envId}…`, 'info');

  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const proc = spawn(
    npmCmd,
    ['run', 'deliver:feishu', '--', `--env=${envId}`],
    {
      cwd: repoRoot,
      env: { ...buildRepoSpawnEnv(session), NODE_OPTIONS: '--dns-result-order=ipv4first' },
      shell: false,
    },
  );
  session.repoCompareProc = proc;
  proc.stdout.on('data', (d) => {
    const t = stripAnsi(d.toString());
    if (t.trim()) logLine(ws, t.trimEnd(), 'dim');
  });
  proc.stderr.on('data', (d) => {
    const t = stripAnsi(d.toString());
    if (t.trim()) logLine(ws, t.trimEnd(), 'warn');
  });

  const exitCode = await new Promise((resolve) => {
    proc.on('close', resolve);
  });
  session.repoCompareProc = null;

  if (exitCode !== 0) {
    send(ws, 'error', { message: `deliver:feishu 退出码 ${exitCode}` });
    send(ws, 'repo:deliver-feishu:done', { ok: false, exitCode });
    return;
  }

  const resultPath = path.join(repoRoot, 'results/feishu-delivery-result.json');
  let docUrl = '';
  let shareDegraded = false;
  if (fs.existsSync(resultPath)) {
    try {
      const result = JSON.parse(fs.readFileSync(resultPath, 'utf-8'));
      docUrl = result.docUrl || '';
      shareDegraded = Boolean(result.shareDegraded);
    } catch {
      /* ignore */
    }
  }

  send(ws, 'repo:deliver-feishu:done', { ok: true, envId, docUrl, shareDegraded });
  if (shareDegraded) {
    logLine(ws, '[repo] 飞书文档已写入，但分享链接需手动公开', 'warn');
  } else if (docUrl) {
    logLine(ws, `[repo] 飞书交付完成: ${docUrl}`, 'ok');
  } else {
    logLine(ws, '[repo] 飞书交付完成', 'ok');
  }
}

module.exports = {
  openRepoCompareReport,
  runRepoCompareReport,
  openRepoCustomerReport,
  runRepoCustomerReport,
  runRepoDeliverFeishu,
};
