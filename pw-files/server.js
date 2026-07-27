/**
 * Playwright Studio — Backend Server
 * 
 * 依赖：
 *   npm install express ws @anthropic-ai/sdk @playwright/test
 *
 * 运行：
 *   ANTHROPIC_API_KEY=sk-xxx node server.js
 *   或 DEEPSEEK_API_KEY=sk-xxx node server.js（可与 Claude 并存，由前端或默认策略选择）
 *   也可在网页侧栏输入密钥（仅存当前 WebSocket 会话内存，不写盘、不写入日志）
 */

const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile, spawn } = require('child_process');
const express = require('express');
const { WebSocketServer } = require('ws');
const Anthropic = require('@anthropic-ai/sdk');
const repoEnv = require('./repo-env');
const { postprocessRecordedScript } = require(path.join(__dirname, '../src/utils/strip-login-from-recording.cjs'));
const { annotateStorageStateMeta } = require(path.join(__dirname, '../src/utils/storage-state-meta.cjs'));
const { extractFromCode } = require(path.join(__dirname, '../src/utils/extract-login-account.cjs'));
const {
  normalizeDateCategoryList,
  isDateCategoryDirSegment,
} = require(path.join(__dirname, '../src/utils/date-category.cjs'));
const {
  specMatchesEnv,
  buildOptimizedRel,
  parseEnvFromSpecRel,
  parseRawOriginalRel,
  listKnownEnvs,
  isKnownEnv,
  assertSpecEnvMatch,
  getLegacyEnvDefault,
  rewriteOptimizedSpecImports,
} = require(path.join(__dirname, '../src/utils/test-env-path.cjs'));
const { cleanSpecScreenshots } = require(path.join(__dirname, '../src/utils/clean-spec-screenshots.cjs'));
const specMeta = require(path.join(__dirname, '../src/utils/spec-meta.cjs'));
const {
  DEFAULT_PLAYWRIGHT_ENV,
  resolveRepoRoot,
  loadRepoEnvironments,
  getSessionPlaywrightEnv,
  getEnvEntry,
  getSessionAccountProfile,
  getEnvEntryResolved,
  buildRepoSpawnEnv,
  buildStudioRunEnv,
} = require('./lib/repo-context');
const { send, logLine, now, stripAnsi, errText } = require('./lib/ws-safe');

const PORT = process.env.PORT || 3001;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const DEEPSEEK_API_BASE = (process.env.DEEPSEEK_API_BASE || 'https://api.deepseek.com').replace(/\/$/, '');
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
/** 直接执行 CLI，避免 spawn(..., { shell: true }) + 参数数组触发 Node DEP0190 */
const PLAYWRIGHT_CLI = path.join(__dirname, 'node_modules', '@playwright', 'test', 'cli.js');

// repo-context / ws-safe 见 ./lib/

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
  send(ws, 'account:info', {
    repoReady: true,
    env: envId,
    current: profile,
    defaultProfile: cfg?.defaultProfile || 'default',
    profiles: repoEnv.listAccountProfiles(repoRoot, envId),
    hasStorage: repoEnv.storageExists(repoRoot, storageRel),
    storageState: storageRel,
    hasAccountsFile: Boolean(cfg),
  });
}

function clearSessionStorage(ws, session) {
  const repoRoot = resolveRepoRoot();
  if (!fs.existsSync(path.join(repoRoot, 'playwright.config.ts'))) {
    send(ws, 'error', { message: '未找到项目根，无法清除登录态' });
    return;
  }
  const envId = getSessionPlaywrightEnv(session);
  const profile = getSessionAccountProfile(session, repoRoot);
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
  if (!entry?.hasStorage && entry?.storageState) {
    logLine(ws, `[account] 未找到 ${entry.storageState}，请开始录制后在浏览器登录并停止录制`, 'warn');
  }
}

function runAccountLogin(ws, session) {
  const repoRoot = resolveRepoRoot();
  const cli = getRepoPlaywrightCli(repoRoot);
  if (!cli) {
    send(ws, 'error', { message: '未找到 @playwright/test，请在项目根执行 npm install' });
    return Promise.resolve();
  }
  const envId = getSessionPlaywrightEnv(session);
  const profile = getSessionAccountProfile(session, repoRoot);
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
          ...buildRepoSpawnEnv(session),
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
    storageState: current?.storageState || '',
    accountProfile: profile,
  });
  sendAccountInfo(ws, session, repoRoot, true);
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
  session.playwrightEnv = entry.id;
  const cfg = repoEnv.getEnvAccountConfig(repoRoot, entry.id);
  session.accountProfile = cfg?.defaultProfile || 'default';
  const resolved = getEnvEntryResolved(repoRoot, entry.id, session.accountProfile);
  if (!resolved?.hasStorage) {
    logLine(
      ws,
      `[env] ${entry.id} 的 storageState 不存在: ${resolved?.storageState || entry.storageState}，请开始录制后在浏览器登录并停止录制`,
      'warn',
    );
  }
  send(ws, 'env:changed', {
    env: entry.id,
    baseURL: entry.baseURL,
    storageState: resolved?.storageState || '',
    hasStorage: resolved?.hasStorage ?? false,
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

function getRepoPlaywrightCli(repoRoot) {
  const p = path.join(repoRoot, 'node_modules', '@playwright', 'test', 'cli.js');
  return fs.existsSync(p) ? p : null;
}

function assertAllowedSavePath(repoRoot, relativePath) {
  const norm = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
  if (norm.includes('..') || norm.split('/').some((s) => s === '..')) {
    throw new Error('路径非法：禁止 ..');
  }
  if (!norm.startsWith('tests/raw-recordings/original/')) {
    throw new Error('仅允许写入 tests/raw-recordings/original/ 下');
  }
  const abs = path.resolve(repoRoot, norm);
  const base = path.resolve(repoRoot, 'tests', 'raw-recordings', 'original');
  if (!abs.startsWith(base + path.sep) && abs !== base) {
    throw new Error('解析路径超出允许目录');
  }
  return abs;
}

function assertAllowedOptimizedSpec(repoRoot, relativePath) {
  const norm = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
  if (norm.includes('..')) throw new Error('路径非法');
  if (!norm.startsWith('tests/optimized/')) {
    throw new Error('仅允许执行 tests/optimized/ 下的用例');
  }
  const abs = path.resolve(repoRoot, norm);
  const base = path.resolve(repoRoot, 'tests', 'optimized');
  if (!abs.startsWith(base + path.sep) && abs !== base) {
    throw new Error('解析路径超出 tests/optimized');
  }
  if (!abs.endsWith('.spec.ts')) throw new Error('须为 .spec.ts');
  return abs;
}

/**
 * 列出 tests/optimized 下 *.optimized.spec.ts（按 mtime 倒序）。
 * @param {{ limit?: number, sinceMs?: number, nameIncludes?: string }} opts
 *   sinceMs — 仅保留该时刻前后约 3s 内更新的文件（pipeline 刚结束）；不传则不过滤时间
 */
function listOptimizedSpecs(repoRoot, opts = {}) {
  const limit = opts.limit ?? 40;
  const sinceMs = opts.sinceMs;
  const nameIncludes = opts.nameIncludes;
  const envFilter = opts.env != null ? String(opts.env).trim() : null;
  const base = path.join(repoRoot, 'tests', 'optimized');
  if (!fs.existsSync(base)) return [];
  const found = [];
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
      else if (ent.isFile() && ent.name.endsWith('.optimized.spec.ts')) {
        try {
          const st = fs.statSync(full);
          if (sinceMs != null && st.mtimeMs < sinceMs - 3000) continue;
          const rel = path.relative(repoRoot, full).split(path.sep).join('/');
          if (nameIncludes && !rel.includes(nameIncludes)) continue;
          if (envFilter && !specMatchesEnv(rel, envFilter, repoRoot)) continue;
          found.push({ rel, mtime: st.mtimeMs });
        } catch {
          /* ignore */
        }
      }
    }
  };
  walk(base);
  found.sort((a, b) => b.mtime - a.mtime);
  return found.slice(0, limit).map((x) => x.rel);
}

/** 列出 optimized 用例并附带账号档案等元数据 */
function listOptimizedSpecEntries(repoRoot, opts = {}) {
  const rels = listOptimizedSpecs(repoRoot, opts);
  const accountFilter = opts.accountProfile != null ? String(opts.accountProfile).trim() : null;
  let entries = rels.map((rel) => specMeta.enrichOptimizedSpecEntry(repoRoot, rel));
  if (accountFilter && accountFilter !== 'all') {
    entries = entries.filter((e) => e.accountProfile === accountFilter);
  }
  return entries;
}

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

