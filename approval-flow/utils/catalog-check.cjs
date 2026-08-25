const CATALOG = {
  searchPlaceholder: '申请人/事由/单号',
  tabPatterns: [/待审批/, /已办|已审批/, /抄送/],
  requiredHeaders: ['申请人', '单号', '提交日期', '单据公司', '事由'],
  listApiPart: '/api/approvals/pendingApproval',
};

function pickSnapshotFrame(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const list = snapshot.list;
  if (list && Array.isArray(list.childFrames) && list.childFrames[0]) return list.childFrames[0];
  return list || snapshot;
}

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
  const ph =
    searchInputs.find((s) => String(s.placeholder || '').includes('单号'))?.placeholder || '';
  if (!ph) {
    warnings.push('未找到顶部搜索框（placeholder 含「单号」）');
  } else if (ph !== CATALOG.searchPlaceholder) {
    warnings.push(`搜索 placeholder 漂移：期望「${CATALOG.searchPlaceholder}」，实机「${ph}」`);
  }

  const tabs = (frame.tabs || []).map(String);
  for (const pat of CATALOG.tabPatterns) {
    if (!tabs.some((t) => pat.test(t))) {
      warnings.push(`页签缺失（需匹配 ${pat}）· 实机：${tabs.slice(0, 12).join(' / ') || '—'}`);
    }
  }

  const headers = (frame.headers || []).filter((h) => h && h !== '+');
  for (const h of CATALOG.requiredHeaders) {
    if (!headers.includes(h)) {
      warnings.push(`表头缺失「${h}」· 实机：${headers.slice(0, 12).join(' / ') || '—'}`);
    }
  }

  const apis = Array.isArray(snapshot.listApis) ? snapshot.listApis : [];
  const apiUrl = String(apis[0]?.url || '');
  if (apiUrl && !apiUrl.includes('pendingApproval')) {
    warnings.push(`待审批列表 API 漂移：${apiUrl.split('?')[0]}`);
  } else if (!apiUrl && !(frame.tbodyRows > 0)) {
    warnings.push('snapshot 未记录 pendingApproval 接口样本');
  }

  return { ok: warnings.length === 0, warnings };
}

module.exports = {
  CATALOG,
  pickSnapshotFrame,
  checkCatalogAgainstSnapshot,
};
