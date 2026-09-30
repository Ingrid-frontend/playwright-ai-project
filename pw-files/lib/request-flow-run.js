const { createFlowRun, flowScriptKey } = require('./flow-run-factory');
const { resolveGoldenSeed } = require('./golden-seed.js');

const api = createFlowRun({
  flowId: 'request-flow',
  flowLabel: '申请单流程',
  domain: 'request',
  entryPath: '/main/request',
  defaultSpec: 'request/full-flow.spec.ts',
  goldenSpec: 'request/golden-regression.spec.ts',
  writeEnvVar: 'REQUEST_ENABLE_WRITE',
  resolveGoldenSeed,
  catalogCheckRel: '../../request-flow/utils/catalog-check.cjs',
  defaultListApi: '/api/applications/v4/search',
  docNoTextRe: /(?:EA|ER|AR|BX|CD|comic)\w{6,}/i,
  failureMode: 'concise',
  verboseRunErrors: true,
  spawnFields: [
    { envVar: 'REQUEST_DOC_NO', msgKey: 'docNo', profileKey: 'requestDocNo', seedKey: 'requestDocNo', useSnapshot: true },
    { envVar: 'REQUEST_FORM_NAME', msgKey: 'formName' },
    { envVar: 'REQUEST_FILTER_KEYWORD', msgKey: 'filterKeyword', profileKey: 'requestFilterKeyword', seedKey: 'requestFilterKeyword' },
  ],
  goldenAllExtras(msg) {
    return {
      filterKeyword:
        msg.filterKeyword != null
          ? String(msg.filterKeyword).trim()
          : String(process.env.REQUEST_FILTER_KEYWORD || '').trim(),
    };
  },
});

module.exports = {
  getRequestFlowStatus: api.getFlowStatus,
  sendRequestFlowStatus: api.sendFlowStatus,
  sendRequestFlowTestList: api.sendFlowTestList,
  listRequestFlowSpecs: api.listFlowSpecs,
  listRequestFlowTests: api.listFlowTests,
  runRequestFlowProbe: api.runFlowProbe,
  runRequestFlowTests: api.runFlowTests,
  runRequestFlowGoldenAll: api.runFlowGoldenAll,
  cancelRequestFlow: api.cancelFlow,
  DEFAULT_SPEC: api.DEFAULT_SPEC,
  flowScriptKey,
};