async function ensureAccountLoginForProfile(ws, session, profileId) {
  const repoRoot = resolveRepoRoot();
  const envId = getSessionPlaywrightEnv(session);
  const profile = repoEnv.resolveAccountProfile(repoRoot, envId, profileId);
  const storageRel = repoEnv.resolveStorageStateRel(repoRoot, envId, profile);
  if (repoEnv.storageExists(repoRoot, storageRel)) {
    return { ok: true, profile, skipped: true };
  }
  logLine(ws, `[account] 档案 ${profile} 无登录态，正在登录…`, 'warn');
  const savedProfile = session.accountProfile;
  session.accountProfile = profile;
  try {
    await runAccountLogin(ws, session);
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

/** 根据 raw original 路径推断 optimized 产物位置（pipeline 刚结束时优先用） */
function findOptimizedCandidatesForRawTarget(repoRoot, targetRelative, sessionEnv) {
  const norm = String(targetRelative || '').replace(/\\/g, '/');
  if (!norm.endsWith('.spec.ts')) return [];
  const parsed = parseRawOriginalRel(norm, repoRoot);
  const stem = path.basename(norm, '.spec.ts');
  const env = parsed?.env || sessionEnv || getLegacyEnvDefault(repoRoot);
  const dateCategory = parsed?.dateCategory || '';
  const relCandidates = [];
  if (parsed) {
    relCandidates.push(buildOptimizedRel({ playwrightEnv: env, dateCategory, stem, repoRoot }));
    if (dateCategory) {
      relCandidates.push(buildOptimizedRel({ playwrightEnv: env, dateCategory: '', stem, repoRoot }));
    }
  }
  if (dateCategory) {
    relCandidates.push(`tests/optimized/${dateCategory}/${stem}.optimized.spec.ts`);
    relCandidates.push(`tests/optimized/${env}/${dateCategory}/${stem}.optimized.spec.ts`);
    relCandidates.push(`tests/optimized/${env}/${stem}.optimized.spec.ts`);
  }
  relCandidates.push(`tests/optimized/${stem}.optimized.spec.ts`);

  const out = [];
  const seen = new Set();
  for (const rel of relCandidates) {
    if (!rel || seen.has(rel)) continue;
    seen.add(rel);
    try {
      const abs = assertAllowedOptimizedSpec(repoRoot, rel);
      if (fs.existsSync(abs)) out.push(rel);
    } catch {
      /* skip invalid */
    }
  }
  return out;
}

/** pipeline 结束后：优先本次新生成/更新的，否则回退为仓库内最近用例，并按保存文件名优先匹配 */
function resolveOptimizedSpecsAfterPipeline(repoRoot, sinceMs, targetRelative, env) {
  const parsedTarget = parseRawOriginalRel(String(targetRelative || '').replace(/\\/g, '/'), repoRoot);
  const envFilter = (parsedTarget?.env || env || getLegacyEnvDefault(repoRoot)).trim();
  const fromTarget = findOptimizedCandidatesForRawTarget(repoRoot, targetRelative, envFilter);
  let specs = [...fromTarget];
  let recent = listOptimizedSpecs(repoRoot, { sinceMs, limit: 12, env: envFilter });
  const stem = targetRelative && targetRelative.endsWith('.spec.ts')
    ? path.basename(targetRelative, '.spec.ts')
    : '';
  if (stem) {
    const byName = listOptimizedSpecs(repoRoot, { limit: 50, nameIncludes: stem, env: envFilter });
    if (byName.length) {
      recent = [...new Set([...byName, ...recent])];
    }
  }
  if (recent.length === 0) {
    recent = listOptimizedSpecs(repoRoot, { limit: 40, env: envFilter });
  }
  if (recent.length === 0 && envFilter) {
    recent = listOptimizedSpecs(repoRoot, { limit: 40, nameIncludes: stem || undefined });
  }
  specs = [...new Set([...specs, ...recent])];
  return specs.slice(0, 40);
}

const DATE_CATEGORIES_REL = 'config/date-categories.json';

function resolveDateCategoriesPath(repoRoot) {
  const abs = path.resolve(repoRoot, DATE_CATEGORIES_REL);
  const base = path.resolve(repoRoot, 'config');
  if (!abs.startsWith(base + path.sep) && abs !== base) {
    throw new Error('路径超出 config 目录');
  }
  return abs;
}

function loadDateCategoriesFile(repoRoot) {
  const abs = resolveDateCategoriesPath(repoRoot);
  if (!fs.existsSync(abs)) {
    return {
      dateCategories: [],
      description:
        '日期分类配置，文件会根据创建日期归类到对应的文件夹。规则：早于第一个日期的文件归到第一个文件夹，在两个日期之间的文件归到后一个日期的文件夹。',
      example: { fileDate: '2026-03-16', category: '260313', reason: '早于 2026-03-13' },
      note: '目录名为 YYMMDD（6 位），如 260313；分类按完整日历日比较',
    };
  }
  const raw = fs.readFileSync(abs, 'utf8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed.dateCategories)) {
    throw new Error('date-categories.json 缺少 dateCategories 数组');
  }
  return parsed;
}

async function configGetDateCategories(ws) {
  const repoRoot = resolveRepoRoot();
  if (!fs.existsSync(path.join(repoRoot, 'playwright.config.ts'))) {
    send(ws, 'error', { message: '未找到项目根，无法读取日期分类' });
    return;
  }
  try {
    const config = loadDateCategoriesFile(repoRoot);
    const dateCategories = normalizeDateCategoryList(config.dateCategories);
    send(ws, 'config:date-categories:done', {
      dateCategories,
      description: config.description || '',
      configPath: DATE_CATEGORIES_REL,
      repoRoot,
    });
  } catch (e) {
    send(ws, 'error', { message: `读取失败: ${errText(e)}` });
  }
}

async function configSaveDateCategories(ws, msg) {
  const repoRoot = resolveRepoRoot();
  if (!fs.existsSync(path.join(repoRoot, 'playwright.config.ts'))) {
    send(ws, 'error', { message: '未找到项目根，无法保存日期分类' });
    return;
  }
  try {
    const dateCategories = normalizeDateCategoryList(msg.dateCategories);
    const existing = loadDateCategoriesFile(repoRoot);
    const next = { ...existing, dateCategories };
    const abs = resolveDateCategoriesPath(repoRoot);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    send(ws, 'config:date-categories:saved', { dateCategories, configPath: DATE_CATEGORIES_REL });
    logLine(ws, `[config] 已保存 ${DATE_CATEGORIES_REL}`, 'ok');
  } catch (e) {
    send(ws, 'error', { message: errText(e) });
  }
}

const DRAFT_RECORDING_BASENAME = 'studio-unsaved-draft.spec.ts';
const DRAFT_OPTIMIZED_BASENAME = 'studio-unsaved-draft.optimized.spec.ts';
const DRAFT_OPTIMIZED_RELATIVE = `tests/optimized/${DRAFT_OPTIMIZED_BASENAME}`;

/** 与 playwright.config.ts 中 optimized 相关 project 一致 */
const REPO_OPTIMIZED_PROJECTS = [
  { id: 'optimized', label: 'Chrome' },
  { id: 'optimized-webkit', label: 'Safari (WebKit)' },
  { id: 'optimized-firefox', label: 'Firefox' },
];
const DEFAULT_REPO_TEST_PROJECTS = REPO_OPTIMIZED_PROJECTS.map((p) => p.id);

function normalizeRepoTestProjects(projects) {
  const allowed = new Set(REPO_OPTIMIZED_PROJECTS.map((p) => p.id));
  const list = (Array.isArray(projects) ? projects : [])
    .map((p) => String(p || '').trim())
    .filter((p) => allowed.has(p));
  return list.length ? [...new Set(list)] : [...DEFAULT_REPO_TEST_PROJECTS];
}

function appendRepoTestProjectArgs(args, projects) {
  for (const p of normalizeRepoTestProjects(projects)) {
    args.push('--project', p);
  }
}

function formatRepoTestProjectsLog(projects) {
  return normalizeRepoTestProjects(projects).join(', ');
}

function isDraftRecordingPath(relativePath) {
  const norm = (relativePath || '').trim().replace(/\\/g, '/');
  return /studio-unsaved-draft\.spec\.ts$/i.test(norm);
}

function isDraftOptimizedPath(relativePath) {
  const norm = (relativePath || '').trim().replace(/\\/g, '/');
  return norm === DRAFT_OPTIMIZED_RELATIVE || /studio-unsaved-draft\.optimized\.spec\.ts$/i.test(norm);
}

function hasDraftRecordingInRepo(repoRoot) {
  const base = path.join(repoRoot, 'tests/raw-recordings/original');
  if (!fs.existsSync(base)) return false;
  try {
    for (const ent of fs.readdirSync(base, { withFileTypes: true })) {
      if (!ent.isDirectory()) continue;
      const p = path.join(base, ent.name, DRAFT_RECORDING_BASENAME);
      if (fs.existsSync(p)) return true;
    }
  } catch {
    return false;
  }
  return false;
}

/** pipeline 后将产物归并到固定草稿 optimized 路径，供 Studio 执行流程使用 */
function ensureDraftOptimizedAtCanonical(repoRoot, sinceMs, targetRelative, env) {
  const canonicalAbs = assertAllowedOptimizedSpec(repoRoot, DRAFT_OPTIMIZED_RELATIVE);
  const fromTarget = findOptimizedCandidatesForRawTarget(repoRoot, targetRelative, env);
  const recent = resolveOptimizedSpecsAfterPipeline(repoRoot, sinceMs, targetRelative, env);
  const pipelineFresh =
    fromTarget[0] ||
    recent.find((s) => s !== DRAFT_OPTIMIZED_RELATIVE) ||
    recent[0] ||
    null;
  const srcRel = pipelineFresh;
  if (!srcRel) {
    return fs.existsSync(canonicalAbs) ? DRAFT_OPTIMIZED_RELATIVE : null;
  }
  if (srcRel === DRAFT_OPTIMIZED_RELATIVE && fs.existsSync(canonicalAbs)) {
    return DRAFT_OPTIMIZED_RELATIVE;
  }
  try {
    const srcAbs = assertAllowedOptimizedSpec(repoRoot, srcRel);
    fs.mkdirSync(path.dirname(canonicalAbs), { recursive: true });
    fs.copyFileSync(srcAbs, canonicalAbs);
    if (srcRel !== DRAFT_OPTIMIZED_RELATIVE && isDraftOptimizedPath(srcRel)) {
      try {
        fs.unlinkSync(srcAbs);
      } catch {
        /* ignore */
      }
    }
    return DRAFT_OPTIMIZED_RELATIVE;
  } catch {
    return fs.existsSync(canonicalAbs) ? DRAFT_OPTIMIZED_RELATIVE : null;
  }
}

function readOptimizedCodeAfterPipeline(repoRoot, draftRel, optimizedSpecs) {
  const candidates = [
    draftRel,
    ...(Array.isArray(optimizedSpecs) ? optimizedSpecs : []),
  ].filter(Boolean);
  const seen = new Set();
  for (const rel of candidates) {
    const norm = String(rel).replace(/\\/g, '/');
    if (seen.has(norm)) continue;
    seen.add(norm);
    try {
      const code = fs.readFileSync(assertAllowedOptimizedSpec(repoRoot, norm), 'utf8');
      if (String(code || '').trim()) return code;
    } catch {
      /* try next */
    }
  }
  return '';
}

function syncDraftOptimizedFromEditor(repoRoot, optimizedCode) {
  const code = String(optimizedCode || '');
  if (!code.trim()) return;
  const abs = assertAllowedOptimizedSpec(repoRoot, DRAFT_OPTIMIZED_RELATIVE);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, code, 'utf8');
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

function buildDraftRecordingRelative(resolved) {
  const dir = path.posix.dirname(resolved.relativePath.replace(/\\/g, '/'));
  return `${dir}/${DRAFT_RECORDING_BASENAME}`;
}

async function ensureDraftRecordingPath(repoRoot, session, { code, name, description }) {
  const resolved = await resolveRecordingPathViaRepo(repoRoot, {
    code,
    name,
    description,
    target: 'original',
    playwrightEnv: getSessionPlaywrightEnv(session),
  });
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

/** 正式保存后清理所有 studio-unsaved-draft 优化草稿（含 env 子目录） */
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

function resolveRecordingPathViaRepo(repoRoot, { code, name, description, target = 'original', playwrightEnv }) {
  return new Promise((resolve, reject) => {
    const script = path.join(repoRoot, 'scripts/recording/resolve-recording-path.ts');
    if (!fs.existsSync(script)) {
      reject(new Error('未找到 scripts/recording/resolve-recording-path.ts'));
      return;
    }
    const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    const proc = spawn(npx, ['tsx', script, '--json'], {
      cwd: repoRoot,
      env: process.env,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    proc.stdout.on('data', (d) => {
      out += d.toString();
    });
    proc.stderr.on('data', (d) => {
      err += d.toString();
    });
    proc.on('error', reject);
    proc.on('close', (exitCode) => {
      if (exitCode !== 0) {
        reject(new Error(stripAnsi(err || out || `resolve-recording-path 退出码 ${exitCode}`)));
        return;
      }
      try {
        resolve(JSON.parse(out.trim()));
      } catch (e) {
        reject(new Error(`解析保存路径 JSON 失败: ${errText(e)}`));
      }
    });
    proc.stdin.write(
      JSON.stringify({
        code: String(code || ''),
        name: name || undefined,
        description: description || undefined,
        target,
        playwrightEnv: playwrightEnv || undefined,
      }),
    );
    proc.stdin.end();
  });
}

async function suggestRepoSavePath(ws, msg) {
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
    });
    send(ws, 'repo:suggest-path:done', result);
    logLine(ws, `[repo] 建议路径: ${result.relativePath}`, 'dim');
  } catch (e) {
    send(ws, 'error', { message: errText(e) });
  }
}

function cancelRepoPipeline(session) {
  session.repoPipelineCancelled = true;
  if (session.repoPipelineProc) {
    try {
      session.repoPipelineProc.kill('SIGTERM');
    } catch {
      /* ignore */
    }
    session.repoPipelineProc = null;
  }
}

function cancelRepoTest(session) {
  session.repoTestCancelled = true;
  if (session.repoTestProc) {
    try {
      session.repoTestProc.kill('SIGTERM');
    } catch {
      /* ignore */
    }
    session.repoTestProc = null;
  }
}

async function repoSave(ws, session, msg) {
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
      });
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

async function repoCommitArtifacts(ws, session, msg) {
  const repoRoot = resolveRepoRoot();
  if (!fs.existsSync(path.join(repoRoot, 'playwright.config.ts'))) {
    send(ws, 'error', {
      message: '未找到项目根（含 playwright.config.ts）。请设置 PLAYWRIGHT_REPO_ROOT 或将 pw-files 放在仓库子目录下。',
    });
    return;
  }
  const rawCode = typeof msg.code === 'string' ? msg.code : session.rawCode;
  if (!rawCode || !String(rawCode).trim()) {
    send(ws, 'error', { message: '保存失败：录制脚本为空' });
    return;
  }
  let optimizedRelative = String(msg.optimizedRelative || '').trim().replace(/\\/g, '/');
  if (isDraftOptimizedPath(optimizedRelative)) {
    optimizedRelative = '';
  }
  if (!optimizedRelative && Array.isArray(session.optimizedSpecs)) {
    const formal = session.optimizedSpecs.find((s) => !isDraftOptimizedPath(s));
    optimizedRelative = formal || '';
  }
  const optCode = typeof msg.optimizedCode === 'string' ? msg.optimizedCode : '';
  let optContent = optCode.trim();
  if (!optContent) {
    const readFrom =
      optimizedRelative || session.draftOptimizedRelative || DRAFT_OPTIMIZED_RELATIVE;
    try {
      optContent = fs.readFileSync(assertAllowedOptimizedSpec(repoRoot, readFrom), 'utf8');
    } catch (e) {
      send(ws, 'error', { message: `无法读取优化脚本: ${errText(e)}` });
      return;
    }
  }
  if (!optContent.trim()) {
    send(ws, 'error', { message: '优化脚本为空' });
    return;
  }

  let relativePath = (msg.relativePath || '').trim().replace(/\\/g, '/');
  if (isPlaceholderRecordingPath(relativePath)) {
    try {
      const resolved = await resolveRecordingPathViaRepo(repoRoot, {
        code: rawCode,
        name: msg.name,
        description: msg.description,
        target: 'original',
        playwrightEnv: getSessionPlaywrightEnv(session),
      });
      relativePath = resolved.relativePath;
      logLine(ws, `[repo] 录制落盘: ${relativePath}`, 'dim');
    } catch (e) {
      send(ws, 'error', { message: `无法解析录制保存路径: ${errText(e)}` });
      return;
    }
  }
  if (!optimizedRelative) {
    const parsed = parseRawOriginalRel(relativePath, repoRoot);
    const stem = path.basename(relativePath.replace(/\\/g, '/'), '.spec.ts');
    if (parsed) {
      optimizedRelative = buildOptimizedRel({
        playwrightEnv: parsed.env,
        dateCategory: parsed.dateCategory,
        stem,
        repoRoot,
      });
    } else {
      const norm = relativePath.replace(/\\/g, '/');
      const parts = norm.split('/');
      const dateCategory = parts[parts.length - 2];
      optimizedRelative =
        parts.includes('original') && isDateCategoryDirSegment(dateCategory)
          ? buildOptimizedRel({
              playwrightEnv: getSessionPlaywrightEnv(session),
              dateCategory,
              stem,
              repoRoot,
            })
          : `tests/optimized/${stem}.optimized.spec.ts`;
    }
  }
  let rawAbs;
  let optAbs;
  try {
    rawAbs = assertAllowedSavePath(repoRoot, relativePath);
    optAbs = assertAllowedOptimizedSpec(repoRoot, optimizedRelative);
  } catch (e) {
    send(ws, 'error', { message: errText(e) });
    return;
  }
  fs.mkdirSync(path.dirname(rawAbs), { recursive: true });
  fs.writeFileSync(rawAbs, rawCode, 'utf8');
  fs.mkdirSync(path.dirname(optAbs), { recursive: true });
  optContent = rewriteOptimizedSpecImports(optContent, optimizedRelative, repoRoot);
  fs.writeFileSync(optAbs, optContent, 'utf8');

  try {
    writeSpecMetaForSession(repoRoot, session, {
      rawRel: relativePath,
      optimizedRel: optimizedRelative,
      rawCode,
      optCode: optContent,
    });
  } catch (e) {
    logLine(ws, `[repo] 元数据写入失败: ${errText(e)}`, 'warn');
  }

  session.lastSavedRelative = relativePath;
  session.lastPrimaryOptimizedRelative = optimizedRelative;
  session.rawCode = rawCode;
  session.optCode = optContent;
  removeDraftRecordingIfAny(repoRoot, session);
  const removedDraftOptimized = removeDraftOptimizedArtifacts(repoRoot);
  session.draftOptimizedRelative = DRAFT_OPTIMIZED_RELATIVE;

  logLine(ws, `[repo] 已保存录制: ${relativePath}`, 'ok');
  logLine(ws, `[repo] 已保存优化: ${optimizedRelative}`, 'ok');
  if (removedDraftOptimized.length) {
    logLine(ws, `[repo] 已清理草稿: ${removedDraftOptimized.join(', ')}`, 'dim');
  }
  send(ws, 'repo:commit-artifacts:done', {
    relativePath,
    optimizedRelative,
    removedDraftOptimized,
    repoRoot,
  });
}

async function runRepoPipeline(ws, session, msg) {
  const repoRoot = resolveRepoRoot();
  if (!fs.existsSync(path.join(repoRoot, 'playwright.config.ts'))) {
    send(ws, 'error', { message: '未找到项目根，无法运行 pipeline' });
    return;
  }
  let targetArg = (msg.targetRelative || '').trim().replace(/\\/g, '/');
  const pipelineCode = typeof msg.code === 'string' ? msg.code : '';
  if (pipelineCode.trim()) {
    try {
      const { draftRelative, formalHint } = await ensureDraftRecordingPath(repoRoot, session, {
        code: pipelineCode,
        name: msg.name,
        description: msg.description,
      });
      targetArg = draftRelative;
      session.draftRelativePath = draftRelative;
      session.suggestedFormalRelative = formalHint;
      logLine(ws, `[repo] 草稿已写入: ${draftRelative}`, 'dim');
    } catch (e) {
      send(ws, 'error', { message: errText(e) });
      return;
    }
  } else if (!targetArg) {
    targetArg = (session.draftRelativePath || session.lastSavedRelative || '').trim().replace(/\\/g, '/');
  }
  if (!targetArg) {
    send(ws, 'error', { message: '无可用录制脚本，请先录制或粘贴内容' });
    return;
  }
  try {
    if (targetArg.endsWith('.spec.ts')) assertAllowedSavePath(repoRoot, targetArg);
    else if (!targetArg.startsWith('tests/raw-recordings/original/')) {
      throw new Error('pipeline 目标须为 tests/raw-recordings/original/ 下的目录或 .spec.ts');
    }
  } catch (e) {
    send(ws, 'error', { message: errText(e) });
    return;
  }

  session.repoPipelineCancelled = false;
  const since = Date.now();
  send(ws, 'repo:pipeline:start', { targetRelative: targetArg });
  logLine(ws, `[repo] 运行 pipeline-raw-to-optimized → ${targetArg}`, 'info');

  let exitCode = 1;
  try {
    const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const proc = spawn(npmCmd, ['run', 'pipeline-raw-to-optimized', '--', targetArg], {
      cwd: repoRoot,
      env: buildRepoSpawnEnv(session),
      shell: false,
    });
    session.repoPipelineProc = proc;

    proc.stdout.on('data', (d) => {
      const lines = stripAnsi(d.toString()).split('\n');
      for (const line of lines) {
        if (line.trim()) logLine(ws, `[pipeline] ${line}`, 'dim');
      }
    });
    proc.stderr.on('data', (d) => {
      const lines = stripAnsi(d.toString()).split('\n');
      for (const line of lines) {
        if (line.trim()) logLine(ws, `[pipeline] ${line}`, 'warn');
      }
    });

    exitCode = await new Promise((resolve, reject) => {
      proc.on('error', (err) => {
        session.repoPipelineProc = null;
        reject(err);
      });
      proc.on('close', (code) => {
        session.repoPipelineProc = null;
        resolve(code == null ? 1 : code);
      });
    });

    if (session.repoPipelineCancelled) {
      send(ws, 'repo:pipeline:cancelled', {});
      logLine(ws, '[repo] pipeline 已取消', 'warn');
      return;
    }

    const pipelineEnv =
      parseRawOriginalRel(targetArg, repoRoot)?.env || getSessionPlaywrightEnv(session);
    const optimizedSpecs = resolveOptimizedSpecsAfterPipeline(
      repoRoot,
      since,
      targetArg,
      pipelineEnv,
    );
    session.optimizedSpecs = optimizedSpecs;
    const draftOptimizedRelative =
      ensureDraftOptimizedAtCanonical(repoRoot, since, targetArg, pipelineEnv) ||
      optimizedSpecs[0] ||
      DRAFT_OPTIMIZED_RELATIVE;
    session.draftOptimizedRelative = draftOptimizedRelative;
    session.lastPrimaryOptimizedRelative = draftOptimizedRelative;
    const optimizedCode = readOptimizedCodeAfterPipeline(
      repoRoot,
      draftOptimizedRelative,
      optimizedSpecs,
    );
    if (optimizedCode) session.optCode = optimizedCode;

    if (session.draftRelativePath) {
      try {
        writeSpecMetaForSession(repoRoot, session, {
          rawRel: session.draftRelativePath,
          rawCode: pipelineCode || session.rawCode,
        });
      } catch {
        /* ignore */
      }
    }
    for (const optRel of optimizedSpecs) {
      try {
        const rawRel = session.draftRelativePath || targetArg;
        specMeta.copyRawMetaToOptimized(repoRoot, rawRel, optRel, {
          playwrightEnv: pipelineEnv,
          accountProfile: getSessionAccountProfile(session, repoRoot),
          code: pipelineCode || session.rawCode,
          recordSource: 'pipeline',
        });
      } catch {
        /* ignore per-spec meta */
      }
    }

    let suggestedFormalRelative = session.suggestedFormalRelative || null;
    let suggestedFormalOptimized = null;
    if (suggestedFormalRelative) {
      try {
        const parsed = parseRawOriginalRel(suggestedFormalRelative, repoRoot);
        const stem = path.basename(suggestedFormalRelative.replace(/\\/g, '/'), '.spec.ts');
        if (parsed) {
          suggestedFormalOptimized = buildOptimizedRel({
            playwrightEnv: parsed.env,
            dateCategory: parsed.dateCategory,
            stem,
            repoRoot,
          });
        }
      } catch {
        /* ignore */
      }
    }

    send(ws, 'repo:pipeline:done', {
      exitCode,
      optimizedSpecs,
      primaryOptimizedRelative: draftOptimizedRelative,
      draftOptimizedRelative,
      optimizedCode,
      draftRelativePath: session.draftRelativePath || null,
      suggestedFormalRelative,
      suggestedFormalOptimized,
      repoRoot,
      hint: optimizedCode
        ? suggestedFormalOptimized
          ? `草稿已就绪；确认无误后点「保存到项目」→ ${suggestedFormalOptimized}`
          : '已加载优化脚本，调试完成后点「保存到项目」落盘正式用例'
        : optimizedSpecs.length
          ? '已找到用例文件但未读取到内容，请从下拉框重新选择'
          : '未找到 *.optimized.spec.ts，请确认 pipeline 已生成 tests/optimized 产物',
    });
    logLine(
      ws,
      `[repo] pipeline 结束 (exit ${exitCode})，候选: ${optimizedSpecs.length ? optimizedSpecs.join(', ') : '无'}${optimizedCode ? '，已载入优化脚本' : '，未载入优化脚本'}`,
      exitCode === 0 && optimizedCode ? 'ok' : 'warn',
    );
  } catch (e) {
    logLine(ws, `[repo] pipeline 异常: ${errText(e)}`, 'err');
    send(ws, 'repo:pipeline:done', {
      exitCode: 1,
      optimizedSpecs: session.optimizedSpecs || [],
      primaryOptimizedRelative: session.draftOptimizedRelative || DRAFT_OPTIMIZED_RELATIVE,
      draftOptimizedRelative: session.draftOptimizedRelative || DRAFT_OPTIMIZED_RELATIVE,
      optimizedCode: '',
      draftRelativePath: session.draftRelativePath || null,
      repoRoot,
      hint: errText(e),
    });
  }
}

async function runRepoTest(ws, session, msg) {
  const repoRoot = resolveRepoRoot();
  let specRel = (msg.specRelative || session.draftOptimizedRelative || DRAFT_OPTIMIZED_RELATIVE)
    .trim()
    .replace(/\\/g, '/');
  if (!specRel) {
    send(ws, 'error', { message: '请指定 specRelative（tests/optimized/.../*.optimized.spec.ts）' });
    return;
  }
  if (isDraftOptimizedPath(specRel) && typeof msg.optimizedCode === 'string' && msg.optimizedCode.trim()) {
    try {
      syncDraftOptimizedFromEditor(repoRoot, msg.optimizedCode);
    } catch (e) {
      send(ws, 'error', { message: `同步草稿用例失败: ${errText(e)}` });
      return;
    }
  }
  let absSpec;
  try {
    absSpec = assertAllowedOptimizedSpec(repoRoot, specRel);
  } catch (e) {
    send(ws, 'error', { message: errText(e) });
    return;
  }
  if (!fs.existsSync(absSpec)) {
    send(ws, 'error', { message: `文件不存在: ${specRel}` });
    return;
  }
  if (!isDraftOptimizedPath(specRel)) {
    try {
      assertSpecEnvMatch(specRel, getSessionPlaywrightEnv(session), repoRoot);
    } catch (e) {
      send(ws, 'error', { message: errText(e) });
      return;
    }
  }

  const specProfile = isDraftOptimizedPath(specRel)
    ? getSessionAccountProfile(session, repoRoot)
    : resolveSpecAccountProfile(repoRoot, specRel);
  const loginReady = await ensureSpecAccountReady(ws, session, specRel);
  if (!loginReady.ok) {
    send(ws, 'error', { message: `账号档案 ${loginReady.profile || specProfile} 登录失败，无法执行用例` });
    return;
  }

  const cli = getRepoPlaywrightCli(repoRoot);
  if (!cli) {
    send(ws, 'error', { message: '项目根未安装 @playwright/test，请在仓库根执行 npm install' });
    return;
  }

  session.repoTestCancelled = false;
  const testProjects = normalizeRepoTestProjects(msg.projects);
  send(ws, 'run:start');
  logLine(ws, `[repo] 项目内执行: ${specRel} --project=${formatRepoTestProjectsLog(testProjects)}`, 'info');

  const headed = Boolean(msg.headed);
  const startTime = Date.now();
  const args = [cli, 'test', specRel];
  appendRepoTestProjectArgs(args, testProjects);
  if (headed) args.push('--headed');
  else args.push('--reporter=json');

  logLine(ws, `[repo] PLAYWRIGHT_ENV=${getSessionPlaywrightEnv(session)}`, 'dim');
  if (specProfile && specProfile !== specMeta.UNKNOWN_PROFILE) {
    logLine(ws, `[repo] PLAYWRIGHT_ACCOUNT=${specProfile}`, 'dim');
  }
  const proc = spawn(process.execPath, args, {
    cwd: repoRoot,
    env: buildRepoSpawnEnv(
      session,
      specProfile && specProfile !== specMeta.UNKNOWN_PROFILE ? specProfile : undefined,
    ),
  });
  session.repoTestProc = proc;

  let stdout = '';
  proc.stdout.on('data', (d) => {
    stdout += d.toString();
  });
  proc.stderr.on('data', (d) => {
    const t = stripAnsi(d.toString()).trim();
    if (t) logLine(ws, t, 'dim');
  });

  const exitCode = await new Promise((resolve) => {
    proc.on('close', (c) => {
      session.repoTestProc = null;
      resolve(c == null ? 1 : c);
    });
  });

  if (session.repoTestCancelled) {
    send(ws, 'run:cancelled');
    return;
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  let passed = 0;
  let failed = 0;
  let total = 0;
  let failures = [];
  if (!headed) {
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
      if (exitCode !== 0 || failed > 0) {
        failures = logPlaywrightFailureReport(ws, result, session, exitCode);
      } else {
        session.lastRunFailures = [];
      }
    } catch {
      passed = exitCode === 0 ? 1 : 0;
      failed = exitCode === 0 ? 0 : 1;
      total = 1;
      if (exitCode !== 0) {
        failures = parsePlaywrightFailures({ suites: [] }, session, exitCode);
        session.lastRunFailures = failures;
      }
    }
  } else {
    logLine(ws, '[repo] 有界面模式已结束，请在浏览器窗口查看结果', 'info');
    passed = exitCode === 0 ? 1 : 0;
    failed = exitCode === 0 ? 0 : 1;
    total = 1;
    if (exitCode !== 0) {
      failures = headedFailurePlaceholder(specRel);
      session.lastRunFailures = failures;
    }
  }

  session.runResult = { passed, failed, total, duration, exitCode, runMode: headed ? 'headed' : 'headless' };
  send(ws, 'run:done', {
    passed,
    failed,
    total,
    duration,
    exitCode,
    runMode: headed ? 'headed' : 'headless',
    uiMode: false,
    failures,
    repoTest: true,
    specRelative: specRel,
    projects: testProjects,
    playwrightEnv: getSessionPlaywrightEnv(session),
    screenshotHint: path.join(repoRoot, 'screenshots'),
    playwrightReportDir: 'playwright-report',
    testResultsDir: 'test-results',
  });
  logLine(ws, `[repo] 截图目录: ${path.join(repoRoot, 'screenshots')}`, 'dim');
}

function cancelRepoBatch(session) {
  session.repoBatchCancelled = true;
  if (session.repoTestProc) {
    try {
      session.repoTestProc.kill('SIGTERM');
    } catch {
      /* ignore */
    }
    session.repoTestProc = null;
  }
}

async function executeRepoSpecForBatch(ws, session, specRel, headed, projects, profileOverride) {
  const repoRoot = resolveRepoRoot();
  let absSpec;
  try {
    absSpec = assertAllowedOptimizedSpec(repoRoot, specRel);
  } catch (e) {
    const err = errText(e);
    return {
      exitCode: 1,
      passed: 0,
      failed: 1,
      total: 1,
      error: err,
      failures: [{ title: specRel, location: specRel, status: 'error', message: err, hint: '请检查用例路径是否在 tests/optimized 下。' }],
    };
  }
  if (!fs.existsSync(absSpec)) {
    const err = `文件不存在: ${specRel}`;
    return {
      exitCode: 1,
      passed: 0,
      failed: 1,
      total: 1,
      error: err,
      failures: [{ title: specRel, location: specRel, status: 'error', message: err, hint: '' }],
    };
  }
  if (!isDraftOptimizedPath(specRel)) {
    try {
      assertSpecEnvMatch(specRel, getSessionPlaywrightEnv(session), repoRoot);
    } catch (e) {
      const err = errText(e);
      return {
        exitCode: 1,
        passed: 0,
        failed: 1,
        total: 1,
        error: err,
        failures: [{ title: specRel, location: specRel, status: 'error', message: err, hint: '请切换侧栏环境或选择当前环境下的用例。' }],
      };
    }
  }
  const cli = getRepoPlaywrightCli(repoRoot);
  if (!cli) {
    const err = '未安装 @playwright/test';
    return {
      exitCode: 1,
      passed: 0,
      failed: 1,
      total: 1,
      error: err,
      failures: [{ title: specRel, location: specRel, status: 'error', message: err, hint: '请在项目根执行 npm install' }],
    };
  }

  session.repoTestCancelled = false;
  const args = [cli, 'test', specRel];
  appendRepoTestProjectArgs(args, projects);
  if (headed) args.push('--headed');
  else args.push('--reporter=json');

  const proc = spawn(process.execPath, args, {
    cwd: repoRoot,
    env: buildRepoSpawnEnv(session, profileOverride),
  });
  session.repoTestProc = proc;

  let stdout = '';
  proc.stdout.on('data', (d) => {
    stdout += d.toString();
  });
  proc.stderr.on('data', (d) => {
    const t = stripAnsi(d.toString()).trim();
    if (t) logLine(ws, `[batch] ${t}`, 'dim');
  });

  const exitCode = await new Promise((resolve) => {
    proc.on('close', (c) => {
      session.repoTestProc = null;
      resolve(c == null ? 1 : c);
    });
  });

  if (session.repoBatchCancelled || session.repoTestCancelled) {
    return { exitCode: 130, passed: 0, failed: 0, total: 0, cancelled: true };
  }

  let passed = 0;
  let failed = 0;
  let total = 0;
  let failures = [];
  if (!headed) {
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
      if (exitCode !== 0 || failed > 0) {
        failures = logPlaywrightFailureReport(ws, result, session, exitCode);
      }
    } catch {
      passed = exitCode === 0 ? 1 : 0;
      failed = exitCode === 0 ? 0 : 1;
      total = 1;
      if (exitCode !== 0) failures = parsePlaywrightFailures({ suites: [] }, session, exitCode);
    }
  } else {
    passed = exitCode === 0 ? 1 : 0;
    failed = exitCode === 0 ? 0 : 1;
    total = 1;
    if (exitCode !== 0 || failed > 0) failures = headedFailurePlaceholder(specRel);
  }

  return { exitCode, passed, failed, total, failures };
}

