/**
 * 从 Figma 节点树抽取“设计稿规范”：
 * 画布尺寸、布局骨架、关键文案、色彩、字体、间距与圆角。
 */
import {
  type ColorToken,
  type DesignSpec,
  type FigmaSpecConfig,
  type Rect,
  type SpacingToken,
  type TypographyToken,
} from './figma-spec-types.js';
import { type FigmaNode } from './design-spec-fetch.js';
import {
  aggregateTexts,
  assignRegionKey,
  classifyColorToken,
  classifyKind,
  collectColors,
  collectRadii,
  collectRegionColors,
  collectRegionSpacing,
  collectSpacing,
  collectTypography,
  extractRegions,
  hexToRgb,
  isDynamicText,
  parseTextStyle,
  relRect,
  solidFill,
  type TextCandidate,
} from './design-spec-collect.js';

export { parseFigmaUrl, fetchFigmaNode } from './design-spec-fetch.js';
export type { FetchFigmaOptions } from './design-spec-fetch.js';

export function extractDesignSpec(
  node: FigmaNode,
  source: DesignSpec['source'],
  config: FigmaSpecConfig,
): DesignSpec {
  const rootB = node.absoluteBoundingBox || { x: 0, y: 0, width: 0, height: 0 };
  const rootRect: Rect = {
    x: rootB.x,
    y: rootB.y,
    width: Math.round(rootB.width * 10) / 10,
    height: Math.round(rootB.height * 10) / 10,
  };

  const textCandidates: TextCandidate[] = [];
  const walkText = (n: FigmaNode, pathNames: string[]): void => {
    if (n.type === 'TEXT' && n.characters) {
      const fill = solidFill(n);
      const style = parseTextStyle(n, fill?.hex);
      const bbox = relRect(n, rootRect);
      const lines = n.characters.split('\n').map((s) => s.trim()).filter(Boolean);
      for (const line of lines) {
        const normalized = line.replace(/\s+/g, ' ');
        const dynamic = isDynamicText(normalized, pathNames);
        textCandidates.push({
          text: line,
          normalized,
          kind: classifyKind(pathNames, dynamic),
          style,
          bbox,
          dynamic,
        });
      }
    }
    for (const child of n.children || []) walkText(child, [...pathNames, child.name || child.type || '']);
  };
  walkText(node, [node.name || '']);

  const colorMap = new Map<string, { weight: number; shape: number; text: number }>();
  collectColors(node, colorMap);
  const maxWeight = Math.max(0, ...[...colorMap.values()].map((c) => c.weight));
  const colors: ColorToken[] = [...colorMap.entries()]
    .map(([hex, c]) => ({
      hex,
      rgb: hexToRgb(hex),
      weight: c.weight,
      shapeCount: c.shape,
      textCount: c.text,
      role: classifyColorToken(hex, c.text, c.shape, c.weight, maxWeight),
    }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, Math.max(config.paletteLimit, 20));

  const typoMap = new Map<string, TypographyToken>();
  collectTypography(node, rootRect, typoMap);
  const typography = [...typoMap.values()].sort((a, b) => b.count - a.count).slice(0, config.typographyLimit);

  const spacingMap = new Map<string, SpacingToken>();
  collectSpacing(node, spacingMap);
  const spacing = [...spacingMap.values()].sort((a, b) => b.count - a.count || a.value - b.value).slice(0, 20);

  const radiiMap = new Map<number, number>();
  collectRadii(node, radiiMap);
  const radii = [...radiiMap.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);

  const regions = extractRegions(node, rootRect, config);
  const texts = aggregateTexts(textCandidates).map((t) => ({
    ...t,
    regionKey: assignRegionKey(t.bbox, regions),
  }));

  const regionColorMaps = new Map<string, Map<string, { weight: number; shape: number; text: number }>>();
  collectRegionColors(node, rootRect, regions, regionColorMaps);
  const regionColors: DesignSpec['regionColors'] = {};
  for (const [key, map] of regionColorMaps) {
    regionColors[key] = [...map.entries()]
      .map(([hex, c]) => ({
        hex,
        rgb: hexToRgb(hex),
        weight: c.weight,
        shapeCount: c.shape,
        textCount: c.text,
        role: classifyColorToken(hex, c.text, c.shape, c.weight, maxWeight),
      }))
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 8);
  }

  const regionSpacingMaps = new Map<string, Map<string, SpacingToken>>();
  collectRegionSpacing(node, rootRect, regions, regionSpacingMaps);
  const regionSpacing: DesignSpec['regionSpacing'] = {};
  for (const [key, map] of regionSpacingMaps) {
    regionSpacing[key] = [...map.values()].sort((a, b) => b.count - a.count).slice(0, 12);
  }

  return {
    source,
    canvas: { name: node.name || '', width: rootRect.width, height: rootRect.height },
    regions,
    texts,
    colors,
    typography,
    spacing,
    radii,
    regionColors,
    regionSpacing,
  };
}
