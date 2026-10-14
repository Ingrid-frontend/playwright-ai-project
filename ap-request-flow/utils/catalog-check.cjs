const { createCatalogCheck } = require('../../flow-kit/utils/catalog-check.cjs');

module.exports = createCatalogCheck({
  name: '对公申请单列表',
  searchPlaceholder: '对公申请单号',
  searchPlaceholderIncludes: '单号',
  requiredHeaders: ['申请人', '单号', '单据名称', '事由', '供应商名称'],
  headerMatch: 'includes',
  tabPatterns: [],
  listApiPart: '/api/applications/public/search',
  listApiHint: 'public/search',
});