async function runRepoBatchTest(ws, session, msg) {
  const repoRoot = resolveRepoRoot();
  if (!fs.existsSync(path.join(repoRoot, 'playwright.config.ts'))) {
    send(ws, 'error', { message: '未找到项目根，无法批量执行' });
    return;
  }

  const specs = [
    ...new Set(
      (Array.isArray(msg.specRelatives) ? msg.specRelatives : [])
        .map((s) => String(s || '').trim().replace(/\\/g, '/'))
        .filter((s) => s && !isDraftOptimizedPath(s)),
    ),
  ];
  if (!specs.length) {
    send(ws, 'error', { message: '请至少选择一个测试用例' });
    return;
  }

  const stopOnError = Boolean(msg.stopOnError);
  const headed = Boolean(msg.headed);
  const testProjects = normalizeRepoTestProjects(msg.projects);
  session.repoBatchCancelled = false;
  session.repoBatchRunning = true;
  send(ws, 'repo:batch-test:start', { total: specs.length, projects: testProjects });
  logLine(
    ws,
    `[batch] 开始批量执行 ${specs.length} 个用例（${formatRepoTestProjectsLog(testProjects)}）`,
    'info',
  );

  const results = [];
  let stoppedEarly = false;

  const repoRootForBatch = resolveRepoRoot();
  const batchEntries = specs.map((rel) => ({
    rel,
    ...specMeta.enrichOptimizedSpecEntry(repoRootForBatch, rel),
  }));
  const profileGroups = specMeta.groupEntriesByAccountProfile(batchEntries);

  let globalIndex = 0;
  for (const [profile, groupEntries] of profileGroups) {
    if (session.repoBatchCancelled) break;
    if (profile && profile !== specMeta.UNKNOWN_PROFILE) {
      logLine(ws, `[batch] 账号组 ${profile}（${groupEntries.length} 个用例）`, 'info');
      const loginReady = await ensureAccountLoginForProfile(ws, session, profile);
      if (!loginReady.ok) {
        for (const entry of groupEntries) {
          const err = `账号档案 ${profile} 登录失败`;
          const item = {
            specRelative: entry.rel,
            exitCode: 1,
            passed: 0,
            failed: 1,
            total: 1,
            error: err,
            failures: [{ title: entry.rel, location: entry.rel, status: 'error', message: err, hint: '请先在侧栏完成该档案登录' }],
          };
          results.push(item);
          send(ws, 'repo:batch-test:progress', {
            index: globalIndex,
            total: specs.length,
            specRelative: entry.rel,
            phase: 'done',
            ...item,
          });
          globalIndex++;
        }
        if (stopOnError) {
          stoppedEarly = true;
          break;
        }
        continue;
      }
    }

    const profileOverride =
      profile && profile !== specMeta.UNKNOWN_PROFILE ? profile : undefined;

    for (const entry of groupEntries) {
      if (session.repoBatchCancelled) break;
      const specRel = entry.rel;
      const i = globalIndex;
      send(ws, 'repo:batch-test:progress', {
        index: i,
        total: specs.length,
        specRelative: specRel,
        phase: 'running',
        accountProfile: entry.accountProfile || null,
      });
      const r = await executeRepoSpecForBatch(ws, session, specRel, headed, testProjects, profileOverride);
      const item = { specRelative: specRel, accountProfile: entry.accountProfile || null, ...r };
      results.push(item);
      send(ws, 'repo:batch-test:progress', {
        index: i,
        total: specs.length,
        specRelative: specRel,
        phase: 'done',
        exitCode: r.exitCode,
        passed: r.passed,
        failed: r.failed,
        total: r.total,
        cancelled: Boolean(r.cancelled),
        error: r.error || null,
        failures: r.failures || [],
        accountProfile: entry.accountProfile || null,
      });
      globalIndex++;
      if (r.cancelled) break;
      const failedRun = r.exitCode !== 0 || (r.failed != null && r.failed > 0);
      if (failedRun) {
        logLine(ws, `[batch] 失败: ${specRel}`, 'warn');
        if (stopOnError) {
          stoppedEarly = true;
          break;
        }
      } else {
        logLine(ws, `[batch] 完成: ${specRel}`, 'ok');
      }
    }
    if (stoppedEarly || session.repoBatchCancelled) break;
  }

  session.repoBatchRunning = false;
  const anyFail = results.some((r) => r.exitCode !== 0 || (r.failed != null && r.failed > 0));
  session.lastBatchRunComplete = !session.repoBatchCancelled && results.length > 0;
  send(ws, 'repo:batch-test:done', {
    results,
    cancelled: session.repoBatchCancelled,
    stoppedEarly,
    anyFail,
    projects: testProjects,
    playwrightEnv: getSessionPlaywrightEnv(session),
    headed,
    screenshotHint: path.join(repoRoot, 'screenshots'),
    playwrightReportDir: 'playwright-report',
    testResultsDir: 'test-results',
  });
  logLine(
    ws,
    `[batch] 结束：${results.length}/${specs.length} 项${session.repoBatchCancelled ? '（已取消）' : ''}`,
    anyFail ? 'warn' : 'ok',
  );
}

