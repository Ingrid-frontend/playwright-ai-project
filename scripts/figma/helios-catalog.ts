import fs from 'fs';
import path from 'path';
import { figmaNodeUrl, HELIOS_FILE_KEY } from './figma-api.js';

export const COMPONENT_CATALOG_PATH = path.join('config', 'helios-component-catalog.json');
export const FULL_CATALOG_PATH = path.join('config', 'helios-design-catalog.json');
export const BINDINGS_PATH = path.join('config', 'helios-audit-bindings.json');

export type CatalogCategory =
  | 'desktop-component'
  | 'business-component'
  | 'mobile-component'
  | 'foundation'
  | 'typography'
  | 'layout'
  | 'color'
  | 'shadow'
  | 'icon'
  | 'template'
  | 'other';

export interface CatalogPage {
  id: string;
  name: string;
  category: CatalogCategory;
  url: string;
}

export interface ComponentCatalogItem {
  code?: string;
  id: string;
  name: string;
  category: CatalogCategory;
  platform: 'desktop' | 'business' | 'foundation' | 'token';
  pageId: string;
  syncNodeId: string;
  figmaUrl: string;
  syncedAt?: string;
  cached?: boolean;
}

export interface ComponentCatalogFile {
  exportedAt: string;
  fileKey: string;
  fileUrl: string;
  excludeCategories: string[];
  items: ComponentCatalogItem[];
  stats: Record<string, number>;
}

export function categorizePage(name: string): CatalogCategory {
  if (/^A\d+/i.test(name)) return 'desktop-component';
  if (/^B\d+/i.test(name)) return 'mobile-component';
  if (/^C\d+/i.test(name)) return 'business-component';
  if (/字体|Font/i.test(name)) return 'typography';
  if (/颜色|Color/i.test(name)) return 'color';
  if (/布局|Layout/i.test(name)) return 'layout';
  if (/阴影|Shadow/i.test(name)) return 'shadow';
  if (/图标|Icon/i.test(name)) return 'icon';
  if (/模版|模板|Template/i.test(name)) return 'template';
  if (/通用/.test(name)) return 'foundation';
  return 'other';
}

export function extractComponentCode(name: string): string | undefined {
  const m = name.match(/^([ABC]\d+)/i);
  return m ? m[1].toUpperCase() : undefined;
}

/** 是否纳入桌面端可 sync 目录（排除 B 系列移动端与分隔/封面页） */
export function isDesktopSyncable(name: string, category: CatalogCategory): boolean {
  if (category === 'mobile-component') return false;
  const n = name.trim();
  if (!n || /^---/.test(n)) return false;
  if (/^移动端/.test(n)) return false;
  if (/^⭕️/.test(n)) return false;
  if (/^(Cover|草稿|桌面端|数据录入控件)$/.test(n)) return false;

  if (category === 'desktop-component' || category === 'business-component') return true;
  if (['foundation', 'typography', 'layout', 'color', 'shadow', 'icon', 'template'].includes(category)) {
    return true;
  }
  if (/Empty|空状态|Chart|图表|Notice|公告/.test(name)) return true;
  return false;
}

function platformOf(category: CatalogCategory): ComponentCatalogItem['platform'] {
  if (category === 'desktop-component') return 'desktop';
  if (category === 'business-component') return 'business';
  if (['typography', 'layout', 'color', 'shadow', 'icon'].includes(category)) return 'token';
  return 'foundation';
}

function loadSyncNodeOverrides(): Map<string, string> {
  const out = new Map<string, string>();
  const abs = path.resolve(BINDINGS_PATH);
  if (!fs.existsSync(abs)) return out;
  try {
    const json = JSON.parse(fs.readFileSync(abs, 'utf-8')) as {
      bindings?: Array<{ figmaPage?: string; figmaNodeId: string }>;
    };
    for (const b of json.bindings ?? []) {
      if (!b.figmaPage || !b.figmaNodeId) continue;
      out.set(b.figmaPage.trim(), b.figmaNodeId);
    }
  } catch {
    /* ignore */
  }
  return out;
}

function pickSyncNodeId(page: CatalogPage, overrides: Map<string, string>): string {
  const code = extractComponentCode(page.name);
  for (const [label, nodeId] of overrides) {
    const labelCode = extractComponentCode(label);
    if (code && labelCode && code === labelCode) return nodeId;
    if (page.name === label) return nodeId;
  }
  return page.id;
}

