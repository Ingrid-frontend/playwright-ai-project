/**
 * 按 flow 参数化的 golden 档案解析。
 *
 * 背景：approval-golden-seed.js 与 golden-seed.js 是同一份逻辑抄了两遍，
 * 区别只有 seeds 文件路径与返回字段名。每新增一个流程再抄第三份没有意义，
 * 所以这里收一份通用实现，那两个文件改成薄封装（保持原有导出名不变）。
 *
 * seeds 文件结构（<flowId>/datasource/golden-seeds.json，不入库）：
 *   { "<envId>": { "<roleSlug>": { "<xxxDocNo>": "EA...", ... } } }
 * roleSlug 找不到时依次回退 "*" → "default"。
 */
const fs = require('fs');
const path = require('path');

/** 读 seeds 文件；缺失或坏 JSON 都当空对象——golden 跑不起来该由调用方报错，不是这里 */
function readFlowSeeds(repoRoot, flowId) {
  const abs = path.join(repoRoot, flowId, 'datasource', 'golden-seeds.json');
  if (!fs.existsSync(abs)) return {};
  try {
    const data = JSON.parse(fs.readFileSync(abs, 'utf8'));
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

/**
 * 取某环境 + 某角色的档案条目。
 * @param {string} repoRoot 仓库根
 * @param {string} flowId   流程 id，如 approval-flow
 * @param {string} envId    环境 id，默认 dev
 * @param {string} roleSlug 角色 slug，可空
 * @returns {Record<string, unknown>} 原始条目（未做字段裁剪）
 */
function resolveFlowSeedEntry(repoRoot, flowId, envId, roleSlug) {
  const env = String(envId || 'dev').trim();
  const slug = String(roleSlug || '').trim();
  const bucket = readFlowSeeds(repoRoot, flowId)[env] || {};
  return (slug && bucket[slug]) || bucket['*'] || bucket.default || {};
}

/**
 * 取指定字段并 trim。
 * @param {string[]} fields 需要的字段名，如 ['approvalDocNo']
 * @returns {Record<string, string>} 每个字段都保证是 string（缺失为 ''）
 */
function resolveFlowGoldenSeed(repoRoot, flowId, envId, roleSlug, fields) {
  const entry = resolveFlowSeedEntry(repoRoot, flowId, envId, roleSlug);
  const out = {};
  for (const f of fields || []) out[f] = String(entry[f] || '').trim();
  return out;
}

module.exports = { readFlowSeeds, resolveFlowSeedEntry, resolveFlowGoldenSeed };
