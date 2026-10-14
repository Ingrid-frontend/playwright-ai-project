const { resolveFlowGoldenSeed } = require('./flow-golden-seed.js');

function resolveApRequestGoldenSeed(repoRoot, envId, roleSlug) {
  return resolveFlowGoldenSeed(repoRoot, 'ap-request-flow', envId, roleSlug, ['apRequestDocNo']);
}

module.exports = { resolveApRequestGoldenSeed };