export function buildComponentCatalog(pages: CatalogPage[]): ComponentCatalogFile {
  const overrides = loadSyncNodeOverrides();
  const items: ComponentCatalogItem[] = [];

  for (const page of pages) {
    const category = categorizePage(page.name);
    if (!isDesktopSyncable(page.name, category)) continue;
    const syncNodeId = pickSyncNodeId(page, overrides);
    items.push({
      code: extractComponentCode(page.name),
      id: page.id,
      name: page.name,
      category,
      platform: platformOf(category),
      pageId: page.id,
      syncNodeId,
      figmaUrl: figmaNodeUrl(HELIOS_FILE_KEY, syncNodeId),
    });
  }

  const syncIds = new Set(items.map((i) => i.syncNodeId));
  const bindingsAbs = path.resolve(BINDINGS_PATH);
  if (fs.existsSync(bindingsAbs)) {
    try {
      const json = JSON.parse(fs.readFileSync(bindingsAbs, 'utf-8')) as {
        bindings?: Array<{ figmaPage?: string; figmaNodeId: string }>;
      };
      for (const b of json.bindings ?? []) {
        if (!b.figmaNodeId || syncIds.has(b.figmaNodeId)) continue;
        syncIds.add(b.figmaNodeId);
        items.push({
          id: b.figmaNodeId,
          name: b.figmaPage || `template-${b.figmaNodeId}`,
          category: 'template',
          platform: 'foundation',
          pageId: b.figmaNodeId,
          syncNodeId: b.figmaNodeId,
          figmaUrl: figmaNodeUrl(HELIOS_FILE_KEY, b.figmaNodeId),
        });
      }
    } catch {
      /* ignore */
    }
  }

  items.sort((a, b) => {
    const ca = a.code ?? a.name;
    const cb = b.code ?? b.name;
    return ca.localeCompare(cb, 'zh-CN');
  });

  const stats: Record<string, number> = {};
  for (const item of items) {
    stats[item.category] = (stats[item.category] ?? 0) + 1;
  }
  stats.total = items.length;

  return {
    exportedAt: new Date().toISOString(),
    fileKey: HELIOS_FILE_KEY,
    fileUrl: `https://www.figma.com/design/${HELIOS_FILE_KEY}/Helios-Design-System`,
    excludeCategories: ['mobile-component'],
    items,
    stats,
  };
}

export function loadComponentCatalog(catalogPath = COMPONENT_CATALOG_PATH): ComponentCatalogFile | null {
  const abs = path.resolve(process.cwd(), catalogPath);
  if (!fs.existsSync(abs)) return null;
  try {
    return JSON.parse(fs.readFileSync(abs, 'utf-8')) as ComponentCatalogFile;
  } catch {
    return null;
  }
}

export function saveComponentCatalog(catalog: ComponentCatalogFile, catalogPath = COMPONENT_CATALOG_PATH): void {
  const abs = path.resolve(process.cwd(), catalogPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify(catalog, null, 2), 'utf-8');
}

export interface CatalogFilter {
  code?: string;
  name?: string;
  category?: string;
  id?: string;
  allDesktop?: boolean;
}

export function filterCatalogItems(
  items: ComponentCatalogItem[],
  filter: CatalogFilter,
): ComponentCatalogItem[] {
  if (filter.allDesktop) return items;
  if (filter.id) {
    const id = filter.id.replace(/-/g, ':');
    return items.filter((i) => i.syncNodeId === id || i.pageId === id || i.id === id);
  }
  if (filter.code) {
    const code = filter.code.toUpperCase();
    return items.filter((i) => i.code?.toUpperCase() === code || i.code?.toUpperCase().startsWith(code));
  }
  if (filter.name) {
    const q = filter.name.toLowerCase();
    return items.filter((i) => i.name.toLowerCase().includes(q));
  }
  if (filter.category) {
    return items.filter((i) => i.category === filter.category || i.platform === filter.category);
  }
  return items;
}

export function markCatalogSynced(
  syncNodeIds: string[],
  syncedAt: string,
  catalogPath = COMPONENT_CATALOG_PATH,
): void {
  const catalog = loadComponentCatalog(catalogPath);
  if (!catalog) return;
  const set = new Set(syncNodeIds);
  for (const item of catalog.items) {
    if (!set.has(item.syncNodeId) && !set.has(item.pageId)) continue;
    item.syncedAt = syncedAt;
    item.cached = true;
  }
  catalog.exportedAt = syncedAt;
  saveComponentCatalog(catalog, catalogPath);
}
