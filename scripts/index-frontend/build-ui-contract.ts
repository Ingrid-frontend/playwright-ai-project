/**
 * 前端仓库 -> UI 契约表索引器。
 *
 * 用法：
 *   npm run index:frontend -- --repo=/path/to/huilianyi-refactoring
 *   npm run index:frontend -- --repo=... --route=/main/approve   # 只看单条路由
 *
 * 产物：datasource/ui-contract.json
 * 生成脚本时只取相关路由那一小段喂给模型，避免整仓源码进上下文。
 */
import fs from 'fs';
import path from 'path';
import { loadI18nCatalog } from './i18n-catalog.js';
import { parseRoutes, type RouteEntry } from './parse-routes.js';
import { extractComponentFacts, type Anchor, type ApiEndpoint } from './extract-anchors.js';

export type RouteContract = {
  key: string;
  url: string;
  containerPath?: string;
  /** 该路由渲染的内容是否在 iframe 内（决定要不要 frameLocator） */
  inIframe: boolean;
  /** inIframe 的判定依据，便于人工复核 */
  iframeReason: string;
  antdComponents: string[];
  /** 经自定义封装间接用到的 antd 组件 */
  indirectAntdComponents: string[];
  /** 表格走虚拟滚动 */
  virtualized: boolean;
  anchors: Anchor[];
  endpoints: ApiEndpoint[];
  sourceFiles: string[];
};

export type UiContract = {
  generatedAt: string;
  repo: string;
  /** 组件库及主版本，决定 role 语义可用性 */
  uiLibrary: { name: string; version: string };
  /** 主布局（/main/**）是否套 iframe —— 已用真实页面核对 */
  mainShellInIframe: boolean;
  /** 登录页是否套 iframe：该项目登录页确实有自引用 iframe 壳 */
  loginInIframe: boolean;
  i18n: {
    entry: string;
    primaryLocale: string;
    availableLocales: string[];
    keyCount: number;
    /** 运行时默认语言可能非中文，定位前应先确认 */
    note: string;
  };
  routes: RouteContract[];
};

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const arg of argv) {
    const match = arg.match(/^--([^=]+)=(.*)$/);
    if (match) out[match[1]] = match[2];
  }
  return out;
}

function detectUiLibrary(repoRoot: string): { name: string; version: string } {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const name of ['antd', 'element-ui', '@arco-design/web-react']) {
      if (deps?.[name]) return { name, version: String(deps[name]) };
    }
  } catch {
    /* ignore */
  }
  return { name: 'unknown', version: 'unknown' };
}

/**
 * 判断主布局是否套 iframe：只看主布局容器本身。
 * 弹窗、富文本编辑器、iPad 壳里的 iframe 不影响 /main/** 的定位路径。
 * 已用 stage 真实页面核对：/main/approve 的 iframe 数为 0。
 */
function detectMainShellIframe(repoRoot: string): boolean {
  const abs = path.join(repoRoot, 'src/containers/main/main.js');
  if (!fs.existsSync(abs)) return false;
  return /<iframe/.test(fs.readFileSync(abs, 'utf8'));
}

/**
 * 登录页判定单独处理：stage 实测登录页存在自引用 iframe
 * （src=/?openBySelf=zoom），登录表单在该 frame 内，必须用 frameLocator。
 */
function isLoginRoute(url: string): boolean {
  return !url.startsWith('/main/');
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = args.repo;
  if (!repoRoot || !fs.existsSync(repoRoot)) {
    console.error('用法: npm run index:frontend -- --repo=<前端仓库绝对路径> [--route=/main/xxx]');
    process.exit(1);
  }

  const catalog = loadI18nCatalog(repoRoot);
  const allRoutes = parseRoutes(repoRoot);
  const filtered: RouteEntry[] = args.route
    ? allRoutes.filter((r) => r.url.startsWith(args.route))
    : allRoutes;

  const mainShellInIframe = detectMainShellIframe(repoRoot);
  // 登录页壳来自实测（stage: /?openBySelf=zoom），源码侧无静态声明
  const loginInIframe = true;
  const routes: RouteContract[] = [];

  // 登录页不在 src/routes 的菜单表里，但它是所有用例的入口，单独补一条
  if (!args.route || '/'.startsWith(args.route) || args.route === '/') {
    const loginFacts = extractComponentFacts(repoRoot, 'containers/login', catalog);
    routes.push({
      key: 'login',
      url: '/',
      containerPath: 'containers/login',
      inIframe: loginInIframe,
      iframeReason: '登录页实测存在自引用 iframe（?openBySelf=zoom），表单在该 frame 内',
      antdComponents: loginFacts.antdComponents,
      indirectAntdComponents: loginFacts.indirectAntdComponents,
      virtualized: loginFacts.virtualized,
      anchors: loginFacts.anchors,
      endpoints: loginFacts.endpoints,
      sourceFiles: loginFacts.files,
    });
  }

  for (const route of filtered) {
    const login = isLoginRoute(route.url);
    const inIframe = login ? loginInIframe : mainShellInIframe;
    const iframeReason = login
      ? '登录页实测存在自引用 iframe（?openBySelf=zoom），表单在该 frame 内'
      : 'src/containers/main/main.js 无 iframe，stage 实测 /main/** iframe 数为 0';

    if (!route.containerPath) {
      routes.push({
        key: route.key,
        url: route.url,
        inIframe,
        iframeReason,
        antdComponents: [],
        indirectAntdComponents: [],
        virtualized: false,
        anchors: [],
        endpoints: [],
        sourceFiles: [],
      });
      continue;
    }
    const facts = extractComponentFacts(repoRoot, route.containerPath, catalog);
    routes.push({
      key: route.key,
      url: route.url,
      containerPath: route.containerPath,
      inIframe,
      iframeReason,
      antdComponents: facts.antdComponents,
      indirectAntdComponents: facts.indirectAntdComponents,
      virtualized: facts.virtualized,
      anchors: facts.anchors,
      endpoints: facts.endpoints,
      sourceFiles: facts.files,
    });
  }

  const contract: UiContract = {
    generatedAt: new Date().toISOString(),
    repo: repoRoot,
    uiLibrary: detectUiLibrary(repoRoot),
    mainShellInIframe,
    loginInIframe,
    i18n: {
      entry: 'messages("<key>")',
      primaryLocale: catalog.primaryLocale,
      availableLocales: catalog.locales,
      keyCount: catalog.byKey.size,
      note: 'stage 登录页实测默认渲染英文，定位前需确认运行时语言或改用 i18n key 对应 locale 的文案',
    },
    routes,
  };

  const outPath = path.resolve('datasource/ui-contract.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(contract, null, 2), 'utf8');

  const withAnchors = routes.filter((r) => r.anchors.length > 0).length;
  console.log(`UI 契约已生成: ${outPath}`);
  console.log(`  组件库: ${contract.uiLibrary.name}@${contract.uiLibrary.version}`);
  console.log(`  主布局在 iframe 内: ${mainShellInIframe}（登录页: ${loginInIframe}）`);
  console.log(`  路由: ${routes.length}（其中 ${withAnchors} 条抽到锚点）`);
  console.log(`  i18n: ${catalog.byKey.size} key / locale: ${catalog.locales.join(', ')}`);
}

main();
