/**
 * 读取前端仓库的 zh_CN 语言包，构建 i18n key -> 中文文案 的双向索引。
 *
 * huilianyi-refactoring 的 i18n 入口是 messages("<key>")，语言包散落在
 * src/static/i18n/zh_CN/{index1,index2,common,menu}.json。
 */
import fs from 'fs';
import path from 'path';

/** 语言包目录（相对前端仓库根）；实际文件按目录内容枚举 */
const I18N_ROOT = 'src/static/i18n';

/** 该目录下这些子目录/文件不是有效语言包 */
const SKIP_ENTRIES = new Set(['invalid-lang']);

export type I18nCatalog = {
  /** key -> 主语言（默认 zh_CN）文案 */
  byKey: Map<string, string>;
  /** 主语言文案 -> key 列表（同文案可能多 key） */
  byText: Map<string, string[]>;
  /** locale -> (key -> 文案)，用于跨语言定位 */
  byLocale: Map<string, Map<string, string>>;
  /** 可用 locale 列表 */
  locales: string[];
  primaryLocale: string;
};

/** 文案里的占位符，如 {arg1}；定位时需转成正则或截断 */
const PLACEHOLDER_RE = /\{[a-zA-Z0-9_]+\}/g;

export function hasPlaceholder(text: string): boolean {
  return PLACEHOLDER_RE.test(text);
}

/**
 * 把带占位符的文案转成可用于 getByText 的稳定前缀。
 * 「表格查询{arg1}条」-> 「表格查询」
 */
export function toStablePrefix(text: string): string {
  const idx = text.search(PLACEHOLDER_RE);
  return idx === -1 ? text : text.slice(0, idx).trim();
}

/** 读取单个 locale 目录下所有 json，合并成 key -> 文案 */
function loadLocale(localeDir: string): Map<string, string> {
  const result = new Map<string, string>();
  if (!fs.existsSync(localeDir)) return result;

  for (const entry of fs.readdirSync(localeDir)) {
    if (!entry.endsWith('.json') || SKIP_ENTRIES.has(entry)) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(localeDir, entry), 'utf8'));
      if (!parsed || typeof parsed !== 'object') continue;
      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof value === 'string' && value.trim()) result.set(key, value);
      }
    } catch {
      continue;
    }
  }
  return result;
}

export function loadI18nCatalog(repoRoot: string, primaryLocale = 'zh_CN'): I18nCatalog {
  const i18nRoot = path.join(repoRoot, I18N_ROOT);
  const byLocale = new Map<string, Map<string, string>>();

  if (fs.existsSync(i18nRoot)) {
    for (const entry of fs.readdirSync(i18nRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || SKIP_ENTRIES.has(entry.name)) continue;
      const map = loadLocale(path.join(i18nRoot, entry.name));
      if (map.size > 0) byLocale.set(entry.name, map);
    }
  }

  const byKey = byLocale.get(primaryLocale) ?? new Map<string, string>();

  const byText = new Map<string, string[]>();
  for (const [key, text] of byKey) {
    const list = byText.get(text);
    if (list) list.push(key);
    else byText.set(text, [key]);
  }

  return {
    byKey,
    byText,
    byLocale,
    locales: [...byLocale.keys()].sort(),
    primaryLocale,
  };
}
