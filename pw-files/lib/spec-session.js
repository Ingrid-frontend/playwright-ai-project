const fs = require('fs');
const path = require('path');

function createSpecSessionHelpers(deps) {
  const {
    specMeta,
    repoEnv,
    getSessionPlaywrightEnv,
    getSessionAccountProfile,
    resolveRepoRoot,
    logLine,
    runAccountLogin,
    isDraftOptimizedPath,
  } = deps;

  function resolveSpecAccountProfile(repoRoot, specRel) {
    return specMeta.resolveOptimizedSpecMeta(repoRoot, specRel).accountProfile;
  }

  function writeSpecMetaForSession(repoRoot, session, { rawRel, optimizedRel, rawCode, optCode }) {
    const envId = getSessionPlaywrightEnv(session);
    const profile = getSessionAccountProfile(session, repoRoot);
    const storageRel = repoEnv.resolveStorageStateRel(repoRoot, envId, profile);
    const storageAbs = path.join(repoRoot, storageRel);
    const sessionMeta = {
      playwrightEnv: envId,
      accountProfile: profile,
      code: rawCode || optCode || '',
      storageAbs: fs.existsSync(storageAbs) ? storageAbs : null,
      storageStateRel: storageRel,
      recordSource: 'studio',
      rawOriginalRel: rawRel || null,
      optimizedRel: optimizedRel || null,
    };
    if (rawRel) {
      specMeta.writeRawSpecMetaFromSession(repoRoot, rawRel, sessionMeta);
    }
    if (optimizedRel) {
      const meta = specMeta.copyRawMetaToOptimized(repoRoot, rawRel || optimizedRel, optimizedRel, {
        playwrightEnv: envId,
        accountProfile: profile,
        code: rawCode || optCode,
        storageAbs: sessionMeta.storageAbs,
        recordSource: 'studio',
      });
      try {
        const abs = path.join(repoRoot, optimizedRel);
        if (fs.existsSync(abs)) {
          const withHeader = specMeta.appendSpecMetaHeaderToCode(fs.readFileSync(abs, 'utf8'), meta);
          fs.writeFileSync(abs, withHeader, 'utf8');
        }
      } catch {
        /* ignore header append */
      }
    }
  }

  async function ensureAccountLoginForProfile(ws, session, profileId, envOverride) {
    const repoRoot = resolveRepoRoot();
    const envId = envOverride || getSessionPlaywrightEnv(session);
    const profile = repoEnv.resolveAccountProfile(repoRoot, envId, profileId);
    const storageRel = repoEnv.resolveStorageStateRel(repoRoot, envId, profile);
    if (repoEnv.storageExists(repoRoot, storageRel)) {
      return { ok: true, profile, skipped: true };
    }
    logLine(ws, `[account] 档案 ${profile} 无登录态，正在登录…`, 'warn');
    const savedProfile = session.accountProfile;
    session.accountProfile = profile;
    try {
      await runAccountLogin(ws, session, envOverride);
      const ok = repoEnv.storageExists(repoRoot, storageRel);
      return { ok, profile, skipped: false };
    } finally {
      session.accountProfile = savedProfile;
    }
  }

  async function ensureSpecAccountReady(ws, session, specRel) {
    if (isDraftOptimizedPath(specRel)) return { ok: true, profile: null };
    const repoRoot = resolveRepoRoot();
    const meta = specMeta.resolveOptimizedSpecMeta(repoRoot, specRel);
    if (!meta.accountProfile || meta.accountProfile === specMeta.UNKNOWN_PROFILE) {
      return { ok: true, profile: null };
    }
    return ensureAccountLoginForProfile(ws, session, meta.accountProfile);
  }

  return {
    resolveSpecAccountProfile,
    writeSpecMetaForSession,
    ensureAccountLoginForProfile,
    ensureSpecAccountReady,
  };
}

module.exports = { createSpecSessionHelpers };
