const { createCatalogCheck } = require('../../flow-kit/utils/catalog-check.cjs');

module.exports = createCatalogCheck({
  name: '申请单列表',
  searchPlaceholder: '申请单号',
  searchPlaceholderIncludes: '单号',
  requiredHeaders: ['申请人', '单号', '单据名称', '事由'],
  headerMatch: 'includes',
  listApiPart: '/api/applications/v4/search',
  listApiHint: 'applications',
});
