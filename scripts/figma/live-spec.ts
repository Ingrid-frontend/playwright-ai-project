/**
 * 采集线上页面的语义化信息（文本、样式、区块、色板），
 * 不做整页像素对比，供设计稿规范校验使用。
 */
import type { Page, Frame } from 'playwright';
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

interface RawText {
  text: string;
  normalized: string;
  bbox: Rect;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  lineHeight: number;
  letterSpacing: number;
  color: string;
  tag: string;
  className: string;
}

interface RawRegion {
  key: string;
  selector: string;
  bbox: Rect;
  tag: string;
  className: string;
  text?: string;
}

interface RawColor {
  hex: string;
  role: 'color' | 'background';
  weight: number;
  regionKey?: string;
}

interface RawSpacing {
  kind: string;
  value: number;
  count: number;
  regionKey?: string;
}

interface RawFrameData {
  viewport: Rect;
  scroll: Rect;
  texts: RawText[];
  regions: RawRegion[];
  palette: RawColor[];
  spacing: RawSpacing[];
}

// tsx 的 keepNames 会给回调里的命名函数注入 __name，导致浏览器端 ReferenceError，
// 因此这里把浏览器端采集逻辑写成纯字符串，用 new Function 构造后交给 Playwright。
const COLLECT_FRAME_BODY = String.raw`({ defs, maxTexts, maxColors }) => {
  const isVisible = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    const o = Number.parseFloat(cs.opacity);
    if (Number.isFinite(o) && o <= 0.01) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const norm = (s) => s.replace(/\s+/g, ' ').trim();
  const toHex = (css) => {
    const m = /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)/i.exec(css);
    if (!m) return null;
    const alpha = m[4] === undefined ? 1 : Number.parseFloat(m[4]);
    if (!Number.isFinite(alpha) || alpha <= 0.02) return null;
    return '#' + [Number.parseInt(m[1], 10), Number.parseInt(m[2], 10), Number.parseInt(m[3], 10)]
      .map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase();
  };
  const texts = [];
  const paletteMap = new Map();
  const spacingMap = new Map();
  const addPalette = (css, role, weight, regionKey) => {
    const hex = toHex(css);
    if (!hex) return;
    const key = hex + '|' + role + '|' + (regionKey || '');
    const cur = paletteMap.get(key) || { role: role, weight: 0, regionKey: regionKey };
    cur.weight += weight;
    paletteMap.set(key, cur);
  };
  const addSpacing = (kind, rawValue, regionKey) => {
    const value = Math.round(Number.parseFloat(rawValue));
    if (!Number.isFinite(value) || value <= 0) return;
    const key = kind + ':' + value + ':' + (regionKey || '');
    const cur = spacingMap.get(key) || { kind: kind, value: value, count: 0, regionKey: regionKey };
    cur.count += 1;
    spacingMap.set(key, cur);
  };
  const body = document.body;
  if (body) {
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    let guard = 0;
    while (node && texts.length < maxTexts && guard < 20000) {
      guard += 1;
      const raw = node.textContent || '';
      const normalized = norm(raw);
      const parent = node.parentElement;
      if (normalized && normalized.length >= 1 && parent && isVisible(parent)) {
        const cs = getComputedStyle(parent);
        const r = parent.getBoundingClientRect();
        texts.push({
          text: normalized,
          normalized: normalized,
          bbox: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) },
          fontFamily: cs.fontFamily,
          fontSize: Number.parseFloat(cs.fontSize) || 0,
          fontWeight: Number.parseFloat(cs.fontWeight) || 400,
          lineHeight: Number.parseFloat(cs.lineHeight) || 0,
          letterSpacing: Number.parseFloat(cs.letterSpacing) || 0,
          color: cs.color,
          tag: parent.tagName,
          className: typeof parent.className === 'string' ? parent.className.slice(0, 120) : ''
        });
        addPalette(cs.color, 'color', r.width * r.height);
      }
      node = walker.nextNode();
    }
    for (const el of Array.from(document.querySelectorAll('input,textarea')).slice(0, 200)) {
      if (!isVisible(el)) continue;
      const placeholder = el.placeholder;
      if (placeholder && placeholder.trim()) {
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        texts.push({
          text: placeholder.trim(),
          normalized: norm(placeholder),
          bbox: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) },
          fontFamily: cs.fontFamily,
          fontSize: Number.parseFloat(cs.fontSize) || 0,
          fontWeight: Number.parseFloat(cs.fontWeight) || 400,
          lineHeight: Number.parseFloat(cs.lineHeight) || 0,
          letterSpacing: Number.parseFloat(cs.letterSpacing) || 0,
          color: cs.color,
          tag: 'INPUT',
          className: String(el.className).slice(0, 120)
        });
        addPalette(cs.color, 'color', r.width * r.height);
      }
    }
  }
  const regions = [];
  for (const def of defs) {
    if (def.union) {
      let minX = Infinity;
      let minY = Infinity;
      let maxRight = -Infinity;
      let maxBottom = -Infinity;
      for (const selector of def.selectors) {
        const el = document.querySelector(selector);
        if (!el || !isVisible(el)) continue;
        const r = el.getBoundingClientRect();
        minX = Math.min(minX, r.x);
        minY = Math.min(minY, r.y);
        maxRight = Math.max(maxRight, r.x + r.width);
        maxBottom = Math.max(maxBottom, r.y + r.height);
      }
      if (Number.isFinite(minX)) {
        regions.push({
          key: def.key,
          selector: 'union(' + def.selectors.join(',') + ')',
          bbox: {
            x: Math.round(minX),
            y: Math.round(minY),
            width: Math.round(maxRight - minX),
            height: Math.round(maxBottom - minY)
          },
          tag: 'UNION',
          className: '',
          text: ''
        });
      }
      continue;
    }
    for (const selector of def.selectors) {
      const el = document.querySelector(selector);
      if (!el || !isVisible(el)) continue;
      const r = el.getBoundingClientRect();
      regions.push({
        key: def.key,
        selector: selector,
        bbox: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) },
        tag: el.tagName,
        className: typeof el.className === 'string' ? el.className.slice(0, 120) : '',
        text: norm(el.textContent || '').slice(0, 80)
      });
      break;
    }
  }
  const regionKeyFor = (rect) => {
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;
    const priority = { filter: 1, table: 2, footer: 3, header: 4, sidebar: 5, content: 6 };
    const list = regions
      .filter((r) => cx >= r.bbox.x && cx <= r.bbox.x + r.bbox.width && cy >= r.bbox.y && cy <= r.bbox.y + r.bbox.height)
      .sort((a, b) => (priority[a.key] || 99) - (priority[b.key] || 99) || a.bbox.width * a.bbox.height - b.bbox.width * b.bbox.height);
    return list.length ? list[0].key : undefined;
  };
  let paletteGuard = 0;
  for (const el of Array.from(document.querySelectorAll('body *'))) {
    if (paletteGuard++ >= maxColors) break;
    if (!isVisible(el)) continue;
    const r = el.getBoundingClientRect();
    const area = r.width * r.height;
    if (!area) continue;
    const cs = getComputedStyle(el);
    const regionKey = regionKeyFor(r);
    addPalette(cs.backgroundColor, 'background', area, regionKey);
    const hasText = (el.textContent || '').trim().length > 0;
    if (hasText) addPalette(cs.color, 'color', area, regionKey);
    if (cs.display === 'flex' || cs.display === 'grid' || cs.display === 'inline-flex') {
      addSpacing('gap', cs.gap, regionKey);
    }
    addSpacing('paddingTop', cs.paddingTop, regionKey);
    addSpacing('paddingRight', cs.paddingRight, regionKey);
    addSpacing('paddingBottom', cs.paddingBottom, regionKey);
    addSpacing('paddingLeft', cs.paddingLeft, regionKey);
  }
  const palette = [];
  for (const entry of paletteMap.entries()) {
    const key = entry[0];
    const v = entry[1];
    const parts = key.split('|');
    palette.push({ hex: parts[0], role: parts[1], weight: v.weight, regionKey: parts[2] || undefined });
  }
  const spacing = [];
  for (const entry of spacingMap.entries()) {
    const v = entry[1];
    spacing.push({ kind: v.kind, value: v.value, count: v.count, regionKey: v.regionKey });
  }
  return {
    viewport: { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight },
    scroll: { x: 0, y: 0, width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
    texts: texts,
    regions: regions,
    palette: palette,
    spacing: spacing
  };
}`;

