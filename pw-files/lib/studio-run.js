const fs = require('fs');
const path = require('path');
const { send, logLine } = require('./ws-safe');

async function runScript(ws, session, code, runOpts = {}, deps) {
  const {
    PLAYWRIGHT_CLI,
    buildStudioRunEnv,
    spawn,
    logPlaywrightFailureReport,
    studioNodeModulesDir,
  } = deps;

  session.runCancelled = false;
  send(ws, 'run:start');

  const uiMode = Boolean(runOpts.ui);
  const headedMode = Boolean(runOpts.headed);
  const debugMode = Boolean(runOpts.debug);
  const interactiveMode = uiMode || debugMode;
  const showBrowser = uiMode || headedMode || debugMode;
  const specFile = path.join(session.tmpDir, 'test.spec.ts');
  fs.writeFileSync(specFile, code);

  const configFile = path.join(session.tmpDir, 'playwright.config.cjs');
  const locale = process.env.PW_LOCALE || 'zh-CN';
  const timezoneId = process.env.PW_TIMEZONE || 'Asia/Shanghai';
  const useOpts = {
    headless: !showBrowser,
    screenshot: 'only-on-failure',
    locale,
    timezoneId,
  };
  if (process.env.PW_CHANNEL) {
    useOpts.channel = process.env.PW_CHANNEL;
  } else if (process.platform === 'darwin') {
    useOpts.channel = 'chrome';
  }

  const testTimeout = Number(process.env.PW_TEST_TIMEOUT) || 120000;
  const navigationTimeout = Number(process.env.PW_NAVIGATION_TIMEOUT) || 60000;
  const actionTimeout = Number(process.env.PW_ACTION_TIMEOUT) || 60000;
  useOpts.navigationTimeout = navigationTimeout;
  useOpts.actionTimeout = actionTimeout;

  const { env: runEnv, resolved: envResolved } = buildStudioRunEnv(session);
  if (envResolved?.baseURL) {
    useOpts.baseURL = envResolved.baseURL;
  }
  if (runEnv.STORAGE_STATE_PATH && !fs.existsSync(runEnv.STORAGE_STATE_PATH)) {
    logLine(
      ws,
      `[run] 登录态不存在: ${envResolved?.storageState || runEnv.STORAGE_STATE_PATH}，请先在该环境录制并登录`,
      'warn',
    );
  } else if (runEnv.STORAGE_STATE_PATH) {
    logLine(ws, `[run] STORAGE_STATE_PATH=${runEnv.STORAGE_STATE_PATH}`, 'dim');
  }
  if (envResolved?.baseURL) {
    logLine(ws, `[run] baseURL=${envResolved.baseURL}`, 'dim');
  }

  fs.writeFileSync(
    configFile,
    `module.exports = ${JSON.stringify({
      testDir: '.',
      timeout: testTimeout,
      expect: { timeout: actionTimeout },
      reporter: 'json',
      outputDir: 'test-results',
      use: useOpts,
    })};\n`,
  );

  logLine(ws, `测试文件: ${specFile}`, 'dim');
  if (debugMode) {
    logLine(ws, '调试模式（--debug）：将打开浏览器与 Playwright Inspector，可单步执行', 'info');
  } else if (uiMode) {
    logLine(ws, 'UI 模式（--ui）：将打开 Playwright Test UI 窗口，关闭窗口后继续', 'info');
  } else if (headedMode) {
    logLine(ws, '有界面模式（--headed）：将弹出浏览器窗口并自动执行脚本', 'info');
  }
  logLine(ws, useOpts.channel
    ? `启动浏览器（channel: ${useOpts.channel}${showBrowser ? '，有界面' : '，无头'}）...`
    : `启动 Chromium（${showBrowser ? '有界面' : '无头'}，需已执行 npx playwright install chromium）...`,
    'info');
  logLine(ws, `超时：用例 ${testTimeout / 1000}s，导航 ${navigationTimeout / 1000}s，单步操作 ${actionTimeout / 1000}s（PW_TEST_TIMEOUT / PW_ACTION_TIMEOUT）`, 'dim');
  logLine(ws, `浏览器区域：locale=${locale}，时区=${timezoneId}（未设置时 Playwright 常为 en-US，中文文案选择器会失败）`, 'dim');

  const startTime = Date.now();
  const pwArgs = [PLAYWRIGHT_CLI, 'test', '--config', 'playwright.config.cjs'];
  if (uiMode) pwArgs.push('--ui');
  else if (debugMode) pwArgs.push('--debug');
  else if (headedMode) pwArgs.push('--headed');
  else pwArgs.push('--reporter=json');

  try {
    const proc = spawn(process.execPath, pwArgs, {
      cwd: session.tmpDir,
      env: {
        ...runEnv,
        NODE_PATH: studioNodeModulesDir,
      },
    });
    session.runProc = proc;

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d) => {
      stdout += d.toString();
    });
    proc.stderr.on('data', (d) => {
      const text = d.toString().trim();
      if (text) logLine(ws, text, 'dim');
    });

    proc.on('close', (exitCode) => {
      session.runProc = null;
      if (session.runCancelled) {
        send(ws, 'run:cancelled');
        return;
      }
      const duration = ((Date.now() - startTime) / 1000).toFixed(1);

      let passed = 0, failed = 0, total = 0;

      try {
        const result = JSON.parse(stdout);
        const s = result.stats || {};
        const expected = Number(s.expected) || 0;
        const unexpected = Number(s.unexpected) || 0;
        const skipped = Number(s.skipped) || 0;
        const flaky = Number(s.flaky) || 0;
        passed = expected + flaky;
        failed = unexpected;
        total = expected + unexpected + skipped + flaky;

        if (total === 0 && exitCode !== 0) {
          passed = 0;
          failed = 1;
          total = 1;
        }

        if (exitCode !== 0 || failed > 0) {
          logPlaywrightFailureReport(ws, result, session, exitCode);
        }
      } catch {
        if (interactiveMode) {
          const modeLabel = debugMode ? '调试（--debug）' : 'UI（--ui）';
          logLine(ws, `${modeLabel}已结束，用例结果请在 Playwright 窗口中查看`, 'info');
          passed = 0;
          failed = 0;
          total = 0;
        } else {
          const tail = (stderr || stdout).trim();
          if (tail) {
            tail.split('\n').slice(-8).forEach((line) => logLine(ws, line, 'err'));
          }
          passed = exitCode === 0 ? 1 : 0;
          failed = exitCode === 0 ? 0 : 1;
          total = 1;
        }
      }

      const runMode = debugMode ? 'debug' : uiMode ? 'ui' : headedMode ? 'headed' : 'headless';
      session.runResult = { passed, failed, total, duration, exitCode, runMode };

      logLine(ws, `进程退出码: ${exitCode}`, exitCode === 0 ? 'ok' : 'err');

      send(ws, 'run:done', {
        passed,
        failed,
        total,
        duration,
        runMode,
        uiMode: interactiveMode,
        failures: session.lastRunFailures || [],
      });
    });
  } catch (err) {
    session.runProc = null;
    if (session.runCancelled) {
      send(ws, 'run:cancelled');
      return;
    }
    send(ws, 'error', { message: `启动测试失败: ${err.message}` });
    send(ws, 'run:done', { passed: 0, failed: 0, total: 0, duration: '0', runMode: 'headless', cancelled: false, error: true });
  }
}

module.exports = { runScript };
