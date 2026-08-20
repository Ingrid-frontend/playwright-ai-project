/**
 * ego 引擎侧的 UI 衰退诊断采集。
 *
 * Playwright 引擎通过 screenshot-capture.ts 往 meta 里写 selectors / layout /
 * styleFingerprint，structure-check 与 style-drift-check 全靠这些字段判衰退。
 * ego 走 CDP，拿不到 Playwright 的 page 对象，所以这里用一段可注入的表达式
 * 采集同样语义的数据，保证两条引擎产出的 meta 能被同一套比对逻辑消费。
 */
import {
  resolveStructureCheckItems,
  resolveStyleCheckItems,
  resolveChangeDetectionSections,
  enrichStructureItemsWithFingerprints,
  filterCheckItemsBySnapshot,
  loadUiRegressionConfig,
  type StructureCheckItem,
  type StyleCheckItem,
} from '../../scripts/report/ui-regression-config.js';
import {
  BROWSER_COLLECT_SECTIONS,
  BROWSER_COLLECT_SELECTORS,
  LEGACY_DOM_FINGERPRINT,
  finalizeSection,
  finalizeSelectorProbe,
  type SectionFingerprint,
  type SectionRaw,
  type SelectorProbeRaw,
} from '../utils/dom-fingerprint.js';

export type SelectorProbe = {
  exists: boolean;
  bbox?: { x: number; y: number; width: number; height: number };
  domHash?: string;
  structureHash?: string;
  textHash?: string;
  resolvedBy?: string;
};

export type EgoUiDiagnostics = {
  layout?: { horizontalOverflow: boolean; scrollWidth: number; innerWidth: number };
  selectors?: Record<string, SelectorProbe>;
  sections?: SectionFingerprint[];
  styleFingerprint?: Record<string, Record<string, string>>;
  domHash?: string;
};

const DEFAULT_STYLE_PROPS = [
  'backgroundColor',
  'color',
  'fontSize',
  'fontWeight',
  'lineHeight',
  'letterSpacing',
  'borderRadius',
  'boxShadow',
  'padding',
  'gap',
];

export type DiagnosticsPlan = {
  structureItems: StructureCheckItem[];
  /** 分区哈希采集目标（structureChecks ∪ changeDetection.sections） */
  sectionItems: StructureCheckItem[];
  styleItems: StyleCheckItem[];
  domHashRoot?: string;
};

export function resolveDiagnosticsPlan(
  scriptKey: string | undefined,
  snapshot?: { snapshotName?: string; state?: string },
): DiagnosticsPlan {
  const cfg = loadUiRegressionConfig();
  const snapCtx = snapshot?.snapshotName
    ? { snapshotName: snapshot.snapshotName, state: snapshot.state || 'normal' }
    : undefined;
  const structureItems = cfg.structureChecks?.enabled
    ? enrichStructureItemsWithFingerprints(
        scriptKey,
        filterCheckItemsBySnapshot(resolveStructureCheckItems(scriptKey), snapCtx),
      )
    : [];
  const changeSections = resolveChangeDetectionSections().map((s) => ({
    key: s.key,
    selector: s.selector,
  }));
  const seen = new Set(structureItems.map((i) => i.key));
  const sectionItems = [
    ...structureItems,
    ...changeSections.filter((s) => !seen.has(s.key)),
  ];
  return {
    structureItems,
    sectionItems,
    styleItems: cfg.styleChecks?.enabled
      ? filterCheckItemsBySnapshot(resolveStyleCheckItems(scriptKey), snapCtx)
      : [],
    domHashRoot: cfg.structureChecks?.domHashRoot,
  };
}

export function planIsEmpty(plan: DiagnosticsPlan): boolean {
  return plan.structureItems.length === 0 && plan.sectionItems.length === 0 && plan.styleItems.length === 0;
}

