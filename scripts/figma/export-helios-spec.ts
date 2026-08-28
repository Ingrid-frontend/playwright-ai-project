/**
 * 从 Helios Design System Figma 导出：
 * - config/helios-design-tokens.json
 * - config/helios-design-catalog.json（全量 81 页索引）
 * - config/helios-component-catalog.json（桌面端可 sync 目录，排除 B 移动端）
 * - 合并 config/figma-baselines.json（保留手工项）
 *
 * 用法：FIGMA_ACCESS_TOKEN=xxx npm run figma:export-helios
 */
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import {
  fetchFilePages,
  fetchNodes,
  fetchPublishedStyles,
  figmaNodeUrl,
  HELIOS_FILE_KEY,
  parseFillHex,
  parseTextStyle,
  resolveFigmaToken,
} from './figma-api.js';
import {
  buildComponentCatalog,
  categorizePage,
  saveComponentCatalog,
  type CatalogPage,
} from './helios-catalog.js';

dotenv.config({ path: path.join(process.cwd(), '.env') });

const CONFIG_DIR = path.join('config');
const TOKENS_PATH = path.join(CONFIG_DIR, 'helios-design-tokens.json');
const CATALOG_PATH = path.join(CONFIG_DIR, 'helios-design-catalog.json');
const BASELINES_PATH = path.join(CONFIG_DIR, 'figma-baselines.json');
const BINDINGS_PATH = path.join(CONFIG_DIR, 'helios-audit-bindings.json');

interface BaselineMapping {
  script: string;
  step?: string;
  figmaUrl: string;
  note?: string;
}

interface HeliosBinding {
  script: string;
  step: string;
  figmaNodeId: string;
  figmaPage?: string;
  layout?: string[];
}

function loadBindings(): HeliosBinding[] {
  const abs = path.resolve(BINDINGS_PATH);
  if (!fs.existsSync(abs)) return [];
  try {
    const json = JSON.parse(fs.readFileSync(abs, 'utf-8')) as { bindings?: HeliosBinding[] };
    return Array.isArray(json.bindings) ? json.bindings.filter((b) => b.script && b.step && b.figmaNodeId) : [];
  } catch {
    return [];
  }
}

function loadBaselines(): BaselineMapping[] {
  const abs = path.resolve(BASELINES_PATH);
  if (!fs.existsSync(abs)) return [];
  try {
    const json = JSON.parse(fs.readFileSync(abs, 'utf-8')) as { mappings?: BaselineMapping[] };
    return Array.isArray(json.mappings) ? json.mappings : [];
  } catch {
    return [];
  }
}

function mergeBaselines(bindings: HeliosBinding[]): BaselineMapping[] {
  const existing = loadBaselines();
  const key = (m: { script: string; step?: string }) => `${m.script}\0${m.step ?? ''}`;
  const map = new Map<string, BaselineMapping>();
  for (const m of existing) map.set(key(m), m);

  for (const b of bindings) {
    const figmaUrl = figmaNodeUrl(HELIOS_FILE_KEY, b.figmaNodeId);
    map.set(key(b), {
      script: b.script,
      step: b.step,
      figmaUrl,
      note: b.figmaPage,
    });
  }
  return [...map.values()].sort((a, b) =>
    `${a.script}\0${a.step ?? ''}`.localeCompare(`${b.script}\0${b.step ?? ''}`),
  );
}