// ── Test Jobs（config/test-jobs.json + results/jobs/）────────────────────────

const TEST_JOBS_CONFIG_REL = 'config/test-jobs.json';

function isJobProcessAlive(pid) {
  if (!pid || typeof pid !== 'number') return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function loadTestJobsConfigFile(repoRoot) {
  const p = path.join(repoRoot, TEST_JOBS_CONFIG_REL);
  if (!fs.existsSync(p)) return { jobs: [] };
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch (e) {
    console.warn('[studio] 无法解析 test-jobs.json', e);
    return { jobs: [] };
  }
}

function readJobLockFile(repoRoot, jobId) {
  const p = path.join(repoRoot, 'results/jobs', jobId, 'lock.json');
  if (!fs.existsSync(p)) return null;
  try {
    const lock = JSON.parse(fs.readFileSync(p, 'utf-8'));
    if (lock?.pid && !isJobProcessAlive(lock.pid)) {
      try {
        fs.unlinkSync(p);
      } catch {
        /* ignore */
      }
      return null;
    }
    return lock;
  } catch {
    return null;
  }
}

function readLatestJobRunFile(repoRoot, jobId) {
  const runsRoot = path.join(repoRoot, 'results/jobs', jobId, 'runs');
  if (!fs.existsSync(runsRoot)) return null;
  const runs = fs
    .readdirSync(runsRoot)
    .filter((f) => fs.statSync(path.join(runsRoot, f)).isDirectory())
    .sort((a, b) => b.localeCompare(a));
  if (!runs.length) return null;
  const runId = runs[0];
  const dir = path.join(runsRoot, runId);
  let status = null;
  let summary = null;
  const statusPath = path.join(dir, 'status.json');
  const summaryPath = path.join(dir, 'summary.json');
  if (fs.existsSync(statusPath)) {
    try {
      status = JSON.parse(fs.readFileSync(statusPath, 'utf-8'));
    } catch {
      /* ignore */
    }
  }
  if (fs.existsSync(summaryPath)) {
    try {
      summary = JSON.parse(fs.readFileSync(summaryPath, 'utf-8'));
    } catch {
      /* ignore */
    }
  }
  return { runId, status, summary, logPath: path.join(dir, 'stdout.log') };
}

const KNOWN_JOB_ENV_IDS = ['dev', 'uat', 'stage', 'stage9084'];

function mergeTestJobDef(config, jobDef) {
  const d = config?.defaults || {};
  const dSteps = d.steps || {};
  const jSteps = jobDef.steps || {};
  return {
    id: String(jobDef.id || ''),
    enabled: jobDef.enabled !== false,
    description: jobDef.description || '',
    schedule: jobDef.schedule ?? null,
    timezone: jobDef.timezone || d.timezone || 'Asia/Shanghai',
    playwrightEnv: jobDef.playwrightEnv ?? d.playwrightEnv ?? 'stage',
    projects: jobDef.projects?.length ? [...jobDef.projects] : [...(d.projects || ['optimized', 'optimized-webkit', 'optimized-firefox'])],
    optimizedDir: jobDef.optimizedDir ?? d.optimizedDir ?? 'tests/optimized',
    specs: jobDef.specs ?? d.specs ?? 'all',
    accountProfile: jobDef.accountProfile ?? d.accountProfile ?? null,
    stopOnTestFailure: jobDef.stopOnTestFailure ?? d.stopOnTestFailure ?? true,
    stopOnCompareGate: jobDef.stopOnCompareGate ?? d.stopOnCompareGate ?? true,
    runCompareAfterAbort: jobDef.runCompareAfterAbort ?? d.runCompareAfterAbort ?? false,
    feishuMode: jobDef.feishuMode ?? d.feishuMode ?? 'interactive',
    notifyOn: jobDef.notifyOn?.length ? [...jobDef.notifyOn] : [...(d.notifyOn || ['failure', 'success'])],
    steps: { ...dSteps, ...jSteps },
  };
}

function globToRegExpJob(pattern) {
  const normalized = String(pattern || '').replace(/\\/g, '/');
  let re = '^';
  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i];
    if (ch === '*') {
      if (normalized[i + 1] === '*') {
        re += '.*';
        i++;
      } else {
        re += '[^/]*';
      }
    } else if (/[+?^${}()|[\]\\]/.test(ch)) {
      re += `\\${ch}`;
    } else {
      re += ch;
    }
  }
  re += '$';
  return new RegExp(re);
}

function matchesAnyJobPattern(relPath, patterns) {
  const normalized = String(relPath || '').replace(/\\/g, '/');
  return patterns.some((p) => {
    const pat = String(p || '').replace(/\\/g, '/');
    if (pat.includes('*')) return globToRegExpJob(pat).test(normalized);
    return normalized === pat || normalized.endsWith(`/${pat}`);
  });
}

function normalizeJobSpecPatterns(specs, playwrightEnv) {
  const env = String(playwrightEnv || 'stage').trim();
  const envPrefix = `tests/optimized/${env}/`;
  return specs.map((raw) => {
    let pat = String(raw || '').replace(/\\/g, '/').trim();
    if (!pat) return pat;
    if (!pat.startsWith('tests/')) {
      pat = pat.startsWith('optimized/') ? `tests/${pat}` : `${envPrefix}${pat}`;
    }
    const legacy = pat.match(/^tests\/optimized\/(\d{6})\/(.+)$/);
    if (legacy && !KNOWN_JOB_ENV_IDS.includes(legacy[1])) {
      return `tests/optimized/${env}/${legacy[1]}/${legacy[2]}`;
    }
    const withEnv = pat.match(/^tests\/optimized\/([^/]+)\/(.+)$/);
    if (withEnv && KNOWN_JOB_ENV_IDS.includes(withEnv[1])) return pat;
    if (legacy) return `tests/optimized/${env}/${legacy[1]}/${legacy[2]}`;
    return pat;
  });
}

function isDraftOptimizedRel(rel) {
  return path.basename(String(rel || '')) === 'studio-unsaved-draft.optimized.spec.ts';
}

function relPathForJobSpecMatch(rel, playwrightEnv) {
  const legacy = rel.match(/^tests\/optimized\/(\d{6})\/(.+\.optimized\.spec\.ts)$/);
  if (legacy && !KNOWN_JOB_ENV_IDS.includes(legacy[1])) {
    return `tests/optimized/${playwrightEnv}/${legacy[1]}/${legacy[2]}`;
  }
  return rel;
}

function listAllOptimizedSpecsForJob(repoRoot, env, optimizedDir) {
  const scanBase = path.join(repoRoot, optimizedDir);
  const found = [];
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
      else if (ent.isFile() && ent.name.endsWith('.optimized.spec.ts')) {
        const rel = path.relative(repoRoot, full).split(path.sep).join('/');
        if (isDraftOptimizedRel(rel)) continue;
        if (env && !specMatchesEnv(rel, env, repoRoot)) continue;
        found.push(rel);
      }
    }
  };
  if (fs.existsSync(scanBase)) walk(scanBase);
  return found.sort((a, b) => a.localeCompare(b));
}

function resolveJobSpecRelsForMerged(repoRoot, merged, accountProfileOverride) {
  const all = listAllOptimizedSpecsForJob(repoRoot, merged.playwrightEnv, merged.optimizedDir);
  let matched = all;
  if (merged.specs !== 'all') {
    const rawSpecs = Array.isArray(merged.specs) ? merged.specs : [merged.specs];
    const patterns = normalizeJobSpecPatterns(rawSpecs, merged.playwrightEnv);
    const env = merged.playwrightEnv || 'stage';
    matched = all.filter((rel) => {
      const normRel = relPathForJobSpecMatch(rel, env);
      return matchesAnyJobPattern(normRel, patterns) || matchesAnyJobPattern(rel, patterns);
    });
  }
  const profileFilter = accountProfileOverride ?? merged.accountProfile ?? null;
  if (profileFilter && profileFilter !== 'all') {
    const allowed = Array.isArray(profileFilter) ? profileFilter : [String(profileFilter)];
    matched = matched.filter((rel) => {
      const meta = specMeta.enrichOptimizedSpecEntry(repoRoot, rel);
      return allowed.includes(meta.accountProfile);
    });
  }
  return matched;
}

function countSpecsForMergedJob(repoRoot, merged, accountProfileOverride) {
  return resolveJobSpecRelsForMerged(repoRoot, merged, accountProfileOverride).length;
}

function summarizeJobProfileCounts(repoRoot, merged, accountProfileOverride) {
  const rels = resolveJobSpecRelsForMerged(repoRoot, merged, accountProfileOverride);
  const entries = rels.map((rel) => specMeta.enrichOptimizedSpecEntry(repoRoot, rel));
  return specMeta.summarizeProfileCounts(entries);
}

function formatJobSpecsDisplay(merged, specCount) {
  if (merged.specs === 'all') return `全部 · ${specCount} 个`;
  if (specCount === 0) return '请在下方选用例';
  return `${specCount} 个用例`;
}

function buildTestJobEntry(repoRoot, jobDef, config) {
  const cfg = config || loadTestJobsConfigFile(repoRoot);
  const merged = mergeTestJobDef(cfg, jobDef);
  const id = merged.id;
  const lock = readJobLockFile(repoRoot, id);
  const latestRun = readLatestJobRunFile(repoRoot, id);
  const specCount = countSpecsForMergedJob(repoRoot, merged);
  return {
    id,
    enabled: merged.enabled,
    description: merged.description,
    schedule: merged.schedule,
    timezone: merged.timezone,
    playwrightEnv: merged.playwrightEnv,
    accountProfile: merged.accountProfile ?? null,
    projects: merged.projects,
    optimizedDir: merged.optimizedDir,
    specs: merged.specs,
    specsLabel: formatJobSpecsDisplay(merged, specCount),
    specCount,
    stopOnTestFailure: merged.stopOnTestFailure,
    stopOnCompareGate: merged.stopOnCompareGate,
    running: Boolean(lock),
    lock,
    latestRun,
  };
}

function buildTestJobsListPayload(repoRoot) {
  const config = loadTestJobsConfigFile(repoRoot);
  const jobs = (config.jobs || []).map((j) => buildTestJobEntry(repoRoot, j, config));
  return {
    jobs,
    configPath: path.join(repoRoot, TEST_JOBS_CONFIG_REL),
    availableEnvs: listKnownEnvs(repoRoot),
  };
}

