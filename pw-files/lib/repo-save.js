const fs = require('fs');
const path = require('path');
const { send, logLine, errText } = require('./ws-safe');

async function suggestRepoSavePath(ws, session, msg, deps) {
  const {
    resolveRepoRoot,
    resolveRecordingPathViaRepo,
    getSessionPlaywrightEnv,
    spawn,
  } = deps;
  const repoRoot = resolveRepoRoot();
  if (!fs.existsSync(path.join(repoRoot, 'playwright.config.ts'))) {
    send(ws, 'error', { message: '未找到项目根，无法建议保存路径' });
    return;
  }
  const code = typeof msg.code === 'string' ? msg.code : '';
  if (!code.trim()) {
    send(ws, 'error', { message: '脚本为空，无法建议保存路径' });
    return;
  }
  try {
    const result = await resolveRecordingPathViaRepo(repoRoot, {
      code,
      name: msg.name,
      description: msg.description,
      target: 'original',
      playwrightEnv: getSessionPlaywrightEnv(session),
    }, spawn);
    send(ws, 'repo:suggest-path:done', result);
    logLine(ws, `[repo] 建议路径: ${result.relativePath}`, 'dim');
  } catch (e) {
    send(ws, 'error', { message: errText(e) });
  }
}

async function repoSave(ws, session, msg, deps) {
  const {
    resolveRepoRoot,
    resolveRecordingPathViaRepo,
    isPlaceholderRecordingPath,
    assertAllowedSavePath,
    spawn,
  } = deps;
  const repoRoot = resolveRepoRoot();
  if (!fs.existsSync(path.join(repoRoot, 'playwright.config.ts'))) {
    send(ws, 'error', {
      message: '未找到项目根（含 playwright.config.ts）。请设置 PLAYWRIGHT_REPO_ROOT 或将 pw-files 放在仓库子目录下。',
    });
    return;
  }
  const code = typeof msg.code === 'string' ? msg.code : session.rawCode;
  if (!code || !String(code).trim()) {
    send(ws, 'error', { message: '保存失败：脚本内容为空' });
    return;
  }
  let relativePath = (msg.relativePath || '').trim().replace(/\\/g, '/');
  if (isPlaceholderRecordingPath(relativePath)) {
    try {
      const resolved = await resolveRecordingPathViaRepo(repoRoot, {
        code,
        name: msg.name,
        description: msg.description,
        target: 'original',
      }, spawn);
      relativePath = resolved.relativePath;
      logLine(ws, `[repo] 使用项目命名: ${relativePath}`, 'dim');
    } catch (e) {
      send(ws, 'error', { message: `无法解析保存路径: ${errText(e)}` });
      return;
    }
  }
  let abs;
  try {
    abs = assertAllowedSavePath(repoRoot, relativePath);
  } catch (e) {
    send(ws, 'error', { message: errText(e) });
    return;
  }
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, code, 'utf8');
  session.lastSavedRelative = relativePath;
  logLine(ws, `[repo] 已保存: ${relativePath}`, 'ok');
  send(ws, 'repo:save:done', { relativePath, repoRoot });
}

module.exports = { suggestRepoSavePath, repoSave };