async function main(): Promise<void> {
  const token = resolveFigmaToken();
  if (!token) {
    console.error('❌ 未配置 FIGMA_ACCESS_TOKEN / FIGMA_TOKEN');
    process.exit(1);
  }

  console.log('📦 导出 Helios Design System …');
  const pages = await fetchFilePages(token);
  console.log(`   页面: ${pages.length}`);

  const styles = await fetchPublishedStyles(token);
  console.log(`   已发布 Styles: ${styles.length}`);

  const nodeDocs = await fetchNodes(
    token,
    styles.map((s) => s.node_id),
  );

  const colors: Array<{ name: string; hex?: string; styleType: string }> = [];
  const typography: Array<{
    name: string;
    fontSize?: number;
    fontWeight?: number;
    lineHeightPx?: number;
    fontFamily?: string;
  }> = [];
  const effects: Array<{ name: string; styleType: string }> = [];
  const grids: Array<{ name: string; styleType: string }> = [];

  for (const style of styles) {
    const doc = nodeDocs[style.node_id];
    if (style.style_type === 'FILL') {
      colors.push({ name: style.name, hex: parseFillHex(doc), styleType: style.style_type });
    } else if (style.style_type === 'TEXT') {
      typography.push({ name: style.name, ...parseTextStyle(doc) });
    } else if (style.style_type === 'EFFECT') {
      effects.push({ name: style.name, styleType: style.style_type });
    } else if (style.style_type === 'GRID') {
      grids.push({ name: style.name, styleType: style.style_type });
    }
  }

  const catalogPages: CatalogPage[] = pages.map((p) => ({
    id: p.id,
    name: p.name,
    category: categorizePage(p.name),
    url: figmaNodeUrl(HELIOS_FILE_KEY, p.id),
  }));

  const catalog = {
    exportedAt: new Date().toISOString(),
    fileKey: HELIOS_FILE_KEY,
    fileUrl: `https://www.figma.com/design/${HELIOS_FILE_KEY}/Helios-Design-System`,
    pages: catalogPages,
  };

  const componentCatalog = buildComponentCatalog(catalogPages);
  const prevComponent = path.resolve(CONFIG_DIR, 'helios-component-catalog.json');
  if (fs.existsSync(prevComponent)) {
    try {
      const old = JSON.parse(fs.readFileSync(prevComponent, 'utf-8')) as {
        items?: Array<{ syncNodeId: string; syncedAt?: string; cached?: boolean }>;
      };
      const cacheMap = new Map((old.items ?? []).map((i) => [i.syncNodeId, i]));
      for (const item of componentCatalog.items) {
        const hit = cacheMap.get(item.syncNodeId);
        if (hit?.syncedAt) {
          item.syncedAt = hit.syncedAt;
          item.cached = hit.cached;
        }
      }
    } catch {
      /* ignore */
    }
  }

  const tokens = {
    exportedAt: new Date().toISOString(),
    fileKey: HELIOS_FILE_KEY,
    colors: colors.filter((c) => c.hex),
    typography,
    effects,
    grids,
    semantic: {
      text: [
        '主要文本 → 中性色/Neutral-10',
        '次要文本 → 中性色/Neutral-7',
        '辅助/占位 → 中性色/Neutral-5',
        '链接/主题色 → 克莱因蓝/Blue-6',
        '错误提示 → 警示/Warning-6',
      ],
      background: ['白底', '浅灰底', '中灰底'],
      icon: ['主要', '次要', '辅助', '主题色'],
    },
  };

  fs.mkdirSync(path.resolve(CONFIG_DIR), { recursive: true });
  fs.writeFileSync(path.resolve(TOKENS_PATH), JSON.stringify(tokens, null, 2), 'utf-8');
  fs.writeFileSync(path.resolve(CATALOG_PATH), JSON.stringify(catalog, null, 2), 'utf-8');
  saveComponentCatalog(componentCatalog);

  const bindings = loadBindings();
  const mergedBaselines = mergeBaselines(bindings);
  fs.writeFileSync(
    path.resolve(BASELINES_PATH),
    JSON.stringify({ mappings: mergedBaselines }, null, 2),
    'utf-8',
  );

  console.log(`✅ ${path.relative(process.cwd(), TOKENS_PATH)}`);
  console.log(`   colors: ${tokens.colors.length}, typography: ${tokens.typography.length}`);
  console.log(`✅ ${path.relative(process.cwd(), CATALOG_PATH)} (${catalog.pages.length} 页)`);
  console.log(
    `✅ config/helios-component-catalog.json (${componentCatalog.stats.total} 项，已排除移动端)`,
  );
  console.log(`   desktop: ${componentCatalog.stats['desktop-component'] ?? 0}, business: ${componentCatalog.stats['business-component'] ?? 0}`);
  console.log(`✅ ${path.relative(process.cwd(), BASELINES_PATH)}`);
  console.log(`   审计映射: ${mergedBaselines.length} 条`);
  console.log('\n💡 按需同步设计稿 PNG：');
  console.log('   npm run figma:sync-baselines -- --list');
  console.log('   npm run figma:sync-baselines -- --catalog --code A06');
  console.log('   npm run figma:sync-baselines -- --catalog --all-desktop');
}

main().catch((err) => {
  console.error('导出失败:', err instanceof Error ? err.message : err);
  process.exit(1);
});
