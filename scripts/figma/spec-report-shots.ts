import fs from "fs";
import path from "path";
import { PNG } from "pngjs";
import {
  type Rect,
  type DesignSpec,
  type DesignText,
  type LiveSpec,
  type LiveText,
  type SpecCheck,
} from "./figma-spec-types.js";
import { regionLabel } from "./spec-report-format.js";

export interface RegionShot {
  key: string;
  label: string;
  designFile?: string;
  liveFile?: string;
  designRect?: Rect;
  liveRect?: Rect;
}

export interface CheckShot {
  designFile?: string;
  liveFile?: string;
}

function clampRect(rect: Rect, width: number, height: number): Rect | null {
  const x = Math.max(0, Math.min(rect.x, width));
  const y = Math.max(0, Math.min(rect.y, height));
  const right = Math.max(x, Math.min(rect.x + rect.width, width));
  const bottom = Math.max(y, Math.min(rect.y + rect.height, height));
  if (right - x < 1 || bottom - y < 1) return null;
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(right - x),
    height: Math.round(bottom - y),
  };
}

function cropPng(src: PNG, rect: Rect): PNG {
  const out = new PNG({ width: rect.width, height: rect.height });
  PNG.bitblt(src, out, rect.x, rect.y, rect.width, rect.height, 0, 0);
  return out;
}

function drawBorder(
  src: PNG,
  rect: Rect,
  color: [number, number, number],
  width: number,
): void {
  const safe = clampRect(rect, src.width, src.height);
  if (!safe) return;
  const left = safe.x;
  const top = safe.y;
  const right = safe.x + safe.width - 1;
  const bottom = safe.y + safe.height - 1;
  for (let i = 0; i < width && i * 2 < safe.width && i * 2 < safe.height; i++) {
    for (let px = left + i; px <= right - i; px++) {
      setPixel(src, px, top + i, color);
      setPixel(src, px, bottom - i, color);
    }
    for (let py = top + i; py <= bottom - i; py++) {
      setPixel(src, left + i, py, color);
      setPixel(src, right - i, py, color);
    }
  }
}

function drawRectBorder(
  src: PNG,
  rect: Rect,
  color: [number, number, number],
  width = 2,
): void {
  const safe = clampRect(rect, src.width, src.height);
  if (!safe) return;
  drawBorder(src, safe, [255, 255, 255], width + 2);
  drawBorder(src, safe, color, width);
}

function setPixel(
  src: PNG,
  x: number,
  y: number,
  color: [number, number, number],
): void {
  if (x < 0 || y < 0 || x >= src.width || y >= src.height) return;
  const idx = (y * src.width + x) * 4;
  src.data[idx] = color[0];
  src.data[idx + 1] = color[1];
  src.data[idx + 2] = color[2];
  src.data[idx + 3] = 255;
}

/** 按设计稿区块和线上对应区块裁出局部截图，供报告直观对照。 */
export function regionShotFiles(
  outDir: string,
  design: DesignSpec,
  live: LiveSpec,
): RegionShot[] {
  const designPath = path.join(outDir, "design.png");
  const livePath = path.join(outDir, "live.png");
  const designPng = fs.existsSync(designPath)
    ? PNG.sync.read(fs.readFileSync(designPath))
    : null;
  const livePng = fs.existsSync(livePath)
    ? PNG.sync.read(fs.readFileSync(livePath))
    : null;
  if (!designPng && !livePng) return [];

  const shotsDir = path.join(outDir, "regions");
  fs.mkdirSync(shotsDir, { recursive: true });
  const viewport = live.rootViewport || { x: 0, y: 0, width: 1, height: 1 };
  const scaleX = livePng ? livePng.width / Math.max(1, viewport.width) : 1;
  const scaleY = livePng ? livePng.height / Math.max(1, viewport.height) : 1;
  const shots: RegionShot[] = [];

  for (const region of design.regions) {
    const shot: RegionShot = {
      key: region.key,
      label: regionLabel(region.key),
    };
    if (designPng) {
      const rect = clampRect(region.bbox, designPng.width, designPng.height);
      if (rect) {
        const file = `regions/${region.key}-design.png`;
        fs.writeFileSync(
          path.join(shotsDir, `${region.key}-design.png`),
          PNG.sync.write(cropPng(designPng, rect)),
        );
        shot.designFile = file;
        shot.designRect = rect;
      }
    }
    const liveRegion = livePng
      ? live.regions.find((r) => r.key === region.key)
      : undefined;
    if (livePng && liveRegion) {
      const scaled: Rect = {
        x: liveRegion.bbox.x * scaleX,
        y: liveRegion.bbox.y * scaleY,
        width: liveRegion.bbox.width * scaleX,
        height: liveRegion.bbox.height * scaleY,
      };
      const rect = clampRect(scaled, livePng.width, livePng.height);
      if (rect) {
        const file = `regions/${region.key}-live.png`;
        fs.writeFileSync(
          path.join(shotsDir, `${region.key}-live.png`),
          PNG.sync.write(cropPng(livePng, rect)),
        );
        shot.liveFile = file;
        shot.liveRect = rect;
      }
    }
    if (shot.designFile || shot.liveFile) shots.push(shot);
  }
  return shots;
}

