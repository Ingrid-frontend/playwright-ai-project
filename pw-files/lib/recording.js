const fs = require('fs');
const path = require('path');
const { send, logLine, errText } = require('./ws-safe');
const {
  postprocessRecordedScript,
} = require('../../src/utils/strip-login-from-recording.cjs');
const {
  annotateStorageStateMeta,
} = require('../../src/utils/storage-state-meta.cjs');
const {
  extractFromCode,
} = require('../../src/utils/extract-login-account.cjs');

function createRecordingActions(deps) {
  const {
    repoEnv,
    resolveRepoRoot,
    getSessionPlaywrightEnv,
    getSessionAccountProfile,
    getEnvEntryResolved,
    runAccountLogin,
    getRepoPlaywrightCli,
    PLAYWRIGHT_CLI,
    buildRepoSpawnEnv,
    generateSampleScript,
    simulateRecording,
    spawn,
  } = deps;

  async function startRecording(ws, session, url) {
    send(ws, 'record:start');
    session.recording = true;
    session.rawCode = '';

    const outFile = path.join(session.tmpDir, 'recorded.ts');
    const repoRoot = resolveRepoRoot();
    const repoReady = fs.existsSync(path.join(repoRoot, 'playwright.config.ts'));
    const envId = getSessionPlaywrightEnv(session);
    const profile = repoReady ? getSessionAccountProfile(session, repoRoot) : 'default';
    let envEntry = repoReady ? getEnvEntryResolved(repoRoot, envId, profile) : null;

    if (repoReady && envEntry?.storageState && !envEntry?.hasStorage) {
      logLine(ws, `[env] storageState 无效，自动执行 login.setup…`, 'info');
      await runAccountLogin(ws, session);
      envEntry = getEnvEntryResolved(repoRoot, envId, profile);
    }

    const recordUrl = (url && String(url).trim()) || envEntry?.baseURL || url;
    session.lastUrl = recordUrl;

    const cli = (repoReady && getRepoPlaywrightCli(repoRoot)) || PLAYWRIGHT_CLI;
    const cwd = repoReady ? repoRoot : path.join(__dirname, '..');
    session.recordSaveStorageAbs = null;
    session.recordSaveStorageRel = null;

    const codegenArgs = [cli, 'codegen'];
    if (repoReady && envEntry?.storageState) {
      const storageAbs = path.resolve(repoRoot, envEntry.storageState);
      fs.mkdirSync(path.dirname(storageAbs), { recursive: true });
      session.recordSaveStorageAbs = storageAbs;
      session.recordSaveStorageRel = envEntry.storageState;
      codegenArgs.push(`--save-storage=${storageAbs}`);
      if (fs.existsSync(storageAbs)) {
        codegenArgs.push(`--load-storage=${storageAbs}`);
      } else {
        logLine(
          ws,
          `[env] ${envId} 未找到 ${envEntry.storageState}，录制结束后将保存当前浏览器登录态`,
          'warn',
        );
      }
      logLine(ws, `[env] 录制结束将写入 ${envEntry.storageState}`, 'dim');
      logLine(
        ws,
        '[env] 模式3：开始录制仅加载登录态；停止录制才保存；换账号请先用「清除当前登录态」',
        'dim',
      );
    }
    codegenArgs.push('--output', outFile, recordUrl);

    try {
      const proc = spawn(process.execPath, codegenArgs, {
        cwd,
        env: repoReady ? buildRepoSpawnEnv(session) : { ...process.env },
      });
      session.recordProc = proc;

      logLine(
        ws,
        `playwright codegen 已启动 [${envId}] ${recordUrl}${envEntry?.hasStorage ? '（已加载登录态）' : ''}`,
        'info',
      );
      logLine(ws, '请在浏览器中操作；完成后点击「停止录制」或直接关闭 codegen 浏览器窗口', 'dim');

      proc.stderr.on('data', (d) => {
        const text = d.toString().trim();
        if (text) logLine(ws, text, 'dim');
      });

      proc.on('close', () => {
        if (!session.recording) return;
        stopRecording(ws, session).catch((e) => {
          logLine(ws, `停止录制异常: ${errText(e)}`, 'err');
          session._stoppingRecord = false;
          send(ws, 'record:done', {
            code: session.rawCode || '',
            lines: 0,
            storageSaved: false,
            aborted: true,
          });
        });
      });
    } catch {
      logLine(ws, '[演示模式] playwright codegen 不可用，使用模拟录制', 'warn');
      simulateRecording(ws, session, recordUrl, stopRecording);
    }
  }

  async function stopRecording(ws, session) {
    if (session._stoppingRecord) return;
    session._stoppingRecord = true;
    session.recording = false;

    const outFile = path.join(session.tmpDir, 'recorded.ts');
    const storageAbs = session.recordSaveStorageAbs;
    const storageRel = session.recordSaveStorageRel;

    const proc = session.recordProc;
    session.recordProc = null;
    if (proc && proc.exitCode === null && proc.signalCode === null) {
      await new Promise((resolve) => {
        const forceKill = setTimeout(() => {
          try {
            proc.kill('SIGKILL');
          } catch {
            /* ignore */
          }
          resolve();
        }, 12000);
        proc.once('close', () => {
          clearTimeout(forceKill);
          resolve();
        });
        try {
          proc.kill('SIGTERM');
        } catch {
          clearTimeout(forceKill);
          resolve();
        }
      });
    }

    let code = '';
    if (fs.existsSync(outFile)) {
      code = fs.readFileSync(outFile, 'utf8');
    } else {
      code = generateSampleScript(session.lastUrl || 'https://example.com');
    }
    const rawRecordedCode = code;

    const repoRoot = resolveRepoRoot();
    if (fs.existsSync(path.join(repoRoot, 'playwright.config.ts'))) {
      const envId = getSessionPlaywrightEnv(session);
      const profile = getSessionAccountProfile(session, repoRoot);
      const storageRelForUse = storageRel || repoEnv.resolveStorageStateRel(repoRoot, envId, profile);

      let storageSavedForMeta = false;
      if (storageAbs && fs.existsSync(storageAbs)) {
        try {
          storageSavedForMeta = fs.statSync(storageAbs).size > 10;
        } catch {
          storageSavedForMeta = false;
        }
      }
      if (storageSavedForMeta && storageAbs) {
        annotateStorageStateMeta(storageAbs, {
          loginAccount: extractFromCode(rawRecordedCode) || undefined,
          code: rawRecordedCode,
          env: envId,
          source: 'studio-record',
        });
      }

      const post = postprocessRecordedScript(code, { storageRel: storageRelForUse });
      if (post.removedLoginLines > 0) {
        logLine(ws, `[record] 已移除录制中的登录步骤 ${post.removedLoginLines} 行（请依赖 storageState）`, 'info');
      }
      code = post.code;
      code = repoEnv.prependRecordingAccountHeader(repoRoot, code, envId, profile, { code: rawRecordedCode });
      if (fs.existsSync(outFile)) {
        try {
          fs.writeFileSync(outFile, code, 'utf8');
        } catch {
          /* 临时目录写入失败不影响回传编辑器 */
        }
      }
    }

    session.rawCode = code;
    const lines = code.split('\n').length;

    let storageSaved = false;
    if (storageAbs && fs.existsSync(storageAbs)) {
      try {
        storageSaved = fs.statSync(storageAbs).size > 10;
      } catch {
        storageSaved = false;
      }
    }

    send(ws, 'record:done', {
      code,
      lines,
      storageSaved,
      storageState: storageRel || undefined,
    });

    if (storageSaved && storageRel) {
      logLine(ws, `[env] 已保存登录态: ${storageRel}`, 'ok');
      send(ws, 'env:storage-saved', {
        env: getSessionPlaywrightEnv(session),
        storageState: storageRel,
        hasStorage: true,
      });
    } else if (storageRel) {
      logLine(ws, `[env] 未写入有效登录态（请确认已在浏览器中登录后再停止录制）: ${storageRel}`, 'warn');
    }

    session.recordSaveStorageAbs = null;
    session.recordSaveStorageRel = null;
    session._stoppingRecord = false;
  }

  return { startRecording, stopRecording };
}

module.exports = { createRecordingActions };
