/**
 * 变化性质识别。
 *
 * 只看「差异像素有多少」会把两类完全不同的事情混为一谈：
 *   1. 内容真的变了（文案改了、模块消失、数据错位）—— 客户必须知道
 *   2. 同样的内容挪了几像素、或字体渲染让笔画边缘变粗 —— 客户不该被打扰
 *
 * 两者的像素差异量可能完全一样。区分它们需要回读原图：
 * 若把区域按最优位移对齐后残差接近 0，说明内容一致，只是位置变了。
 */
import { PNG } from 'pngjs';
import type { DiffRegion } from './image-diff.js';

export type ChangeNature =
  /** 内容出现（基线侧空白） */
  | 'appeared'
  /** 内容消失（当前侧空白） */
  | 'vanished'
  /** 内容被替换/改写 */
  | 'content'
  /** 同样内容整体位移 */
  | 'shifted'
  /** 仅笔画边缘/抗锯齿差异 */
  | 'rendering';

export interface RegionNature {
  nature: ChangeNature;
  /**
   * 位移像素数，nature 为 shifted 时有意义。
   * 正值表示当前截图的内容相对基线向右/向下移动。
   */
  shiftX: number;
  shiftY: number;
  /** 对齐后残差（0 表示内容完全一致） */
  alignedResidual: number;
  /** 原始残差 */
  rawResidual: number;
  /** 基线/当前侧的内容密度，用于判断出现与消失 */
  inkBefore: number;
  inkAfter: number;
  /** 肉眼可见变化的像素占比 */
  visibleRatio: number;
  /** 肉眼可见变化的像素数 */
  visiblePixels: number;
}

export interface ChangeNatureConfig {
  /**
   * 位移搜索半径（像素）。真实项目里侧边栏折叠、字号调整会带来 10px 以上的整体平移，
   * 半径过小会把「同样内容挪了位置」错判成「内容变了」。
   */
  maxShift: number;
  /** 对齐后残差低于此值视为「内容一致」 */
  alignedResidualTolerance: number;
  /** 原始残差低于此值且内容密度接近，视为渲染差异 */
  renderingResidualTolerance: number;
  /** 内容密度低于此值视为空白 */
  blankInkRatio: number;
  /** 内容密度高于此值视为有内容 */
  filledInkRatio: number;
  /** 判定为「有墨」的亮度阈值 */
  inkLuminance: number;
  /** 单像素亮度差达到该值才算「肉眼可见的变化」 */
  visibleDelta: number;
  /** 可见变化占比与像素数均低于阈值时，判为渲染差异而不是内容变化 */
  minVisibleRatio: number;
  minVisiblePixels: number;
  /** 细窄条（宽或高小于该值）走宽松的亚像素位移判定 */
  thinStripSize: number;
  /** 细窄条平移后残差下降比例达到该值即认为是同一内容挪了位置 */
  thinStripGain: number;
}

export const DEFAULT_CHANGE_NATURE_CONFIG: ChangeNatureConfig = {
  maxShift: 32,
  alignedResidualTolerance: 3,
  renderingResidualTolerance: 12,
  blankInkRatio: 0.01,
  filledInkRatio: 0.05,
  inkLuminance: 235,
  visibleDelta: 40,
  minVisibleRatio: 0.03,
  minVisiblePixels: 40,
  thinStripSize: 24,
  thinStripGain: 0.25,
};

function luminanceAt(png: PNG, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= png.width || y >= png.height) return 255;
  const i = (png.width * y + x) << 2;
  return 0.299 * png.data[i]! + 0.587 * png.data[i + 1]! + 0.114 * png.data[i + 2]!;
}

function inkRatio(png: PNG, r: DiffRegion, inkLuminance: number): number {
  let ink = 0;
  let total = 0;
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      total++;
      if (luminanceAt(png, x, y) < inkLuminance) ink++;
    }
  }
  return total > 0 ? ink / total : 0;
}

