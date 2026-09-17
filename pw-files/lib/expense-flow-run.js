const { createFlowRun, flowScriptKey } = require('./flow-run-factory');
const { resolveExpenseGoldenSeed } = require('./expense-golden-seed.js');

const api = createFlowRun({
  flowId: 'expense-flow',
  flowLabel: '报销流程',
  domain: 'expense',
  entryPath: '/main/expense-parent-report/expense-report',
  defaultSpec: 'expense/full-flow.spec.ts',
  goldenSpec: 'expense/golden-regression.spec.ts',
  writeEnvVar: 'EXPENSE_ENABLE_WRITE',
  resolveGoldenSeed: resolveExpenseGoldenSeed,
  catalogCheckRel: '../../expense-flow/utils/catalog-check.cjs',
  defaultListApi: '/api/expense/report/search',
  failureMode: 'concise',
  verboseRunErrors: true,
  includeGoldenSpecInStatus: true,
  spawnFields: [
    { envVar: 'EXPENSE_DOC_NO', msgKey: 'docNo', profileKey: 'expenseDocNo', seedKey: 'expenseDocNo', useSnapshot: true },
  ],
});

module.exports = {
  getExpenseFlowStatus: api.getFlowStatus,
  sendExpenseFlowStatus: api.sendFlowStatus,
  sendExpenseFlowTestList: api.sendFlowTestList,
  listExpenseFlowSpecs: api.listFlowSpecs,
  listExpenseFlowTests: api.listFlowTests,
  runExpenseFlowProbe: api.runFlowProbe,
  runExpenseFlowTests: api.runFlowTests,
  runExpenseFlowGoldenAll: api.runFlowGoldenAll,
  cancelExpenseFlow: api.cancelFlow,
  DEFAULT_SPEC: api.DEFAULT_SPEC,
  GOLDEN_SPEC: api.GOLDEN_SPEC,
  flowScriptKey,
};
