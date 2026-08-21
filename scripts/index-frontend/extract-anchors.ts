/**
 * 从一个容器组件（及其同目录子文件）中抽取 Playwright 可用的定位锚点。
 *
 * 关键事实（huilianyi-refactoring）：
 *  - i18n 入口是 messages("<key>")，可反查 zh_CN 文案 -> 生成 getByText/getByRole name
 *  - antd v3：Table 行不带 role="row"，Select 不是原生 <select>，需要特殊定位策略
 *  - 接口在 *.service.js 里以 `${config.baseUrl}/api/...` 模板串出现 -> 生成 waitForResponse
 */
import fs from 'fs';
import path from 'path';
import { hasPlaceholder, toStablePrefix, type I18nCatalog } from './i18n-catalog.js';

export type AnchorRole = 'button' | 'tab' | 'text' | 'placeholder' | 'column' | 'menuitem';

export type Anchor = {
  /** i18n key，作为跨语言稳定标识 */
  i18nKey: string;
  /** 当前语言（zh_CN）文案 */
  text: string;
  /** 用于 getByText 的稳定片段（占位符已截断） */
  matchText: string;
  /** 推断的语义角色，决定用 getByRole 还是 getByText */
  role: AnchorRole;
  /** 文案含占位符，定位需用正则前缀而非 exact */
  dynamic: boolean;
  /** 其他 locale 的同 key 文案；应用运行时默认语言可能不是中文 */
  localized?: Record<string, string>;
};

export type ApiEndpoint = {
  method: 'get' | 'post' | 'put' | 'delete';
  /** /api/... 形式的路径，含 ${} 的段已转为 * */
  path: string;
  /** waitForResponse 可直接用的 glob */
  glob: string;
  /** 该 glob 在本页相关文件里出现的次数，用于把主接口排到前面 */
  hits?: number;
  /** 所属 service 函数名，是判断语义的关键线索 */
  fn?: string;
  /** 该 service 函数是否在页面容器（非 service）里被真正调用 */
  calledInContainer?: boolean;
  /**
   * 是否为列表/查询类接口。
   * 光看路径会误判：/api/approvals/pending 实际是「单据暂挂」，
   * 真正的列表接口是 getPendingApproveList -> /api/approvals/pendingApproval。
   * 所以以所属函数名而非 URL 来判定。
   */
  isList?: boolean;
};

export type ComponentFacts = {
  /** 用到的 antd 组件 */
  antdComponents: string[];
  /** 经自定义封装间接用到的 antd 组件（如 AdvancedTable -> antd Table） */
  indirectAntdComponents: string[];
  /** 表格是否走虚拟滚动：影响「第 N 行必然在 DOM 里」的假设 */
  virtualized: boolean;
  /** 组件树里是否出现 <iframe> */
  hasIframe: boolean;
  anchors: Anchor[];
  endpoints: ApiEndpoint[];
  /** 扫描过的文件（相对仓库根） */
  files: string[];
};

/** 本地组件 import：import Foo from "components/xxx" */
const LOCAL_IMPORT_RE = /import\s+(\w+)\s+from\s+["'](components\/[^"']+|containers\/[^"']+)["']/g;

const VIRTUAL_RE = /VirtualTable|VirtualTreeTable|react-virtualized|rc-virtual-list/;

/**
 * 解析 "components/xxx" 形式的 import。
 * 目录形式除了 index.js，还可能是 <dir>/<dir>.js（该仓库常见写法，
 * 如 components/virtual-table 实际入口经 index 再转一层）。
 */
function resolveLocalImport(repoRoot: string, importPath: string): string[] {
  const base = path.join(repoRoot, 'src', importPath);
  const out: string[] = [];
  const candidates = [
    `${base}.js`,
    path.join(base, 'index.js'),
    path.join(base, `${path.basename(base)}.js`),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) out.push(candidate);
  }
  return out;
}