function resolveJobRunEnvForRepo(repoRoot, merged, override) {
  const env = String(override ?? merged.playwrightEnv ?? 'stage').trim();
  if (!isKnownEnv(env, repoRoot)) {
    throw new Error(`未知环境: ${env}`);
  }
  return env;
}

function buildJobPreviewPayload(repoRoot, def, config, playwrightEnv, accountProfile, specRelatives) {
  const merged = mergeTestJobDef(config, def);
  const env = resolveJobRunEnvForRepo(repoRoot, merged, playwrightEnv);
  const profileFilter =
    accountProfile != null && String(accountProfile).trim() && accountProfile !== 'all'
      ? String(accountProfile).trim()
      : merged.accountProfile ?? null;
  const previewMerged = { ...merged, playwrightEnv: env, accountProfile: profileFilter };
  let candidateSpecs = resolveJobSpecRelsForMerged(repoRoot, previewMerged, profileFilter);
  const configMatchedEmpty = candidateSpecs.length === 0 && merged.specs !== 'all';
  if (configMatchedEmpty) {
    candidateSpecs = listAllOptimizedSpecsForJob(repoRoot, env, merged.optimizedDir);
  }

  let effectiveSpecs = candidateSpecs;
  let specsOverridden = false;
  if (Array.isArray(specRelatives) && specRelatives.length) {
    const selected = [
      ...new Set(
        specRelatives.map((s) => String(s || '').trim().replace(/\\/g, '/')).filter(Boolean),
      ),
    ];
    effectiveSpecs = selected.filter((rel) => {
      try {
        assertAllowedOptimizedSpec(repoRoot, rel);
        return candidateSpecs.includes(rel);
      } catch {
        return false;
      }
    });
    specsOverridden = effectiveSpecs.length > 0;
  }

  const specCount = specsOverridden ? effectiveSpecs.length : countSpecsForMergedJob(repoRoot, previewMerged, profileFilter);
  const profileCounts = summarizeJobProfileCounts(repoRoot, previewMerged, profileFilter);
  const candidateEntries = candidateSpecs.map((rel) => {
    const meta = specMeta.enrichOptimizedSpecEntry(repoRoot, rel);
    return { rel, accountProfile: meta.accountProfile || 'unknown' };
  });
  return {
    jobId: merged.id,
    playwrightEnv: env,
    configPlaywrightEnv: merged.playwrightEnv,
    configAccountProfile: merged.accountProfile ?? null,
    accountProfile: profileFilter,
    envOverridden: env !== merged.playwrightEnv,
    profileOverridden:
      profileFilter != null &&
      JSON.stringify(profileFilter) !== JSON.stringify(merged.accountProfile ?? null),
    specCount,
    profileCounts,
    specsLabel: specsOverridden
      ? `已选用例 · ${specCount} 个`
      : configMatchedEmpty
        ? `${candidateEntries.length} 个可选用例`
        : formatJobSpecsDisplay(previewMerged, specCount),
    specsOverridden,
    configMatchedEmpty,
    candidateSpecs: candidateEntries,
  };
}

async function handleJobsPreview(ws, msg) {
  const repoRoot = resolveRepoRoot();
  const jobId = String(msg.jobId || '').trim();
  if (!jobId) {
    send(ws, 'error', { message: 'jobs:preview 需要 jobId' });
    return;
  }
  const config = loadTestJobsConfigFile(repoRoot);
  const def = (config.jobs || []).find((j) => j.id === jobId);
  if (!def) {
    send(ws, 'error', { message: `未找到 Job: ${jobId}` });
    send(ws, 'jobs:preview:done', { jobId, ok: false });
    return;
  }
  try {
    const preview = buildJobPreviewPayload(
      repoRoot,
      def,
      config,
      msg.playwrightEnv,
      msg.accountProfile,
      msg.specRelatives,
    );
    send(ws, 'jobs:preview:done', { ok: true, ...preview });
  } catch (e) {
    send(ws, 'error', { message: errText(e) });
    send(ws, 'jobs:preview:done', { jobId, ok: false });
  }
}

function tailJobLog(repoRoot, jobId, lines = 40) {
  const latest = readLatestJobRunFile(repoRoot, jobId);
  if (!latest?.logPath || !fs.existsSync(latest.logPath)) return { runId: latest?.runId || null, text: '' };
  const content = fs.readFileSync(latest.logPath, 'utf-8');
  const tail = content.split('\n').slice(-lines).join('\n');
  return { runId: latest.runId, text: tail };
}

async function handleJobsList(ws) {
  const repoRoot = resolveRepoRoot();
  if (!fs.existsSync(path.join(repoRoot, 'playwright.config.ts'))) {
    send(ws, 'error', { message: '未找到项目根，无法列出测试任务' });
    send(ws, 'jobs:list:done', { jobs: [] });
    return;
  }
  send(ws, 'jobs:list:done', buildTestJobsListPayload(repoRoot));
}

async function handleJobsStatus(ws, msg) {
  const repoRoot = resolveRepoRoot();
  const jobId = String(msg.jobId || '').trim();
  if (!jobId) {
    send(ws, 'jobs:status:done', buildTestJobsListPayload(repoRoot));
    return;
  }
  const config = loadTestJobsConfigFile(repoRoot);
  const def = (config.jobs || []).find((j) => j.id === jobId);
  if (!def) {
    send(ws, 'error', { message: `未找到 Job: ${jobId}` });
    send(ws, 'jobs:status:done', { job: null });
    return;
  }
  const job = buildTestJobEntry(repoRoot, def, config);
  const logs = tailJobLog(repoRoot, jobId, Number(msg.lines) || 40);
  send(ws, 'jobs:status:done', { job, logs });
}

async function handleJobsRun(ws, msg) {
  const repoRoot = resolveRepoRoot();
  const jobId = String(msg.jobId || '').trim();
  if (!jobId) {
    send(ws, 'error', { message: 'jobs:run 需要 jobId' });
    return;
  }
  const config = loadTestJobsConfigFile(repoRoot);
  const def = (config.jobs || []).find((j) => j.id === jobId);
  if (!def) {
    send(ws, 'error', { message: `未找到 Job: ${jobId}` });
    return;
  }
  const merged = mergeTestJobDef(config, def);
  const runEnv = resolveJobRunEnvForRepo(repoRoot, merged, msg.playwrightEnv);
  const runProfile =
    msg.accountProfile != null && String(msg.accountProfile).trim() && msg.accountProfile !== 'all'
      ? String(msg.accountProfile).trim()
      : merged.accountProfile ?? null;

  const specRelatives = [
    ...new Set(
      (Array.isArray(msg.specRelatives) ? msg.specRelatives : [])
        .map((s) => String(s || '').trim().replace(/\\/g, '/'))
        .filter(Boolean),
    ),
  ];

  const background = Boolean(msg.background);
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const args = ['run', 'test-job', '--', 'run', `--id=${jobId}`, `--env=${runEnv}`, '--trigger=manual'];
  if (runProfile) args.push(`--profile=${runProfile}`);
  for (const spec of specRelatives) args.push(`--spec=${spec}`);
  if (background) args.push('--background');
  const spawnEnv = { ...process.env, PLAYWRIGHT_ENV: runEnv };
  if (runProfile) spawnEnv.PLAYWRIGHT_ACCOUNT = runProfile;

  if (background) {
    const proc = spawn(npmCmd, args, {
      cwd: repoRoot,
      env: spawnEnv,
      detached: true,
      stdio: 'ignore',
      shell: false,
    });
    proc.unref();
    send(ws, 'jobs:run:done', {
      jobId,
      background: true,
      pid: proc.pid,
      playwrightEnv: runEnv,
      accountProfile: runProfile,
    });
    logLine(
      ws,
      `[jobs] 已在后台启动 Job「${jobId}」(env=${runEnv}${runProfile ? `, profile=${runProfile}` : ''}${specRelatives.length ? `, ${specRelatives.length} 个选用例` : ''}${runEnv !== merged.playwrightEnv ? `, 覆盖默认 ${merged.playwrightEnv}` : ''})`,
      'ok',
    );
    return;
  }

  send(ws, 'jobs:run:start', { jobId, playwrightEnv: runEnv, accountProfile: runProfile });
  const logChunks = [];
  const emitJobRunLog = (text, level = 'dim') => {
    const line = String(text || '').trimEnd();
    if (!line) return;
    logLine(ws, line, level);
    logChunks.push(line);
    send(ws, 'jobs:run:log', { jobId, text: line });
  };
  emitJobRunLog(
    `[jobs] 开始执行 Job「${jobId}」(env=${runEnv}${runProfile ? `, profile=${runProfile}` : ''}${specRelatives.length ? `, ${specRelatives.length} 个选用例` : ''}${runEnv !== merged.playwrightEnv ? `, 覆盖默认 ${merged.playwrightEnv}` : ''})`,
    'info',
  );
  const proc = spawn(npmCmd, args, { cwd: repoRoot, env: spawnEnv, shell: false });
  proc.stdout.on('data', (d) => {
    const t = stripAnsi(d.toString());
    if (t.trim()) emitJobRunLog(t.trimEnd(), 'dim');
  });
  proc.stderr.on('data', (d) => {
    const t = stripAnsi(d.toString());
    if (t.trim()) emitJobRunLog(t.trimEnd(), 'warn');
  });
  const exitCode = await new Promise((resolve) => {
    proc.on('close', resolve);
  });
  emitJobRunLog(`[jobs] Job「${jobId}」结束，退出码 ${exitCode}`, exitCode === 0 ? 'ok' : 'warn');
  const latestRun = readLatestJobRunFile(repoRoot, jobId);
  const logTail = logChunks.join('\n');
  if (latestRun?.logPath && logTail) {
    try {
      fs.mkdirSync(path.dirname(latestRun.logPath), { recursive: true });
      fs.writeFileSync(latestRun.logPath, `${logTail}\n`, 'utf-8');
    } catch {
      /* ignore */
    }
  }
  send(ws, 'jobs:run:done', { jobId, background: false, exitCode, latestRun, logTail });
}

async function handleJobsStop(ws, msg) {
  const repoRoot = resolveRepoRoot();
  const jobId = String(msg.jobId || '').trim();
  if (!jobId) {
    send(ws, 'error', { message: 'jobs:stop 需要 jobId' });
    return;
  }
  const lock = readJobLockFile(repoRoot, jobId);
  if (!lock?.pid) {
    send(ws, 'jobs:stop:done', { jobId, ok: false, message: '无运行中进程' });
    logLine(ws, `[jobs] Job「${jobId}」未在运行`, 'info');
    return;
  }
  try {
    process.kill(lock.pid, 'SIGTERM');
    send(ws, 'jobs:stop:done', { jobId, ok: true, pid: lock.pid });
    logLine(ws, `[jobs] 已向 Job「${jobId}」发送 SIGTERM (pid=${lock.pid})`, 'warn');
  } catch (e) {
    send(ws, 'jobs:stop:done', { jobId, ok: false, message: errText(e) });
    send(ws, 'error', { message: `停止 Job 失败: ${errText(e)}` });
  }
}

async function repoLoadOptimized(ws, msg) {
  const repoRoot = resolveRepoRoot();
  const specRel = String(msg.specRelative || '').trim().replace(/\\/g, '/');
  if (!specRel) {
    send(ws, 'error', { message: '请指定 specRelative' });
    return;
  }
  try {
    const abs = assertAllowedOptimizedSpec(repoRoot, specRel);
    if (!fs.existsSync(abs)) {
      send(ws, 'error', { message: `文件不存在: ${specRel}` });
      return;
    }
    const code = fs.readFileSync(abs, 'utf8');
    send(ws, 'repo:load-optimized:done', { specRelative: specRel, code });
  } catch (e) {
    send(ws, 'error', { message: errText(e) });
  }
}

async function repoDeleteOptimizedSpecs(ws, session, msg) {
  const repoRoot = resolveRepoRoot();
  if (!fs.existsSync(path.join(repoRoot, 'playwright.config.ts'))) {
    send(ws, 'error', { message: '未找到项目根，无法删除用例' });
    return;
  }
  const list = Array.isArray(msg.specRelatives)
    ? msg.specRelatives
    : msg.specRelative
      ? [msg.specRelative]
      : [];
  const specs = [...new Set(list.map((s) => String(s || '').trim().replace(/\\/g, '/')).filter(Boolean))];
  if (!specs.length) {
    send(ws, 'error', { message: '请指定要删除的 tests/optimized/.../*.optimized.spec.ts' });
    return;
  }

  const deleted = [];
  const failed = [];
  for (const specRel of specs) {
    if (isDraftOptimizedPath(specRel)) {
      failed.push({ specRelative: specRel, error: '不允许删除草稿用例' });
      continue;
    }
    try {
      const abs = assertAllowedOptimizedSpec(repoRoot, specRel);
      if (!fs.existsSync(abs)) {
        failed.push({ specRelative: specRel, error: '文件不存在' });
        continue;
      }
      fs.unlinkSync(abs);
      specMeta.deleteSpecMetaFile(repoRoot, specRel);
      deleted.push(specRel);
      logLine(ws, `[repo] 已删除用例: ${specRel}`, 'ok');
    } catch (e) {
      failed.push({ specRelative: specRel, error: errText(e) });
    }
  }

  const optimizedSpecEntries = listOptimizedSpecEntries(repoRoot, {
    limit: 40,
    env: getSessionPlaywrightEnv(session),
  });
  send(ws, 'repo:delete-spec:done', {
    deleted,
    failed,
    optimizedSpecs: optimizedSpecEntries.map((e) => e.rel),
    optimizedSpecEntries,
    profileCounts: specMeta.summarizeProfileCounts(optimizedSpecEntries),
    repoRoot,
  });
  if (deleted.length && failed.length) {
    logLine(ws, `[repo] 删除完成：成功 ${deleted.length}，失败 ${failed.length}`, 'warn');
  } else if (failed.length) {
    logLine(ws, `[repo] 删除失败 ${failed.length} 项`, 'err');
  }
}

