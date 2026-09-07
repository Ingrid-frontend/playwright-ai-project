const fs = require('fs');
const path = require('path');

function q(s) {
  return JSON.stringify(String(s ?? ''));
}

function matchStringConst(src, name) {
  const re = new RegExp(`export const ${name}\\s*=\\s*['\`]([^'\`]*)['\`]`, 'm');
  const m = src.match(re);
  return m ? m[1] : '';
}

function matchStringArray(src, name) {
  const re = new RegExp(`export const ${name}\\s*(?::[^=]+)?=\\s*\\[([^\\]]*)\\]`, 'ms');
  const m = src.match(re);
  if (!m) return [];
  const inner = m[1].trim();
  if (!inner) return [];
  const items = [];
  const itemRe = /['"]([^'"]*)['"]/g;
  let hit;
  while ((hit = itemRe.exec(inner))) items.push(hit[1]);
  return items;
}

function replaceStringConst(src, name, value) {
  const re = new RegExp(`(export const ${name}\\s*=\\s*)(['\`])[^'\`]*\\2`);
  if (!re.test(src)) return src;
  return src.replace(re, `$1${q(value)}`);
}

function replaceStringArray(src, name, values) {
  const arr = `[${(values || []).map((v) => q(v)).join(', ')}]`;
  const re = new RegExp(`(export const ${name}\\s*(?::[^=]+)?=\\s*)\\[[^\\]]*\\]`, 'ms');
  if (!re.test(src)) return src;
  return src.replace(re, `$1${arr}`);
}

function countReviewMarkers(src) {
  return (String(src || '').match(/TODO\(review\)/gi) || []).length;
}

function resolveCatalogAbs(repoRoot, flowId, domain) {
  const rel = path.join(flowId, 'utils', `${domain}-catalog.ts`);
  const abs = path.join(repoRoot, rel);
  return fs.existsSync(abs) ? { abs, rel } : null;
}

function readCatalogForm(absPath) {
  if (!absPath || !fs.existsSync(absPath)) {
    return {
      searchPlaceholder: '',
      docNoColumn: '',
      tabs: [],
      reviewCount: 0,
    };
  }
  const src = fs.readFileSync(absPath, 'utf8');
  return {
    searchPlaceholder: matchStringConst(src, 'SEARCH_PLACEHOLDER'),
    docNoColumn: matchStringConst(src, 'DOC_NO_COLUMN'),
    tabs: matchStringArray(src, 'TABS'),
    reviewCount: countReviewMarkers(src),
  };
}

function writeCatalogForm(absPath, form) {
  if (!absPath || !fs.existsSync(absPath)) {
    throw new Error('页面描述文件不存在，请先完成一键配置');
  }
  let src = fs.readFileSync(absPath, 'utf8');
  if (form.searchPlaceholder != null) {
    src = replaceStringConst(src, 'SEARCH_PLACEHOLDER', form.searchPlaceholder);
  }
  if (form.docNoColumn != null) {
    src = replaceStringConst(src, 'DOC_NO_COLUMN', form.docNoColumn);
  }
  if (form.tabs != null) {
    src = replaceStringArray(src, 'TABS', form.tabs);
  }
  fs.writeFileSync(absPath, src, 'utf8');
  return readCatalogForm(absPath);
}

module.exports = {
  resolveCatalogAbs,
  readCatalogForm,
  writeCatalogForm,
  countReviewMarkers,
};
