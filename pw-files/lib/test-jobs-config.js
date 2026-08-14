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
    projects: jobDef.projects?.length ? [...jobDef.projects] : [...(d.projects || ['optimized', 'optimized-webkit'])],
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
  const normalized = relPath.replace(/\\/g, '/');
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

function relPathForJobSpecMatch(rel, playwrightEnv) {
  const legacy = rel.match(/^tests\/optimized\/(\d{6})\/(.+\.optimized\.spec\.ts)$/);
  if (legacy && !KNOWN_JOB_ENV_IDS.includes(legacy[1])) {
    return `tests/optimized/${playwrightEnv}/${legacy[1]}/${legacy[2]}`;
  }
  return rel;
}

module.exports = {
  KNOWN_JOB_ENV_IDS,
  mergeTestJobDef,
  globToRegExpJob,
  matchesAnyJobPattern,
  normalizeJobSpecPatterns,
  relPathForJobSpecMatch,
};
