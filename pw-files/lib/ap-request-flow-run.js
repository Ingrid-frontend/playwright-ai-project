const { createFlowRun, flowScriptKey } = require('./flow-run-factory');
const { resolveApRequestGoldenSeed } = require('./ap-request-golden-seed.js');

const api = createFlowRun({
  flowId: 'ap-request-flow',
  flowLabel: '对公申请单流程',
  domain: 'ap-request',
  entryPath: '/main/ap-request',
  defaultSpec: 'ap-request/golden-regression.spec.ts',
  goldenSpec: 'ap-request/golden-regression.spec.ts',
  writeEnvVar: 'AP_REQUEST_ENABLE_WRITE',
  resolveGoldenSeed: resolveApRequestGoldenSeed,
  catalogCheckRel: '../../ap-request-flow/utils/catalog-check.cjs',
  defaultListApi: '/api/applications/public/search',
  failureMode: 'concise',
  verboseRunErrors: true,
  includeGoldenSpecInStatus: true,
  spawnFields: [
    { envVar: 'AP_REQUEST_DOC_NO', msgKey: 'docNo', profileKey: 'apRequestDocNo', seedKey: 'apRequestDocNo', useSnapshot: true },
  ],
});

module.exports = {
  getApRequestFlowStatus: api.getFlowStatus,
  sendApRequestFlowStatus: api.sendFlowStatus,
  sendApRequestFlowTestList: api.sendFlowTestList,
  listApRequestFlowSpecs: api.listFlowSpecs,
  listApRequestFlowTests: api.listFlowTests,
  runApRequestFlowProbe: api.runFlowProbe,
  runApRequestFlowTests: api.runFlowTests,
  runApRequestFlowGoldenAll: api.runFlowGoldenAll,
  cancelApRequestFlow: api.cancelFlow,
  DEFAULT_SPEC: api.DEFAULT_SPEC,
  GOLDEN_SPEC: api.GOLDEN_SPEC,
  flowScriptKey,
};
