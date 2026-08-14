const fs = require('fs');
const path = require('path');

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

module.exports = {
  TEST_JOBS_CONFIG_REL,
  isJobProcessAlive,
  loadTestJobsConfigFile,
  readJobLockFile,
  readLatestJobRunFile,
};