async function repoCleanSpecScreenshots(ws, session, msg) {
  const repoRoot = resolveRepoRoot();
  if (!fs.existsSync(path.join(repoRoot, 'playwright.config.ts'))) {
    send(ws, 'error', { message: '未找到项目根，无法清理截图' });
    return;
  }

  const mode = msg.mode === 'latest' ? 'latest' : 'all';
  const list = Array.isArray(msg.specRelatives)
    ? msg.specRelatives
    : msg.specRelative
      ? [msg.specRelative]
      : [];
  const specs = [...new Set(list.map((s) => String(s || '').trim().replace(/\\/g, '/')).filter(Boolean))];
  if (!specs.length) {
    send(ws, 'error', { message: '请指定要清理截图的 tests/optimized/.../*.optimized.spec.ts' });
    return;
  }

  const results = [];
  const failed = [];
  for (const specRel of specs) {
    try {
      assertAllowedOptimizedSpec(repoRoot, specRel);
      const result = cleanSpecScreenshots(repoRoot, specRel, { mode, cleanDiffs: true });
      results.push(result);
      if (result.removed.length) {
        const detail =
          mode === 'latest'
            ? `${result.removedRuns} 个 run 目录`
            : result.screenshotDir || specRel;
        logLine(ws, `[repo] 已清理截图 (${mode}): ${specRel} · ${detail}`, 'ok');
      } else {
        logLine(ws, `[repo] 无需清理 (${mode}): ${specRel} — ${result.message || '无截图'}`, 'dim');
      }
    } catch (e) {
      failed.push({ specRelative: specRel, error: errText(e) });
      logLine(ws, `[repo] 清理截图失败 ${specRel}: ${errText(e)}`, 'err');
    }
  }

  send(ws, 'repo:clean-screenshots:done', { mode, results, failed });
}

/** 仅允许通过 Studio 暴露仓库内 results/ 与 screenshots/（对比报告 HTML 引用 ../screenshots） */
function resolveRepoPublicReadFile(repoRoot, urlRel) {
  const rel = decodeURIComponent(String(urlRel || '').replace(/\\/g, '/')).replace(/^\/+/, '');
  if (!rel || rel.split('/').some((s) => !s || s === '..')) return null;
  const abs = path.normalize(path.join(repoRoot, ...rel.split('/')));
  const root = path.resolve(repoRoot);
  if (!abs.startsWith(root + path.sep)) return null;
  const fromRoot = path.relative(root, abs).replace(/\\/g, '/');
  const top = fromRoot.split('/')[0];
  if (top !== 'results' && top !== 'screenshots') return null;
  return abs;
}

function cancelRepoCompare(session) {
  session.repoCompareCancelled = true;
  if (session.repoCompareProc) {
    try {
      session.repoCompareProc.kill('SIGTERM');
    } catch {
      /* ignore */
    }
    session.repoCompareProc = null;
  }
}

const COMPARE_REPORT_REL = path.join('results', 'screenshot-comparison.html');

function repoHasScreenshotPng(dir) {
  if (!fs.existsSync(dir)) return false;
  let found = false;
  const walk = (current) => {
    if (found) return;
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (found) break;
      if (ent.name.startsWith('.')) continue;
      const full = path.join(current, ent.name);
      if (ent.isFile() && /\.png$/i.test(ent.name)) {
        found = true;
        break;
      }
      if (ent.isDirectory()) walk(full);
    }
  };
  walk(dir);
  return found;
}

function compareReportOpenPath() {
  return `/repo-report/${COMPARE_REPORT_REL.split(path.sep).join('/')}`;
}

function sendCompareReportReady(ws, extra = {}) {
  send(ws, 'repo:compare-report:done', { ok: true, openPath: compareReportOpenPath(), ...extra });
  logLine(ws, `[repo] 对比报告就绪: ${compareReportOpenPath()}`, 'ok');
}

function readUiIssuesSummary(repoRoot) {
  const p = path.join(repoRoot, 'results/ui-issues.json');
  if (!fs.existsSync(p)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(p, 'utf-8'));
    return data.summary || null;
  } catch {
    return null;
  }
}

function getCompareReportStatus(repoRoot) {
  const absReport = path.join(repoRoot, COMPARE_REPORT_REL);
  const hasReport = fs.existsSync(absReport);
  const hasScreenshots = repoHasScreenshotPng(path.join(repoRoot, 'screenshots'));
  return {
    hasReport,
    hasScreenshots,
    openPath: hasReport ? compareReportOpenPath() : null,
    reportRel: COMPARE_REPORT_REL,
    uiIssues: readUiIssuesSummary(repoRoot),
  };
}

async function runRepoPromoteBaseline(ws, session, msg) {
  const repoRoot = resolveRepoRoot();
  const scriptKey = String(msg.scriptKey || msg.script || '').trim();
  const runTs = String(msg.runTimestamp || msg.run || '').trim();
  const browser = String(msg.browser || 'chrome').trim().toLowerCase();

  if (!scriptKey || !runTs) {
    send(ws, 'error', { message: 'promote 需要 scriptKey 与 runTimestamp' });
    send(ws, 'repo:promote-baseline:done', { ok: false });
    return;
  }

  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const args = [
    'run',
    'promote-baseline',
    '--',
    `--script=${scriptKey}`,
    `--run=${runTs}`,
    `--browser=${browser}`,
  ];
  logLine(ws, `[repo] promote-baseline ${scriptKey} @ ${runTs}`, 'info');
  const proc = spawn(npmCmd, args, {
    cwd: repoRoot,
    env: buildRepoSpawnEnv(session),
    shell: false,
  });
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
  if (exitCode !== 0) {
    send(ws, 'error', { message: `promote-baseline 退出码 ${exitCode}` });
    send(ws, 'repo:promote-baseline:done', { ok: false });
    return;
  }
  send(ws, 'repo:promote-baseline:done', { ok: true, scriptKey, runTimestamp: runTs });
  logLine(ws, '[repo] Golden 基线已更新', 'ok');
}

async function sendRepoUiIssues(ws) {
  const repoRoot = resolveRepoRoot();
  const p = path.join(repoRoot, 'results/ui-issues.json');
  if (!fs.existsSync(p)) {
    send(ws, 'repo:ui-issues', { ok: true, issues: [], summary: null });
    return;
  }
  try {
    const data = JSON.parse(fs.readFileSync(p, 'utf-8'));
    send(ws, 'repo:ui-issues', { ok: true, ...data });
  } catch (e) {
    send(ws, 'error', { message: `读取 ui-issues.json 失败: ${e.message}` });
    send(ws, 'repo:ui-issues', { ok: false });
  }
}

function sendCompareReportStatus(ws, repoRoot) {
  send(ws, 'repo:compare-report:status', getCompareReportStatus(repoRoot));
}

async function openRepoCompareReport(ws, session, { regenerate = false } = {}) {
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

  await runRepoCompareReport(ws, session);
}

