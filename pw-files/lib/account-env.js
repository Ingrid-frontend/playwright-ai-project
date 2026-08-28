const fs = require('fs');
const path = require('path');
const { send, logLine, errText } = require('./ws-safe');

function createAccountEnvActions(deps) {
  const {
    repoEnv,
    resolveRepoRoot,
    getSessionPlaywrightEnv,
    getSessionAccountProfile,
    getEnvEntryResolved,
    getRepoPlaywrightCli,
    spawn,
    buildRepoSpawnEnv,
    loadRepoEnvironments,
    DEFAULT_PLAYWRIGHT_ENV,
    listOptimizedSpecs,
    listOptimizedSpecEntries,
    specMeta,
  } = deps;

  function logMissingStorageHint(ws, repoRoot, envId, storageRel) {
    const avail = repoEnv.findAvailableProfileStorage(repoRoot, envId);
    if (avail) {
      logLine(
        ws,
        `[env] ${envId} 默认路径无登录态（${storageRel || '未配置'}）；可用角色 ${avail.profileId} → ${avail.storageState}`,
        'dim',
      );
      return;
    }
    logLine(
      ws,
      `[env] ${envId} 尚无登录态。请在侧栏「账号」登录，或在申请单流程 Golden/调试 Tab 为角色完成登录`,
      'warn',
    );
  }

  function sendAccountInfo(ws, session, repoRoot, repoReady) {
    if (!repoReady) {
      send(ws, 'account:info', {
        repoReady: false,
        profiles: [],
        current: 'default',
        hasStorage: false,
        storageState: '',
      });
      return;
    }
    const envId = getSessionPlaywrightEnv(session);
    const cfg = repoEnv.getEnvAccountConfig(repoRoot, envId);
    if (!session.accountProfile || (cfg && !cfg.profiles[session.accountProfile])) {
      session.accountProfile = cfg?.defaultProfile || 'default';
    }
    const profile = getSessionAccountProfile(session, repoRoot);
    const storageRel = repoEnv.resolveStorageStateRel(repoRoot, envId, profile);
    const flowProfileIds = [
      ...repoEnv.listGoldenProfileIds(repoRoot, envId),
      ...repoEnv.listWriteProfileIds(repoRoot, envId),
    ].filter((id) => {
      const profiles = repoEnv.getEnvAccountConfig(repoRoot, envId)?.profiles;
      return profiles?.[id] || id === 'write' || id === 'golden';
    });
    send(ws, 'account:info', {
      repoReady: true,
      env: envId,
      current: profile,
      defaultProfile: cfg?.defaultProfile || 'default',
      profiles: repoEnv.listAccountProfiles(repoRoot, envId),
      flowProfiles: repoEnv.listProfilesStorageStatus(repoRoot, envId, flowProfileIds),
      hasStorage: repoEnv.storageExists(repoRoot, storageRel),
      storageState: storageRel,
      hasAccountsFile: Boolean(cfg),
    });
  }

  function sendEnvInfo(ws, session, repoRoot, repoReady) {
    if (!repoReady) {
      send(ws, 'env:info', {
        defaultEnv: DEFAULT_PLAYWRIGHT_ENV,
        current: getSessionPlaywrightEnv(session),
        environments: [],
        repoReady: false,
      });
      return;
    }
    const info = loadRepoEnvironments(repoRoot);
    if (!session.playwrightEnv || !info.environments.some((e) => e.id === session.playwrightEnv)) {
      session.playwrightEnv = info.defaultEnv;
    }
    const profile = getSessionAccountProfile(session, repoRoot);
    const current = getEnvEntryResolved(repoRoot, session.playwrightEnv, profile);
    send(ws, 'env:info', {
      ...info,
      current: session.playwrightEnv,
      repoReady: true,
      baseURL: current?.baseURL || '',
      hasStorage: current?.hasStorage ?? false,
      hasAnyStorage: repoEnv.envHasAnyStorage(repoRoot, session.playwrightEnv),
      storageState: current?.storageState || '',
      accountProfile: profile,
    });
    sendAccountInfo(ws, session, repoRoot, true);
  }

  function clearSessionStorage(ws, session, profileOverride) {
    const repoRoot = resolveRepoRoot();
    if (!fs.existsSync(path.join(repoRoot, 'playwright.config.ts'))) {
      send(ws, 'error', { message: '未找到项目根，无法清除登录态' });
      return;
    }
    const envId = getSessionPlaywrightEnv(session);
    const profile = profileOverride
      ? repoEnv.resolveAccountProfile(repoRoot, envId, profileOverride)
      : getSessionAccountProfile(session, repoRoot);
    const storageRel = repoEnv.resolveStorageStateRel(repoRoot, envId, profile);
    if (!storageRel) {
      send(ws, 'error', { message: '当前环境未配置 storageState' });
      return;
    }
    const storageAbs = path.resolve(repoRoot, storageRel);
    let removed = false;
    if (fs.existsSync(storageAbs)) {
      try {
        fs.unlinkSync(storageAbs);
        removed = true;
      } catch (e) {
        send(ws, 'error', { message: `清除失败: ${errText(e)}` });
        return;
      }
    }
    if (removed) {
      logLine(ws, `[account] 已清除登录态: ${storageRel}`, 'ok');
    } else {
      logLine(ws, `[account] 登录态文件不存在: ${storageRel}`, 'dim');
    }
    send(ws, 'account:storage-cleared', {
      env: envId,
      profile,
      storageState: storageRel,
      hasStorage: false,
      removed,
    });
    const repoReady = true;
    sendEnvInfo(ws, session, repoRoot, repoReady);
    sendAccountInfo(ws, session, repoRoot, repoReady);
  }

  function setSessionAccountProfile(ws, session, profileId) {
    const repoRoot = resolveRepoRoot();
    if (!fs.existsSync(path.join(repoRoot, 'playwright.config.ts'))) {
      send(ws, 'error', { message: '未找到项目根，无法切换账号' });
      return;
    }
    const envId = getSessionPlaywrightEnv(session);
    const resolved = repoEnv.resolveAccountProfile(repoRoot, envId, profileId);
    session.accountProfile = resolved;
    const entry = getEnvEntryResolved(repoRoot, envId, resolved);
    send(ws, 'account:changed', {
      env: envId,
      profile: resolved,
      storageState: entry?.storageState || '',
      hasStorage: entry?.hasStorage ?? false,
    });
    logLine(ws, `[account] 已切换为 ${envId} / ${resolved}`, 'info');
    if (!entry?.hasStorage && entry?.storageState && !repoEnv.envHasAnyStorage(repoRoot, envId)) {
      logMissingStorageHint(ws, repoRoot, envId, entry.storageState);
    }
  }

  function runAccountLogin(ws, session, envOverride, profileOverride) {
    const repoRoot = resolveRepoRoot();
    const cli = getRepoPlaywrightCli(repoRoot);
    if (!cli) {
      send(ws, 'error', { message: '未找到 @playwright/test，请在项目根执行 npm install' });
      return Promise.resolve();
    }
    const envId = envOverride || getSessionPlaywrightEnv(session);
    const profile = repoEnv.resolveAccountProfile(
      repoRoot,
      envId,
      profileOverride || session.accountProfile,
    );
    const storageRel = repoEnv.resolveStorageStateRel(repoRoot, envId, profile);

    logLine(ws, `[account] 正在登录 ${envId} / ${profile}…`, 'info');
    send(ws, 'account:login:start', { env: envId, profile });

    return new Promise((resolve) => {
      const proc = spawn(
        process.execPath,
        [
          cli,
          'test',
          'src/setup/login.setup.ts',
          '--project=setup',
          '--retries=0',
          '--timeout=120000',
        ],
        {
          cwd: repoRoot,
          env: {
            ...buildRepoSpawnEnv(session, undefined, envOverride),
            PLAYWRIGHT_REFRESH_STORAGE: '1',
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );

      proc.stdout.on('data', (d) => {
        const text = d.toString().trim();
        if (text) logLine(ws, text, 'dim');
      });
      proc.stderr.on('data', (d) => {
        const text = d.toString().trim();
        if (text) logLine(ws, text, 'warn');
      });

      proc.on('close', (code) => {
        const ok = code === 0 && repoEnv.storageExists(repoRoot, storageRel);
        send(ws, 'account:login:done', {
          env: envId,
          profile,
          exitCode: code,
          ok,
          storageState: storageRel,
          hasStorage: ok,
        });
        if (ok) {
          logLine(ws, `[account] 登录成功: ${storageRel}`, 'ok');
          send(ws, 'env:storage-saved', { env: envId, storageState: storageRel, hasStorage: true });
        } else {
          logLine(ws, `[account] 登录失败（退出码 ${code}）`, 'err');
        }
        const repoReady = fs.existsSync(path.join(repoRoot, 'playwright.config.ts'));
        sendEnvInfo(ws, session, repoRoot, repoReady);
        sendAccountInfo(ws, session, repoRoot, repoReady);
        resolve();
      });
    });
  }

  function setSessionPlaywrightEnv(ws, session, envId) {
    const repoRoot = resolveRepoRoot();
    const repoReady = fs.existsSync(path.join(repoRoot, 'playwright.config.ts'));
    if (!repoReady) {
      send(ws, 'error', { message: '未找到项目根，无法切换环境' });
      return;
    }
    const info = loadRepoEnvironments(repoRoot);
    const entry = info.environments.find((e) => e.id === envId);
    if (!entry) {
      send(ws, 'error', { message: `未知环境: ${envId}` });
      return;
    }
    if (session.playwrightEnv === entry.id) {
      return;
    }
    session.playwrightEnv = entry.id;
    const cfg = repoEnv.getEnvAccountConfig(repoRoot, entry.id);
    session.accountProfile = cfg?.defaultProfile || 'default';
    const resolved = getEnvEntryResolved(repoRoot, entry.id, session.accountProfile);
    if (!resolved?.hasStorage && !repoEnv.envHasAnyStorage(repoRoot, entry.id)) {
      logMissingStorageHint(ws, repoRoot, entry.id, resolved?.storageState || entry.storageState);
    }
    send(ws, 'env:changed', {
      env: entry.id,
      baseURL: entry.baseURL,
      storageState: resolved?.storageState || '',
      hasStorage: resolved?.hasStorage ?? false,
      hasAnyStorage: repoEnv.envHasAnyStorage(repoRoot, entry.id),
      accountProfile: session.accountProfile,
      optimizedSpecs: listOptimizedSpecs(repoRoot, { limit: 40, env: entry.id }),
      optimizedSpecEntries: listOptimizedSpecEntries(repoRoot, { limit: 40, env: entry.id }),
      profileCounts: specMeta.summarizeProfileCounts(
        listOptimizedSpecEntries(repoRoot, { limit: 200, env: entry.id }),
      ),
    });
    sendAccountInfo(ws, session, repoRoot, true);
    logLine(ws, `[env] 已切换为 ${entry.id} · ${entry.baseURL}`, 'info');
  }

  function addGoldenProfileEntry(ws, session, envOverride, opts = {}) {
    const repoRoot = resolveRepoRoot();
    if (!fs.existsSync(path.join(repoRoot, 'playwright.config.ts'))) {
      send(ws, 'error', { message: '未找到项目根，无法新增 Golden 档案' });
      return;
    }
    const envId = envOverride || getSessionPlaywrightEnv(session);
    const result = repoEnv.addGoldenProfile(repoRoot, envId, opts);
    if (!result.ok) {
      send(ws, 'error', { message: result.error || '新增 Golden 档案失败' });
      return;
    }
    const repoReady = true;
    send(ws, 'account:golden-profile-added', {
      env: envId,
      profile: result.profileId,
      label: result.label,
      storageState: result.storageState || '',
      hasStorage: repoEnv.storageExists(repoRoot, result.storageState),
    });
    logLine(ws, `[account] 已新增 Golden 档案 ${envId}/${result.profileId}`, 'ok');
    if (result.initializedAccounts) {
      logLine(ws, `[account] 已自动补全 datasource/accounts.json（环境 ${envId}）`, 'info');
    }
    sendEnvInfo(ws, session, repoRoot, repoReady);
    sendAccountInfo(ws, session, repoRoot, repoReady);
  }

  function removeGoldenProfileEntry(ws, session, envOverride, profileId) {
    const repoRoot = resolveRepoRoot();
    if (!fs.existsSync(path.join(repoRoot, 'playwright.config.ts'))) {
      send(ws, 'error', { message: '未找到项目根，无法删除 Golden 档案' });
      return;
    }
    const envId = envOverride || getSessionPlaywrightEnv(session);
    const prof = String(profileId || '').trim();
    if (!prof) {
      send(ws, 'error', { message: '缺少 profile' });
      return;
    }
    const result = repoEnv.removeGoldenProfile(repoRoot, envId, prof);
    if (!result.ok) {
      send(ws, 'error', { message: result.error || '删除 Golden 档案失败' });
      return;
    }
    const repoReady = true;
    send(ws, 'account:golden-profile-removed', {
      env: envId,
      profile: result.profileId,
      label: result.label,
      storageState: result.storageState || '',
      removedStorage: Boolean(result.removedStorage),
    });
    logLine(ws, `[account] 已删除 Golden 档案 ${envId}/${result.profileId}`, 'ok');
    sendEnvInfo(ws, session, repoRoot, repoReady);
    sendAccountInfo(ws, session, repoRoot, repoReady);
  }

  function addWriteProfileEntry(ws, session, envOverride, opts = {}) {
    const repoRoot = resolveRepoRoot();
    if (!fs.existsSync(path.join(repoRoot, 'playwright.config.ts'))) {
      send(ws, 'error', { message: '未找到项目根，无法新增 write 档案' });
      return;
    }
    const envId = envOverride || getSessionPlaywrightEnv(session);
    const result = repoEnv.addWriteProfile(repoRoot, envId, opts);
    if (!result.ok) {
      send(ws, 'error', { message: result.error || '新增 write 档案失败' });
      return;
    }
    const repoReady = true;
    send(ws, 'account:write-profile-added', {
      env: envId,
      profile: result.profileId,
      label: result.label,
      storageState: result.storageState || '',
      hasStorage: repoEnv.storageExists(repoRoot, result.storageState),
    });
    logLine(ws, `[account] 已新增 write 档案 ${envId}/${result.profileId}`, 'ok');
    if (result.initializedAccounts) {
      logLine(ws, `[account] 已自动补全 datasource/accounts.json（环境 ${envId}）`, 'info');
    }
    sendEnvInfo(ws, session, repoRoot, repoReady);
    sendAccountInfo(ws, session, repoRoot, repoReady);
  }

  function removeWriteProfileEntry(ws, session, envOverride, profileId) {
    const repoRoot = resolveRepoRoot();
    if (!fs.existsSync(path.join(repoRoot, 'playwright.config.ts'))) {
      send(ws, 'error', { message: '未找到项目根，无法删除 write 档案' });
      return;
    }
    const envId = envOverride || getSessionPlaywrightEnv(session);
    const prof = String(profileId || '').trim();
    if (!prof) {
      send(ws, 'error', { message: '缺少 profile' });
      return;
    }
    const result = repoEnv.removeWriteProfile(repoRoot, envId, prof);
    if (!result.ok) {
      send(ws, 'error', { message: result.error || '删除 write 档案失败' });
      return;
    }
    const repoReady = true;
    send(ws, 'account:write-profile-removed', {
      env: envId,
      profile: result.profileId,
      label: result.label,
      storageState: result.storageState || '',
      removedStorage: Boolean(result.removedStorage),
    });
    logLine(ws, `[account] 已删除 write 档案 ${envId}/${result.profileId}`, 'ok');
    sendEnvInfo(ws, session, repoRoot, repoReady);
    sendAccountInfo(ws, session, repoRoot, repoReady);
  }

  return {
    sendAccountInfo,
    sendEnvInfo,
    clearSessionStorage,
    setSessionAccountProfile,
    runAccountLogin,
    setSessionPlaywrightEnv,
    addGoldenProfileEntry,
    removeGoldenProfileEntry,
    addWriteProfileEntry,
    removeWriteProfileEntry,
  };
}

module.exports = { createAccountEnvActions };
