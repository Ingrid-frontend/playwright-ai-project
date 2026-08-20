import { createHash } from 'crypto';

export interface SectionFingerprint {
  key: string;
  structureHash: string;
  textHash: string;
  nodeCount: number;
  childTags: string;
}

export interface TextSection {
  key: string;
  text: string;
  textHash: string;
  charCount: number;
}

export interface ElementFingerprint {
  tag: string;
  stableAttributes: Record<string, string>;
  textHint: string;
  xpath: string;
  fallbackSelectors: string[];
  baselineRect: { x: number; y: number; width: number; height: number };
  baselinePageWidth: number;
  baselinePageHeight: number;
}

export interface SectionRaw {
  key: string;
  structureRaw: string;
  textRaw: string;
  nodeCount: number;
  childTags: string;
}

export interface SelectorProbeRaw {
  exists: boolean;
  bbox?: { x: number; y: number; width: number; height: number };
  structureRaw?: string;
  textRaw?: string;
  resolvedBy?: string;
  fingerprint?: ElementFingerprint;
}

const STABLE_ATTRS = ['data-testid', 'role', 'aria-label', 'name', 'type', 'id'];

export function sha16(input: string): string {
  return createHash('sha256').update(input || '').digest('hex').slice(0, 16);
}

export function normalizeText(raw: string): string {
  let s = String(raw || '').replace(/\s+/g, ' ').trim();
  s = s.replace(/\b99\+\b/g, '<COUNT>');
  s = s.replace(/\(\d+\)/g, '<COUNT>');
  s = s.replace(/\d+/g, '<NUM>');
  s = s.replace(/\b[A-Za-z0-9_-]{8,}\b/g, '<ID>');
  s = s.replace(/\d{4}-\d{2}-\d{2}/g, '<TIME>');
  s = s.replace(/\d{1,2}:\d{2}(:\d{2})?/g, '<TIME>');
  s = s.replace(/\d+\s*分钟前/g, '<TIME>');
  s = s.replace(/[￥$]\s?[\d,]+(?:\.\d+)?/g, '<MONEY>');
  return s;
}

export function finalizeSection(raw: SectionRaw): SectionFingerprint {
  const norm = normalizeText(raw.textRaw);
  return {
    key: raw.key,
    structureHash: sha16(raw.structureRaw),
    textHash: sha16(norm),
    nodeCount: raw.nodeCount,
    childTags: raw.childTags,
  };
}

export function finalizeTextSection(key: string, text: string): TextSection {
  const norm = normalizeText(text);
  return { key, text: norm, textHash: sha16(norm), charCount: norm.length };
}

export function finalizeSelectorProbe(raw: SelectorProbeRaw): {
  exists: boolean;
  bbox?: { x: number; y: number; width: number; height: number };
  domHash?: string;
  structureHash?: string;
  textHash?: string;
  resolvedBy?: string;
  fingerprint?: ElementFingerprint;
} {
  if (!raw.exists) return { exists: false };
  const structureHash = raw.structureRaw ? sha16(raw.structureRaw) : undefined;
  const textHash = raw.textRaw ? sha16(normalizeText(raw.textRaw)) : undefined;
  return {
    exists: true,
    bbox: raw.bbox,
    domHash: structureHash,
    structureHash,
    textHash,
    resolvedBy: raw.resolvedBy,
    fingerprint: raw.fingerprint,
  };
}

/** 浏览器内采集：分区结构/文本原始串（Node 侧再 sha256） */
export const BROWSER_COLLECT_SECTIONS = `function collectSections(items) {
  const STABLE = ${JSON.stringify(STABLE_ATTRS)};
  function isMasked(el) {
  return el.hasAttribute('data-ui-regression-mask') || el.hasAttribute('data-pw-mask');
  }
  function walk(el, depth, parts, textParts, counter) {
    if (!el || depth > 12) return;
    if (isMasked(el)) return;
    counter.n++;
    const stable = STABLE.map(function(a) {
      var v = el.getAttribute(a);
      return v ? a + '=' + v : '';
    }).filter(Boolean).join(',');
    parts.push(el.tagName + (stable ? '[' + stable + ']' : ''));
    var t = (el.innerText || el.textContent || '').trim();
    if (t) textParts.push(t.slice(0, 200));
    for (var i = 0; i < el.children.length; i++) walk(el.children[i], depth + 1, parts, textParts, counter);
  }
  function fingerprintSection(root) {
    var parts = [], textParts = [], counter = { n: 0 };
    walk(root, 0, parts, textParts, counter);
    var childTags = '';
    try {
      childTags = Array.from(root.children).map(function(c) { return c.tagName; }).join(',');
    } catch (e) {}
    return {
      structureRaw: parts.join('>'),
      textRaw: textParts.join(' '),
      nodeCount: counter.n,
      childTags: childTags
    };
  }
  var out = [];
  for (var i = 0; i < items.length; i++) {
    var item = items[i];
  try {
      var el = document.querySelector(item.selector);
      if (!el) continue;
      var fp = fingerprintSection(el);
      out.push({ key: item.key, structureRaw: fp.structureRaw, textRaw: fp.textRaw, nodeCount: fp.nodeCount, childTags: fp.childTags });
    } catch (e) {}
  }
  return out;
}`;

