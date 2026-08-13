/** 设计稿规范对比的共享类型与默认配置。 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DesignSource {
  fileKey: string;
  nodeId: string;
  nodeName: string;
  figmaUrl?: string;
  fetchedAt: string;
  fromCache: boolean;
}

export interface TextStyle {
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  lineHeight?: number;
  letterSpacing?: number;
  textCase?: string;
  color?: string;
  colorRgb?: [number, number, number];
}

export interface DesignRegion {
  key: string;
  name: string;
  nodeName: string;
  type: string;
  bbox: Rect;
  layoutMode?: string;
  selectors: string[];
}

export interface DesignText {
  text: string;
  normalized: string;
  kind: 'nav' | 'sidebar' | 'tab' | 'filter' | 'table-header' | 'footer' | 'input' | 'label' | 'sample';
  style: TextStyle;
  bbox: Rect;
  count: number;
  dynamic: boolean;
  regionKey?: string;
}

export interface ColorToken {
  hex: string;
  rgb: [number, number, number];
  weight: number;
  shapeCount: number;
  textCount: number;
  role: 'background' | 'surface' | 'text' | 'accent' | 'border' | 'other';
}

export interface TypographyToken {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  lineHeight: number;
  letterSpacing: number;
  textCase: string;
  color: string;
  colorRgb: [number, number, number];
  count: number;
  examples: string[];
}

export interface SpacingToken {
  value: number;
  kind: string;
  count: number;
  regionKey?: string;
}

export interface DesignSpec {
  source: DesignSource;
  canvas: {
    name: string;
    width: number;
    height: number;
  };
  regions: DesignRegion[];
  texts: DesignText[];
  colors: ColorToken[];
  typography: TypographyToken[];
  spacing: SpacingToken[];
  radii: Array<{ value: number; count: number }>;
  regionColors: Record<string, ColorToken[]>;
  regionSpacing: Record<string, SpacingToken[]>;
}

export interface LiveText extends TextStyle {
  text: string;
  normalized: string;
  bbox: Rect;
  tag: string;
  className: string;
  frameUrl: string;
  count: number;
  regionKey?: string;
}

export interface LiveRegion {
  key: string;
  selector: string;
  bbox: Rect;
  rawBbox: Rect;
  frameUrl: string;
  tag: string;
  className: string;
  text?: string;
}

export interface LiveColor {
  hex: string;
  rgb: [number, number, number];
  weight: number;
  count: number;
  role: 'color' | 'background';
  regionKey?: string;
}

export interface LiveFrameSpec {
  url: string;
  viewport: Rect;
  scroll: Rect;
  texts: LiveText[];
  regions: LiveRegion[];
  palette: LiveColor[];
  spacing: SpacingToken[];
}

export interface LiveSpec {
  rootViewport: Rect;
  frames: LiveFrameSpec[];
  texts: LiveText[];
  regions: LiveRegion[];
  palette: LiveColor[];
  spacing: SpacingToken[];
  regionColors: Record<string, LiveColor[]>;
  regionSpacing: Record<string, SpacingToken[]>;
  warnings: string[];
}

export type CheckStatus = 'pass' | 'warn' | 'fail' | 'info' | 'skip';
export type CheckSeverity = 'blocker' | 'warning' | 'info';

export interface SpecCheck {
  key: string;
  category: 'viewport' | 'layout' | 'text' | 'typography' | 'color' | 'spacing';
  label: string;
  status: CheckStatus;
  severity: CheckSeverity;
  region?: string;
  expected?: string;
  actual?: string;
  detail?: string;
}

export interface SpecCheckSummary {
  total: number;
  pass: number;
  warn: number;
  fail: number;
  info: number;
  skip: number;
  blockers: number;
}

export interface RegionSpec {
  key: string;
  selectors: string[];
  designNamePatterns: string[];
  union?: boolean;
}

export interface FigmaSpecConfig {
  regions: RegionSpec[];
  textIgnore: string[];
  textIgnorePatterns: string[];
  requiredTextKinds: DesignText['kind'][];
  paletteLimit: number;
  typographyLimit: number;
  textCheckLimit: number;
  tolerance: {
    fontSizePx: number;
    lineHeightPx: number;
    colorDelta: number;
    fontWeightDelta: number;
    spacingPx: number;
    layoutPx: number;
    layoutRatio: number;
  };
}

export const DEFAULT_REGION_SELECTORS: Record<string, string[]> = {
  header: ['[role="banner"]', 'header', '.ant-layout-header', '.ant-tabs-bar', '[class*="header"]'],
  sidebar: ['aside', '.ant-layout-sider', '[role="navigation"]', 'nav'],
  content: ['main', '.ant-layout-content', '[role="main"]', '[class*="content"]'],
  filter: ['[class*="filter"]', '.approve-business-filter', '[class*="search"]', '.ant-input-affix-wrapper'],
  table: ['.ant-table', 'table', '[role="table"]', '[class*="table"]'],
  footer: ['.ant-pagination', '[class*="pagination"]', '[class*="footer"]'],
};

export const DEFAULT_SPEC_CONFIG: FigmaSpecConfig = {
  regions: [
    { key: 'header', selectors: DEFAULT_REGION_SELECTORS.header, designNamePatterns: ['顶部导航'] },
    { key: 'sidebar', selectors: DEFAULT_REGION_SELECTORS.sidebar, designNamePatterns: ['导航', '菜单'] },
    { key: 'content', selectors: DEFAULT_REGION_SELECTORS.content, designNamePatterns: ['筛选', '列表', '内容'] },
    { key: 'filter', selectors: DEFAULT_REGION_SELECTORS.filter, designNamePatterns: ['筛选项', '筛选', '搜索'] },
    { key: 'table', selectors: DEFAULT_REGION_SELECTORS.table, designNamePatterns: ['审批列表', '表格', '列表'] },
    { key: 'footer', selectors: DEFAULT_REGION_SELECTORS.footer, designNamePatterns: ['底部操作', '翻页器'] },
  ],
  textIgnore: [],
  textIgnorePatterns: [
    '^\\d{4}-\\d{2}-\\d{2}$',
    '^EA\\d+$',
    '^[\\d,]+(\\.\\d+)?\\s*(CNY|USD|HKD|JPY|EUR|RMB)$',
    '^已选\\s+\\d+\\s+条',
    '^共\\s+\\d+\\s+条$',
    '^\\d+\\s+条/页$',
  ],
  requiredTextKinds: ['nav', 'sidebar', 'tab', 'filter', 'table-header', 'footer'],
  paletteLimit: 12,
  typographyLimit: 10,
  textCheckLimit: 60,
  tolerance: {
    fontSizePx: 1,
    lineHeightPx: 2,
    colorDelta: 20,
    fontWeightDelta: 100,
    spacingPx: 0,
    layoutPx: 12,
    layoutRatio: 0.03,
  },
};

export function emptyCheckSummary(): SpecCheckSummary {
  return { total: 0, pass: 0, warn: 0, fail: 0, info: 0, skip: 0, blockers: 0 };
}
