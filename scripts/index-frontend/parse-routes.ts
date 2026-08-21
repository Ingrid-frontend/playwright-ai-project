/**
 * 解析 src/routes/** 下的菜单路由定义，得到 url -> 容器组件 的映射。
 *
 * 路由是纯静态对象字面量（key/url/components + children 嵌套），
 * 组件通过 asyncComponent(() => import("containers/xxx")) 声明，
 * 所以用正则扫描即可，不需要跑 babel。
 */
import fs from 'fs';
import path from 'path';

export type RouteEntry = {
  /** 路由 key，如 approve */
  key: string;
  /** 路由 url，可能含 :param */
  url: string;
  /** 声明该路由的组件变量名 */
  componentVar?: string;
  /** 组件变量对应的 containers 路径 */
  containerPath?: string;
  /** 定义该路由的文件（相对前端仓库根） */
  sourceFile: string;
};

/** const Foo = asyncComponent(() => import("containers/a/b")) */
const COMPONENT_DECL_RE =
  /const\s+(\w+)\s*=\s*asyncComponent\(\s*\(\)\s*=>\s*\n?\s*import\(\s*["']([^"']+)["']/g;

/** key: "x" ... url: "/main/x" ... components: Foo（字段顺序不固定，按块解析） */
const KEY_RE = /\bkey:\s*["']([^"']+)["']/;
const URL_RE = /\burl:\s*["']([^"']+)["']/;
const COMPONENTS_RE = /\bcomponents:\s*(\w+)/;

function walkJsFiles(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) walkJsFiles(abs, out);
    else if (entry.isFile() && entry.name.endsWith('.js')) out.push(abs);
  }
  return out;
}

/**
 * 按 `{ ... }` 粗切分对象块。路由定义里每个块都带 key/url，
 * 用「以 key: 开头的片段」切分足够稳，不必构建完整 AST。
 */
function extractRouteBlocks(source: string): string[] {
  const blocks: string[] = [];
  const re = /\bkey:\s*["'][^"']+["']/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source))) {
    // 从 key 声明往后取一段，覆盖同级的 url/components 字段
    blocks.push(source.slice(match.index, match.index + 400));
  }
  return blocks;
}

export function parseRoutes(repoRoot: string): RouteEntry[] {
  const routesDir = path.join(repoRoot, 'src/routes');
  const files = walkJsFiles(routesDir);
  const entries: RouteEntry[] = [];

  for (const abs of files) {
    const source = fs.readFileSync(abs, 'utf8');
    const rel = path.relative(repoRoot, abs);

    const componentMap = new Map<string, string>();
    let decl: RegExpExecArray | null;
    COMPONENT_DECL_RE.lastIndex = 0;
    while ((decl = COMPONENT_DECL_RE.exec(source))) {
      componentMap.set(decl[1], decl[2]);
    }

    for (const block of extractRouteBlocks(source)) {
      const key = block.match(KEY_RE)?.[1];
      const url = block.match(URL_RE)?.[1];
      if (!key || !url) continue;
      const componentVar = block.match(COMPONENTS_RE)?.[1];
      entries.push({
        key,
        url,
        componentVar,
        containerPath: componentVar ? componentMap.get(componentVar) : undefined,
        sourceFile: rel,
      });
    }
  }

  // 同 url 去重，保留信息最全的一条
  const byUrl = new Map<string, RouteEntry>();
  for (const entry of entries) {
    const prev = byUrl.get(entry.url);
    if (!prev || (!prev.containerPath && entry.containerPath)) byUrl.set(entry.url, entry);
  }
  return [...byUrl.values()].sort((a, b) => a.url.localeCompare(b.url));
}
