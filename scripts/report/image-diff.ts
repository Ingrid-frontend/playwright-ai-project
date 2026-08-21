import fs from 'fs';
import path from 'path';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { resolveIgnoreRegions, resolveDiffRegionsConfig } from './ui-regression-config.js';
import { classifyRegionNature, type ChangeNature } from './change-nature.js';

export type DiffRegionSeverity = 'high' | 'medium' | 'low';

/**
 * 区域聚类算法版本。
 * v1 的 regions 因缺少 diffMask 而退化为整页框，缓存必须失效重算。
 */
export const DIFF_REGIONS_VERSION = 2;

/**
 * 区域性质识别版本。
 * v3 起每个区域带 nature（位移/渲染/内容），缓存需重算。
 */
export const DIFF_NATURE_VERSION = 7;

export interface DiffRegion {
  x: number;
  y: number;
  w: number;
  h: number;
  pixels: number;
  ratio: number;
  severity: DiffRegionSeverity;
  /** 变化性质：区分「内容真的变了」与「只是挪了位置/渲染不同」 */
  nature?: ChangeNature;
  /** nature 为 shifted 时的位移量 */
  shiftX?: number;
  shiftY?: number;
}

export interface ImageDiffResult {
  difference: number;
  diffImagePath?: string;
  overlayImagePath?: string;
  width?: number;
  height?: number;
  sizeMismatch?: boolean;
  regions?: DiffRegion[];
}

export type CompareKind =
  | 'same-browser'
  | 'cross-browser'
  | 'golden'
  | 'last-green'
  | 'run-drift';

export interface ImageComparison {
  image1Path: string;
  image2Path: string;
  difference: number;
  diffImagePath?: string;
  overlayImagePath?: string;
  /** 同浏览器多次运行对比时为目标浏览器；跨浏览器时为 secondary（如 webkit） */
  browser?: string;
  sizeMismatch?: boolean;
  compareKind?: CompareKind;
  /** 跨浏览器：基线侧（固定 chrome） */
  browser1?: string;
  /** 跨浏览器：对比侧（固定 webkit） */
  browser2?: string;
  /** 跨浏览器配对说明（同日按运行序或同 timestamp 目录对齐） */
  pairLabel?: string;
  width?: number;
  height?: number;
  regions?: DiffRegion[];
}

/** pixelmatch 额外选项；includeAA 默认 true。设为 false 时抗锯齿像素不计入差异。 */
export interface CompareImagesOptions {
  includeAA?: boolean;
  /** 为 false 时不写入 diff PNG（difference 为 0 时默认跳过） */
  writeDiffImage?: boolean;
  /** 仅应用匹配该 script 的 ignoreRegions */
  scriptKey?: string;
}

interface PreparedPair {
  croppedImg1: PNG;
  croppedImg2: PNG;
  diff: PNG;
  /** 仅含差异像素的掩码（透明底 + 红点），用于区域聚类与标注叠加 */
  mask: PNG;
  width: number;
  height: number;
  sizeMismatch: boolean;
}

function readPNG(filePath: string): Promise<PNG> {
  return new Promise((resolve, reject) => {
    fs.createReadStream(filePath)
      .pipe(new PNG())
      .on('parsed', function (this: PNG) {
        resolve(this);
      })
      .on('error', reject);
  });
}

function writePNG(png: PNG, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(outputPath);
    png.pack().pipe(out);
    out.on('finish', resolve);
    out.on('error', reject);
  });
}

/** 裁切到重叠区域，使用 Buffer 行拷贝替代逐像素循环 */
function cropToOverlap(img1: PNG, img2: PNG, width: number, height: number): { croppedImg1: PNG; croppedImg2: PNG } {
  const croppedImg1 = new PNG({ width, height });
  const croppedImg2 = new PNG({ width, height });
  const rowBytes = width * 4;

  for (let y = 0; y < height; y++) {
    const srcOff1 = (y * img1.width) * 4;
    const srcOff2 = (y * img2.width) * 4;
    const dstOff = y * rowBytes;
    img1.data.copy(croppedImg1.data, dstOff, srcOff1, srcOff1 + rowBytes);
    img2.data.copy(croppedImg2.data, dstOff, srcOff2, srcOff2 + rowBytes);
  }

  return { croppedImg1, croppedImg2 };
}

