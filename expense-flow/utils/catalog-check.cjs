const { createCatalogCheck } = require('../../flow-kit/utils/catalog-check.cjs');

module.exports = createCatalogCheck({
  name: '报销列表',
  searchPlaceholder: '报销单号',
  searchPlaceholderIncludes: '单号',
  requiredHeaders: ['申请人', '单号', '提交日期', '单据名称', '事由'],
  headerMatch: 'includes',
  tabPatterns: [],
  listApiPart: '/api/expense/queryPage',
  listApiHint: 'queryPage',
});
