const fs = require('fs');
const path = require('path');
const { send, logLine, stripAnsi, errText } = require('./ws-safe');

function createTestJobsActions(deps) {
  const {
    resolveRepoRoot,
    isDraftOptimizedPath,
    specMatchesEnv,
    specMeta,
    normalizeJobSpecPatterns,
    relPathForJobSpecMatch,
    matchesAnyJobPattern,
    mergeTestJobDef,
    loadTestJobsConfigFile,
    readJobLockFile,
    readLatestJobRunFile,
    TEST_JOBS_CONFIG_REL,
    listKnownEnvs,
    isKnownEnv,
    assertAllowedOptimizedSpec,
    cleanSpecScreenshots,
    listOptimizedSpecEntries,
    getSessionPlaywrightEnv,
  } = deps;

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
          if (isDraftOptimizedPath(rel)) continue;
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

  return {
    handleJobsPreview,
    handleJobsList,
    handleJobsStatus,
    handleJobsRun,
    handleJobsStop,
    repoLoadOptimized,
    repoDeleteOptimizedSpecs,
    repoCleanSpecScreenshots,
  };
}

module.exports = { createTestJobsActions };
