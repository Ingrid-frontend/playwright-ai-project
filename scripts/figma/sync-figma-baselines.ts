/**
 * 从 Figma API 拉取设计稿 PNG 到本地持久缓存。
 * 审计默认只读缓存，不访问 Figma API。
 *
 * 用法：
 *   npm run figma:sync-baselines                    # 仅 sync 审计映射（figma-baselines.json）
 *   npm run figma:sync-baselines -- --catalog --all-desktop   # 桌面端全量组件目录
 *   npm run figma:sync-baselines -- --catalog --code A06      # 按组件编号
 *   npm run figma:sync-baselines -- --catalog --name 表格     # 按名称子串
 *   npm run figma:sync-baselines -- --catalog --category desktop-component
 *   npm run figma:sync-baselines -- --catalog --id 13996-101258
 *   npm run figma:sync-baselines -- --list                    # 列出可 sync 目录
 *   npm run figma:sync-baselines -- --force                   # 强制覆盖已有 PNG
 */
import path from 'path';
import dotenv from 'dotenv';
import fs from 'fs';
import {
  baselineImageAbsPath,
  fetchFigmaPng,
  loadFigmaBaselineConfig,
  mergeFigmaBaselineManifest,
  parseFigmaUrl,
  resolveFigmaToken,
  syncFigmaBaselineManifest,
  type FigmaBaselineManifestEntry,
  type FigmaNodeRef,
} from '../report/figma-baseline.js';
import {
  filterCatalogItems,
  loadComponentCatalog,
  markCatalogSynced,
  type ComponentCatalogItem,
} from './helios-catalog.js';
import { HELIOS_FILE_KEY } from './figma-api.js';

dotenv.config({ path: path.join(process.cwd(), '.env') });

interface SyncArgs {
  force: boolean;
  list: boolean;
  catalog: boolean;
  allDesktop: boolean;
  code?: string;
  name?: string;
  category?: string;
  id?: string;
}

function getArg(argv: string[], name: string): string | undefined {
  const withEq = argv.find((a) => a.startsWith(`--${name}=`));
  if (withEq) return withEq.slice(name.length + 3);
  const idx = argv.indexOf(`--${name}`);
  if (idx >= 0 && argv[idx + 1] && !argv[idx + 1].startsWith('--')) return argv[idx + 1];
  return undefined;
}

function parseArgs(argv: string[]): SyncArgs {
  return {
    force: argv.includes('--force'),
    list: argv.includes('--list'),
    catalog: argv.includes('--catalog'),
    allDesktop: argv.includes('--all-desktop'),
    code: getArg(argv, 'code'),
    name: getArg(argv, 'name'),
    category: getArg(argv, 'category'),
    id: getArg(argv, 'id'),
  };
}