const MESSAGES_RE = /messages\(\s*["']([^"']+)["']/g;
const ANTD_IMPORT_RE = /import\s*\{([^}]+)\}\s*from\s*["']antd["']/g;
const IFRAME_RE = /<iframe/;

/** service 里的直接调用：get(`${config.baseUrl}/api/x`) / post("/api/y") */
const API_CALL_RE =
  /\.(get|post|put|delete)\(\s*[`"']((?:\$\{[^}]*\})?[^`"']*\/api\/[^`"'?]*)/gi;

/**
 * 该仓库大量 service 先把 url 存进变量再调用，例如：
 *   const url = `${config.baseUrl}/api/approvals/batchfilters/v4`;
 *   return this.handleUrl(params, data, url);
 * 只匹配 `.post(` 会漏掉这些真正的列表主接口，因此单独抽一遍变量赋值。
 */
const API_ASSIGN_RE =
  /\b(?:const|let|var)\s+\w*[uU]rl\w*\s*=\s*[`"']((?:\$\{[^}]*\})?[^`"']*\/api\/[^`"'?]*)/g;

/** 页面里的 service 方法调用：xxxService.getPendingApproveList( / service.getList( */
const SERVICE_CALL_RE = /\b\w*(?:[sS]ervice|[sS]ervices)\.(\w+)\s*\(/g;

/**
 * 根据 messages() 调用点的上下文推断语义角色。
 * 取调用前一段源码判断它落在哪种 antd 结构里。
 */
function inferRole(context: string): AnchorRole {
  if (/placeholder\s*=\s*\{?\s*$/.test(context)) return 'placeholder';
  if (/<Button[^>]*>\s*$/.test(context) || /okText|cancelText/.test(context)) return 'button';
  if (/<TabPane[^>]*tab\s*=\s*\{?\s*$/.test(context) || /\btab:\s*$/.test(context)) return 'tab';
  if (/\btitle:\s*$/.test(context) || /dataIndex/.test(context)) return 'column';
  if (/<Menu\.Item[^>]*>\s*$/.test(context)) return 'menuitem';
  return 'text';
}

function collectFiles(repoRoot: string, containerPath: string): string[] {
  // containers/approve/approve-list -> src/containers/approve/approve-list.js
  const base = path.join(repoRoot, 'src', containerPath);
  const candidates: string[] = [];

  for (const suffix of ['.js', '/index.js']) {
    const abs = base + suffix;
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) candidates.push(abs);
  }
  // 目录形式：带上同目录的 service / 直接子文件
  if (fs.existsSync(base) && fs.statSync(base).isDirectory()) {
    for (const entry of fs.readdirSync(base)) {
      if (entry.endsWith('.js')) candidates.push(path.join(base, entry));
    }
  }
  // 文件形式：捎上兄弟 service（接口定义通常在那里）
  const dir = path.dirname(base);
  if (fs.existsSync(dir)) {
    for (const entry of fs.readdirSync(dir)) {
      if (entry.endsWith('.service.js')) candidates.push(path.join(dir, entry));
    }
  }

  return [...new Set(candidates)];
}

function toGlob(apiPath: string): string {
  // ${config.baseUrl}/api/approvals/pending -> **/api/approvals/pending
  const cleaned = apiPath.replace(/\$\{[^}]*\}/g, '');
  const idx = cleaned.indexOf('/api/');
  const rel = idx === -1 ? cleaned : cleaned.slice(idx);
  return `**${rel}`;
}

/** 累计同一 glob 的命中次数，方法名以首次出现为准 */
function recordEndpoint(
  store: Map<string, ApiEndpoint>,
  rawPath: string,
  method: ApiEndpoint['method'],
  fn?: string,
): void {
  const glob = toGlob(rawPath);
  if (!glob.includes('/api/')) return;
  const existing = store.get(glob);
  if (existing) {
    existing.hits = (existing.hits ?? 1) + 1;
    if (!existing.fn && fn) {
      existing.fn = fn;
      existing.isList = isListFn(fn);
    }
    return;
  }
  store.set(glob, {
    method,
    path: rawPath.replace(/\$\{[^}]*\}/g, '*'),
    glob,
    hits: 1,
    fn,
    isList: fn ? isListFn(fn) : false,
  });
}

/**
 * 从 service 函数名判断这是不是「拉列表 / 查询数据」的接口。
 * 排除 count / 导出 / 操作类，避免把计数接口当主数据源去等。
 */
function isListFn(fn: string): boolean {
  if (/count$|export|download|template/i.test(fn)) return false;
  return /^(get|query|fetch|search|load)/i.test(fn) && /(list|page|search|query|records?)/i.test(fn);
}

/**
 * 找出 rawPath 所在位置最近的上层函数名。
 * service 都是 `fnName(params) {` 这种对象方法写法，向上回溯即可。
 */
const ENCLOSING_FN_RE = /(?:^|\n)\s*(?:async\s+)?(\w+)\s*(?::\s*(?:async\s*)?function\s*)?\([^)]*\)\s*(?:=>\s*)?\{/g;

function findEnclosingFn(source: string, index: number): string | undefined {
  ENCLOSING_FN_RE.lastIndex = 0;
  let best: string | undefined;
  let match: RegExpExecArray | null;
  while ((match = ENCLOSING_FN_RE.exec(source))) {
    if (match.index > index) break;
    best = match[1];
  }
  return best;
}

/**
 * 顺着本地组件 import 向下追几层，找出被自定义组件包裹的 antd 组件。
 *
 * 该仓库的表格是 AdvancedTable -> Table -> ResizeTable -> antd Table 四层封装，
 * 只看直接 import 会漏判「这页有没有 antd Table」，进而漏掉 role 语义约束。
 */
function traceIndirectAntd(
  repoRoot: string,
  entryFiles: string[],
  maxDepth = 6,
): { components: Set<string>; virtualized: boolean } {
  const found = new Set<string>();
  let virtualized = false;
  const visited = new Set<string>();

  let frontier = entryFiles.slice();
  for (let depth = 0; depth < maxDepth && frontier.length > 0; depth += 1) {
    const next: string[] = [];

    for (const abs of frontier) {
      if (visited.has(abs)) continue;
      visited.add(abs);

      let source: string;
      try {
        source = fs.readFileSync(abs, 'utf8');
      } catch {
        continue;
      }

      if (VIRTUAL_RE.test(source)) virtualized = true;

      ANTD_IMPORT_RE.lastIndex = 0;
      let imp: RegExpExecArray | null;
      while ((imp = ANTD_IMPORT_RE.exec(source))) {
        for (const name of imp[1].split(',')) {
          const clean = name.trim().split(/\s+as\s+/)[0].trim();
          if (clean) found.add(clean);
        }
      }

      LOCAL_IMPORT_RE.lastIndex = 0;
      let local: RegExpExecArray | null;
      while ((local = LOCAL_IMPORT_RE.exec(source))) {
        for (const candidate of resolveLocalImport(repoRoot, local[2])) {
          if (!visited.has(candidate)) next.push(candidate);
        }
      }
    }

    frontier = next;
  }

  return { components: found, virtualized };
}

export function extractComponentFacts(
  repoRoot: string,
  containerPath: string,
  catalog: I18nCatalog,
  maxAnchors = 40,
): ComponentFacts {
  const files = collectFiles(repoRoot, containerPath);
  const antd = new Set<string>();
  const anchorByKey = new Map<string, Anchor>();
  const endpointByGlob = new Map<string, ApiEndpoint>();
  /** 页面组件里出现过的 service 方法调用，如 approveService.getPendingApproveList(...) */
  const containerCalledFns = new Set<string>();
  let hasIframe = false;
  const scanned: string[] = [];

  for (const abs of files) {
    let source: string;
    try {
      source = fs.readFileSync(abs, 'utf8');
    } catch {
      continue;
    }
    scanned.push(path.relative(repoRoot, abs));

    if (IFRAME_RE.test(source)) hasIframe = true;

    // service 文件里只是定义接口，只有页面组件的调用才证明这页真的会打它
    if (!abs.endsWith('.service.js')) {
      SERVICE_CALL_RE.lastIndex = 0;
      let call: RegExpExecArray | null;
      while ((call = SERVICE_CALL_RE.exec(source))) containerCalledFns.add(call[1]);
    }

    ANTD_IMPORT_RE.lastIndex = 0;
    let imp: RegExpExecArray | null;
    while ((imp = ANTD_IMPORT_RE.exec(source))) {
      for (const name of imp[1].split(',')) {
        const clean = name.trim().split(/\s+as\s+/)[0].trim();
        if (clean) antd.add(clean);
      }
    }

    MESSAGES_RE.lastIndex = 0;
    let msg: RegExpExecArray | null;
    while ((msg = MESSAGES_RE.exec(source))) {
      const key = msg[1];
      if (anchorByKey.has(key)) continue;
      const text = catalog.byKey.get(key);
      if (!text || text.length > 30) continue;
      // 纯格式串（日期、标点）不是可定位锚点
      if (/^[-,.\s:]*$/.test(text) || /^[YMDHms\-:\s]+$/.test(text)) continue;

      const context = source.slice(Math.max(0, msg.index - 120), msg.index);
      const dynamic = hasPlaceholder(text);
      const matchText = dynamic ? toStablePrefix(text) : text;
      if (!matchText) continue;

      // 带上其他语言的同 key 文案：运行时默认语言未必是中文
      const localized: Record<string, string> = {};
      for (const [locale, map] of catalog.byLocale) {
        if (locale === catalog.primaryLocale) continue;
        const value = map.get(key);
        if (value) localized[locale] = value;
      }

      anchorByKey.set(key, {
        i18nKey: key,
        text,
        matchText,
        role: inferRole(context),
        dynamic,
        localized: Object.keys(localized).length > 0 ? localized : undefined,
      });
    }

    API_CALL_RE.lastIndex = 0;
    let api: RegExpExecArray | null;
    while ((api = API_CALL_RE.exec(source))) {
      recordEndpoint(
        endpointByGlob,
        api[2],
        api[1].toLowerCase() as ApiEndpoint['method'],
        findEnclosingFn(source, api.index),
      );
    }

    // 变量赋值形式的 url，方法未知时按该仓库列表接口惯例记为 post
    API_ASSIGN_RE.lastIndex = 0;
    let assigned: RegExpExecArray | null;
    while ((assigned = API_ASSIGN_RE.exec(source))) {
      recordEndpoint(endpointByGlob, assigned[1], 'post', findEnclosingFn(source, assigned.index));
    }
  }

  const traced = traceIndirectAntd(repoRoot, files);
  const direct = new Set(antd);
  const indirect = [...traced.components].filter((name) => !direct.has(name)).sort();

  return {
    antdComponents: [...antd].sort(),
    indirectAntdComponents: indirect,
    virtualized: traced.virtualized,
    hasIframe,
    anchors: [...anchorByKey.values()].slice(0, maxAnchors),
    // waitForResponse 该等的是「容器里真的调用了的列表接口」。
    // 单看函数名会把一堆同类查询接口并列成主数据源，加上容器调用证据才能收敛。
    endpoints: [...endpointByGlob.values()]
      .map((ep) => ({
        ...ep,
        calledInContainer: ep.fn ? containerCalledFns.has(ep.fn) : false,
      }))
      .sort((a, b) => score(b) - score(a))
      .slice(0, 20),
    files: scanned,
  };
}

/** 容器里被调用的列表接口 > 列表接口 > 出现次数 */
function score(ep: ApiEndpoint): number {
  let value = Math.min(ep.hits ?? 0, 5);
  if (ep.isList) value += 10;
  if (ep.calledInContainer) value += 40;
  return value;
}
