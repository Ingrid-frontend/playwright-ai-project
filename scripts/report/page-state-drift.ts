import fs from 'fs';
import path from 'path';
import { isActionableNature } from './change-nature.js';
import type { DiffRegion } from './image-diff.js';
import type { StepMeta } from './structure-check.js';

/** 左侧栏/待办列表常见占位，宽于表格左列 */
const LEFT_SIDEBAR_MAX_X_RATIO = 0.28;

export interface PageStateDriftResult {
  drift: boolean;
  reason?: string;
}

export function metaPathForPng(pngPath: string): string {
  return pngPath.replace(/\.png$/i, '.meta.json');
}

function resolveScreenshotPath(pngPath: string): string {
  if (path.isAbsolute(pngPath)) return pngPath;
  const fromCwd = path.resolve(pngPath);
  if (fs.existsSync(fromCwd)) return fromCwd;
  const fromResults = path.resolve(process.cwd(), 'results', pngPath);
  if (fs.existsSync(fromResults)) return fromResults;
  return fromCwd;
}

export function readStepMeta(pngPath: string): StepMeta | null {
  const abs = resolveScreenshotPath(pngPath);
  const metaPath = metaPathForPng(abs);
  if (!fs.existsSync(metaPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as StepMeta;
  } catch {
    return null;
  }
}

function isLeftSidebarRegion(r: DiffRegion, width: number): boolean {
  return r.x + r.w <= width * LEFT_SIDEBAR_MAX_X_RATIO;
}

function sharedSectionStructureChanged(baselineMeta: StepMeta, currentMeta: StepMeta): boolean {
  const baseMap = new Map((baselineMeta.sections || []).map((s) => [s.key, s]));
  for (const cur of currentMeta.sections || []) {
    const base = baseMap.get(cur.key);
    if (base && base.structureHash !== cur.structureHash) return true;
  }
  return false;
}

function maxSectionNodeRatio(baselineMeta: StepMeta, currentMeta: StepMeta): number {
  const baseMap = new Map((baselineMeta.sections || []).map((s) => [s.key, s]));
  let ratio = 1;
  for (const cur of currentMeta.sections || []) {
    const base = baseMap.get(cur.key);
    if (!base?.nodeCount) continue;
    ratio = Math.max(ratio, cur.nodeCount / base.nodeCount);
  }
  return ratio;
}

/**
 * 同一步骤截图对比时，识别「页面外壳/侧栏状态」漂移（如待办列表展开），避免误标 UI 衰退。
 */
export function detectPageStateDrift(opts: {
  baselineMeta?: StepMeta | null;
  currentMeta?: StepMeta | null;
  regions?: DiffRegion[];
  width?: number;
  height?: number;
}): PageStateDriftResult {
  const { baselineMeta, currentMeta } = opts;
  if (!baselineMeta?.domHash || !currentMeta?.domHash) return { drift: false };
  if (baselineMeta.domHash === currentMeta.domHash) return { drift: false };

  const w = opts.width || currentMeta.imageWidth || baselineMeta.imageWidth || 1280;
  const significant = (opts.regions || [])
    .filter((r) => r.severity !== 'low')
    .sort((a, b) => b.pixels - a.pixels);
  const actionable = significant.filter((r) => !r.nature || isActionableNature(r.nature));
  if (actionable.length === 0) return { drift: false };

  const structureChanged = sharedSectionStructureChanged(baselineMeta, currentMeta);
  const nodeRatio = maxSectionNodeRatio(baselineMeta, currentMeta);
  const allLeft = actionable.every((r) => isLeftSidebarRegion(r, w));
  const listNatures = actionable.every(
    (r) => r.nature === 'appeared' || r.nature === 'vanished' || !r.nature,
  );

  if (structureChanged && allLeft && listNatures) {
    return {
      drift: true,
      reason:
        '左侧栏或待办列表与基线页面状态不一致（展开/收起或条数不同），主内容区未检测到变化，多为测试环境数据漂移',
    };
  }

  if (nodeRatio >= 1.5 && allLeft && actionable.every((r) => r.nature === 'appeared')) {
    return {
      drift: true,
      reason: '页面结构增多且差异集中在左侧列表，多为待办数据增减导致，非主内容 UI 回归',
    };
  }

  const natures = actionable.map((r) => r.nature).filter(Boolean);
  if (
    structureChanged &&
    natures.includes('appeared') &&
    natures.includes('vanished') &&
    actionable.every((r) => isLeftSidebarRegion(r, w))
  ) {
    return {
      drift: true,
      reason: '左侧列表同时出现新增与消失区域，多为基线与本次待办数据不一致，非样式回归',
    };
  }

  return { drift: false };
}