/** 平均绝对亮度差；dx/dy 为把 after 相对 before 平移的量 */
function residual(before: PNG, after: PNG, r: DiffRegion, dx: number, dy: number): number {
  let sum = 0;
  let n = 0;
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      sum += Math.abs(luminanceAt(before, x, y) - luminanceAt(after, x + dx, y + dy));
      n++;
    }
  }
  return n > 0 ? sum / n : 0;
}

/**
 * 列投影（每列亮度均值）。整体平移会让投影曲线跟着平移，
 * 因此用一维投影先估出位移量，避免在二维空间做 65x65 次全区域比对。
 */
function columnProfile(png: PNG, r: DiffRegion, pad: number): number[] {
  const out: number[] = [];
  for (let x = r.x - pad; x < r.x + r.w + pad; x++) {
    let sum = 0;
    for (let y = r.y; y < r.y + r.h; y++) sum += luminanceAt(png, x, y);
    out.push(sum / r.h);
  }
  return out;
}

function rowProfile(png: PNG, r: DiffRegion, pad: number): number[] {
  const out: number[] = [];
  for (let y = r.y - pad; y < r.y + r.h + pad; y++) {
    let sum = 0;
    for (let x = r.x; x < r.x + r.w; x++) sum += luminanceAt(png, x, y);
    out.push(sum / r.w);
  }
  return out;
}

/** 在投影曲线上找最优一维位移，返回最可能的几个候选 */
function bestProfileShifts(base: number[], moved: number[], pad: number, keep: number): number[] {
  const len = base.length - 2 * pad;
  const scored: Array<{ d: number; cost: number }> = [];
  for (let d = -pad; d <= pad; d++) {
    let sum = 0;
    for (let i = 0; i < len; i++) {
      sum += Math.abs(base[pad + i]! - moved[pad + i + d]!);
    }
    scored.push({ d, cost: sum / len });
  }
  scored.sort((a, b) => a.cost - b.cost);
  return scored.slice(0, keep).map((s) => s.d);
}

/**
 * 统计区域内「肉眼能看出来」的变化像素。
 * pixelmatch 会把 1-2 级灰度抖动也算成差异像素，这类变化人眼根本看不见，
 * 不能作为「内容变了」的依据。
 */
function visibleChange(
  before: PNG,
  after: PNG,
  r: DiffRegion,
  delta: number,
): { ratio: number; pixels: number } {
  let hit = 0;
  let total = 0;
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      total++;
      if (Math.abs(luminanceAt(before, x, y) - luminanceAt(after, x, y)) > delta) hit++;
    }
  }
  return { ratio: total > 0 ? hit / total : 0, pixels: hit };
}

/**
 * 判断单个差异区的变化性质。
 * before/after 必须是同尺寸的对比图（image-diff 裁切后的重叠区）。
 */