async function runRepoCompareReport(ws, session) {
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
  const proc = spawn(npmCmd, ['run', 'compare-screenshots', '--'], {
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

// ── Setup ───────────────────────────────────────────────────────────────
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use((req, res, next) => {
  if (req.method !== 'GET' || !req.path.startsWith('/repo-report/')) return next();
  const repoRoot = resolveRepoRoot();
  const tail = req.path.slice('/repo-report/'.length);
  let abs;
  try {
    abs = resolveRepoPublicReadFile(repoRoot, tail);
  } catch {
    res.status(400).send('Bad path');
    return;
  }
  if (!abs || !fs.existsSync(abs)) {
    res.status(404).send('Not found');
    return;
  }
  res.sendFile(abs, (err) => {
    if (err && !res.headersSent) res.status(500).send(String(err.message || err));
  });
});

app.use(express.static(path.join(__dirname, 'public')));
app.use("/results", express.static(path.join(__dirname, "..", "results")));
app.use("/screenshots", express.static(path.join(__dirname, "..", "screenshots")));
app.use(express.json());

// ── State per connection ────────────────────────────────────────────────
const sessions = new Map();
/** 会话工作目录放在项目内，便于 Playwright 从测试文件解析 node_modules/@playwright/test */
const SESSION_WORK_ROOT = path.join(__dirname, '.pw-studio');

function ensureSessionWorkRoot() {
  fs.mkdirSync(SESSION_WORK_ROOT, { recursive: true });
}

function makeSession() {
  ensureSessionWorkRoot();
  return {
    recording: false,
    recordProc: null,
    runProc: null,
    optimizeRunning: false,
    optimizeCancelled: false,
    runCancelled: false,
    rawCode: '',
    optCode: '',
    runResult: null,
    tmpDir: fs.mkdtempSync(path.join(SESSION_WORK_ROOT, 'run-')),
    /** 界面传入的密钥，优先于环境变量；null 表示使用环境变量 */
    apiKeys: { anthropic: null, deepseek: null },
    repoPipelineProc: null,
    repoTestProc: null,
    repoPipelineCancelled: false,
    repoTestCancelled: false,
    repoCompareProc: null,
    repoCompareCancelled: false,
    repoBatchCancelled: false,
    repoBatchRunning: false,
    lastBatchRunComplete: false,
    lastSavedRelative: null,
    draftRelativePath: null,
    draftOptimizedRelative: DRAFT_OPTIMIZED_RELATIVE,
    suggestedFormalRelative: null,
    lastPrimaryOptimizedRelative: null,
    optimizedSpecs: [],
    playwrightEnv: process.env.PLAYWRIGHT_ENV || DEFAULT_PLAYWRIGHT_ENV,
    accountProfile: process.env.PLAYWRIGHT_ACCOUNT || 'default',
  };
}

function cancelOptimize(session) {
  session.optimizeCancelled = true;
}

function cancelRun(session) {
  session.runCancelled = true;
  if (session.runProc) {
    try {
      session.runProc.kill('SIGTERM');
    } catch {
      /* ignore */
    }
    session.runProc = null;
  }
}

// ── Helpers（send/logLine/now/stripAnsi/errText 见 ./lib/ws-safe.js）────

function findLastFailedStep(steps) {
  if (!Array.isArray(steps)) return null;
  let hit = null;
  for (const s of steps) {
    if (s.error) hit = s;
    const inner = findLastFailedStep(s.steps);
    if (inner) hit = inner;
  }
  return hit;
}

/** 从 Playwright JSON 报告提取结构化失败列表（不写日志） */
function parsePlaywrightFailures(result, session, exitCode) {
  const failures = [];

  const pushFailure = (item) => {
    failures.push(item);
  };

  function walkSuites(suites, suitePath) {
    for (const suite of suites || []) {
      const pathLabel = suitePath
        ? `${suitePath} › ${suite.title || suite.file || ''}`
        : (suite.title || suite.file || '套件');
      for (const spec of suite.specs || []) {
        const specTitle = spec.title || '未命名用例';
        const loc = spec.file != null
          ? `${spec.file}${spec.line ? `:${spec.line}` : ''}`
          : (suite.file || session?.tmpDir || '');

        for (const test of spec.tests || []) {
          const testStatus = test.status;
          const results = test.results || [];
          const failedResults = results.filter((r) =>
            r.status === 'failed' || r.status === 'timedOut' || r.status === 'interrupted',
          );

          if (spec.ok !== false && testStatus !== 'unexpected' && failedResults.length === 0) continue;

          for (const r of failedResults.length ? failedResults : results.slice(-1)) {
            const msg = errText(r.error) || errText(r.errors?.[0]);
            if (!msg && spec.ok !== false) continue;

            const failedStep = findLastFailedStep(r.steps);
            const allSteps = [];
            const collectSteps = (steps, depth = 0) => {
              for (const s of steps || []) {
                allSteps.push(`${'  '.repeat(depth)}${s.title} (${s.duration || 0}ms)`);
                collectSteps(s.steps, depth + 1);
              }
            };
            collectSteps(r.steps);

            let hint = '';
            if (/locator\.\w+:\s*Timeout|waiting for locator/i.test(msg)) {
              hint = '单步操作超时：在限定时间内未找到/未点到目标元素。常见原因：iframe 未加载完、文案与录制时不一致（若未设 locale，页面可能是英文）。执行测试已默认 locale=zh-CN；仍失败可在点击前 waitFor iframe，或 export PW_ACTION_TIMEOUT=60000。';
            } else if (/Test timeout of/i.test(msg)) {
              hint = '整条用例总超时（默认 120s）。可 export PW_TEST_TIMEOUT=180000；并检查脚本是否含过多 waitForTimeout，可再点 AI 优化移除硬等待。';
            } else if (/timeout.*exceeded/i.test(msg)) {
              hint = '执行超时。请根据上方 Call log 查看卡在哪一步，并酌情调整 PW_TEST_TIMEOUT / PW_ACTION_TIMEOUT。';
            } else if (/net::|ERR_|ECONNREFUSED|ENOTFOUND/i.test(msg)) {
              hint = '网络或目标 URL 无法访问，请检查录制脚本里的地址与本机网络。';
            } else if (/locator|selector|not found|strict mode/i.test(msg)) {
              hint = '元素定位失败，页面结构可能已变，建议重新录制或调整选择器。';
            }

            pushFailure({
              title: `${pathLabel} › ${specTitle}`,
              location: loc,
              status: r.status || testStatus,
              durationMs: r.duration,
              lastStep: failedStep?.title || (allSteps.length ? allSteps[allSteps.length - 1] : null),
              message: msg,
              snippet: r.error?.snippet || spec.tests?.[0]?.results?.[0]?.error?.snippet,
              hint,
            });
          }
        }
      }
      walkSuites(suite.suites, pathLabel);
    }
  }

  walkSuites(result.suites, '');

  if (Array.isArray(result.errors)) {
    for (const err of result.errors) {
      const msg = errText(err);
      if (!msg) continue;
      if (failures.some((f) => f.message === msg)) continue;
      pushFailure({
        title: '运行前错误（未执行到用例）',
        location: err.location?.file
          ? `${err.location.file}:${err.location.line || 1}`
          : '',
        status: 'error',
        message: msg,
        hint: /No tests found/i.test(msg)
          ? '未找到测试文件，请确认「优化脚本」或「录制脚本」为合法 Playwright 代码。'
          : '',
      });
    }
  }

  if (failures.length === 0 && exitCode !== 0) {
    pushFailure({
      title: '执行失败（未解析到详细项）',
      location: '',
      status: 'error',
      message: `进程退出码 ${exitCode}`,
      hint: '请展开控制台 Playwright 原始输出，或改用无头模式以生成 JSON 失败详情。',
    });
  }

  return failures;
}

/** 从 Playwright JSON 报告提取失败信息并写入控制台日志 */
function logPlaywrightFailureReport(ws, result, session, exitCode) {
  const failures = parsePlaywrightFailures(result, session, exitCode);
  let blockIndex = 0;

  const logFailure = (item) => {
    blockIndex += 1;
    logLine(ws, `──── 失败 ${blockIndex} ────`, 'err');
    if (item.title) logLine(ws, `用例: ${item.title}`, 'err');
    if (item.location) logLine(ws, `位置: ${item.location}`, 'err');
    if (item.status) logLine(ws, `状态: ${item.status}`, 'err');
    if (item.durationMs != null) logLine(ws, `耗时: ${(item.durationMs / 1000).toFixed(1)}s`, 'dim');
    if (item.lastStep) logLine(ws, `卡住步骤: ${item.lastStep}`, 'warn');
    if (item.message) {
      const lines = item.message.split('\n').slice(0, 12);
      lines.forEach((line) => {
        if (line.trim()) logLine(ws, line.trim(), 'err');
      });
    }
    if (item.snippet) {
      item.snippet.split('\n').slice(0, 8).forEach((line) => logLine(ws, `  ${line}`, 'dim'));
    }
    if (item.hint) logLine(ws, `提示: ${item.hint}`, 'warn');
  };

  for (const item of failures) logFailure(item);

  if (failures.length === 0 && exitCode !== 0) {
    logLine(ws, '未解析到详细失败项，请展开上方 Playwright 原始输出', 'warn');
    if (session?.tmpDir) {
      logLine(ws, `工作目录: ${session.tmpDir}`, 'dim');
      logLine(ws, `可本地调试: cd ${session.tmpDir} && npx playwright test --config playwright.config.cjs`, 'dim');
    }
  } else if (failures.length > 0) {
    logLine(ws, `共 ${failures.length} 条失败记录（见上方「失败 N」）`, 'warn');
  }

  if (session) session.lastRunFailures = failures;
  return failures;
}

function headedFailurePlaceholder(specRel) {
  return [
    {
      title: specRel || '用例执行',
      location: specRel || '',
      status: 'headed',
      message: '有界面模式未生成 JSON 结构化失败报告。',
      hint: '请在浏览器窗口查看失败步骤；如需复制结构化信息，请使用无头模式重新执行。',
    },
  ];
}

// ── Record ───────────────────────────────────────────────────────────────
/**
 * 启动 playwright codegen 录制
 * 实际项目中使用：npx playwright codegen --output=xxx.ts <url>
 */
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
  const cwd = repoReady ? repoRoot : __dirname;
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

  // 真实命令：spawn playwright codegen（与 npm run record 对齐：baseURL + storageState + PLAYWRIGHT_ENV 上下文）
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

  } catch (err) {
    // Fallback: 模拟录制（当 playwright 未安装时）
    logLine(ws, '[演示模式] playwright codegen 不可用，使用模拟录制', 'warn');
    simulateRecording(ws, session, recordUrl);
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
  // 用户关闭 codegen 浏览器时进程可能已退出，勿再 SIGTERM 并空等 12s
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

function simulateRecording(ws, session, url) {
  let elapsed = 0;
  const interval = setInterval(() => {
    elapsed++;
    if (!session.recording || elapsed > 30) {
      clearInterval(interval);
      if (session.recording) stopRecording(ws, session);
    }
  }, 1000);
  session._simInterval = interval;
}

function generateSampleScript(url) {
  return `import { test, expect } from '@playwright/test';

test('recorded test', async ({ page }) => {
  await page.goto('${url}');
  await page.waitForTimeout(2000);
  
  // 点击导航链接
  await page.click('a[href="/docs"]');
  await page.waitForTimeout(1500);
  
  // 搜索输入
  await page.click('input[type="search"]');
  await page.fill('input[type="search"]', 'playwright test');
  await page.waitForTimeout(1000);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2000);
  
  // 点击搜索结果
  await page.click('.search-result:first-child a');
  await page.waitForTimeout(1500);
  
  // 验证页面
  const title = await page.title();
  console.log('Page title:', title);
});
`;
}

// ── Optimize (Claude / DeepSeek API) ────────────────────────────────────
function getOptimizeApiKeys(session, msg) {
  // 界面非空密钥写入会话；留空不覆盖会话中已有值，以便继续用环境变量
  if (msg.anthropicApiKey !== undefined) {
    const t = String(msg.anthropicApiKey ?? '').trim();
    if (t) session.apiKeys.anthropic = t;
  }
  if (msg.deepseekApiKey !== undefined) {
    const t = String(msg.deepseekApiKey ?? '').trim();
    if (t) session.apiKeys.deepseek = t;
  }
  return {
    anthropic: session.apiKeys.anthropic || ANTHROPIC_API_KEY || null,
    deepseek: session.apiKeys.deepseek || DEEPSEEK_API_KEY || null,
  };
}

/**
 * @param {'claude'|'deepseek'|undefined} explicit 侧栏所选模型
 * @returns {{ provider: 'claude'|'deepseek', fallback: boolean }}
 */
function resolveOptimizeProvider(explicit, keys) {
  const hasAnthropic = Boolean(keys.anthropic);
  const hasDeepseek = Boolean(keys.deepseek);

  if (explicit === 'claude' || explicit === 'deepseek') {
    const selected = explicit;
    const hasSelected = selected === 'claude' ? hasAnthropic : hasDeepseek;
    if (hasSelected) return { provider: selected, fallback: false };
    const alt = selected === 'claude' ? 'deepseek' : 'claude';
    const hasAlt = alt === 'deepseek' ? hasDeepseek : hasAnthropic;
    if (hasAlt) return { provider: alt, fallback: true };
    return { provider: selected, fallback: false };
  }

  if (hasAnthropic) return { provider: 'claude', fallback: false };
  if (hasDeepseek) return { provider: 'deepseek', fallback: false };
  return { provider: 'claude', fallback: false };
}

function logOptimizeProviderChoice(ws, requested, resolved, keys, fallback) {
  const keyHint = (p) => {
    if (p === 'claude') {
      return keys.anthropic
        ? (keys.anthropic === ANTHROPIC_API_KEY ? '环境变量 ANTHROPIC_API_KEY' : '界面 Anthropic 密钥')
        : '无';
    }
    return keys.deepseek
      ? (keys.deepseek === DEEPSEEK_API_KEY ? '环境变量 DEEPSEEK_API_KEY' : '界面 DeepSeek 密钥')
      : '无';
  };
  const name = resolved === 'claude' ? 'Claude (Anthropic)' : 'DeepSeek';
  if (fallback) {
    const reqName = requested === 'claude' ? 'Claude' : 'DeepSeek';
    logLine(ws, `侧栏已选 ${reqName}，但未配置对应密钥，已改用 ${name}（${keyHint(resolved)}）`, 'warn');
  } else {
    logLine(ws, `使用 ${name} 优化，密钥来源：${keyHint(resolved)}`, 'info');
  }
}

/**
 * DeepSeek OpenAI 兼容流式接口，SSE data 行解析
 */
async function streamDeepSeekChat(prompt, onChunk, apiKeyOverride) {
  const apiKey = apiKeyOverride || DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY 未配置');

  const url = `${DEEPSEEK_API_BASE}/chat/completions`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      messages: [{ role: 'user', content: prompt }],
      stream: true,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`DeepSeek API ${res.status}: ${errText.slice(0, 240)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const data = trimmed.slice(5).trim();
      if (data === '[DONE]') continue;
      try {
        const json = JSON.parse(data);
        const piece = json.choices?.[0]?.delta?.content;
        if (piece) onChunk(piece);
      } catch {
        // 忽略不完整 JSON 行
      }
    }
  }

  if (buffer.trim()) {
    const trimmed = buffer.trim();
    if (trimmed.startsWith('data:')) {
      const data = trimmed.slice(5).trim();
      if (data !== '[DONE]') {
        try {
          const json = JSON.parse(data);
          const piece = json.choices?.[0]?.delta?.content;
          if (piece) onChunk(piece);
        } catch {
          /* ignore */
        }
      }
    }
  }
}

async function optimizeCode(ws, session, code, opts, providerHint, msgKeys) {
  session.optimizeRunning = true;
  session.optimizeCancelled = false;

  const keys = getOptimizeApiKeys(session, msgKeys || {});
  const { provider, fallback } = resolveOptimizeProvider(providerHint, keys);
  send(ws, 'optimize:start', { provider, requested: providerHint || null, fallback });
  logOptimizeProviderChoice(ws, providerHint, provider, keys, fallback);

  const checks = [
    opts.selector && '- 将脆弱的 CSS/XPath 选择器替换为 getByRole、getByLabel、getByTestId 等语义化选择器',
    opts.assert   && '- 在关键操作后插入 expect 断言，验证 URL、元素可见性、文本内容等',
    opts.wait     && '- 移除所有 waitForTimeout 硬等待，改用 Playwright 内置的 auto-waiting 或 waitForSelector',
    opts.env      && '- 将 URL、账号密码等硬编码常量抽取为 process.env 环境变量',
    opts.pom      && '- 将页面交互逻辑封装为 Page Object 类',
    opts.comment  && '- 为每个关键步骤添加中文注释',
  ].filter(Boolean).join('\n');

  const prompt = `你是一个资深 Playwright 测试工程师。请优化以下录制的 Playwright 测试脚本。

优化要求：
${checks}

其他要求：
- 保持测试逻辑和用例结构不变
- 输出完整可运行的 TypeScript 代码
- 只输出代码本身，不要 markdown 代码块标记（不要 \`\`\`typescript 等）
- 代码要符合 Playwright 最佳实践

待优化的原始脚本：
${code}`;

  try {
    let fullCode = '';

    if (provider === 'claude') {
      if (!keys.anthropic) throw new Error('ANTHROPIC_API_KEY 未配置（请填写 Anthropic 密钥或配置环境变量）');

      const client = new Anthropic({ apiKey: keys.anthropic });
      const stream = await client.messages.stream({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }],
      });

      for await (const chunk of stream) {
        if (session.optimizeCancelled) break;
        if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
          const text = chunk.delta.text;
          fullCode += text;
          send(ws, 'optimize:stream', { chunk: text });
        }
      }
    } else {
      if (!keys.deepseek) throw new Error('DEEPSEEK_API_KEY 未配置（请填写 DeepSeek 密钥或配置环境变量）');
      await streamDeepSeekChat(
        prompt,
        (text) => {
          if (session.optimizeCancelled) return;
          fullCode += text;
          send(ws, 'optimize:stream', { chunk: text });
        },
        keys.deepseek,
      );
    }

    if (session.optimizeCancelled) {
      send(ws, 'optimize:cancelled');
      return;
    }

    fullCode = fullCode.replace(/```typescript\n?|```ts\n?|```\n?/g, '').trim();
    session.optCode = fullCode;

    const rawLines = code.split('\n').length;
    const optLines = fullCode.split('\n').length;

    send(ws, 'optimize:done', {
      code: fullCode,
      lines: optLines,
      removed: Math.max(0, rawLines - optLines),
      demo: false,
    });

  } catch (err) {
    if (session.optimizeCancelled) {
      send(ws, 'optimize:cancelled');
      return;
    }
    // Fallback: 演示模拟优化
    logLine(ws, `[演示模式] ${err.message}，使用示例优化结果`, 'warn');
    await simulateOptimize(ws, session, code, opts, err.message);
  } finally {
    session.optimizeRunning = false;
  }
}

async function simulateOptimize(ws, session, code, opts, demoReason = 'API 不可用') {
  // 基于原始脚本做简单文本替换演示
  let result = code;

  if (opts.wait) {
    result = result.replace(/await page\.waitForTimeout\(\d+\);?\n?/g, '');
  }
  if (opts.selector) {
    result = result.replace(/await page\.click\('a\[href="\/docs"\]'\)/g,
      "await page.getByRole('link', { name: 'Docs' }).click()");
    result = result.replace(/await page\.click\('input\[type="search"\]'\)/g,
      "await page.getByRole('searchbox').click()");
    result = result.replace(/await page\.fill\('input\[type="search"\],/g,
      "await page.getByRole('searchbox').fill(");
    result = result.replace(/await page\.click\('\.search-result:first-child a'\)/g,
      "await page.getByRole('link').first().click()");
  }
  if (opts.assert) {
    result = result.replace(
      "const title = await page.title();\n  console.log('Page title:', title);",
      "await expect(page).toHaveTitle(/Playwright/);\n  await expect(page.getByRole('main')).toBeVisible();"
    );
  }
  if (opts.env) {
    result = result.replace(/('https?:\/\/[^'"]+')/, 'process.env.BASE_URL || $1');
  }
  if (opts.comment) {
    result = result.replace(
      "await page.goto(",
      "// 导航到目标页面\n  await page.goto("
    );
  }

  // Stream character by character for effect
  const chars = result.split('');
  let buf = '';
  for (let i = 0; i < chars.length; i++) {
    if (session.optimizeCancelled) {
      send(ws, 'optimize:cancelled');
      return;
    }
    buf += chars[i];
    if (i % 8 === 0) {
      send(ws, 'optimize:stream', { chunk: buf });
      buf = '';
      await new Promise(r => setTimeout(r, 5));
    }
  }
  if (session.optimizeCancelled) {
    send(ws, 'optimize:cancelled');
    return;
  }
  if (buf) send(ws, 'optimize:stream', { chunk: buf });

  session.optCode = result;
  send(ws, 'optimize:done', {
    code: result,
    lines: result.split('\n').length,
    removed: code.split('\n').length - result.split('\n').length,
    demo: true,
    demoReason,
  });
}

// ── Run ──────────────────────────────────────────────────────────────────
async function runScript(ws, session, code, runOpts = {}) {
  session.runCancelled = false;
  send(ws, 'run:start');

  const uiMode = Boolean(runOpts.ui);
  const headedMode = Boolean(runOpts.headed);
  const debugMode = Boolean(runOpts.debug);
  const interactiveMode = uiMode || debugMode;
  const showBrowser = uiMode || headedMode || debugMode;
  const specFile = path.join(session.tmpDir, 'test.spec.ts');
  fs.writeFileSync(specFile, code);

  // 纯 CommonJS，避免在临时目录 require('@playwright/test') 失败；cwd 使用项目根以解析依赖
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
    // macOS 上若未 npx playwright install，可用本机 Google Chrome
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
        NODE_PATH: path.join(__dirname, 'node_modules'),
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
        // Playwright JSON：expected=通过，unexpected=失败，flaky=重试后通过，skipped=跳过（勿用 expected - unexpected，否则会出现 -1）
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

async function simulateRun(ws, session, code, startTime) {
  const steps = [
    ['info', 'Chromium 已启动'],
    ['dim', '导航到目标 URL...'],
    ['ok', 'page.goto() ✓'],
    ['dim', '执行操作步骤...'],
    ['ok', 'getByRole().click() ✓'],
    ['ok', 'getByRole().fill() ✓'],
    ['ok', 'expect().toHaveURL() ✓'],
    ['ok', 'expect().toBeVisible() ✓'],
    ['ok', 'expect().toHaveTitle() ✓'],
    ['ok', '用例 "recorded test" 通过 ✓'],
  ];

  for (const [level, text] of steps) {
    await new Promise(r => setTimeout(r, 300));
    logLine(ws, text, level);
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  session.runResult = { passed: 1, failed: 0, total: 1, duration };
  send(ws, 'run:done', { passed: 1, failed: 0, total: 1, duration });
}

// ── Report ────────────────────────────────────────────────────────────────
function generateReport(ws, session) {
  const result = session.runResult || { passed: 0, failed: 0, total: 0, duration: '0' };

  const rawLines = session.rawCode.split('\n').filter(Boolean).length;
  const optLines = session.optCode.split('\n').filter(Boolean).length;
  const rawWaits = (session.rawCode.match(/waitForTimeout/g) || []).length;
  const optAsserts = (session.optCode.match(/expect\(/g) || []).length;

  const reportData = {
    ...result,
    tests: [
      { name: 'recorded test', status: result.failed === 0 ? 'passed' : 'failed', duration: Math.round(parseFloat(result.duration) * 1000) },
    ],
    optimizations: [
      { label: '原始脚本行数', value: `${rawLines} 行`, type: 'warn' },
      { label: '优化后行数', value: `${optLines} 行`, type: 'ok' },
      { label: '移除硬等待', value: `${rawWaits} 处`, type: 'ok' },
      { label: '新增断言', value: `${optAsserts} 处`, type: 'ok' },
      { label: '语义化选择器', value: `已替换`, type: 'ok' },
    ],
  };

  // Write HTML report
  const reportHtml = buildHtmlReport(reportData, session.optCode);
  const reportFile = path.join(session.tmpDir, 'report.html');
  fs.writeFileSync(reportFile, reportHtml);

  send(ws, 'report:done', { data: reportData, file: reportFile });
}

function buildHtmlReport(data, code) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8"><title>Playwright Studio Report</title>
<style>
body{font-family:monospace;background:#0a0c10;color:#e8edf5;padding:32px;max-width:900px;margin:0 auto}
h1{font-size:24px;margin-bottom:24px;color:#00d97e}
.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:24px}
.card{background:#151921;border-radius:10px;padding:16px;border:1px solid rgba(255,255,255,.07)}
.val{font-size:28px;font-weight:700;margin-bottom:4px}
.lbl{font-size:11px;color:#6b7a99}
.ok{color:#00d97e}.fail{color:#ff4d6a}.info{color:#4d9fff}.warn{color:#f5a623}
pre{background:#151921;border-radius:10px;padding:20px;overflow-x:auto;font-size:11px;line-height:1.7;border:1px solid rgba(255,255,255,.07)}
.meta{color:#6b7a99;font-size:11px;margin-bottom:24px}
</style></head>
<body>
<h1>📊 Playwright Studio Report</h1>
<div class="meta">生成时间: ${new Date().toLocaleString('zh-CN')}</div>
<div class="grid">
<div class="card"><div class="val ok">${data.passed}</div><div class="lbl">通过</div></div>
<div class="card"><div class="val fail">${data.failed}</div><div class="lbl">失败</div></div>
<div class="card"><div class="val info">${data.total}</div><div class="lbl">总用例</div></div>
<div class="card"><div class="val warn">${data.duration}s</div><div class="lbl">耗时</div></div>
</div>
<h2 style="font-size:14px;margin-bottom:12px;color:#6b7a99">优化后脚本</h2>
<pre>${code.replace(/</g,'&lt;')}</pre>
</body></html>`;
}

// ── Export ────────────────────────────────────────────────────────────────
app.get('/download/spec', (req, res) => {
  const sessionId = req.query.sid;
  const session = sessions.get(sessionId);
  if (!session || !session.optCode) return res.status(404).send('Not found');
  res.setHeader('Content-Disposition', 'attachment; filename="recorded.spec.ts"');
  res.setHeader('Content-Type', 'text/plain');
  res.send(session.optCode);
});

app.get('/download/report', (req, res) => {
  const sessionId = req.query.sid;
  const session = sessions.get(sessionId);
  const file = path.join(session?.tmpDir || '', 'report.html');
  if (!session || !fs.existsSync(file)) return res.status(404).send('Not found');
  res.sendFile(file);
});


// ── 飞书卡片回调 ────────────────────────────────────────────────────────────
const FEISHU_VERIFICATION_TOKEN = process.env.FEISHU_VERIFICATION_TOKEN || '';

app.post('/feishu/callback', express.json(), (req, res) => {
  const body = req.body || {};

  // URL 验证握手
  if (body.type === 'url_verification') {
    console.log('[feishu-callback] URL 验证');
    return res.json({ challenge: body.challenge || '' });
  }

  // 验证令牌
  const requestToken = req.headers['x-lark-request-token'];
  if (FEISHU_VERIFICATION_TOKEN && requestToken !== FEISHU_VERIFICATION_TOKEN) {
    console.log('[feishu-callback] 令牌验证失败');
    return res.status(403).json({ error: 'Invalid token' });
  }

  const action = body.action || {};
  const openId = body.open_id || '';
  const userName = body.user ? (body.user.name || '') : '';
  let value = {};
  try {
    value = typeof action.value === 'string' ? JSON.parse(action.value) : (action.value || {});
  } catch { value = { raw: action.value }; }

  const actionType = value.action || 'unknown';
  console.log(`[feishu-callback] action=${actionType}, user=${userName || openId}`);

  let responseMsg = '';
  let responseTemplate = 'green';

  switch (actionType) {
    case 'rerun_failed': {
      responseMsg = `已接受请求，正在重跑失败用例（由 ${userName || openId} 触发）`;
      console.log(`[feishu-callback] → 触发重跑: ${responseMsg}`);
      // 在后台异步触发重跑（不阻塞回调响应）
      setTimeout(() => {
        const { spawn } = require('child_process');
        const repoRoot = resolveRepoRoot();
        const child = spawn('npm', ['run', 'test-job', '--', 'run', '--id=rerun-failed', '--trigger=manual'], {
          cwd: repoRoot,
          stdio: 'ignore',
          detached: true,
          env: { ...process.env, PLAYWRIGHT_ENV: process.env.PLAYWRIGHT_ENV || 'stage' },
        });
        child.unref();
      }, 100);
      break;
    }
    case 'approve_baseline': {
      responseMsg = `已接受请求，正在晋升基线（由 ${userName || openId} 批准）`;
      console.log(`[feishu-callback] → 晋升基线: ${responseMsg}`);
      setTimeout(() => {
        const { execSync } = require('child_process');
        try {
          execSync('npm run promote-baseline', { cwd: resolveRepoRoot(), stdio: 'pipe' });
        } catch (e) {
          console.error('[feishu-callback] 晋升失败:', e.message);
        }
      }, 100);
      break;
    }
    default:
      responseMsg = `未知操作: ${actionType}`;
      responseTemplate = 'red';
  }

  // 返回卡片更新
  res.json({
    code: 0,
    msg: 'ok',
    data: {
      card: {
        header: {
          title: { tag: 'plain_text', content: actionType === 'unknown' ? '⚠️ 未知操作' : '✅ 操作已触发' },
          template: responseTemplate,
        },
        elements: [
          { tag: 'div', text: { tag: 'lark_md', content: responseMsg } },
          ...(actionType === 'approve_baseline' ? [{
            tag: 'div',
            text: { tag: 'lark_md', content: '基线晋升将在后台执行，请稍后在报告中查看结果。' },
          }] : []),
          ...(actionType === 'rerun_failed' ? [{
            tag: 'div',
            text: { tag: 'lark_md', content: '重跑将在后台执行，完成后会再次推送通知。' },
          }] : []),
        ],
      },
    },
  });
});
// ── WebSocket handler ─────────────────────────────────────────────────────
wss.on('connection', (ws) => {
  const sessionId = Math.random().toString(36).slice(2);
  const session = makeSession();
  sessions.set(sessionId, session);

  const root = resolveRepoRoot();
  const repoReady = fs.existsSync(path.join(root, 'playwright.config.ts'));
  const optimizedSpecEntries = repoReady
    ? listOptimizedSpecEntries(root, { limit: 40, env: getSessionPlaywrightEnv(session) })
    : [];
  const optimizedSpecs = optimizedSpecEntries.map((e) => e.rel);
  let draftOptimizedExists = false;
  let draftRecordingExists = false;
  let dateCategories = [];
  let dateCategoriesDescription = '';
  if (repoReady) {
    try {
      draftOptimizedExists = fs.existsSync(path.join(root, DRAFT_OPTIMIZED_RELATIVE));
      draftRecordingExists = hasDraftRecordingInRepo(root);
    } catch {
      /* ignore */
    }
    try {
      const cfg = loadDateCategoriesFile(root);
      dateCategories = normalizeDateCategoryList(cfg.dateCategories || []);
      dateCategoriesDescription = cfg.description || '';
    } catch (e) {
      console.warn(`[${now()}] 读取 date-categories 失败:`, errText(e));
    }
  }
  send(ws, 'repo:info', {
    repoRoot: root,
    repoReady,
    optimizedSpecs,
    optimizedSpecEntries,
    profileCounts: specMeta.summarizeProfileCounts(optimizedSpecEntries),
    draftOptimizedRelative: DRAFT_OPTIMIZED_RELATIVE,
    draftOptimizedExists,
    draftRecordingExists,
    dateCategories,
    dateCategoriesDescription,
    browserProjects: REPO_OPTIMIZED_PROJECTS,
    defaultBrowserProjects: DEFAULT_REPO_TEST_PROJECTS,
    optimizeKeys: {
      anthropic: Boolean(ANTHROPIC_API_KEY),
      deepseek: Boolean(DEEPSEEK_API_KEY),
    },
    compareReport: repoReady ? getCompareReportStatus(root) : {
      hasReport: false,
      hasScreenshots: false,
      openPath: null,
      reportRel: COMPARE_REPORT_REL,
    },
  });
  sendEnvInfo(ws, session, root, repoReady);

  console.log(`[${now()}] Client connected: ${sessionId}`);

  ws.on('message', async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    console.log(`[${now()}] MSG ${msg.type}`);

    try {
    switch (msg.type) {
      case 'record:start':
        if (msg.env) session.playwrightEnv = String(msg.env);
        session.lastUrl = msg.url;
        await startRecording(ws, session, msg.url);
        break;

      case 'env:set':
        setSessionPlaywrightEnv(ws, session, String(msg.env || ''));
        break;

      case 'account:set':
        setSessionAccountProfile(ws, session, String(msg.profile || ''));
        break;

      case 'account:login':
        await runAccountLogin(ws, session);
        break;

      case 'account:clear-storage':
        clearSessionStorage(ws, session);
        break;

      case 'record:stop':
        await stopRecording(ws, session);
        break;

      case 'optimize':
        await optimizeCode(ws, session, msg.code, msg.opts || {}, msg.provider, msg);
        break;

      case 'run':
        await runScript(ws, session, msg.code, {
          ui: Boolean(msg.ui),
          headed: Boolean(msg.headed),
          debug: Boolean(msg.debug),
        });
        break;

      case 'cancel:optimize':
        cancelOptimize(session);
        break;

      case 'cancel:run':
        cancelRun(session);
        break;

      case 'report':
        generateReport(ws, session);
        break;

      case 'export':
        send(ws, 'run:log', { text: `下载链接: /download/spec?sid=${sessionId}`, level: 'info' });
        break;

      case 'export:html':
        send(ws, 'run:log', { text: `下载链接: /download/report?sid=${sessionId}`, level: 'info' });
        break;

      case 'repo:save':
        await repoSave(ws, session, msg);
        break;

      case 'repo:commit-artifacts':
        await repoCommitArtifacts(ws, session, msg);
        break;

      case 'repo:suggest-path':
        await suggestRepoSavePath(ws, msg);
        break;

      case 'repo:list-optimized': {
        const repoRoot = resolveRepoRoot();
        if (!fs.existsSync(path.join(repoRoot, 'playwright.config.ts'))) {
          send(ws, 'error', { message: '未找到项目根，无法列出 optimized 用例' });
          break;
        }
        const accountProfile = msg.accountProfile != null ? String(msg.accountProfile).trim() : null;
        const optimizedSpecEntries = listOptimizedSpecEntries(repoRoot, {
          limit: msg.limit ?? 40,
          env: getSessionPlaywrightEnv(session),
          accountProfile: accountProfile || undefined,
        });
        send(ws, 'repo:list-optimized:done', {
          optimizedSpecs: optimizedSpecEntries.map((e) => e.rel),
          optimizedSpecEntries,
          profileCounts: specMeta.summarizeProfileCounts(
            listOptimizedSpecEntries(repoRoot, { limit: 200, env: getSessionPlaywrightEnv(session) }),
          ),
          repoRoot,
        });
        break;
      }

      case 'repo:pipeline':
        await runRepoPipeline(ws, session, msg);
        break;

      case 'repo:test':
        await runRepoTest(ws, session, msg);
        break;

      case 'repo:batch-test':
        await runRepoBatchTest(ws, session, msg);
        break;

      case 'repo:load-optimized':
        await repoLoadOptimized(ws, msg);
        break;

      case 'repo:delete-spec':
        await repoDeleteOptimizedSpecs(ws, session, msg);
        break;

      case 'repo:clean-screenshots':
        await repoCleanSpecScreenshots(ws, session, msg);
        break;

      case 'config:get-date-categories':
        await configGetDateCategories(ws);
        break;

      case 'config:save-date-categories':
        await configSaveDateCategories(ws, msg);
        break;

      case 'cancel:repo-pipeline':
        cancelRepoPipeline(session);
        break;

      case 'cancel:repo-test':
        cancelRepoTest(session);
        break;

      case 'cancel:repo-batch-test':
        cancelRepoBatch(session);
        break;

      case 'repo:compare-report':
        await runRepoCompareReport(ws, session);
        break;

      case 'repo:open-compare-report':
        await openRepoCompareReport(ws, session, { regenerate: Boolean(msg.regenerate) });
        break;

      case 'repo:compare-report:status':
        sendCompareReportStatus(ws, resolveRepoRoot());
        break;

      case 'repo:promote-baseline':
        await runRepoPromoteBaseline(ws, session, msg);
        break;

      case 'repo:ui-issues':
        await sendRepoUiIssues(ws);
        break;

      case 'cancel:repo-compare':
        cancelRepoCompare(session);
        break;

      case 'jobs:list':
        await handleJobsList(ws);
        break;

      case 'jobs:status':
        await handleJobsStatus(ws, msg);
        break;

      case 'jobs:preview':
        await handleJobsPreview(ws, msg);
        break;

      case 'jobs:run':
        await handleJobsRun(ws, msg);
        break;

      case 'jobs:stop':
        await handleJobsStop(ws, msg);
        break;
    }
    } catch (err) {
      console.error(`[${now()}] WS handler error:`, errText(err));
      send(ws, 'error', { message: errText(err) || '服务器处理消息失败' });
    }
  });

  ws.on('close', () => {
    console.log(`[${now()}] Client disconnected: ${sessionId}`);
    // Cleanup temp dir after delay
    setTimeout(() => {
      try { fs.rmSync(session.tmpDir, { recursive: true, force: true }); } catch {}
      sessions.delete(sessionId);
    }, 60000);
  });
});

// ── Start ─────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`\n🎭 Playwright Studio`);
  console.log(`   http://localhost:${PORT}`);
  console.log(`   ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY ? '✓ 已配置' : '✗ 未配置'}`);
  console.log(`   DEEPSEEK_API_KEY: ${DEEPSEEK_API_KEY ? '✓ 已配置' : '✗ 未配置'}`);
  if (!ANTHROPIC_API_KEY && !DEEPSEEK_API_KEY) {
    console.log('   （两者皆未配置时将使用演示模式；也可在网页侧栏输入密钥）');
  }
  console.log('');
});