async function syncNodes(
  byNode: Map<string, FigmaNodeRef>,
  opts: { force: boolean; label?: (ref: FigmaNodeRef) => string },
): Promise<{
  images: Record<string, { imageFile: string; syncedAt: string; figmaUrl: string }>;
  fetched: number;
  skipped: number;
  syncedNodeIds: string[];
}> {
  const now = new Date().toISOString();
  const images: Record<string, { imageFile: string; syncedAt: string; figmaUrl: string }> = {};
  let fetched = 0;
  let skipped = 0;
  const syncedNodeIds: string[] = [];

  for (const [nodeKey, ref] of byNode) {
    const had =
      !opts.force &&
      fs.existsSync(baselineImageAbsPath(ref)) &&
      fs.statSync(baselineImageAbsPath(ref)).size > 32;
    try {
      const imagePath = await fetchFigmaPng(ref, { force: opts.force });
      const imageFile = path.relative(path.resolve('screenshots-baseline', 'figma'), imagePath);
      images[nodeKey] = { imageFile, syncedAt: now, figmaUrl: ref.url };
      syncedNodeIds.push(ref.nodeId);
      if (had) skipped += 1;
      else fetched += 1;
      const tag = opts.label?.(ref) ?? ref.nodeId;
      console.log(`   ${had ? '⏭️' : '✅'} ${tag} → ${imageFile}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`   ❌ ${ref.nodeId}: ${msg.slice(0, 120)}`);
    }
  }

  return { images, fetched, skipped, syncedNodeIds };
}

function catalogToRef(item: ComponentCatalogItem): FigmaNodeRef {
  return {
    fileKey: HELIOS_FILE_KEY,
    nodeId: item.syncNodeId,
    url: item.figmaUrl,
  };
}

function printCatalogList(): void {
  const catalog = loadComponentCatalog();
  if (!catalog) {
    console.log('⚠️  未找到 config/helios-component-catalog.json，请先 npm run figma:export-helios');
    return;
  }
  console.log(`📋 桌面端可 sync 目录（共 ${catalog.items.length} 项，已排除移动端 B 系列）\n`);
  for (const item of catalog.items) {
    const status = item.cached ? '🟢' : '⚪';
    const code = item.code ? `${item.code} ` : '';
    console.log(`  ${status} ${code}${item.name}`);
    console.log(`     ${item.category} · sync ${item.syncNodeId}${item.syncedAt ? ` · ${item.syncedAt.slice(0, 10)}` : ''}`);
  }
  console.log('\n同步示例:');
  console.log('  npm run figma:sync-baselines -- --catalog --all-desktop');
  console.log('  npm run figma:sync-baselines -- --catalog --code A06');
}

async function syncAuditMappings(force: boolean): Promise<void> {
  const mappings = loadFigmaBaselineConfig();
  if (mappings.length === 0) {
    console.log('⚠️  config/figma-baselines.json 无映射');
    return;
  }

  const byNode = new Map<string, FigmaNodeRef>();
  const entries: FigmaBaselineManifestEntry[] = [];
  const now = new Date().toISOString();

  for (const m of mappings) {
    const ref = parseFigmaUrl(m.figmaUrl);
    if (!ref) {
      console.log(`⚠️  跳过无效 URL: ${m.script}${m.step ? ` / ${m.step}` : ''}`);
      continue;
    }
    byNode.set(`${ref.fileKey}:${ref.nodeId}`, ref);
    entries.push({
      script: m.script,
      step: m.step,
      figmaUrl: m.figmaUrl,
      fileKey: ref.fileKey,
      nodeId: ref.nodeId,
      note: m.note,
      syncedAt: now,
    });
  }

  console.log(`📥 同步审计映射（${byNode.size} 个唯一节点，${entries.length} 条）${force ? ' · 强制覆盖' : ''}`);
  const { images, fetched, skipped } = await syncNodes(byNode, { force });
  syncFigmaBaselineManifest({ syncedAt: now, entries, images });
  console.log(`\n   新拉取/覆盖: ${fetched}，沿用缓存: ${skipped}`);
}

async function syncCatalogItems(items: ComponentCatalogItem[], force: boolean): Promise<void> {
  if (items.length === 0) {
    console.log('⚠️  无匹配的目录项');
    return;
  }

  const byNode = new Map<string, FigmaNodeRef>();
  for (const item of items) {
    const ref = catalogToRef(item);
    byNode.set(`${ref.fileKey}:${ref.nodeId}`, ref);
  }

  console.log(`📥 同步组件目录（${byNode.size} 个节点）${force ? ' · 强制覆盖' : ''}`);
  const { images, fetched, skipped, syncedNodeIds } = await syncNodes(byNode, {
    force,
    label: (ref) => {
      const hit = items.find((i) => i.syncNodeId === ref.nodeId);
      return hit ? `${hit.code ?? ''} ${hit.name}`.trim() : ref.nodeId;
    },
  });

  const now = new Date().toISOString();
  mergeFigmaBaselineManifest({ syncedAt: now, images });
  markCatalogSynced(syncedNodeIds, now);

  console.log(`\n   新拉取/覆盖: ${fetched}，沿用缓存: ${skipped}`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.list) {
    printCatalogList();
    return;
  }

  const token = resolveFigmaToken();
  if (!token) {
    console.error('❌ 未配置 FIGMA_ACCESS_TOKEN / FIGMA_TOKEN');
    process.exit(1);
  }

  if (args.catalog) {
    const catalog = loadComponentCatalog();
    if (!catalog) {
      console.log('⚠️  未找到 config/helios-component-catalog.json，请先 npm run figma:export-helios');
      process.exit(1);
    }
    const items = filterCatalogItems(catalog.items, {
      allDesktop: args.allDesktop,
      code: args.code,
      name: args.name,
      category: args.category,
      id: args.id,
    });
    await syncCatalogItems(items, args.force);
  } else {
    await syncAuditMappings(args.force);
  }

  console.log('\n📦 缓存目录: screenshots-baseline/figma/');
  console.log('   后续 npm run ui-audit 只读本地缓存');
}

main().catch((err) => {
  console.error('同步失败:', err instanceof Error ? err.message : err);
  process.exit(1);
});