/** 浏览器内采集：selector probe + 多路定位 */
export const BROWSER_COLLECT_SELECTORS = `function collectSelectorProbes(items) {
  const STABLE = ${JSON.stringify(STABLE_ATTRS)};
  function isMasked(el) {
    return el.hasAttribute('data-ui-regression-mask') || el.hasAttribute('data-pw-mask');
  }
  function walk(el, depth, parts, textParts, counter) {
    if (!el || depth > 12) return;
    if (isMasked(el)) return;
    counter.n++;
    var stable = STABLE.map(function(a) {
      var v = el.getAttribute(a);
      return v ? a + '=' + v : '';
    }).filter(Boolean).join(',');
    parts.push(el.tagName + (stable ? '[' + stable + ']' : ''));
    var t = (el.innerText || el.textContent || '').trim();
    if (t) textParts.push(t.slice(0, 200));
    for (var i = 0; i < el.children.length; i++) walk(el.children[i], depth + 1, parts, textParts, counter);
  }
  function fingerprintEl(el) {
    var parts = [], textParts = [], counter = { n: 0 };
    walk(el, 0, parts, textParts, counter);
    return { structureRaw: parts.join('>'), textRaw: textParts.join(' ') };
  }
  function xpath(el) {
    if (!el || el.nodeType !== 1) return '';
    var segs = [];
    while (el && el.nodeType === 1) {
      var ix = 1, sib = el.previousSibling;
      while (sib) { if (sib.nodeType === 1 && sib.tagName === el.tagName) ix++; sib = sib.previousSibling; }
      segs.unshift(el.tagName.toLowerCase() + '[' + ix + ']');
      el = el.parentElement;
    }
    return '/' + segs.join('/');
  }
  function stableAttrs(el) {
    var o = {};
    STABLE.forEach(function(a) { var v = el.getAttribute(a); if (v) o[a] = v; });
    return o;
  }
  function tryStableSelector(attrs) {
    var parts = Object.keys(attrs).map(function(k) {
      var v = attrs[k];
      if (k === 'id') return '#' + v;
      return '[' + k + '="' + v.replace(/"/g, '\\\\"') + '"]';
    });
    return parts.join('');
  }
  function locate(item) {
    var el = null, resolvedBy = 'selector';
    try { el = document.querySelector(item.selector); } catch (e) {}
    if (!el && item.fingerprint) {
      var fp = item.fingerprint;
      if (fp.stableAttributes) {
        var sel = tryStableSelector(fp.stableAttributes);
        if (sel) { try { el = document.querySelector(sel); if (el) resolvedBy = 'stableAttributes'; } catch (e) {} }
      }
      if (!el && fp.xpath) {
        try {
          var r = document.evaluate(fp.xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
          el = r.singleNodeValue;
          if (el) resolvedBy = 'xpath';
        } catch (e) {}
      }
      if (!el && fp.fallbackSelectors) {
        for (var fi = 0; fi < fp.fallbackSelectors.length; fi++) {
          try { el = document.querySelector(fp.fallbackSelectors[fi]); if (el) { resolvedBy = 'fallback'; break; } } catch (e) {}
        }
      }
      if (!el && fp.textHint) {
        var hint = fp.textHint.slice(0, 40);
        var all = document.querySelectorAll(fp.tag || '*');
        for (var j = 0; j < all.length; j++) {
          var txt = (all[j].innerText || '').trim();
          if (txt.indexOf(hint) >= 0) { el = all[j]; resolvedBy = 'textHint'; break; }
        }
      }
    }
    return { el: el, resolvedBy: resolvedBy };
  }
  var out = {};
  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    try {
      var hit = locate(item);
      if (!hit.el) { out[item.key] = { exists: false }; continue; }
      var el = hit.el;
      var r = el.getBoundingClientRect();
      var fp = fingerprintEl(el);
      var attrs = stableAttrs(el);
      var idSel = attrs.id ? '#' + attrs.id : '';
      out[item.key] = {
        exists: true,
        bbox: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) },
        structureRaw: fp.structureRaw,
        textRaw: fp.textRaw,
        resolvedBy: hit.resolvedBy === item.selector ? 'selector' : hit.resolvedBy,
        fingerprint: {
          tag: el.tagName,
          stableAttributes: attrs,
          textHint: (el.innerText || '').trim().slice(0, 40),
          xpath: xpath(el),
          fallbackSelectors: idSel ? [idSel] : [],
          baselineRect: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) },
          baselinePageWidth: document.documentElement.clientWidth || window.innerWidth,
          baselinePageHeight: document.documentElement.scrollHeight || document.documentElement.clientHeight
        }
      };
    } catch (e) { out[item.key] = { exists: false }; }
  }
  return out;
}`;

/** legacy domHash 兼容：tag|children|class */
export const LEGACY_DOM_FINGERPRINT = `(function(el){
  var tag=el.tagName;
  var children=el.children?el.children.length:0;
  var cls=(el.className&&el.className.toString)?String(el.className).slice(0,120):'';
  return tag+'|'+children+'|'+cls;
})`;

export function buildLegacyDomHash(structureHash: string | undefined): string | undefined {
  if (!structureHash) return undefined;
  return `SEC|${structureHash}`;
}

export function isEmptyShellSections(sections: SectionFingerprint[] | undefined): boolean {
  if (!sections?.length) return true;
  return sections.every((s) => !s.structureHash || s.nodeCount <= 0);
}

export function scaleBbox(
  bbox: { x: number; y: number; width: number; height: number },
  baseW: number,
  baseH: number,
  curW: number,
  curH: number,
): { x: number; y: number; width: number; height: number } {
  if (!(baseW > 0 && baseH > 0 && curW > 0 && curH > 0)) return bbox;
  const sx = curW / baseW;
  const sy = curH / baseH;
  return {
    x: Math.round(bbox.x * sx),
    y: Math.round(bbox.y * sy),
    width: Math.round(bbox.width * sx),
    height: Math.round(bbox.height * sy),
  };
}