export function buildDiagnosticsExpression(plan: DiagnosticsPlan): string {
  const structurePayload = plan.structureItems.map((i) => ({
    key: i.key,
    selector: i.selector,
    fingerprint: i.fingerprint,
  }));
  const sectionPayload = plan.sectionItems.map((i) => ({
    key: i.key,
    selector: i.selector,
  }));
  const stylePayload = plan.styleItems.map((i) => ({
    key: i.key,
    selector: i.selector,
    props: i.props?.length ? i.props : DEFAULT_STYLE_PROPS,
  }));

  return `(() => {
  ${BROWSER_COLLECT_SECTIONS}
  ${BROWSER_COLLECT_SELECTORS}
  const structure = ${JSON.stringify(structurePayload)};
  const sections = ${JSON.stringify(sectionPayload)};
  const styles = ${JSON.stringify(stylePayload)};
  const domHashRoot = ${JSON.stringify(plan.domHashRoot || '')};
  const legacyFp = ${LEGACY_DOM_FINGERPRINT};

  const out = {};
  try {
    out.layout = {
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    };
  } catch (e) {}

  if (domHashRoot) {
    try {
      const rootEl = document.querySelector(domHashRoot);
      if (rootEl) out.domHash = legacyFp(rootEl);
    } catch (e) {}
  }

  if (structure.length) {
    out.selectorsRaw = collectSelectorProbes(structure);
  }
  if (sections.length) {
    out.sectionsRaw = collectSections(sections);
  }

  if (styles.length) {
    const toHex = (css) => {
      const m = /rgba?\\(\\s*([\\d.]+)\\s*,\\s*([\\d.]+)\\s*,\\s*([\\d.]+)(?:\\s*,\\s*([\\d.]+))?\\s*\\)/i.exec(css || '');
      if (!m) return css;
      const alpha = m[4] === undefined ? 1 : parseFloat(m[4]);
      if (!isFinite(alpha) || alpha <= 0.02) return null;
      return '#' + [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)]
        .map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0'))
        .join('').toUpperCase();
    };
    const norm = (css, prop) => {
      if (!css) return '';
      if (prop === 'backgroundColor' || prop === 'color') { const hex = toHex(css); return hex || css; }
      return css;
    };
    const sf = {};
    for (const item of styles) {
      try {
        const el = document.querySelector(item.selector);
        if (!el) { sf[item.key] = { __missing: '1' }; continue; }
        const cs = getComputedStyle(el);
        const props = {};
        for (const p of item.props) props[p] = norm(cs[p], p);
        sf[item.key] = props;
      } catch (e) { sf[item.key] = { __missing: '1' }; }
    }
    out.styleFingerprint = sf;
  }

  return JSON.stringify(out);
})()`;
}

export function parseDiagnostics(raw: unknown): EgoUiDiagnostics | undefined {
  if (typeof raw !== 'string' || !raw.trim()) return undefined;
  try {
    const parsed = JSON.parse(raw) as {
      layout?: EgoUiDiagnostics['layout'];
      domHash?: string;
      sectionsRaw?: SectionRaw[];
      selectorsRaw?: Record<string, SelectorProbeRaw>;
      styleFingerprint?: Record<string, Record<string, string>>;
    };
    if (!parsed || typeof parsed !== 'object') return undefined;

    const out: EgoUiDiagnostics = {};
    if (parsed.layout) out.layout = parsed.layout;
    if (parsed.domHash) out.domHash = parsed.domHash;
    if (parsed.sectionsRaw?.length) {
      out.sections = parsed.sectionsRaw.map(finalizeSection);
      const first = out.sections[0];
      if (first?.structureHash) out.domHash = `SEC|${first.structureHash}`;
    }
    if (parsed.selectorsRaw) {
      out.selectors = {};
      for (const [key, probe] of Object.entries(parsed.selectorsRaw)) {
        out.selectors[key] = finalizeSelectorProbe(probe);
      }
    }
    if (parsed.styleFingerprint) out.styleFingerprint = parsed.styleFingerprint;
    return out;
  } catch {
    return undefined;
  }
}
