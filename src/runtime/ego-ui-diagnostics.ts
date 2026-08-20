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
  filterCheckItemsBySnapshot,
  loadUiRegressionConfig,
  type StructureCheckItem,
  type StyleCheckItem,
} from '../../scripts/report/ui-regression-config.js';

export type SelectorProbe = {
  exists: boolean;
  bbox?: { x: number; y: number; width: number; height: number };
  domHash?: string;
};

export type EgoUiDiagnostics = {
  layout?: { horizontalOverflow: boolean; scrollWidth: number; innerWidth: number };
  selectors?: Record<string, SelectorProbe>;
  styleFingerprint?: Record<string, Record<string, string>>;
  domHash?: string;
};

/** 与 screenshot-capture.ts 的 domFingerprintFn 保持一致，否则两引擎的 domHash 不可比 */
const DOM_FINGERPRINT = `(function(el){
  var tag=el.tagName;
  var children=el.children?el.children.length:0;
  var cls=(el.className&&el.className.toString)?String(el.className).slice(0,120):'';
  return tag+'|'+children+'|'+cls;
})`;

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
  styleItems: StyleCheckItem[];
  domHashRoot?: string;
};

/**
 * 解析当前步骤要采集哪些检查项。snapshot 作用域与 Playwright 侧同规则：
 * 带 snapshotName 的配置项只在匹配的快照上生效。
 */
export function resolveDiagnosticsPlan(
  scriptKey: string | undefined,
  snapshot?: { snapshotName?: string; state?: string },
): DiagnosticsPlan {
  const cfg = loadUiRegressionConfig();
  const snapCtx = snapshot?.snapshotName
    ? { snapshotName: snapshot.snapshotName, state: snapshot.state || 'normal' }
    : undefined;
  return {
    structureItems: cfg.structureChecks?.enabled
      ? filterCheckItemsBySnapshot(resolveStructureCheckItems(scriptKey), snapCtx)
      : [],
    styleItems: cfg.styleChecks?.enabled
      ? filterCheckItemsBySnapshot(resolveStyleCheckItems(scriptKey), snapCtx)
      : [],
    domHashRoot: cfg.structureChecks?.domHashRoot,
  };
}

export function planIsEmpty(plan: DiagnosticsPlan): boolean {
  return plan.structureItems.length === 0 && plan.styleItems.length === 0;
}

/**
 * 生成在页面里执行的采集表达式。
 *
 * frame: 'first' 的配置项在 ego 下按「同文档内查找」降级处理：ego 的 CDP 求值默认
 * 落在主文档，跨 frame 采集需要额外的 isolated world 编排，这里先让主文档命中的
 * 选择器可用，未命中则如实记为 exists:false，由 required 决定严重级别。
 */
export function buildDiagnosticsExpression(plan: DiagnosticsPlan): string {
  const structurePayload = plan.structureItems.map((i) => ({ key: i.key, selector: i.selector }));
  const stylePayload = plan.styleItems.map((i) => ({
    key: i.key,
    selector: i.selector,
    props: i.props?.length ? i.props : DEFAULT_STYLE_PROPS,
  }));

  return `(() => {
  const fp = ${DOM_FINGERPRINT};
  const structure = ${JSON.stringify(structurePayload)};
  const styles = ${JSON.stringify(stylePayload)};
  const domHashRoot = ${JSON.stringify(plan.domHashRoot || '')};

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
      if (rootEl) out.domHash = fp(rootEl);
    } catch (e) {}
  }

  if (structure.length) {
    const sel = {};
    for (const item of structure) {
      try {
        const el = document.querySelector(item.selector);
        if (!el) { sel[item.key] = { exists: false }; continue; }
        const r = el.getBoundingClientRect();
        sel[item.key] = {
          exists: true,
          bbox: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) },
          domHash: fp(el),
        };
      } catch (e) { sel[item.key] = { exists: false }; }
    }
    out.selectors = sel;
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
    const parsed = JSON.parse(raw) as EgoUiDiagnostics;
    return parsed && typeof parsed === 'object' ? parsed : undefined;
  } catch {
    return undefined;
  }
}
