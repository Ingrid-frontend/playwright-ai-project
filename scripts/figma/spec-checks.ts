/**
 * 设计稿规范 vs 线上语义采集的校验逻辑。
 * 校验维度：视口比例、布局骨架、关键文案、字体令牌、色彩令牌。
 */
import fs from 'fs';
import path from 'path';
import {
  DEFAULT_SPEC_CONFIG,
  emptyCheckSummary,
  type CheckStatus,
  type DesignSpec,
  type DesignText,
  type FigmaSpecConfig,
  type LiveSpec,
  type LiveText,
  type SpecCheck,
  type SpecCheckSummary,
  type TextStyle,
} from './figma-spec-types.js';

const SPEC_CONFIG_PATH = path.join(process.cwd(), 'config', 'figma-spec.json');

let cachedConfig: FigmaSpecConfig | null = null;

export function loadSpecConfig(configPath = SPEC_CONFIG_PATH): FigmaSpecConfig {
  if (cachedConfig) return cachedConfig;
  let merged: FigmaSpecConfig = { ...DEFAULT_SPEC_CONFIG, regions: [...DEFAULT_SPEC_CONFIG.regions] };
  if (fs.existsSync(configPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as Partial<FigmaSpecConfig>;
      merged = {
        ...merged,
        ...raw,
        regions: raw.regions?.length ? raw.regions : merged.regions,
        textIgnore: raw.textIgnore ?? merged.textIgnore,
        textIgnorePatterns: raw.textIgnorePatterns ?? merged.textIgnorePatterns,
        requiredTextKinds: raw.requiredTextKinds ?? merged.requiredTextKinds,
        tolerance: { ...merged.tolerance, ...raw.tolerance },
      };
    } catch (e) {
      console.warn(`⚠️  无法解析 ${configPath}，使用默认配置`, e);
    }
  }
  cachedConfig = merged;
  return merged;
}

