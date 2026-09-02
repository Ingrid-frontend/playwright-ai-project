const { createCatalogCheck } = require('../../flow-kit/utils/catalog-check.cjs');

module.exports = createCatalogCheck({
  name: '审批列表',
  searchPlaceholder: '申请人/事由/单号',
  searchPlaceholderIncludes: '单号',
  requiredHeaders: ['申请人', '单号', '提交日期', '单据公司', '事由'],
  headerMatch: 'exact',
  tabPatterns: [/待审批/, /已办|已审批/, /抄送/],
  listApiPart: 'pendingApproval',
  listApiHint: 'pendingApproval',
});
