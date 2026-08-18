import type { Frame, Page } from '@playwright/test';
import type { StyleCheckItem } from '../../scripts/report/ui-regression-config.js';

export type StyleProps = Record<string, string>;
export type StyleFingerprint = Record<string, StyleProps>;

const DEFAULT_PROPS = [
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

const COLLECT_STYLE_BODY = String.raw`({ items }) => {
  const toHex = (css) => {
    const m = /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)/i.exec(css || '');
    if (!m) return css;
    const alpha = m[4] === undefined ? 1 : Number.parseFloat(m[4]);
    if (!Number.isFinite(alpha) || alpha <= 0.02) return null;
    return '#' + [Number.parseInt(m[1], 10), Number.parseInt(m[2], 10), Number.parseInt(m[3], 10)]
      .map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase();
  };
  const norm = (css, prop) => {
    if (!css) return '';
    if (prop === 'backgroundColor' || prop === 'color') {
      const hex = toHex(css);
      return hex || css;
    }
    return css;
  };
  const out = {};
  for (const item of items) {
    const el = document.querySelector(item.selector);
    if (!el) {
      out[item.key] = { __missing: '1' };
      continue;
    }
    const cs = getComputedStyle(el);
    const props = {};
    for (const p of item.props) {
      props[p] = norm(cs[p], p);
    }
    out[item.key] = props;
  }
  return out;
}`;

function resolveProps(item: StyleCheckItem): string[] {
  return item.props?.length ? item.props : DEFAULT_PROPS;
}

async function collectInContext(
  ctx: Page | Frame,
  items: StyleCheckItem[],
): Promise<StyleFingerprint> {
  if (!items.length) return {};
  const payload = items.map((i) => ({ key: i.key, selector: i.selector, props: resolveProps(i) }));
  return ctx.evaluate(
    ({ body, list }) => {
      const fn = new Function('items', `return (${body})({ items })`);
      return fn(list) as StyleFingerprint;
    },
    { body: COLLECT_STYLE_BODY, list: payload },
  );
}

export async function collectStyleFingerprint(
  page: Page,
  items: StyleCheckItem[],
): Promise<StyleFingerprint> {
  if (!items.length) return {};
  const mainItems = items.filter((i) => (i.frame || 'main') === 'main');
  const frameItems = items.filter((i) => i.frame === 'first');
  const out: StyleFingerprint = {};

  if (mainItems.length) {
    Object.assign(out, await collectInContext(page, mainItems));
  }
  if (frameItems.length) {
    const child = page.frames().find((f) => f !== page.mainFrame());
    if (child) {
      Object.assign(out, await collectInContext(child, frameItems));
    } else {
      for (const item of frameItems) {
        out[item.key] = { __missing: '1' };
      }
    }
  }
  return out;
}

export function compareStyleProps(
  base: StyleProps,
  cur: StyleProps,
  tolerance: { fontSizePx?: number },
): Array<{ prop: string; from: string; to: string }> {
  const diffs: Array<{ prop: string; from: string; to: string }> = [];
  const keys = new Set([...Object.keys(base), ...Object.keys(cur)]);
  for (const prop of keys) {
    if (prop === '__missing') continue;
    const a = base[prop] ?? '';
    const b = cur[prop] ?? '';
    if (a === b) continue;
    if (prop === 'fontSize' && tolerance.fontSizePx) {
      const pa = Number.parseFloat(a);
      const pb = Number.parseFloat(b);
      if (Number.isFinite(pa) && Number.isFinite(pb) && Math.abs(pa - pb) <= tolerance.fontSizePx) {
        continue;
      }
    }
    diffs.push({ prop, from: a, to: b });
  }
  return diffs;
}
