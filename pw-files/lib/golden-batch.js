const fs = require('fs');
const path = require('path');

function goldenBatchAbs(repoRoot, flowId) {
  return path.join(repoRoot, 'results', 'flow-runs', flowId, 'last-golden-batch.json');
}

function readGoldenBatch(repoRoot, flowId) {
  const abs = goldenBatchAbs(repoRoot, flowId);
  if (!fs.existsSync(abs)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(abs, 'utf8'));
    return data && typeof data === 'object' ? data : null;
  } catch {
    return null;
  }
}

function writeGoldenBatch(repoRoot, flowId, batch) {
  const abs = goldenBatchAbs(repoRoot, flowId);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify(batch, null, 2), 'utf8');
}

function summarizeGoldenBatch(batch) {
  if (!batch) return { ok: false, exitCode: 1, lines: [] };
  const lines = [];
  const ignored = batch.ignored || [];
  const results = batch.results || [];
  const passed = results.filter((r) => r.ok && !r.skipped);
  const failed = results.filter((r) => !r.ok && !r.skipped);
  const skipped = results.filter((r) => r.skipped);

  if (ignored.length) {
    for (const item of ignored) {
      lines.push(`忽略 ${item.profileId}${item.roleSlug ? ` (${item.roleSlug})` : ''}: ${item.reason || '无有效登录态'}`);
    }
  }
  for (const item of passed) {
    lines.push(
      `通过 ${item.profileId}${item.roleSlug ? ` (${item.roleSlug})` : ''}: ${item.passed ?? '?'}/${item.total ?? '?'}`,
    );
  }
  for (const item of failed) {
    lines.push(
      `失败 ${item.profileId}${item.roleSlug ? ` (${item.roleSlug})` : ''}: ${item.error || `${item.passed ?? 0}/${item.total ?? '?'}`}`,
    );
  }
  for (const item of skipped) {
    lines.push(
      `跳过 ${item.profileId}${item.roleSlug ? ` (${item.roleSlug})` : ''}: ${item.reason || '无数据'}`,
    );
  }

  const headline = batch.ok
    ? skipped.length && !passed.length
      ? `Golden 批次完成：${skipped.length} 个角色跳过${ignored.length ? `，${ignored.length} 个忽略` : ''}`
      : `Golden 批次完成：${passed.length} 个角色通过${ignored.length ? `，${ignored.length} 个忽略` : ''}${skipped.length ? `，${skipped.length} 个跳过` : ''}`
    : failed.length && passed.length
      ? `Golden 批次部分失败：${passed.length} 通过，${failed.length} 失败${ignored.length ? `，${ignored.length} 忽略` : ''}`
      : `Golden 批次失败：${failed.length || 1} 个角色未通过`;

  return { ok: Boolean(batch.ok), exitCode: batch.exitCode ?? (batch.ok ? 0 : 1), headline, lines };
}

module.exports = {
  goldenBatchAbs,
  readGoldenBatch,
  writeGoldenBatch,
  summarizeGoldenBatch,
};