async function prepareImagePair(img1Path: string, img2Path: string): Promise<PreparedPair> {
  const img1 = await readPNG(img1Path);
  const img2 = await readPNG(img2Path);

  const width = Math.min(img1.width, img2.width);
  const height = Math.min(img1.height, img2.height);
  const sizeMismatch = img1.width !== img2.width || img1.height !== img2.height;

  if (sizeMismatch) {
    console.log(
      `⚠️  图片尺寸不同: ${img1.width}x${img1.height} vs ${img2.width}x${img2.height}, 使用重叠区域 ${width}x${height}`,
    );
  }

  const { croppedImg1, croppedImg2 } = cropToOverlap(img1, img2, width, height);
  const diff = new PNG({ width, height });
  const mask = new PNG({ width, height });

  return { croppedImg1, croppedImg2, diff, mask, width, height, sizeMismatch };
}

/** 将 ignoreRegions 涂黑，降低动态区误报（按行批量 fill 替代逐像素循环） */
function applyIgnoreRegionsToPair(prepared: PreparedPair, scriptKey?: string): void {
  const regions = resolveIgnoreRegions(scriptKey);
  if (!regions.length) return;
  const { width, croppedImg1, croppedImg2 } = prepared;
  const rowBytes = width * 4;
  const zeroRow = Buffer.alloc(rowBytes, 0);
  for (const region of regions) {
    const x0 = Math.max(0, Math.floor(region.x));
    const y0 = Math.max(0, Math.floor(region.y));
    const x1 = Math.min(width, x0 + Math.floor(region.width));
    const y1 = Math.min(prepared.height, y0 + Math.floor(region.height));
    const segmentBytes = (x1 - x0) * 4;
    for (let y = y0; y < y1; y++) {
      const rowOffset = y * rowBytes + x0 * 4;
      zeroRow.copy(croppedImg1.data, rowOffset, 0, segmentBytes);
      zeroRow.copy(croppedImg2.data, rowOffset, 0, segmentBytes);
    }
  }
}

function runPixelmatch(
  prepared: PreparedPair,
  threshold: number,
  includeAA: boolean,
  opts?: { buildDisplay?: boolean },
): number {
  // 用 diffMask 输出「透明底 + 红点」的纯差异掩码：未变化像素 alpha=0。
  // 若沿用 pixelmatch 默认输出（淡化原图 + 红点），白底页面的未变化像素 R≈255，
  // 会让后续按 R>128 判定的聚类与叠加把整页误判为差异。
  const count = pixelmatch(
    prepared.croppedImg1.data,
    prepared.croppedImg2.data,
    prepared.mask.data,
    prepared.width,
    prepared.height,
    { threshold, includeAA, diffMask: true },
  );
  if (opts?.buildDisplay !== false) buildDisplayDiff(prepared);
  return count;
}

/** 由掩码还原「淡化原图 + 红色差异点」的展示用 diff 图（对齐 pixelmatch 默认观感） */
function buildDisplayDiff(prepared: PreparedPair): void {
  const { croppedImg1, mask, diff } = prepared;
  const alpha = 0.1;
  for (let i = 0; i < diff.data.length; i += 4) {
    if (mask.data[i + 3]! > 0) {
      diff.data[i] = mask.data[i]!;
      diff.data[i + 1] = mask.data[i + 1]!;
      diff.data[i + 2] = mask.data[i + 2]!;
      diff.data[i + 3] = 255;
      continue;
    }
    const r = croppedImg1.data[i]!;
    const g = croppedImg1.data[i + 1]!;
    const b = croppedImg1.data[i + 2]!;
    const a = croppedImg1.data[i + 3]!;
    const val = 255 + (r * 0.29889531 + g * 0.58662247 + b * 0.11448223 - 255) * alpha * (a / 255);
    const v = Math.max(0, Math.min(255, Math.round(val)));
    diff.data[i] = v;
    diff.data[i + 1] = v;
    diff.data[i + 2] = v;
    diff.data[i + 3] = 255;
  }
}

