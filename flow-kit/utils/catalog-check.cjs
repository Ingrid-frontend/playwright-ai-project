/**
 * 通用 catalog ↔ 实机 snapshot 校验器。
 *
 * 之前 request-flow / approval-flow 各写了一份只有常量不同的 .cjs，
 * 新增流程又要再抄一份。这里把规则参数化：
 *
 *   const { createCatalogCheck } = require('../../flow-kit/utils/catalog-check.cjs');
 *   module.exports = createCatalogCheck({
 *     name: '审批列表',
 *     searchPlaceholder: '申请人/事由/单号',
 *     searchPlaceholderIncludes: '单号',
 *     requiredHeaders: ['申请人', '单号', '提交日期', '单据公司', '事由'],
 *     headerMatch: 'exact' | 'includes',
 *     tabPatterns: [/待审批/, /已办|已审批/, /抄送/],
 *     listApiPart: '/api/approvals/pendingApproval',
 *   });
 *
 * 对外仍导出 CATALOG / pickSnapshotFrame / checkCatalogAgainstSnapshot，
 * 兼容既有 verify 脚本。
 */
function pickSnapshotFrame(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const list = snapshot.list;
  if (list && Array.isArray(list.childFrames) && list.childFrames[0]) return list.childFrames[0];
  return list || snapshot;
}

function createCatalogCheck(config) {
  const {
    name = '列表',
    searchPlaceholder = '',
    searchPlaceholderIncludes = '',
    requiredHeaders = [],
    headerMatch = 'includes',
    tabPatterns = [],
    listApiPart = '',
    listApiHint = '',
  } = config || {};

  function checkCatalogAgainstSnapshot(snapshot) {
    const warnings = [];
    if (!snapshot) {
      return { ok: false, warnings: ['无 live-snapshot.json'] };
    }

    const frame = pickSnapshotFrame(snapshot);
    if (!frame) {
      return { ok: false, warnings: ['snapshot 缺少 list / iframe frame 数据'] };
    }

    const searchInputs = frame.searchInputs || [];
    const needle = searchPlaceholderIncludes || '单号';
    const ph =
      searchInputs.find((s) => String(s.placeholder || '').includes(needle))?.placeholder || '';
    if (!ph) {
      warnings.push(`未找到顶部搜索框（placeholder 含「${needle}」）`);
    } else if (searchPlaceholder && ph !== searchPlaceholder) {
      warnings.push(`搜索 placeholder 漂移：期望「${searchPlaceholder}」，实机「${ph}」`);
    }

    const headers = (frame.headers || []).filter((h) => h && h !== '+');
    for (const h of requiredHeaders) {
      const hit =
        headerMatch === 'exact'
          ? headers.includes(h)
          : headers.some((x) => String(x).includes(h));
      if (!hit) {
        warnings.push(`表头缺失「${h}」· 实机：${headers.slice(0, 12).join(' / ') || '—'}`);
      }
    }

    if (Array.isArray(tabPatterns) && tabPatterns.length) {
      const tabs = (frame.tabs || []).map(String);
      for (const pat of tabPatterns) {
        if (!tabs.some((t) => pat.test(t))) {
          warnings.push(
            `页签缺失（需匹配 ${pat}）· 实机：${tabs.slice(0, 12).join(' / ') || '—'}`,
          );
        }
      }
    }

    const apis = Array.isArray(snapshot.listApis) ? snapshot.listApis : [];
    const apiUrl = String(apis[0]?.url || '');
    if (apiUrl && listApiPart && !apiUrl.includes(listApiPart)) {
      warnings.push(`${name} API 漂移：${apiUrl.split('?')[0]}`);
    } else if (!apiUrl && !(frame.tbodyRows > 0)) {
      warnings.push(`snapshot 未记录 ${listApiHint || listApiPart || name} 接口样本`);
    }

    return { ok: warnings.length === 0, warnings };
  }

  return {
    CATALOG: config || {},
    pickSnapshotFrame,
    checkCatalogAgainstSnapshot,
  };
}

module.exports = {
  pickSnapshotFrame,
  createCatalogCheck,
};
