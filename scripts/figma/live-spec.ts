/**
 * 采集线上页面的语义化信息（文本、样式、区块、色板），
 * 不做整页像素对比，供设计稿规范校验使用。
 */
import type { Page } from 'playwright';
import {
  type FigmaSpecConfig,
  type LiveColor,
  type LiveFrameSpec,
  type LiveRegion,
  type LiveSpec,
  type LiveText,
  type Rect,
  type SpacingToken,
  type TextStyle,
} from './figma-spec-types.js';
import {
  assignRegionKey,
  collectFrameData,
  frameOffset,
  parseCssRgb,
  parseRgb,
} from './live-spec-collect.js';

export async function captureLiveSpec(page: Page, config: FigmaSpecConfig): Promise<LiveSpec> {
  const frames = [page.mainFrame(), ...page.frames().filter((f) => f !== page.mainFrame())].slice(0, 6);
  const frameSpecs: LiveFrameSpec[] = [];
  const frameErrors: string[] = [];

  for (const frame of frames) {
    try {
      const raw = await collectFrameData(frame, config.regions);
      const offset = await frameOffset(page, frame);
      const texts = raw.texts.map<LiveText>((t) => ({
        ...t,
        bbox: {
          x: Math.round((t.bbox.x + offset.x) * 10) / 10,
          y: Math.round((t.bbox.y + offset.y) * 10) / 10,
          width: t.bbox.width,
          height: t.bbox.height,
        },
        colorRgb: parseCssRgb(t.color),
        frameUrl: frame.url(),
        count: 1,
      }));
      const regions = raw.regions.map<LiveRegion>((r) => ({
        ...r,
        bbox: {
          x: Math.round((r.bbox.x + offset.x) * 10) / 10,
          y: Math.round((r.bbox.y + offset.y) * 10) / 10,
          width: r.bbox.width,
          height: r.bbox.height,
        },
        rawBbox: r.bbox,
        frameUrl: frame.url(),
      }));
      const palette = raw.palette.map<LiveColor>((c) => ({ ...c, rgb: parseRgb(c.hex), count: 1 }));
      const spacing = raw.spacing.map<SpacingToken>((s) => ({ ...s }));

      frameSpecs.push({
        url: frame.url(),
        viewport: raw.viewport,
        scroll: raw.scroll,
        texts,
        regions,
        palette,
        spacing,
      });
    } catch (e) {
      frameErrors.push(`${frame === page.mainFrame() ? 'main' : frame.url().slice(0, 80)}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const allTexts: LiveText[] = [];
  const textMap = new Map<string, LiveText>();
  for (const spec of frameSpecs) {
    for (const t of spec.texts) {
      const key = `${t.normalized}|${t.fontSize}|${t.fontWeight}|${t.color}`;
      const cur = textMap.get(key);
      if (cur) {
        cur.count += 1;
        continue;
      }
      const copy = { ...t, count: 1 };
      textMap.set(key, copy);
      allTexts.push(copy);
    }
  }

  const allRegions: LiveRegion[] = frameSpecs.flatMap((f) => f.regions);
  const textsWithRegions = allTexts.map((t) => ({
    ...t,
    regionKey: assignRegionKey(t.bbox, allRegions),
  }));
  const paletteMap = new Map<string, LiveColor>();
  for (const spec of frameSpecs) {
    for (const c of spec.palette) {
      const key = `${c.hex}|${c.role}`;
      const cur = paletteMap.get(key);
      if (cur) {
        cur.weight += c.weight;
        cur.count += 1;
      } else {
        paletteMap.set(key, { ...c });
      }
    }
  }
  const allPalette = [...paletteMap.values()].sort((a, b) => b.weight - a.weight);

  const spacingMap = new Map<string, SpacingToken>();
  for (const spec of frameSpecs) {
    for (const s of spec.spacing) {
      const key = `${s.kind}:${s.value}`;
      const cur = spacingMap.get(key);
      if (cur) cur.count += s.count;
      else spacingMap.set(key, { ...s });
    }
  }
  const allSpacing = [...spacingMap.values()].sort((a, b) => b.count - a.count || a.value - b.value);

  const regionColorMap = new Map<string, Map<string, LiveColor>>();
  for (const spec of frameSpecs) {
    for (const c of spec.palette) {
      if (!c.regionKey) continue;
      const map = regionColorMap.get(c.regionKey) || new Map();
      const key = `${c.hex}|${c.role}`;
      const cur = map.get(key);
      if (cur) {
        cur.weight += c.weight;
        cur.count += c.count;
      } else {
        map.set(key, { ...c });
      }
      regionColorMap.set(c.regionKey, map);
    }
  }
  const regionColors: Record<string, LiveColor[]> = {};
  for (const [key, map] of regionColorMap) {
    regionColors[key] = [...map.values()].sort((a, b) => b.weight - a.weight);
  }

  const regionSpacingMap = new Map<string, Map<string, SpacingToken>>();
  for (const spec of frameSpecs) {
    for (const s of spec.spacing) {
      if (!s.regionKey) continue;
      const map = regionSpacingMap.get(s.regionKey) || new Map();
      const key = `${s.kind}:${s.value}`;
      const cur = map.get(key);
      if (cur) cur.count += s.count;
      else map.set(key, { ...s });
      regionSpacingMap.set(s.regionKey, map);
    }
  }
  const regionSpacing: Record<string, SpacingToken[]> = {};
  for (const [key, map] of regionSpacingMap) {
    regionSpacing[key] = [...map.values()].sort((a, b) => b.count - a.count || a.value - b.value);
  }

  const rootViewport = frameSpecs.reduce<Rect | null>(
    (best, f) =>
      !best || f.viewport.width * f.viewport.height > best.width * best.height
        ? { ...f.viewport }
        : best,
    null,
  ) || { x: 0, y: 0, width: 0, height: 0 };

  const warnings: string[] = [];
  for (const err of frameErrors) warnings.push(`frame 采集失败：${err}`);
  if (frameSpecs.length > 1) {
    warnings.push('页面内容位于 iframe 中，坐标已换算到顶层视口；尺寸校验按比例进行。');
  }

  return {
    rootViewport,
    frames: frameSpecs,
    texts: textsWithRegions,
    regions: allRegions,
    palette: allPalette,
    spacing: allSpacing,
    regionColors,
    regionSpacing,
    warnings,
  };
}

export function liveTextStyle(t: LiveText): TextStyle {
  return {
    fontFamily: t.fontFamily,
    fontSize: t.fontSize,
    fontWeight: t.fontWeight,
    lineHeight: t.lineHeight,
    letterSpacing: t.letterSpacing,
    textCase: t.textCase,
    color: t.color,
    colorRgb: t.colorRgb,
  };
}
