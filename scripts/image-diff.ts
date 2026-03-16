import fs from 'fs';
import path from 'path';
import { PNG } from 'pngjs';

export interface ImageDiffResult {
  difference: number;
  diffImagePath?: string;
}

export interface ImageComparison {
  image1Path: string;
  image2Path: string;
  difference: number;
  diffImagePath?: string;
  browser?: string;
}

function readPNG(filePath: string): Promise<PNG> {
  return new Promise((resolve, reject) => {
    fs.createReadStream(filePath)
      .pipe(new PNG())
      .on('parsed', function(this: PNG) {
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

export async function compareImages(
  img1Path: string,
  img2Path: string,
  threshold: number = 0.1
): Promise<ImageDiffResult> {
  try {
    const img1 = await readPNG(img1Path);
    const img2 = await readPNG(img2Path);

    const width = Math.min(img1.width, img2.width);
    const height = Math.min(img1.height, img2.height);

    if (width !== img2.width || height !== img2.height) {
      console.log(`⚠️  图片尺寸不同: ${img1.width}x${img1.height} vs ${img2.width}x${img2.height}, 使用重叠区域 ${width}x${height}`);
    }

    const diff = new PNG({ width, height });
    const pixelmatch = (await import('pixelmatch')).default;

    const croppedImg1 = new PNG({ width, height });
    const croppedImg2 = new PNG({ width, height });

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx1 = (y * img1.width + x) * 4;
        const idx2 = (y * img2.width + x) * 4;
        const idxCropped = (y * width + x) * 4;

        croppedImg1.data[idxCropped] = img1.data[idx1];
        croppedImg1.data[idxCropped + 1] = img1.data[idx1 + 1];
        croppedImg1.data[idxCropped + 2] = img1.data[idx1 + 2];
        croppedImg1.data[idxCropped + 3] = img1.data[idx1 + 3];

        croppedImg2.data[idxCropped] = img2.data[idx2];
        croppedImg2.data[idxCropped + 1] = img2.data[idx2 + 1];
        croppedImg2.data[idxCropped + 2] = img2.data[idx2 + 2];
        croppedImg2.data[idxCropped + 3] = img2.data[idx2 + 3];
      }
    }

    const numDiffPixels = pixelmatch(
      croppedImg1.data,
      croppedImg2.data,
      diff.data,
      width,
      height,
      { threshold }
    );

    const totalPixels = width * height;
    const difference = numDiffPixels / totalPixels;

    return {
      difference
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
  threshold: number = 0.1
): Promise<ImageDiffResult> {
  try {
    const img1 = await readPNG(img1Path);
    const img2 = await readPNG(img2Path);

    const width = Math.min(img1.width, img2.width);
    const height = Math.min(img1.height, img2.height);

    if (width !== img2.width || height !== img2.height) {
      console.log(`⚠️  图片尺寸不同: ${img1.width}x${img1.height} vs ${img2.width}x${img2.height}, 使用重叠区域 ${width}x${height}`);
    }

    const diff = new PNG({ width, height });
    const pixelmatch = (await import('pixelmatch')).default;

    const croppedImg1 = new PNG({ width, height });
    const croppedImg2 = new PNG({ width, height });

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx1 = (y * img1.width + x) * 4;
        const idx2 = (y * img2.width + x) * 4;
        const idxCropped = (y * width + x) * 4;

        croppedImg1.data[idxCropped] = img1.data[idx1];
        croppedImg1.data[idxCropped + 1] = img1.data[idx1 + 1];
        croppedImg1.data[idxCropped + 2] = img1.data[idx1 + 2];
        croppedImg1.data[idxCropped + 3] = img1.data[idx1 + 3];

        croppedImg2.data[idxCropped] = img2.data[idx2];
        croppedImg2.data[idxCropped + 1] = img2.data[idx2 + 1];
        croppedImg2.data[idxCropped + 2] = img2.data[idx2 + 2];
        croppedImg2.data[idxCropped + 3] = img2.data[idx2 + 3];
      }
    }

    const numDiffPixels = pixelmatch(
      croppedImg1.data,
      croppedImg2.data,
      diff.data,
      width,
      height,
      { threshold }
    );

    const totalPixels = width * height;
    const difference = numDiffPixels / totalPixels;

    await writePNG(diff, diffOutputPath);

    return {
      difference,
      diffImagePath: diffOutputPath
    };
  } catch (error) {
    console.error('Error comparing images with diff:', error);
    throw error;
  }
}

export async function compareMultipleImages(
  baseImagePath: string,
  compareImagePaths: string[],
  diffOutputDir: string,
  threshold: number = 0.1
): Promise<ImageComparison[]> {
  const results: ImageComparison[] = [];

  for (const compareImagePath of compareImagePaths) {
    const fileName = `diff-${path.basename(compareImagePath, '.png')}.png`;
    const diffOutputPath = path.join(diffOutputDir, fileName);

    const result = await compareImagesWithDiff(
      baseImagePath,
      compareImagePath,
      diffOutputPath,
      threshold
    );

    results.push({
      image1Path: baseImagePath,
      image2Path: compareImagePath,
      difference: result.difference,
      diffImagePath: result.diffImagePath
    });
  }

  return results;
}

export function formatDifference(difference: number): string {
  const percentage = (difference * 100).toFixed(2);
  return `${percentage}%`;
}

export function getDifferenceLevel(difference: number): 'low' | 'medium' | 'high' {
  if (difference < 0.001) return 'low';
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
  const level = getDifferenceLevel(difference);
  switch (level) {
    case 'low':
      return '无差异';
    case 'medium':
      return '轻微差异';
    case 'high':
      return '显著差异';
    default:
      return '未知';
  }
}

export async function batchCompareImages(
  imageGroups: Map<string, string[]>,
  diffOutputDir: string,
  threshold: number = 0.1
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
      threshold
    );

    results.set(stepName, comparisons);
  }

  return results;
}
