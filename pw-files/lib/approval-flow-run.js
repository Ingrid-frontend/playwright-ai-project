const { createFlowRun, flowScriptKey } = require('./flow-run-factory');
const { resolveApprovalGoldenSeed } = require('./approval-golden-seed.js');

const api = createFlowRun({
  flowId: 'approval-flow',
  flowLabel: '审批流程',
  domain: 'approval',
  entryPath: '/main/approve',
  defaultSpec: 'approval/full-flow.spec.ts',
  goldenSpec: 'approval/golden-regression.spec.ts',
  writeEnvVar: 'APPROVAL_ENABLE_WRITE',
  resolveGoldenSeed: resolveApprovalGoldenSeed,
  catalogCheckRel: '../../approval-flow/utils/catalog-check.cjs',
  defaultListApi: '/api/approvals/pendingApproval',
  docNoTextRe: /[A-Z]{2}\d{6,}/,
  failureMode: 'report',
  verboseRunErrors: false,
  includeGoldenSpecInStatus: true,
  spawnFields: [
    { envVar: 'APPROVAL_DOC_NO', msgKey: 'docNo', profileKey: 'approvalDocNo', seedKey: 'approvalDocNo', useSnapshot: true },
  ],
  snapshotSummary(snapshot, pickFrame) {
    const frame = pickFrame(snapshot);
    if (!frame) return null;
    const tabs = (frame.tabs || []).filter((t) => /待审批|已办|抄送|操作历史/.test(String(t)));
    const searchInputs = frame.searchInputs || [];
    const searchPlaceholder =
      searchInputs.find((s) => String(s.placeholder || '').includes('单号'))?.placeholder || '';
    const apis = Array.isArray(snapshot.listApis) ? snapshot.listApis : [];
    const rows = apis[0]?.sample || snapshot.sampleRows || snapshot.pendingRows || [];
    const first = Array.isArray(rows) ? rows[0] : null;
    const docFromRow = first?.businessCode || first?.documentNumber || '';
    const docFromText = String(frame.firstRowText || '').match(/[A-Z]{2}\d{6,}/);
    return {
      probedAt: snapshot.probedAt || snapshot.generatedAt || '',
      tabs: tabs.slice(0, 8),
      headers: Array.isArray(frame.headers) ? frame.headers.filter((h) => h && h !== '+').slice(0, 12) : [],
      searchPlaceholder,
      inIframe: Boolean(snapshot.list?.iframeCount || snapshot.list?.iframeSrcs?.length),
      tbodyRows: frame.tbodyRows ?? 0,
      sampleDocNo: docFromRow || (docFromText ? docFromText[0] : ''),
      listApi: apis[0]?.url?.split('?')[0] || '/api/approvals/pendingApproval',
    };
  },
});

module.exports = {
  getApprovalFlowStatus: api.getFlowStatus,
  sendApprovalFlowStatus: api.sendFlowStatus,
  sendApprovalFlowTestList: api.sendFlowTestList,
  listApprovalFlowSpecs: api.listFlowSpecs,
  listApprovalFlowTests: api.listFlowTests,
  runApprovalFlowProbe: api.runFlowProbe,
  runApprovalFlowTests: api.runFlowTests,
  runApprovalFlowGoldenAll: api.runFlowGoldenAll,
  cancelApprovalFlow: api.cancelFlow,
  DEFAULT_SPEC: api.DEFAULT_SPEC,
  GOLDEN_SPEC: api.GOLDEN_SPEC,
  flowScriptKey,
};