function paddedRect(
  rect: Rect,
  width: number,
  height: number,
  pad: number,
): Rect | null {
  return clampRect(
    {
      x: rect.x - pad,
      y: rect.y - pad,
      width: rect.width + pad * 2,
      height: rect.height + pad * 2,
    },
    width,
    height,
  );
}

function writeShotFile(
  outDir: string,
  src: PNG,
  rect: Rect,
  fileName: string,
  highlight?: { rect: Rect; color: [number, number, number] },
): string | undefined {
  const safe = clampRect(rect, src.width, src.height);
  if (!safe) return undefined;
  const crop = cropPng(src, safe);
  if (highlight) {
    const inner = clampRect(
      {
        x: highlight.rect.x - safe.x,
        y: highlight.rect.y - safe.y,
        width: highlight.rect.width,
        height: highlight.rect.height,
      },
      safe.width,
      safe.height,
    );
    if (inner) drawRectBorder(crop, inner, highlight.color);
  }
  fs.writeFileSync(path.join(outDir, fileName), PNG.sync.write(crop));
  return `regions/${fileName}`;
}

/** 为警告/失败校验点裁出对应文字或区块的局部对比截图。 */
export function checkShotFiles(
  outDir: string,
  design: DesignSpec,
  live: LiveSpec,
  checks: SpecCheck[],
): Map<string, CheckShot> {
  const designPath = path.join(outDir, "design.png");
  const livePath = path.join(outDir, "live.png");
  const designPng = fs.existsSync(designPath)
    ? PNG.sync.read(fs.readFileSync(designPath))
    : null;
  const livePng = fs.existsSync(livePath)
    ? PNG.sync.read(fs.readFileSync(livePath))
    : null;
  const viewport = live.rootViewport || { x: 0, y: 0, width: 1, height: 1 };
  const scaleX = livePng ? livePng.width / Math.max(1, viewport.width) : 1;
  const scaleY = livePng ? livePng.height / Math.max(1, viewport.height) : 1;

  const designTexts = new Map<string, DesignText>();
  for (const t of design.texts) {
    if (!t.regionKey) continue;
    designTexts.set(`text:${t.regionKey}:${t.normalized}`, t);
  }
  const liveTexts = new Map<string, LiveText>();
  for (const t of live.texts) {
    if (!t.regionKey) continue;
    const key = `text:${t.regionKey}:${t.normalized}`;
    if (!liveTexts.has(key)) liveTexts.set(key, t);
  }

  const shotsDir = path.join(outDir, "regions");
  fs.mkdirSync(shotsDir, { recursive: true });
  const shots = new Map<string, CheckShot>();
  let seq = 0;

  for (const c of checks) {
    if (c.status !== "warn" && c.status !== "fail") continue;
    const shot: CheckShot = {};
    const designText = designTexts.get(c.key);
    const liveText = liveTexts.get(c.key);
    const designRegion = design.regions.find((r) => r.key === c.region);
    const liveRegion = live.regions.find((r) => r.key === c.region);
    const designRect = designText?.bbox ?? designRegion?.bbox;
    const liveRect = liveText
      ? {
          x: liveText.bbox.x * scaleX,
          y: liveText.bbox.y * scaleY,
          width: liveText.bbox.width * scaleX,
          height: liveText.bbox.height * scaleY,
        }
      : liveRegion
        ? {
            x: liveRegion.bbox.x * scaleX,
            y: liveRegion.bbox.y * scaleY,
            width: liveRegion.bbox.width * scaleX,
            height: liveRegion.bbox.height * scaleY,
          }
        : undefined;
    const color: [number, number, number] =
      c.status === "fail" ? [229, 72, 77] : [245, 166, 35];
    if (designRect && designPng) {
      const dRect = paddedRect(
        designRect,
        designPng.width,
        designPng.height,
        8,
      );
      if (dRect) {
        shot.designFile = writeShotFile(
          shotsDir,
          designPng,
          dRect,
          `check-${seq}-design.png`,
          {
            rect: designRect,
            color,
          },
        );
      }
    }
    if (liveRect && livePng) {
      const lRect = paddedRect(liveRect, livePng.width, livePng.height, 8);
      if (lRect) {
        shot.liveFile = writeShotFile(
          shotsDir,
          livePng,
          lRect,
          `check-${seq}-live.png`,
          {
            rect: liveRect,
            color,
          },
        );
      }
    }
    if (shot.designFile || shot.liveFile) {
      shots.set(c.key, shot);
      seq += 1;
    }
  }
  return shots;
}
