const { resolveFlowGoldenSeed } = require('./flow-golden-seed.js');

function resolveExpenseGoldenSeed(repoRoot, envId, roleSlug) {
  return resolveFlowGoldenSeed(repoRoot, 'expense-flow', envId, roleSlug, ['expenseDocNo']);
}

module.exports = { resolveExpenseGoldenSeed };