export function classifyRegionNature(
  before: PNG,
  after: PNG,
  region: DiffRegion,
  cfg: ChangeNatureConfig = DEFAULT_CHANGE_NATURE_CONFIG,
): RegionNature {
  const inkBefore = inkRatio(before, region, cfg.inkLuminance);
  const inkAfter = inkRatio(after, region, cfg.inkLuminance);
  const rawResidual = residual(before, after, region, 0, 0);
  const visible = visibleChange(before, after, region, cfg.visibleDelta);

  const base: Omit<RegionNature, 'nature'> = {
    shiftX: 0,
    shiftY: 0,
    alignedResidual: rawResidual,
    rawResidual,
    inkBefore,
    inkAfter,
    visibleRatio: visible.ratio,
    visiblePixels: visible.pixels,
  };

  // 一侧空白：内容出现或消失，这是客户最需要知道的变化。
  // 但要求变化肉眼可见——极淡的 1px 分隔线也会让 ink 从 0 跳到 1，
  // 那种「变化」客户看不见，报告里点出来只会制造噪声。
  const visuallyObvious = visible.ratio >= cfg.minVisibleRatio || visible.pixels >= cfg.minVisiblePixels;
  if (visuallyObvious) {
    if (inkBefore < cfg.blankInkRatio && inkAfter >= cfg.filledInkRatio) {
      return { ...base, nature: 'appeared' };
    }
    if (inkAfter < cfg.blankInkRatio && inkBefore >= cfg.filledInkRatio) {
      return { ...base, nature: 'vanished' };
    }
  }

  // 找最优位移：若对齐后残差接近 0，说明内容一致，只是挪了位置。
  // 先用行/列投影把 ±maxShift 的二维搜索收敛到少量候选，再在候选附近精搜。
  const pad = cfg.maxShift;
  const dxCandidates = bestProfileShifts(
    columnProfile(before, region, pad),
    columnProfile(after, region, pad),
    pad,
    3,
  );
  const dyCandidates = bestProfileShifts(
    rowProfile(before, region, pad),
    rowProfile(after, region, pad),
    pad,
    3,
  );
  const probes = new Set<string>();
  for (const cx of dxCandidates) {
    for (const cy of dyCandidates) {
      // 候选点附近 ±1 精搜，吸收投影估计的取整误差
      for (let ox = -1; ox <= 1; ox++) {
        for (let oy = -1; oy <= 1; oy++) {
          const dx = cx + ox;
          const dy = cy + oy;
          if (Math.abs(dx) > pad || Math.abs(dy) > pad) continue;
          probes.add(`${dx},${dy}`);
        }
      }
    }
  }
  let best = { residual: rawResidual, dx: 0, dy: 0 };
  for (const key of probes) {
    const [dx, dy] = key.split(',').map(Number) as [number, number];
    if (dx === 0 && dy === 0) continue;
    const res = residual(before, after, region, dx, dy);
    if (res < best.residual) best = { residual: res, dx, dy };
  }

  if (
    (best.dx !== 0 || best.dy !== 0) &&
    best.residual <= cfg.alignedResidualTolerance &&
    best.residual < rawResidual
  ) {
    return {
      ...base,
      nature: 'shifted',
      shiftX: best.dx,
      shiftY: best.dy,
      alignedResidual: best.residual,
    };
  }

  // 细窄条（分隔线、图标条、单行文本）1px 级亚像素位移：对齐后残差不会归零，
  // 但只要平移能明显压低残差且残差落在渲染差异量级，就是「同一内容挪了位置」。
  const isThinStrip =
    region.w <= cfg.thinStripSize || region.h <= cfg.thinStripSize;
  if (
    isThinStrip &&
    (best.dx !== 0 || best.dy !== 0) &&
    rawResidual > 0 &&
    (rawResidual - best.residual) / rawResidual >= cfg.thinStripGain &&
    best.residual <= cfg.renderingResidualTolerance
  ) {
    return {
      ...base,
      nature: 'shifted',
      shiftX: best.dx,
      shiftY: best.dy,
      alignedResidual: best.residual,
    };
  }

  // 内容密度几乎不变且残差很小：字体渲染/抗锯齿
  if (
    rawResidual <= cfg.renderingResidualTolerance &&
    Math.abs(inkBefore - inkAfter) < 0.05
  ) {
    return { ...base, nature: 'rendering' };
  }

  // 几乎没有肉眼可见的像素变化：属于抗锯齿/亚像素抖动，不是内容变化
  if (visible.ratio < cfg.minVisibleRatio && visible.pixels < cfg.minVisiblePixels) {
    return { ...base, nature: 'rendering' };
  }

  return { ...base, nature: 'content' };
}

/** 客户可读的性质名 */
export function natureLabel(nature: ChangeNature): string {
  switch (nature) {
    case 'appeared':
      return '新增内容';
    case 'vanished':
      return '内容缺失';
    case 'content':
      return '内容变化';
    case 'shifted':
      return '位置偏移';
    case 'rendering':
      return '渲染差异';
  }
}

/**
 * 该性质是否值得客户处理。
 * 位移与渲染差异属于「看起来不一样但没坏」，不应标红。
 */
export function isActionableNature(nature: ChangeNature): boolean {
  return nature === 'appeared' || nature === 'vanished' || nature === 'content';
}
