const fs = require('fs');
const path = require('path');
const { assertAllowedOptimizedSpec, assertAllowedSavePath } = require('./repo-paths');

const STUDIO_DRAFT_STEM = 'studio-auto';
const LEGACY_STUDIO_DRAFT_STEM = 'studio-unsaved-draft';
const DRAFT_OPTIMIZED_RELATIVE = `tests/optimized/${STUDIO_DRAFT_STEM}.optimized.spec.ts`;

function isDraftRecordingPath(relativePath) {
  const norm = (relativePath || '').trim().replace(/\\/g, '/');
  const base = path.basename(norm);
  return (
    base === `${STUDIO_DRAFT_STEM}.spec.ts` ||
    base === `${LEGACY_STUDIO_DRAFT_STEM}.spec.ts` ||
    base.startsWith(`${STUDIO_DRAFT_STEM}_`) && base.endsWith('.spec.ts')
  );
}

function isDraftOptimizedPath(relativePath) {
  const norm = (relativePath || '').trim().replace(/\\/g, '/');
  const base = path.basename(norm);
  return (
    base === `${STUDIO_DRAFT_STEM}.optimized.spec.ts` ||
    base === `${LEGACY_STUDIO_DRAFT_STEM}.optimized.spec.ts` ||
    base.startsWith(`${STUDIO_DRAFT_STEM}_`) && base.endsWith('.optimized.spec.ts')
  );
}

function hasDraftRecordingInRepo(repoRoot) {
  const base = path.join(repoRoot, 'tests/raw-recordings/original');
  if (!fs.existsSync(base)) return false;
  const walk = (dir) => {
    let ents;
    try {
      ents = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return false;
    }
    for (const ent of ents) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (walk(full)) return true;
      } else if (ent.isFile() && isDraftRecordingPath(ent.name)) {
        return true;
      }
    }
    return false;
  };
  return walk(base);
}

function hasDraftOptimizedInRepo(repoRoot) {
  const base = path.join(repoRoot, 'tests', 'optimized');
  if (!fs.existsSync(base)) return false;
  const walk = (dir) => {
    let ents;
    try {
      ents = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return false;
    }
    for (const ent of ents) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (walk(full)) return true;
      } else if (ent.isFile() && isDraftOptimizedPath(ent.name)) {
        return true;
      }
    }
    return false;
  };
  return walk(base);
}

function syncDraftOptimizedFromEditor(repoRoot, optimizedCode, specRel = DRAFT_OPTIMIZED_RELATIVE) {
  const code = String(optimizedCode || '');
  if (!code.trim()) return;
  const abs = assertAllowedOptimizedSpec(repoRoot, specRel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, code, 'utf8');
}

function buildDraftRecordingRelative(resolved) {
  return resolved.relativePath.replace(/\\/g, '/');
}

async function ensureDraftRecordingPath(repoRoot, session, { code, name, description }, deps) {
  const {
    resolveRecordingPathViaRepo,
    getSessionPlaywrightEnv,
    spawn,
    writeSpecMetaForSession,
  } = deps;
  const resolved = await resolveRecordingPathViaRepo(repoRoot, {
    code,
    name,
    description,
    target: 'original',
    playwrightEnv: getSessionPlaywrightEnv(session),
  }, spawn);
  const draftRelative = buildDraftRecordingRelative(resolved);
  const abs = assertAllowedSavePath(repoRoot, draftRelative);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, String(code || ''), 'utf8');
  try {
    writeSpecMetaForSession(repoRoot, session, { rawRel: draftRelative, rawCode: code });
  } catch {
    /* meta 写入失败不阻断草稿 */
  }
  return { draftRelative, formalHint: resolved.relativePath };
}

function removeDraftRecordingIfAny(repoRoot, session) {
  const draftRel = session.draftRelativePath;
  if (!draftRel) return;
  try {
    const draftAbs = assertAllowedSavePath(repoRoot, draftRel);
    if (fs.existsSync(draftAbs)) fs.unlinkSync(draftAbs);
  } catch {
    /* ignore */
  }
  session.draftRelativePath = null;
}

function isPlaceholderRecordingPath(relativePath) {
  const norm = (relativePath || '').trim().replace(/\\/g, '/');
  if (!norm) return true;
  if (isDraftRecordingPath(norm)) return true;
  if (/studio-recording\.spec\.ts$/i.test(norm)) return true;
  if (/tests\/raw-recordings\/original\/\d{6,8}\/studio-recording\.spec\.ts$/i.test(norm)) {
    return true;
  }
  return false;
}

/** 正式保存后清理所有 studio-auto / studio-unsaved-draft 优化草稿（含 env 子目录） */
function removeDraftOptimizedArtifacts(repoRoot) {
  const base = path.join(repoRoot, 'tests', 'optimized');
  if (!fs.existsSync(base)) return;
  const removed = [];
  const walk = (dir) => {
    let ents;
    try {
      ents = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of ents) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (ent.isFile() && isDraftOptimizedPath(path.relative(repoRoot, full).split(path.sep).join('/'))) {
        try {
          fs.unlinkSync(full);
          removed.push(path.relative(repoRoot, full).split(path.sep).join('/'));
        } catch {
          /* ignore */
        }
      }
    }
  };
  walk(base);
  return removed;
}

module.exports = {
  STUDIO_DRAFT_STEM,
  LEGACY_STUDIO_DRAFT_STEM,
  DRAFT_OPTIMIZED_RELATIVE,
  isDraftRecordingPath,
  isDraftOptimizedPath,
  hasDraftRecordingInRepo,
  hasDraftOptimizedInRepo,
  syncDraftOptimizedFromEditor,
  buildDraftRecordingRelative,
  isPlaceholderRecordingPath,
  ensureDraftRecordingPath,
  removeDraftRecordingIfAny,
  removeDraftOptimizedArtifacts,
};