function colorDelta(a?: [number, number, number], b?: [number, number, number]): number {
  if (!a || !b) return 999;
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function familyMatches(design: string | undefined, live: string | undefined): boolean {
  if (!design || !live) return true;
  const normalized = design.toLowerCase();
  return live.toLowerCase().includes(normalized);
}

function styleIssues(design: TextStyle, live: TextStyle, cfg: FigmaSpecConfig): string[] {
  const issues: string[] = [];
  const tol = cfg.tolerance;
  if (
    design.fontSize !== undefined &&
    live.fontSize !== undefined &&
    Math.abs(design.fontSize - live.fontSize) > tol.fontSizePx
  ) {
    issues.push(`字号 ${design.fontSize}px vs 线上 ${live.fontSize}px`);
  }
  if (
    design.fontWeight !== undefined &&
    live.fontWeight !== undefined &&
    Math.abs(design.fontWeight - live.fontWeight) > tol.fontWeightDelta
  ) {
    issues.push(`字重 ${design.fontWeight} vs 线上 ${live.fontWeight}`);
  }
  if (colorDelta(design.colorRgb, live.colorRgb) > tol.colorDelta) {
    issues.push(`颜色 ${design.color || '未知'} vs 线上 ${live.color || '未知'}`);
  }
  if (!familyMatches(design.fontFamily, live.fontFamily)) {
    issues.push(`字体 ${design.fontFamily} 未在线上匹配`);
  }
  return issues;
}

function matchKey(s: string): string {
  return s.replace(/\s*\([\d+，,\s]+\)$/, '').replace(/\s+/g, ' ').trim();
}

function shouldIgnoreText(t: DesignText, cfg: FigmaSpecConfig): boolean {
  if (t.dynamic || t.kind === 'sample') return true;
  if (t.normalized.length < 2) return true;
  if (cfg.textIgnore.includes(t.normalized)) return true;
  return cfg.textIgnorePatterns.some((p) => new RegExp(p).test(t.normalized));
}

function textCheckStatus(issues: string[], matched: boolean): { status: CheckStatus; detail?: string } {
  if (!matched) return { status: 'warn', detail: '设计稿文案未在线上页面找到' };
  if (issues.length) return { status: 'warn', detail: issues.join('；') };
  return { status: 'pass' };
}

function runTextChecks(design: DesignSpec, live: LiveSpec, cfg: FigmaSpecConfig): SpecCheck[] {
  const kindOrder: DesignText['kind'][] = ['nav', 'sidebar', 'tab', 'table-header', 'filter', 'footer', 'input', 'label'];
  const checks: SpecCheck[] = [];
  const regionOrder = ['header', 'sidebar', 'content', 'filter', 'table', 'footer'];
  const regions = [...design.regions].sort(
    (a, b) => (regionOrder.indexOf(a.key) === -1 ? 99 : regionOrder.indexOf(a.key)) - (regionOrder.indexOf(b.key) === -1 ? 99 : regionOrder.indexOf(b.key)),
  );
  const perRegionLimit = Math.max(5, Math.floor(cfg.textCheckLimit / Math.max(1, regions.length)));
  const buildLiveMap = (texts: LiveText[]): Map<string, LiveText[]> => {
    const map = new Map<string, LiveText[]>();
    for (const t of texts) {
      const key = matchKey(t.normalized);
      const list = map.get(key) || [];
      list.push(t);
      map.set(key, list);
    }
    return map;
  };
  const sortByKind = (texts: DesignText[]): DesignText[] =>
    texts.sort((a, b) => {
      const ka = kindOrder.indexOf(a.kind);
      const kb = kindOrder.indexOf(b.kind);
      return (ka === -1 ? 99 : ka) - (kb === -1 ? 99 : kb) || b.count - a.count;
    });

  for (const region of regions) {
    const designTexts = sortByKind(design.texts.filter((t) => t.regionKey === region.key && !shouldIgnoreText(t, cfg)));
    if (!designTexts.length) continue;
    const liveRegion = live.regions.find((r) => r.key === region.key);
    const liveTexts = liveRegion ? live.texts.filter((t) => t.regionKey === region.key) : [];
    const liveByKey = buildLiveMap(liveTexts);

    for (const t of designTexts.slice(0, perRegionLimit)) {
      if (!liveRegion) {
        checks.push({
          key: `text:${region.key}:${t.normalized}`,
          category: 'text',
          label: `${region.name} / 文案「${t.text}」`,
          status: 'skip',
          severity: 'info',
          region: region.key,
          expected: t.text,
          actual: '区块未匹配',
          detail: '线上未找到对应区块，已跳过区块内文案校验',
        });
        continue;
      }
      const candidates = liveByKey.get(matchKey(t.normalized)) || [];
      const matched = candidates.length > 0;
      const issues = matched ? styleIssues(t.style, candidates[0]!, cfg) : [];
      const { status, detail } = textCheckStatus(issues, matched);
      checks.push({
        key: `text:${region.key}:${t.normalized}`,
        category: 'text',
        label: `${region.name} / 文案「${t.text}」`,
        status,
        severity: status === 'pass' ? 'info' : 'warning',
        region: region.key,
        expected: t.text,
        actual: matched ? candidates[0]!.text : '未找到',
        detail,
      });
    }
  }

  const globalDesign = sortByKind(design.texts.filter((t) => !t.regionKey && !shouldIgnoreText(t, cfg)));
  if (globalDesign.length) {
    const liveByKey = buildLiveMap(live.texts);
    for (const t of globalDesign.slice(0, 8)) {
      const candidates = liveByKey.get(matchKey(t.normalized)) || [];
      const matched = candidates.length > 0;
      const issues = matched ? styleIssues(t.style, candidates[0]!, cfg) : [];
      const { status, detail } = textCheckStatus(issues, matched);
      checks.push({
        key: `text:global:${t.normalized}`,
        category: 'text',
        label: `全局 / 文案「${t.text}」`,
        status,
        severity: status === 'pass' ? 'info' : 'warning',
        region: 'global',
        expected: t.text,
        actual: matched ? candidates[0]!.text : '未找到',
        detail,
      });
    }
  }
  return checks;
}

function runRegionColorChecks(design: DesignSpec, live: LiveSpec, cfg: FigmaSpecConfig): SpecCheck[] {
  const checks: SpecCheck[] = [];
  for (const region of design.regions) {
    const designColors = design.regionColors[region.key] || [];
    if (!designColors.length) continue;
    const liveColors = live.regionColors[region.key] || [];
    const liveRegionExists = live.regions.some((r) => r.key === region.key);

    for (const color of designColors.slice(0, 6)) {
      if (!liveRegionExists || !liveColors.length) {
        checks.push({
          key: `color:${region.key}:${color.hex}`,
          category: 'color',
          label: `${region.name} / 色彩 ${color.hex}`,
          status: 'skip',
          severity: 'info',
          region: region.key,
          expected: color.hex,
          actual: '区块未匹配',
          detail: '线上对应区块未采到颜色，已跳过该项',
        });
        continue;
      }
      let best: { delta: number; hex: string } | null = null;
      for (const c of liveColors) {
        const delta = colorDelta(color.rgb, c.rgb);
        if (!best || delta < best.delta) best = { delta, hex: c.hex };
      }
      const pass = !!best && best.delta <= cfg.tolerance.colorDelta;
      checks.push({
        key: `color:${region.key}:${color.hex}`,
        category: 'color',
        label: `${region.name} / 色彩 ${color.hex}`,
        status: pass ? 'pass' : 'warn',
        severity: pass ? 'info' : 'warning',
        region: region.key,
        expected: color.hex,
        actual: best ? best.hex : '未采集到颜色',
        detail: pass ? undefined : `色差 ${best ? Math.round(best.delta) : '-'}（阈值 ${cfg.tolerance.colorDelta}）`,
      });
    }
  }
  return checks;
}

function runRegionSpacingChecks(design: DesignSpec, live: LiveSpec, cfg: FigmaSpecConfig): SpecCheck[] {
  const checks: SpecCheck[] = [];
  for (const region of design.regions) {
    const designTokens = design.regionSpacing[region.key] || [];
    if (!designTokens.length) continue;
    const liveTokens = live.regionSpacing[region.key] || [];
    const liveRegionExists = live.regions.some((r) => r.key === region.key);
    const seen = new Set<number>();
    const tokens = designTokens.filter((s) => {
      if (seen.has(s.value)) return false;
      seen.add(s.value);
      return true;
    }).slice(0, 8);

    for (const token of tokens) {
      if (!liveRegionExists || !liveTokens.length) {
        checks.push({
          key: `spacing:${region.key}:${token.value}`,
          category: 'spacing',
          label: `${region.name} / 间距 ${token.value}px`,
          status: 'skip',
          severity: 'info',
          region: region.key,
          expected: `${token.kind}=${token.value}px`,
          actual: '区块未匹配',
          detail: '线上对应区块未采到间距，已跳过该项',
        });
        continue;
      }
      const match = liveTokens.find((s) => Math.abs(s.value - token.value) <= cfg.tolerance.spacingPx);
      checks.push({
        key: `spacing:${region.key}:${token.value}`,
        category: 'spacing',
        label: `${region.name} / 间距 ${token.value}px`,
        status: match ? 'pass' : 'warn',
        severity: match ? 'info' : 'warning',
        region: region.key,
        expected: `${token.kind}=${token.value}px`,
        actual: match ? `${match.kind}=${match.value}px` : '线上对应区块未采到该间距',
        detail: match ? `线上出现 ${match.count} 次` : '建议检查该区块容器 gap/padding',
      });
    }
  }
  return checks;
}

function regionSkeletonCheck(
  key: string,
  designRegion: DesignSpec['regions'][number],
  liveRegion: LiveSpec['regions'][number] | undefined,
  live: LiveSpec,
  cfg: FigmaSpecConfig,
): SpecCheck {
  const labelMap: Record<string, string> = {
    header: '顶部导航',
    sidebar: '左侧导航',
    content: '主内容区',
    filter: '筛选/操作区',
    table: '数据列表',
    footer: '底部操作',
  };
  const label = labelMap[key] || key;
  if (!liveRegion) {
    const b = designRegion.bbox;
    return {
      key: `layout:${key}`,
      category: 'layout',
      label: `区块 ${label}`,
      status: 'warn',
      severity: 'warning',
      region: key,
      expected: `${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.width)}x${Math.round(b.height)}`,
      actual: '未找到对应 DOM 区块',
      detail: '线上未匹配到该区域的常见选择器',
    };
  }

  const root = live.rootViewport;
  const pass = (() => {
    switch (key) {
      case 'header':
        return liveRegion.bbox.y <= Math.max(cfg.tolerance.layoutPx, root.height * 0.08) && liveRegion.bbox.height < 220;
      case 'sidebar':
        return (
          Math.abs(liveRegion.bbox.x) <= cfg.tolerance.layoutPx &&
          liveRegion.bbox.width >= 120 &&
          liveRegion.bbox.width <= 260
        );
      case 'content': {
        const sidebar = live.regions.find((r) => r.key === 'sidebar');
        const minX = sidebar ? sidebar.bbox.x + sidebar.bbox.width - cfg.tolerance.layoutPx : root.width * 0.1;
        return liveRegion.bbox.x >= minX && liveRegion.bbox.width >= root.width * 0.5;
      }
      case 'filter':
        return true;
      case 'table': {
        const content = live.regions.find((r) => r.key === 'content');
        const contentWidth = content ? content.bbox.width : root.width;
        return liveRegion.bbox.width >= contentWidth * 0.6;
      }
      case 'footer':
        return liveRegion.bbox.y >= root.height * 0.6;
      default:
        return true;
    }
  })();

  return {
    key: `layout:${key}`,
    category: 'layout',
    label: `区块 ${label}`,
    status: pass ? 'pass' : 'warn',
    severity: pass ? 'info' : 'warning',
    region: key,
    expected: `${Math.round(designRegion.bbox.x)},${Math.round(designRegion.bbox.y)} ${Math.round(designRegion.bbox.width)}x${Math.round(designRegion.bbox.height)}`,
    actual: `${Math.round(liveRegion.bbox.x)},${Math.round(liveRegion.bbox.y)} ${Math.round(liveRegion.bbox.width)}x${Math.round(liveRegion.bbox.height)}`,
    detail: pass ? undefined : '区块位置/尺寸与设计稿骨架不一致（线上为宽视口时按比例判断）',
  };
}

function runLayoutChecks(design: DesignSpec, live: LiveSpec, cfg: FigmaSpecConfig): SpecCheck[] {
  const checks: SpecCheck[] = [];
  for (const region of design.regions) {
    const liveRegion = live.regions.find((r) => r.key === region.key);
    checks.push(regionSkeletonCheck(region.key, region, liveRegion, live, cfg));
  }
  return checks;
}

function runViewportCheck(design: DesignSpec, live: LiveSpec): SpecCheck {
  const designW = design.canvas.width;
  const designH = design.canvas.height;
  const liveW = live.rootViewport.width;
  const liveH = live.rootViewport.height;
  const ratio = designW > 0 ? liveW / designW : 0;
  return {
    key: 'viewport',
    category: 'viewport',
    label: '画布/视口',
    status: 'info',
    severity: 'info',
    expected: `${designW}x${designH}`,
    actual: `${liveW}x${liveH}`,
    detail:
      ratio >= 1.5
        ? `线上以约 ${ratio.toFixed(2)}x 的宽视口打开，尺寸校验按比例执行，不强制像素一致`
        : '视口尺寸与设计稿接近',
  };
}

export function summarizeChecks(checks: SpecCheck[]): SpecCheckSummary {
  const summary = emptyCheckSummary();
  summary.total = checks.length;
  for (const c of checks) {
    summary[c.status] += 1;
    if (c.status === 'fail') summary.blockers += 1;
  }
  return summary;
}

export function runSpecChecks(design: DesignSpec, live: LiveSpec, config: FigmaSpecConfig): SpecCheck[] {
  return [
    runViewportCheck(design, live),
    ...runLayoutChecks(design, live, config),
    ...runTextChecks(design, live, config),
    ...runRegionColorChecks(design, live, config),
    ...runRegionSpacingChecks(design, live, config),
  ];
}