export function clusterDiffRegions(
  diff: PNG,
  opts?: { enabled?: boolean },
): DiffRegion[] {
  const cfg = resolveDiffRegionsConfig();
  if (opts?.enabled === false || !cfg.enabled) return [];

  const { width, height, data } = diff;
  const totalPixels = width * height;
  if (totalPixels <= 0) return [];

  // 先把差异像素落到网格里，再对相邻网格做连通域。
  // 逐像素连通域会把每个文字笔画拆成独立区域，输出几百个 1~2px 的框，
  // 对报告读者毫无定位价值；网格聚合能得到「头部一条」「表格某行」这种可指认的块。
  const grid = Math.max(1, Math.floor(cfg.gridSize ?? 16));
  const minRegionPixels = Math.max(1, Math.floor(cfg.minRegionPixels ?? 12));
  const minCellDensity = Math.max(0, cfg.minCellDensity ?? 0.06);
  const cols = Math.ceil(width / grid);
  const rows = Math.ceil(height / grid);
  const cellPixels = new Int32Array(cols * rows);
  const cellMinX = new Int32Array(cols * rows).fill(width);
  const cellMinY = new Int32Array(cols * rows).fill(height);
  const cellMaxX = new Int32Array(cols * rows).fill(-1);
  const cellMaxY = new Int32Array(cols * rows).fill(-1);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!isDiffPixel(data, (y * width + x) * 4)) continue;
      const ci = Math.floor(y / grid) * cols + Math.floor(x / grid);
      cellPixels[ci]!++;
      if (x < cellMinX[ci]!) cellMinX[ci] = x;
      if (y < cellMinY[ci]!) cellMinY[ci] = y;
      if (x > cellMaxX[ci]!) cellMaxX[ci] = x;
      if (y > cellMaxY[ci]!) cellMaxY[ci] = y;
    }
  }

  // 稀疏格多为字体渲染/抗锯齿抖动，若保留会把满页零散噪点串成一个巨框
  const minCellPixels = Math.max(1, Math.ceil(grid * grid * minCellDensity));
  for (let i = 0; i < cellPixels.length; i++) {
    if (cellPixels[i]! > 0 && cellPixels[i]! < minCellPixels) cellPixels[i] = 0;
  }

  const visited = new Uint8Array(cols * rows);
  const regions: DiffRegion[] = [];
  const dcx = [-1, 0, 1, -1, 1, -1, 0, 1];
  const dcy = [-1, -1, -1, 0, 0, 1, 1, 1];

  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const start = cy * cols + cx;
      if (visited[start] || cellPixels[start]! <= 0) continue;

      let minX = cellMinX[start]!;
      let minY = cellMinY[start]!;
      let maxX = cellMaxX[start]!;
      let maxY = cellMaxY[start]!;
      let pixels = 0;
      const queue = [start];
      visited[start] = 1;

      while (queue.length) {
        const ci = queue.pop()!;
        pixels += cellPixels[ci]!;
        if (cellMinX[ci]! < minX) minX = cellMinX[ci]!;
        if (cellMinY[ci]! < minY) minY = cellMinY[ci]!;
        if (cellMaxX[ci]! > maxX) maxX = cellMaxX[ci]!;
        if (cellMaxY[ci]! > maxY) maxY = cellMaxY[ci]!;
        const gx = ci % cols;
        const gy = (ci - gx) / cols;
        for (let k = 0; k < 8; k++) {
          const nx = gx + dcx[k]!;
          const ny = gy + dcy[k]!;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          const nidx = ny * cols + nx;
          if (visited[nidx] || cellPixels[nidx]! <= 0) continue;
          visited[nidx] = 1;
          queue.push(nidx);
        }
      }

      if (pixels < minRegionPixels) continue;
      const w = maxX - minX + 1;
      const h = maxY - minY + 1;
      const ratio = pixels / totalPixels;
      let severity: DiffRegionSeverity = 'medium';
      if (pixels < cfg.lowMaxPixels) severity = 'low';
      else if (ratio >= cfg.highRatio || (w >= cfg.highMinWidth && h >= cfg.highMinHeight)) {
        severity = 'high';
      }
      regions.push({ x: minX, y: minY, w, h, pixels, ratio, severity });
    }
  }

  regions.sort((a, b) => b.pixels - a.pixels);
  return regions.slice(0, 40);
}

