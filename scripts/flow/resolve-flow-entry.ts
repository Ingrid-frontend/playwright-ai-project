/**
 * 从流程名称 / 菜单文案解析列表页路由，避免手写猜路径。
 *
 * 数据源：datasource/menu_items.json + menu_routes.json（来自前端仓库路由索引）
 *
 * 用法：
 *   npx tsx scripts/flow/resolve-flow-entry.ts --label=报销流程
 *   npx tsx scripts/flow/resolve-flow-entry.ts --label=报销流程 --entry=/main/xxx
 */
import fs from 'fs';
import path from 'path';

export type ResolveResult = {
  entry: string;
  source: string;
  menuKey?: string;
  menuLabel?: string;
};

type MenuMaps = {
  items: Record<string, string>;
  routes: Record<string, string>;
};

function resolveRepoRoot(): string {
  let dir = path.resolve(process.cwd());
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, 'datasource/menu_routes.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(process.cwd());
}

export function loadMenuMaps(repoRoot?: string): MenuMaps {
  const root = repoRoot || resolveRepoRoot();
  const items = JSON.parse(fs.readFileSync(path.join(root, 'datasource/menu_items.json'), 'utf8'));
  const routes = JSON.parse(fs.readFileSync(path.join(root, 'datasource/menu_routes.json'), 'utf8'));
  return { items, routes };
}

function normLabel(s: string): string {
  return String(s || '')
    .trim()
    .replace(/流程$/, '')
    .trim();
}

function matchScore(query: string, menuLabel: string): number {
  const q = String(query || '').trim();
  const m = String(menuLabel || '').trim();
  if (!q || !m) return 0;
  const qn = normLabel(q);
  if (q === m || qn === m) return 100;
  if (m.startsWith(qn) || qn.startsWith(m.replace(/单$/, ''))) return 85;
  if (q.includes(m) || m.includes(q)) return 70;
  if (qn && (m.includes(qn) || qn.includes(m))) return 65;
  return 0;
}

export function resolveFromMenu(query: string, maps: MenuMaps): ResolveResult | null {
  const q = String(query || '').trim();
  if (!q) return null;

  let best: { key: string; label: string; score: number } | null = null;
  for (const [key, label] of Object.entries(maps.items)) {
    const score = matchScore(q, label);
    if (!best || score > best.score) best = { key, label, score };
  }
  if (!best || best.score < 60) return null;

  const entry = maps.routes[best.key];
  if (!entry) return null;
  return {
    entry,
    source: `menu:${best.key}`,
    menuKey: best.key,
    menuLabel: best.label,
  };
}

export function resolveFlowEntry(
  opts: { label?: string; entry?: string },
  repoRoot?: string,
): ResolveResult | null {
  const entry = String(opts.entry || '').trim();
  const label = String(opts.label || '').trim();

  if (entry.startsWith('/')) {
    return { entry, source: 'manual' };
  }

  const maps = loadMenuMaps(repoRoot);
  const queries = [entry, label, normLabel(label)].filter(Boolean);
  for (const q of queries) {
    const hit = resolveFromMenu(q, maps);
    if (hit) return hit;
  }
  return null;
}

function getArg(name: string): string {
  const prefix = `--${name}=`;
  const hit = process.argv.slice(2).find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length).trim() : '';
}

const isDirectRun = process.argv[1]?.replace(/\\/g, '/').includes('resolve-flow-entry');

if (isDirectRun) {
  const label = getArg('label');
  const entry = getArg('entry');
  const hit = resolveFlowEntry({ label, entry });
  if (!hit) {
    process.stderr.write(`无法从菜单路由表解析入口（label=${label || '-'} entry=${entry || '-'}）\n`);
    process.exit(1);
  }
  process.stdout.write(`${JSON.stringify(hit)}\n`);
}
