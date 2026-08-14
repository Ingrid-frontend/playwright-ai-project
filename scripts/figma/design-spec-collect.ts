import {
  DEFAULT_REGION_SELECTORS,
  type ColorToken,
  type DesignRegion,
  type DesignText,
  type FigmaSpecConfig,
  type Rect,
  type SpacingToken,
  type TextStyle,
  type TypographyToken,
} from './figma-spec-types.js';
import { type FigmaNode } from './design-spec-fetch.js';

export interface TextCandidate {
  text: string;
  normalized: string;
  kind: DesignText['kind'];
  style: TextStyle;
  bbox: Rect;
  dynamic: boolean;
}

function num(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function toHex(c: { r: number; g: number; b: number }): string {
  return (
    '#' +
    [c.r, c.g, c.b]
      .map((v) => Math.round(v * 255).toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()
  );
}

export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return [0, 0, 0];
  return [Number.parseInt(m[1]!, 16), Number.parseInt(m[2]!, 16), Number.parseInt(m[3]!, 16)];
}

export function solidFill(node: FigmaNode): { hex: string; rgb: [number, number, number] } | null {
  for (const fill of node.fills || []) {
    if (fill.type !== 'SOLID' || fill.visible === false || !fill.color) continue;
    const alpha = fill.opacity ?? fill.color.a ?? 1;
    if (alpha <= 0.02) continue;
    const hex = toHex(fill.color);
    return { hex, rgb: hexToRgb(hex) };
  }
  return null;
}

export function relRect(node: FigmaNode, root: Rect | null): Rect {
  const b = node.absoluteBoundingBox;
  if (!b) return { x: 0, y: 0, width: 0, height: 0 };
  const x = Math.round((root ? b.x - root.x : b.x) * 10) / 10;
  const y = Math.round((root ? b.y - root.y : b.y) * 10) / 10;
  return { x, y, width: Math.round(b.width * 10) / 10, height: Math.round(b.height * 10) / 10 };
}

export function parseTextStyle(node: FigmaNode, colorHex?: string): TextStyle {
  const style = node.style || {};
  const rgb = colorHex ? hexToRgb(colorHex) : undefined;
  return {
    fontFamily: typeof style.fontFamily === 'string' ? style.fontFamily : undefined,
    fontSize: num(style.fontSize),
    fontWeight: num(style.fontWeight),
    lineHeight: num(style.lineHeightPx),
    letterSpacing: num(style.letterSpacing),
    textCase: typeof style.textCase === 'string' ? style.textCase : undefined,
    color: colorHex,
    colorRgb: rgb,
  };
}

export function isDynamicText(text: string, pathNames: string[]): boolean {
  const joined = pathNames.join('|');
  if (/行高32|行高36|表格\/内容/.test(joined) && !/表格\/标题/.test(joined)) return true;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return true;
  if (/^EA\d+$/i.test(text)) return true;
  if (/^[\d,]+(\.\d+)?\s*(CNY|USD|HKD|JPY|EUR|RMB)$/i.test(text)) return true;
  if (/^(CNY|USD|HKD|JPY|EUR|RMB)\s*[\d,]+(\.\d+)?$/i.test(text)) return true;
  if (/^[-+]?\d+(\.\d+)?$/.test(text) && text.length <= 4) return true;
  return false;
}

export function classifyKind(pathNames: string[], dynamic: boolean): DesignText['kind'] {
  if (dynamic) return 'sample';
  const joined = pathNames.join('|');
  if (/顶部导航|Component 5|审批tab切换|基础tab/.test(joined)) return 'tab';
  if (/Frame 427318172|导航标题/.test(joined)) return 'sidebar';
  if (/表头操作项|表格顶部操作|表格\/标题/.test(joined)) return 'table-header';
  if (/筛选项|Frame 1321315831/.test(joined)) return 'filter';
  if (/底部操作|翻页器/.test(joined)) return 'footer';
  if (/输入框/.test(joined)) return 'input';
  if (/左导航|导航/.test(joined)) return 'sidebar';
  return 'label';
}

const KIND_PRIORITY: Record<DesignText['kind'], number> = {
  nav: 1,
  sidebar: 2,
  tab: 3,
  'table-header': 4,
  filter: 5,
  footer: 6,
  input: 7,
  label: 8,
  sample: 9,
};

export function aggregateTexts(candidates: TextCandidate[]): DesignText[] {
  const byText = new Map<string, TextCandidate & { count: number }>();
  for (const c of candidates) {
    const key = c.normalized;
    const cur = byText.get(key);
    if (!cur) {
      byText.set(key, { ...c, count: 1 });
      continue;
    }
    cur.count += 1;
    if (KIND_PRIORITY[c.kind] < KIND_PRIORITY[cur.kind]) {
      cur.kind = c.kind;
      cur.dynamic = c.dynamic;
    }
  }
  return [...byText.values()]
    .map((c) => ({
      text: c.text,
      normalized: c.normalized,
      kind: c.kind,
      style: c.style,
      bbox: c.bbox,
      count: c.count,
      dynamic: c.dynamic,
    }))
    .sort((a, b) => KIND_PRIORITY[a.kind] - KIND_PRIORITY[b.kind] || b.count - a.count);
}

export function assignRegionKey(bbox: Rect, regions: DesignRegion[]): string | undefined {
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

function isSaturated(hex: string): boolean {
  const [r, g, b] = hexToRgb(hex);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max - min >= 80 && max >= 60 && min <= 200;
}

export function classifyColorToken(
  hex: string,
  textCount: number,
  shapeCount: number,
  weight: number,
  maxWeight: number,
): ColorToken['role'] {
  if ((hex === '#FFFFFF' || hex === '#F9F9F9' || hex === '#F1F3F5' || hex === '#F2F2F3') && shapeCount > 0) {
    return weight > maxWeight * 0.5 ? 'background' : 'surface';
  }
  if (textCount > 0 && textCount >= shapeCount) return 'text';
  if (isSaturated(hex)) return 'accent';
  return 'other';
}

export function collectColors(node: FigmaNode, out: Map<string, { weight: number; shape: number; text: number }>): void {
  const fill = solidFill(node);
  const b = node.absoluteBoundingBox;
  const area = b ? b.width * b.height : 0;
  if (fill) {
    const cur = out.get(fill.hex) || { weight: 0, shape: 0, text: 0 };
    cur.weight += area;
    if (node.type === 'TEXT') cur.text += 1;
    else cur.shape += 1;
    out.set(fill.hex, cur);
  }
  for (const child of node.children || []) collectColors(child, out);
}

export function collectTypography(node: FigmaNode, root: Rect | null, out: Map<string, TypographyToken>): void {
  if (node.type === 'TEXT' && node.characters?.trim()) {
    const fill = solidFill(node);
    if (fill) {
      const style = parseTextStyle(node, fill.hex);
      const key = [
        style.fontFamily || '',
        style.fontSize ?? '',
        style.fontWeight ?? '',
        style.lineHeight ?? '',
        style.letterSpacing ?? '',
        style.textCase || '',
        fill.hex,
      ].join('|');
      const cur = out.get(key) || {
        fontFamily: style.fontFamily || '',
        fontSize: style.fontSize || 14,
        fontWeight: style.fontWeight || 400,
        lineHeight: style.lineHeight || 0,
        letterSpacing: style.letterSpacing || 0,
        textCase: style.textCase || 'ORIGINAL',
        color: fill.hex,
        colorRgb: fill.rgb,
        count: 0,
        examples: [],
      };
      cur.count += 1;
      const sample = node.characters.trim().replace(/\s+/g, ' ').slice(0, 20);
      if (cur.examples.length < 3 && !cur.examples.includes(sample)) cur.examples.push(sample);
      out.set(key, cur);
    }
  }
  for (const child of node.children || []) collectTypography(child, root, out);
}

export function collectSpacing(node: FigmaNode, out: Map<string, SpacingToken>): void {
  if (node.layoutMode && node.layoutMode !== 'NONE') {
    const entries: Array<[string, number | undefined]> = [
      ['itemSpacing', node.itemSpacing],
      ['paddingTop', node.paddingTop],
      ['paddingBottom', node.paddingBottom],
      ['paddingLeft', node.paddingLeft],
      ['paddingRight', node.paddingRight],
    ];
    for (const [kind, v] of entries) {
      const value = num(v);
      if (value !== undefined && value > 0) {
        const rounded = Math.round(value);
        const key = `${kind}:${rounded}`;
        const cur = out.get(key) || { value: rounded, kind, count: 0 };
        cur.count += 1;
        out.set(key, cur);
      }
    }
  }
  for (const child of node.children || []) collectSpacing(child, out);
}

export function collectRadii(node: FigmaNode, out: Map<number, number>): void {
  const r = node.cornerRadius;
  if (typeof r === 'number' && Number.isFinite(r) && r > 0.5) {
    const rounded = Math.round(r);
    out.set(rounded, (out.get(rounded) || 0) + 1);
  }
  for (const child of node.children || []) collectRadii(child, out);
}

export function collectRegionColors(
  node: FigmaNode,
  root: Rect,
  regions: DesignRegion[],
  out: Map<string, Map<string, { weight: number; shape: number; text: number }>>,
): void {
  const fill = solidFill(node);
  const b = relRect(node, root);
  const key = assignRegionKey(b, regions);
  if (fill && key) {
    const map = out.get(key) || new Map();
    const cur = map.get(fill.hex) || { weight: 0, shape: 0, text: 0 };
    cur.weight += b.width * b.height;
    if (node.type === 'TEXT') cur.text += 1;
    else cur.shape += 1;
    map.set(fill.hex, cur);
    out.set(key, map);
  }
  for (const child of node.children || []) collectRegionColors(child, root, regions, out);
}

export function collectRegionSpacing(
  node: FigmaNode,
  root: Rect,
  regions: DesignRegion[],
  out: Map<string, Map<string, SpacingToken>>,
): void {
  if (node.layoutMode && node.layoutMode !== 'NONE') {
    const key = assignRegionKey(relRect(node, root), regions);
    if (key) {
      const map = out.get(key) || new Map();
      const entries: Array<[string, number | undefined]> = [
        ['itemSpacing', node.itemSpacing],
        ['paddingTop', node.paddingTop],
        ['paddingBottom', node.paddingBottom],
        ['paddingLeft', node.paddingLeft],
        ['paddingRight', node.paddingRight],
      ];
      for (const [kind, v] of entries) {
        const value = num(v);
        if (value !== undefined && value > 0) {
          const rounded = Math.round(value);
          const key2 = `${kind}:${rounded}`;
          const cur = map.get(key2) || { value: rounded, kind, count: 0 };
          cur.count += 1;
          map.set(key2, cur);
        }
      }
      out.set(key, map);
    }
  }
  for (const child of node.children || []) collectRegionSpacing(child, root, regions, out);
}

function pickRegion(
  nodes: FigmaNode[],
  root: Rect,
  patterns: string[],
  areaMin = 2000,
  extraFilter?: (n: FigmaNode, b: Rect) => boolean,
): { node: FigmaNode; bbox: Rect } | null {
  let best: { node: FigmaNode; bbox: Rect } | null = null;
  let bestArea = 0;
  for (const n of nodes) {
    const b = relRect(n, root);
    if (b.width * b.height < areaMin) continue;
    if (!patterns.some((p) => new RegExp(p).test(n.name || ''))) continue;
    if (extraFilter && !extraFilter(n, b)) continue;
    const area = b.width * b.height;
    if (area > bestArea) {
      best = { node: n, bbox: b };
      bestArea = area;
    }
  }
  return best;
}

function collectAllNodes(node: FigmaNode, out: FigmaNode[]): void {
  out.push(node);
  for (const child of node.children || []) collectAllNodes(child, out);
}

export function extractRegions(root: FigmaNode, rootRect: Rect, config: FigmaSpecConfig): DesignRegion[] {
  const nodes: FigmaNode[] = [];
  collectAllNodes(root, nodes);
  const regions: DesignRegion[] = [];

  const headerPick = pickRegion(nodes, rootRect, ['顶部导航'], 2000, (_n, b) => b.width >= rootRect.width - 4);
  if (headerPick) {
    // 顶部导航通常和顶部 banner 连成一块，向上合并同一水平带。
    let minY = headerPick.bbox.y;
    let maxY = headerPick.bbox.y + headerPick.bbox.height;
    for (const n of nodes) {
      const b = relRect(n, rootRect);
      if (
        b.width >= rootRect.width - 4 &&
        b.y < 240 &&
        b.y + b.height <= 240 &&
        b.y < maxY &&
        b.y + b.height >= minY
      ) {
        minY = Math.min(minY, b.y);
        maxY = Math.max(maxY, b.y + b.height);
      }
    }
    regions.push({
      key: 'header',
      name: '顶部导航',
      nodeName: headerPick.node.name || '',
      type: headerPick.node.type || '',
      bbox: { x: 0, y: minY, width: rootRect.width, height: maxY - minY },
      layoutMode: headerPick.node.layoutMode,
      selectors: config.regions.find((r) => r.key === 'header')?.selectors || DEFAULT_REGION_SELECTORS.header,
    });
  }

  const sidebarPick = pickRegion(
    nodes,
    rootRect,
    ['^导航$', '菜单'],
    4000,
    (_n, b) => b.width <= 260 && b.width >= 60 && b.height >= rootRect.height * 0.3,
  );
  if (sidebarPick) {
    regions.push({
      key: 'sidebar',
      name: '左侧导航',
      nodeName: sidebarPick.node.name || '',
      type: sidebarPick.node.type || '',
      bbox: sidebarPick.bbox,
      layoutMode: sidebarPick.node.layoutMode,
      selectors: config.regions.find((r) => r.key === 'sidebar')?.selectors || DEFAULT_REGION_SELECTORS.sidebar,
    });
  }

  const contentPick = pickRegion(
    nodes,
    rootRect,
    ['^筛选\\+列表$'],
    8000,
    (_n, b) => b.width < rootRect.width - 60 && b.height > rootRect.height * 0.5,
  );
  if (contentPick) {
    regions.push({
      key: 'content',
      name: '主内容区',
      nodeName: contentPick.node.name || '',
      type: contentPick.node.type || '',
      bbox: contentPick.bbox,
      layoutMode: contentPick.node.layoutMode,
      selectors: config.regions.find((r) => r.key === 'content')?.selectors || DEFAULT_REGION_SELECTORS.content,
    });
  } else if (sidebarPick) {
    regions.push({
      key: 'content',
      name: '主内容区',
      nodeName: '',
      type: '',
      bbox: {
        x: sidebarPick.bbox.x + sidebarPick.bbox.width,
        y: sidebarPick.bbox.y,
        width: rootRect.width - sidebarPick.bbox.x - sidebarPick.bbox.width,
        height: sidebarPick.bbox.height,
      },
      selectors: config.regions.find((r) => r.key === 'content')?.selectors || DEFAULT_REGION_SELECTORS.content,
    });
  }

  const content = regions.find((r) => r.key === 'content');
  const tablePick = pickRegion(
    nodes,
    rootRect,
    ['审批列表', '表格', '列表'],
    8000,
    (_n, b) =>
      content
        ? b.x >= content.bbox.x - 4 &&
          b.y >= content.bbox.y - 4 &&
          b.width <= content.bbox.width + 4 &&
          b.height <= content.bbox.height + 400
        : true,
  );
  if (tablePick) {
    regions.push({
      key: 'table',
      name: '数据列表',
      nodeName: tablePick.node.name || '',
      type: tablePick.node.type || '',
      bbox: tablePick.bbox,
      layoutMode: tablePick.node.layoutMode,
      selectors: config.regions.find((r) => r.key === 'table')?.selectors || DEFAULT_REGION_SELECTORS.table,
    });
  }

  if (content) {
    const filterPick = pickRegion(
      nodes,
      rootRect,
      ['Frame 1321315805', '筛选项', '搜索'],
      2000,
      (_n, b) => b.y >= content.bbox.y && b.y <= content.bbox.y + 160 && b.height <= 140,
    );
    if (filterPick) {
      regions.push({
        key: 'filter',
        name: '筛选/操作区',
        nodeName: filterPick.node.name || '',
        type: filterPick.node.type || '',
        bbox: filterPick.bbox,
        layoutMode: filterPick.node.layoutMode,
        selectors: config.regions.find((r) => r.key === 'filter')?.selectors || DEFAULT_REGION_SELECTORS.filter,
      });
    }
  }

  const footerPick = pickRegion(nodes, rootRect, ['底部操作', '翻页器'], 1000);
  if (footerPick) {
    regions.push({
      key: 'footer',
      name: '底部操作',
      nodeName: footerPick.node.name || '',
      type: footerPick.node.type || '',
      bbox: footerPick.bbox,
      layoutMode: footerPick.node.layoutMode,
      selectors: config.regions.find((r) => r.key === 'footer')?.selectors || DEFAULT_REGION_SELECTORS.footer,
    });
  }

  return regions;
}