function collectFrameData(frame: Frame, regionDefs: FigmaSpecConfig['regions']): Promise<RawFrameData> {
  const fn = new Function('return (' + COLLECT_FRAME_BODY + ');')() as (
    args: { defs: FigmaSpecConfig['regions']; maxTexts: number; maxColors: number },
  ) => RawFrameData;
  return frame.evaluate(fn, { defs: regionDefs, maxTexts: 3000, maxColors: 5000 });
}

async function frameOffset(page: Page, frame: Frame): Promise<{ x: number; y: number }> {
  if (frame === page.mainFrame()) return { x: 0, y: 0 };
  try {
    const parent = frame.parentFrame();
    const el = await frame.frameElement();
    const box = await el.boundingBox();
    const parentOffset = parent ? await frameOffset(page, parent) : { x: 0, y: 0 };
    return { x: parentOffset.x + (box?.x || 0), y: parentOffset.y + (box?.y || 0) };
  } catch {
    return { x: 0, y: 0 };
  }
}

function parseRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  return m ? [Number.parseInt(m[1]!, 16), Number.parseInt(m[2]!, 16), Number.parseInt(m[3]!, 16)] : [0, 0, 0];
}

function parseCssRgb(css: string): [number, number, number] {
  const m = /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i.exec(css);
  return m
    ? [Number.parseInt(m[1]!, 10), Number.parseInt(m[2]!, 10), Number.parseInt(m[3]!, 10)]
    : [0, 0, 0];
}

function assignRegionKey(bbox: Rect, regions: LiveRegion[]): string | undefined {
  const cx = bbox.x + bbox.width / 2;
  const cy = bbox.y + bbox.height / 2;
  const priority: Record<string, number> = {
    filter: 1,
    table: 2,
    footer: 3,
    header: 4,
    sidebar: 5,
    content: 6,
  };
  const containing = regions
    .filter(
      (r) =>
        cx >= r.bbox.x &&
        cx <= r.bbox.x + r.bbox.width &&
        cy >= r.bbox.y &&
        cy <= r.bbox.y + r.bbox.height,
    )
    .sort(
      (a, b) =>
        (priority[a.key] ?? 99) - (priority[b.key] ?? 99) ||
        a.bbox.width * a.bbox.height - b.bbox.width * b.bbox.height,
    );
  return containing[0]?.key;
}

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
