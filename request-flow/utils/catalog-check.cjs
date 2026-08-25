const CATALOG = {
  searchPlaceholder: '申请单号',
  requiredHeaders: ['申请人', '单号', '单据名称', '事由'],
  listApiPart: '/api/applications/v4/search',
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

  const headers = (frame.headers || []).filter((h) => h && h !== '+');
  for (const h of CATALOG.requiredHeaders) {
    if (!headers.some((x) => String(x).includes(h))) {
      warnings.push(`表头缺失「${h}」· 实机：${headers.slice(0, 12).join(' / ') || '—'}`);
    }
  }

  const apis = Array.isArray(snapshot.listApis) ? snapshot.listApis : [];
  const apiUrl = String(apis[0]?.url || '');
  if (apiUrl && !apiUrl.includes('applications')) {
    warnings.push(`申请单列表 API 漂移：${apiUrl.split('?')[0]}`);
  } else if (!apiUrl && !(frame.tbodyRows > 0)) {
    warnings.push('snapshot 未记录 applications 列表接口样本');
  }

  return { ok: warnings.length === 0, warnings };
}

module.exports = {
  CATALOG,
  pickSnapshotFrame,
  checkCatalogAgainstSnapshot,
};