/** 掩码差异像素：alpha>0 即为 pixelmatch 标注的差异点；兼容无 alpha 的历史输入 */
function isDiffPixel(data: Buffer | Uint8Array, offset: number): boolean {
  const a = data[offset + 3]!;
  if (a === 0) return false;
  return data[offset]! > 128;
}

async function writeOverlayPng(
  prepared: PreparedPair,
  outputPath: string,
  regions: DiffRegion[],
): Promise<void> {
  const { width, height, croppedImg2, mask } = prepared;
  const out = new PNG({ width, height });
  for (let i = 0; i < croppedImg2.data.length; i += 4) {
    out.data[i] = croppedImg2.data[i]!;
    out.data[i + 1] = croppedImg2.data[i + 1]!;
    out.data[i + 2] = croppedImg2.data[i + 2]!;
    out.data[i + 3] = 255;
    if (isDiffPixel(mask.data, i)) {
      out.data[i] = 255;
      out.data[i + 1] = Math.floor(out.data[i + 1]! * 0.35);
      out.data[i + 2] = Math.floor(out.data[i + 2]! * 0.35);
    }
  }
  // 给聚类出的区域描边，读者不必逐像素找红点即可定位改动范围
  for (const region of regions) {
    if (region.severity === 'low') continue;
    drawRegionBox(out, region, width, height);
  }
  await writePNG(out, outputPath);
}

function drawRegionBox(out: PNG, region: DiffRegion, width: number, height: number): void {
  const pad = 3;
  const x0 = Math.max(0, region.x - pad);
  const y0 = Math.max(0, region.y - pad);
  const x1 = Math.min(width - 1, region.x + region.w - 1 + pad);
  const y1 = Math.min(height - 1, region.y + region.h - 1 + pad);
  const thickness = 2;
  const paint = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const i = (y * width + x) * 4;
    out.data[i] = 255;
    out.data[i + 1] = 32;
    out.data[i + 2] = 32;
    out.data[i + 3] = 255;
  };
  for (let t = 0; t < thickness; t++) {
    for (let x = x0; x <= x1; x++) {
      paint(x, y0 + t);
      paint(x, y1 - t);
    }
    for (let y = y0; y <= y1; y++) {
      paint(x0 + t, y);
      paint(x1 - t, y);
    }
  }
}

export async function compareImages(
  img1Path: string,
  img2Path: string,
  threshold: number = 0.1,
  opts: CompareImagesOptions = {},
): Promise<ImageDiffResult> {
  const includeAA = opts.includeAA ?? true;

  try {
    const prepared = await prepareImagePair(img1Path, img2Path);
    const numDiffPixels = runPixelmatch(prepared, threshold, includeAA, { buildDisplay: false });
    const totalPixels = prepared.width * prepared.height;
    const difference = totalPixels > 0 ? numDiffPixels / totalPixels : 0;

    return {
      difference,
      width: prepared.width,
      height: prepared.height,
      sizeMismatch: prepared.sizeMismatch,
    };
  } catch (error) {
    console.error('Error comparing images:', error);
    throw error;
  }
}

