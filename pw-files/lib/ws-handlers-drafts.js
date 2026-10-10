const fs = require('fs');
const path = require('path');
const { send, logLine, errText } = require('./ws-safe');

const DRAFTS_DIR = 'results/drafts';

function draftsRoot(repoRoot) {
  return path.join(repoRoot, DRAFTS_DIR);
}

function readJson(abs) {
  try {
    return JSON.parse(fs.readFileSync(abs, 'utf8'));
  } catch {
    return null;
  }
}

function listDrafts(repoRoot) {
  const root = draftsRoot(repoRoot);
  if (!fs.existsSync(root)) return [];
  const index = readJson(path.join(root, 'index.json'));
  const indexed = Array.isArray(index?.drafts) ? index.drafts : [];
  const byPage = new Map(indexed.map((e) => [String(e.pageId), e]));

  // 索引之外的孤儿草稿（手工放置）也纳入
  for (const name of fs.readdirSync(root, { withFileTypes: true })) {
    if (!name.isDirectory() || name.name === '.' ) continue;
    if (name.name.startsWith('.')) continue;
    const yamlAbs = path.join(root, name.name, 'intent.preview.yaml');
    if (fs.existsSync(yamlAbs) && !byPage.has(name.name)) {
      byPage.set(name.name, {
        pageId: name.name,
        label: name.name,
        route: '',
        env: '',
        status: 'pending-review',
        trustLevel: 'trial',
        reviewRequired: false,
        writeActions: [],
        steps: 0,
        generatedAt: fs.statSync(yamlAbs).mtime.toISOString(),
      });
    }
  }

  const out = [];
  for (const e of byPage.values()) {
    const pageId = String(e.pageId || '');
    if (!pageId) continue;
    const yamlRel = `${DRAFTS_DIR}/${pageId}/intent.preview.yaml`;
    const yamlAbs = path.join(repoRoot, yamlRel);
    out.push({
      pageId,
      label: e.label || pageId,
      route: e.route || '',
      env: e.env || '',
      status: e.status || 'pending-review',
      trustLevel: e.trustLevel || 'trial',
      reviewRequired: e.reviewRequired === true,
      writeActionsCount: Array.isArray(e.writeActions) ? e.writeActions.length : 0,
      steps: e.steps || 0,
      generatedAt: e.generatedAt || '',
      error: e.error || undefined,
      yamlRel,
      yamlExists: fs.existsSync(yamlAbs),
      promotedPath: e.promotedPath || undefined,
    });
  }
  return out.sort((a, b) => String(b.generatedAt).localeCompare(String(a.generatedAt)));
}

function loadDraft(repoRoot, pageId) {
  const id = String(pageId || '').trim();
  if (!id || id.includes('..') || id.includes('/')) return { error: 'pageId 不合法' };
  const yamlRel = `${DRAFTS_DIR}/${id}/intent.preview.yaml`;
  const yamlAbs = path.join(repoRoot, yamlRel);
  if (!fs.existsSync(yamlAbs)) return { error: `草稿不存在: ${yamlRel}` };
  return { pageId: id, yamlRel, yamlText: fs.readFileSync(yamlAbs, 'utf8') };
}

