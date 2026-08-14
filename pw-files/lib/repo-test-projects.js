const REPO_OPTIMIZED_PROJECTS = [
  { id: 'optimized', label: 'Chrome' },
  { id: 'optimized-webkit', label: 'Safari (WebKit)' },
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

module.exports = {
  REPO_OPTIMIZED_PROJECTS,
  DEFAULT_REPO_TEST_PROJECTS,
  normalizeRepoTestProjects,
  appendRepoTestProjectArgs,
  formatRepoTestProjectsLog,
};