export async function compareImagesWithDiff(
  img1Path: string,
  img2Path: string,
  diffOutputPath: string,
  threshold: number = 0.1,
  opts: CompareImagesOptions = {},
): Promise<ImageDiffResult> {
  const includeAA = opts.includeAA ?? true;
  const writeDiffImage = opts.writeDiffImage ?? true;

  try {
    const prepared = await prepareImagePair(img1Path, img2Path);
    applyIgnoreRegionsToPair(prepared, opts.scriptKey);
    const numDiffPixels = runPixelmatch(prepared, threshold, includeAA);
    const totalPixels = prepared.width * prepared.height;
    const difference = totalPixels > 0 ? numDiffPixels / totalPixels : 0;

    const shouldWrite = writeDiffImage && difference > 0;
    const regions = difference > 0 ? clusterDiffRegions(prepared.mask) : [];
    // 回读原图判断每个区域的变化性质，把「位移/渲染」与「内容变化」分开
    for (const region of regions) {
      const info = classifyRegionNature(prepared.croppedImg1, prepared.croppedImg2, region);
      region.nature = info.nature;
      if (info.nature === 'shifted') {
        region.shiftX = info.shiftX;
        region.shiftY = info.shiftY;
      }
    }
    const outDir = path.dirname(diffOutputPath);
    let overlayPath: string | undefined;
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    if (shouldWrite) {
      await writePNG(prepared.diff, diffOutputPath);
      overlayPath = diffOutputPath.replace(/\.png$/i, '-overlay.png');
      await writeOverlayPng(prepared, overlayPath, regions);
    } else if (fs.existsSync(diffOutputPath)) {
      try {
        fs.unlinkSync(diffOutputPath);
      } catch {
        /* 忽略清理失败 */
      }
    }

    const t1 = fs.statSync(img1Path).mtimeMs;
    const t2 = fs.statSync(img2Path).mtimeMs;
    writeDiffMeta(diffOutputPath, {
      difference,
      sizeMismatch: prepared.sizeMismatch,
      width: prepared.width,
      height: prepared.height,
      img1Mtime: t1,
      img2Mtime: t2,
      pixelmatchThreshold: threshold,
      includeAA,
      regions,
      regionsVersion: DIFF_REGIONS_VERSION,
      natureVersion: DIFF_NATURE_VERSION,
    });

    return {
      difference,
      diffImagePath: shouldWrite ? diffOutputPath : undefined,
      overlayImagePath: shouldWrite ? overlayPath : undefined,
      width: prepared.width,
      height: prepared.height,
      sizeMismatch: prepared.sizeMismatch,
      regions,
    };
  } catch (error) {
    console.error('Error comparing images with diff:', error);
    throw error;
  }
}

export interface DiffMeta {
  difference: number;
  sizeMismatch?: boolean;
  width?: number;
  height?: number;
  img1Mtime: number;
  img2Mtime: number;
  pixelmatchThreshold?: number;
  includeAA?: boolean;
  regions?: DiffRegion[];
  /** 聚类算法版本；与 DIFF_REGIONS_VERSION 不符时缓存失效 */
  regionsVersion?: number;
  /** 变化性质识别版本；与 DIFF_NATURE_VERSION 不符时缓存失效 */
  natureVersion?: number;
}

function diffMetaPath(diffOutputPath: string): string {
  return `${diffOutputPath}.meta.json`;
}

export function writeDiffMeta(diffOutputPath: string, meta: DiffMeta): void {
  fs.writeFileSync(diffMetaPath(diffOutputPath), JSON.stringify(meta), 'utf-8');
}

export function readDiffMeta(diffOutputPath: string): DiffMeta | null {
  const metaFile = diffMetaPath(diffOutputPath);
  if (!fs.existsSync(metaFile)) return null;
  try {
    return JSON.parse(fs.readFileSync(metaFile, 'utf-8')) as DiffMeta;
  } catch {
    return null;
  }
}

/** 源图未更新且 meta 与 diff 图均有效时跳过 pixelmatch */
export function isDiffCacheValid(
  img1Path: string,
  img2Path: string,
  diffOutputPath: string,
  expected?: { threshold: number; includeAA: boolean },
): boolean {
  try {
    const t1 = fs.statSync(img1Path).mtimeMs;
    const t2 = fs.statSync(img2Path).mtimeMs;
    const meta = readDiffMeta(diffOutputPath);
    if (meta && meta.img1Mtime === t1 && meta.img2Mtime === t2) {
      if (expected) {
        if (meta.pixelmatchThreshold !== expected.threshold) return false;
        if (meta.includeAA !== expected.includeAA) return false;
      }
      if (meta.difference <= 0) return true;
      if (resolveDiffRegionsConfig().enabled) {
        if (!meta.regions) return false;
        if ((meta.regionsVersion ?? 1) !== DIFF_REGIONS_VERSION) return false;
        if ((meta.natureVersion ?? 0) !== DIFF_NATURE_VERSION) return false;
      }
      return fs.existsSync(diffOutputPath);
    }
    if (!fs.existsSync(diffOutputPath)) return false;
    const diffMtime = fs.statSync(diffOutputPath).mtimeMs;
    return diffMtime >= t1 && diffMtime >= t2;
  } catch {
    return false;
  }
}