/** 入库门禁：spawn 单一事实源 CLI 扫描写动作 */
function runWriteScan(repoRoot, spawn, yamlAbs) {
  return new Promise((resolve) => {
    const tsxBin = path.join(repoRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'tsx.cmd' : 'tsx');
    const proc = spawn(tsxBin, ['scripts/ai/intent-write-scan.ts', `--yaml=${yamlAbs}`], {
      cwd: repoRoot,
      shell: false,
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => {
      stdout += d.toString();
    });
    proc.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    proc.on('error', (err) => resolve({ ok: false, error: errText(err) }));
    proc.on('close', (code) => {
      if (code !== 0) {
        resolve({ ok: false, error: `intent-write-scan 退出码 ${code}: ${stderr.slice(0, 200)}` });
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (err) {
        resolve({ ok: false, error: `扫描输出解析失败: ${errText(err)}` });
      }
    });
  });
}

function updateIndexStatus(repoRoot, pageId, patch) {
  const indexAbs = path.join(draftsRoot(repoRoot), 'index.json');
  const index = readJson(indexAbs) || { version: 1, drafts: [] };
  const drafts = Array.isArray(index.drafts) ? index.drafts : [];
  const hit = drafts.find((e) => String(e.pageId) === pageId);
  if (hit) Object.assign(hit, patch);
  else drafts.push({ pageId, ...patch });
  index.updatedAt = new Date().toISOString();
  index.drafts = drafts;
  fs.mkdirSync(path.dirname(indexAbs), { recursive: true });
  fs.writeFileSync(indexAbs, `${JSON.stringify(index, null, 2)}\n`);
}

function createDraftsHandlers(ctx) {
  const { send, resolveRepoRoot, spawn, now } = ctx;

  return {
    'drafts:list': async (ws) => {
      const repoRoot = resolveRepoRoot();
      send(ws, 'drafts:list', { drafts: listDrafts(repoRoot) });
    },

    'drafts:load': async (ws, _session, _sessionId, msg) => {
      const repoRoot = resolveRepoRoot();
      const loaded = loadDraft(repoRoot, msg.pageId);
      if (loaded.error) {
        send(ws, 'error', { message: loaded.error });
        return;
      }
      send(ws, 'drafts:loaded', loaded);
    },

    'drafts:promote': async (ws, _session, _sessionId, msg) => {
      const repoRoot = resolveRepoRoot();
      const loaded = loadDraft(repoRoot, msg.pageId);
      if (loaded.error) {
        send(ws, 'error', { message: loaded.error });
        send(ws, 'drafts:promote:done', { ok: false, message: loaded.error });
        return;
      }

      logLine(ws, `[drafts] 门禁扫描 ${loaded.yamlRel} …`, 'info');
      const scan = await runWriteScan(repoRoot, spawn, path.join(repoRoot, loaded.yamlRel));
      if (!scan.ok) {
        const message = `门禁扫描失败: ${scan.error || '未知错误'}`;
        send(ws, 'error', { message });
        send(ws, 'drafts:promote:done', { ok: false, message });
        return;
      }

      // 入库门禁：强制 trial + 写动作强制 reviewRequired
      const targetRel = `tests/definitions/drafts/${loaded.pageId}.yaml`;
      const targetAbs = path.join(repoRoot, targetRel);
      let intent;
      try {
        const { parse: parseYaml, stringify: stringifyYaml } = require('yaml');
        intent = parseYaml(loaded.yamlText);
        intent.trustLevel = 'trial';
        if (scan.writeActions.length || intent.reviewRequired === true) intent.reviewRequired = true;
        intent.pageId = intent.pageId || loaded.pageId;
        fs.mkdirSync(path.dirname(targetAbs), { recursive: true });
        const text = stringifyYaml(intent);
        fs.writeFileSync(targetAbs, text.endsWith('\n') ? text : `${text}\n`, 'utf8');
      } catch (err) {
        const message = `入库失败: ${errText(err)}`;
        send(ws, 'error', { message });
        send(ws, 'drafts:promote:done', { ok: false, message });
        return;
      }

      updateIndexStatus(repoRoot, loaded.pageId, {
        status: 'promoted',
        promotedPath: targetRel,
        promotedAt: new Date().toISOString(),
        reviewRequired: intent.reviewRequired === true,
        writeActions: scan.writeActions,
      });

      logLine(
        ws,
        `[drafts] 已入库 ${targetRel} · trustLevel=trial · reviewRequired=${intent.reviewRequired === true}${scan.writeActions.length ? ` · 写动作 ${scan.writeActions.length} 处` : ''}`,
        'ok',
      );
      if (intent.reviewRequired) {
        logLine(ws, '[drafts] 含写动作：只会进入 write 类 job，试跑通过后仍需人审', 'warn');
      }
      send(ws, 'drafts:promote:done', {
        ok: true,
        pageId: loaded.pageId,
        promotedPath: targetRel,
        trustLevel: 'trial',
        reviewRequired: intent.reviewRequired === true,
        writeActions: scan.writeActions,
        at: now ? now() : new Date().toISOString(),
      });
    },
  };
}

module.exports = { createDraftsHandlers, listDrafts, loadDraft };
