import fs from 'fs';
import path from 'path';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { loadUiRegressionConfig } from './ui-regression-config.js';

export interface ImageDiffResult {
  difference: number;
  diffImagePath?: string;
  width?: number;
  height?: number;
  sizeMismatch?: boolean;
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
}

/** pixelmatch 额外选项；includeAA 默认 true。设为 false 时抗锯齿像素不计入差异。 */
export interface CompareImagesOptions {
  includeAA?: boolean;
  /** 为 false 时不写入 diff PNG（difference 为 0 时默认跳过） */
  writeDiffImage?: boolean;
}

interface PreparedPair {
  croppedImg1: PNG;
  croppedImg2: PNG;
  diff: PNG;
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

  return { croppedImg1, croppedImg2, diff, width, height, sizeMismatch };
}

/** 将 ignoreRegions 涂黑，降低动态区误报 */
function applyIgnoreRegionsToPair(prepared: PreparedPair): void {
  const regions = loadUiRegressionConfig().ignoreRegions;
  if (!regions.length) return;
  for (const region of regions) {
    const x0 = Math.max(0, Math.floor(region.x));
    const y0 = Math.max(0, Math.floor(region.y));
    const x1 = Math.min(prepared.width, x0 + Math.floor(region.width));
    const y1 = Math.min(prepared.height, y0 + Math.floor(region.height));
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const idx = (y * prepared.width + x) * 4;
        prepared.croppedImg1.data[idx] = 0;
        prepared.croppedImg1.data[idx + 1] = 0;
        prepared.croppedImg1.data[idx + 2] = 0;
        prepared.croppedImg2.data[idx] = 0;
        prepared.croppedImg2.data[idx + 2] = 0;
        prepared.croppedImg2.data[idx + 1] = 0;
      }
    }
  }
}

function runPixelmatch(
  prepared: PreparedPair,
  threshold: number,
  includeAA: boolean,
): number {
  return pixelmatch(
    prepared.croppedImg1.data,
    prepared.croppedImg2.data,
    prepared.diff.data,
    prepared.width,
    prepared.height,
    { threshold, includeAA },
  );
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
    const numDiffPixels = runPixelmatch(prepared, threshold, includeAA);
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
    applyIgnoreRegionsToPair(prepared);
    const numDiffPixels = runPixelmatch(prepared, threshold, includeAA);
    const totalPixels = prepared.width * prepared.height;
    const difference = totalPixels > 0 ? numDiffPixels / totalPixels : 0;

    const shouldWrite = writeDiffImage && difference > 0;
    const outDir = path.dirname(diffOutputPath);
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    if (shouldWrite) {
      await writePNG(prepared.diff, diffOutputPath);
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
    });

    return {
      difference,
      diffImagePath: shouldWrite ? diffOutputPath : undefined,
      width: prepared.width,
      height: prepared.height,
      sizeMismatch: prepared.sizeMismatch,
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
    width: meta.width,
    height: meta.height,
    sizeMismatch: meta.sizeMismatch,
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