export function loadCachedDiffResult(
  img1Path: string,
  img2Path: string,
  diffOutputPath: string,
  expected?: { threshold: number; includeAA: boolean },
): ImageDiffResult | null {
  if (!isDiffCacheValid(img1Path, img2Path, diffOutputPath, expected)) return null;
  const meta = readDiffMeta(diffOutputPath);
  if (!meta) return null;
  return {
    difference: meta.difference,
    diffImagePath: meta.difference > 0 && fs.existsSync(diffOutputPath) ? diffOutputPath : undefined,
    overlayImagePath:
      meta.difference > 0 && fs.existsSync(diffOutputPath.replace(/\.png$/i, '-overlay.png'))
        ? diffOutputPath.replace(/\.png$/i, '-overlay.png')
        : undefined,
    width: meta.width,
    height: meta.height,
    sizeMismatch: meta.sizeMismatch,
    regions: meta.regions,
  };
}

export async function compareMultipleImages(
  baseImagePath: string,
  compareImagePaths: string[],
  diffOutputDir: string,
  threshold: number = 0.1,
  opts: CompareImagesOptions = {},
): Promise<ImageComparison[]> {
  const results: ImageComparison[] = [];

  for (const compareImagePath of compareImagePaths) {
    const fileName = `diff-${path.basename(compareImagePath, '.png')}.png`;
    const diffOutputPath = path.join(diffOutputDir, fileName);

    const result = await compareImagesWithDiff(baseImagePath, compareImagePath, diffOutputPath, threshold, opts);

    results.push({
      image1Path: baseImagePath,
      image2Path: compareImagePath,
      difference: result.difference,
      diffImagePath: result.diffImagePath,
      sizeMismatch: result.sizeMismatch,
    });
  }

  return results;
}

/**
 * 与 getDifferenceLabel 对齐：比例 < 0.01% 时若仍用 toFixed(2) 会得到 0.00%，却标成「微小差异」。
 */
export function formatDifference(difference: number): string {
  if (difference < 1e-12) {
    return '0.00%';
  }
  const pct = difference * 100;
  if (pct >= 0.01) {
    return `${pct.toFixed(2)}%`;
  }
  for (let d = 4; d <= 14; d++) {
    const rounded = Number.parseFloat(pct.toFixed(d));
    if (rounded > 0) {
      return `${rounded}%`;
    }
  }
  return `${pct.toExponential(1)}%`;
}

export function getDifferenceLevel(difference: number): 'low' | 'medium' | 'high' {
  if (difference < 1e-12) return 'low';
  if (difference < 0.00004) return 'low';
  if (difference < 0.01) return 'medium';
  return 'high';
}

export function getDifferenceColor(difference: number): string {
  const level = getDifferenceLevel(difference);
  switch (level) {
    case 'low':
      return '#28a745';
    case 'medium':
      return '#ffc107';
    case 'high':
      return '#dc3545';
    default:
      return '#6c757d';
  }
}

export function getDifferenceLabel(difference: number): string {
  if (difference < 1e-12) return '无差异';
  if (difference < 0.00004) return '微小差异';
  if (difference < 0.01) return '轻微差异';
  return '显著差异';
}

export async function batchCompareImages(
  imageGroups: Map<string, string[]>,
  diffOutputDir: string,
  threshold: number = 0.1,
  opts: CompareImagesOptions = {},
): Promise<Map<string, ImageComparison[]>> {
  const results = new Map<string, ImageComparison[]>();

  if (!fs.existsSync(diffOutputDir)) {
    fs.mkdirSync(diffOutputDir, { recursive: true });
  }

  for (const [stepName, imagePaths] of imageGroups.entries()) {
    if (imagePaths.length < 2) {
      results.set(stepName, []);
      continue;
    }

    const baseImagePath = imagePaths[0];
    const compareImagePaths = imagePaths.slice(1);

    const stepDiffDir = path.join(diffOutputDir, stepName);
    const comparisons = await compareMultipleImages(
      baseImagePath,
      compareImagePaths,
      stepDiffDir,
      threshold,
      opts,
    );

    results.set(stepName, comparisons);
  }

  return results;
}

/** 限制并发的任务队列 */
export async function runWithConcurrency<T>(
  tasks: (() => Promise<T>)[],
  concurrency: number,
): Promise<T[]> {
  if (tasks.length === 0) return [];
  const limit = Math.max(1, concurrency);
  const results: T[] = new Array(tasks.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      const i = nextIndex++;
      if (i >= tasks.length) return;
      results[i] = await tasks[i]();
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, () => worker()));
  return results;
}
