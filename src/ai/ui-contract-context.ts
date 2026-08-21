/**
 * 从 datasource/ui-contract.json（全量，本地）或 ui-contract.seed.json 取出与目标路由相关的一小段，
 * 渲染成可注入生成 prompt 的「UI 契约」文本。
 *
 * 设计前提：契约是高置信提示，不是唯一真相。
 * 不把整仓源码塞进上下文，只给当前路由的锚点 / 接口 / iframe 事实，
 * 并要求模型不得发明契约外的 testid。
 */
import fs from 'fs';
import path from 'path';

type Anchor = {
  i18nKey: string;
  text: string;
  matchText: string;
  role: string;
  dynamic: boolean;
  localized?: Record<string, string>;
};

type RouteContract = {
  key: string;
  url: string;
  containerPath?: string;
  inIframe: boolean;
  iframeReason: string;
  antdComponents: string[];
  indirectAntdComponents?: string[];
  virtualized?: boolean;
  anchors: Anchor[];
  endpoints: {
    method: string;
    path: string;
    glob: string;
    fn?: string;
    isList?: boolean;
    calledInContainer?: boolean;
  }[];
};

type UiContract = {
  uiLibrary: { name: string; version: string };
  mainShellInIframe: boolean;
  loginInIframe: boolean;
  i18n: { primaryLocale: string; availableLocales: string[]; note: string };
  routes: RouteContract[];
};

const CONTRACT_PATHS = ['datasource/ui-contract.json', 'datasource/ui-contract.seed.json'];

let cached: UiContract | null | undefined;

function loadContract(): UiContract | null {
  if (cached !== undefined) return cached;
  for (const rel of CONTRACT_PATHS) {
    const abs = path.resolve(rel);
    if (!fs.existsSync(abs)) continue;
    try {
      cached = JSON.parse(fs.readFileSync(abs, 'utf8')) as UiContract;
      return cached;
    } catch {
      continue;
    }
  }
  cached = null;
  return cached;
}

/** 用入口路径挑最匹配的路由：优先精确命中，其次最长前缀 */
function pickRoute(contract: UiContract, entry: string): RouteContract | null {
  const normalized = entry.split('?')[0].replace(/\/+$/, '') || '/';

  const exact = contract.routes.find((r) => r.url === normalized);
  if (exact) return exact;

  // /login 等登录变体统一落到索引里的 '/' 条目
  if (/^\/login/.test(normalized)) {
    return contract.routes.find((r) => r.key === 'login') ?? null;
  }

  const prefixed = contract.routes
    .filter((r) => !r.url.includes(':') && normalized.startsWith(r.url))
    .sort((a, b) => b.url.length - a.url.length);
  return prefixed[0] ?? null;
}

/** antd v3 的 role 语义缺口，需要显式告知模型 */
function anchorNote(a: Anchor): string {
  if (a.dynamic) return '含占位符，用前缀正则匹配';
  // 实测 /main/approve：页签渲染为 `待审批-全部 (1)`，exact 匹配必然失败
  if (a.role === 'tab') return '运行时会追加计数，禁止 exact，用子串匹配';
  if (a.role === 'column') return '列头含排序/筛选图标，用子串匹配';
  return '可子串匹配，整格文本一致时才可用 exact';
}

function antdV3Notes(route: RouteContract, version: string): string[] {
  if (!/^\^?3\./.test(version)) return [];
  // 直接 import 与经封装间接使用一并计入：该仓库表格有四层封装
  const components = new Set([
    ...route.antdComponents,
    ...(route.indirectAntdComponents ?? []),
  ]);
  const notes: string[] = [];
  if (components.has('Table')) {
    notes.push(
      'antd v3 的 Table 不输出 role="row"/"cell"：禁止用 getByRole(\'row\')/getByRole(\'cell\') 定位数据行，改用行内业务文案或 .ant-table-tbody tr 配合可见性过滤。',
    );
  }
  if (route.virtualized) {
    notes.push(
      '该页表格走虚拟滚动：DOM 里只有视口内的行，禁止用总行数做断言，也不要假设第 N 行一定在 DOM 中；需要某行时先滚动到可见。',
    );
  }
  if (components.has('Select')) {
    notes.push(
      'antd v3 的 Select 不是原生 <select>：禁止 selectOption()，需先点击 .ant-select 再点下拉项文案（下拉挂在 body 上，用 page 级定位）。',
    );
  }
  if (components.has('Modal')) {
    notes.push('antd v3 的 Modal 渲染在 body 末尾，定位弹窗内容用 page 级 .ant-modal 作用域，不要在原容器内找。');
  }
  if (components.has('Tooltip') || components.has('Popover')) {
    notes.push('Tooltip/Popover 内容挂在 body：hover 后在 page 级找，不在触发元素内部。');
  }
  return notes;
}

export type UiContractContext = {
  /** 注入 prompt 的文本，空串表示无可用契约 */
  text: string;
  /** 命中的路由，供调用方记录 */
  route: RouteContract | null;
};

export function buildUiContractContext(entry?: string): UiContractContext {
  const contract = loadContract();
  if (!contract || !entry) return { text: '', route: null };

  const route = pickRoute(contract, entry);
  if (!route) return { text: '', route: null };

  const lines: string[] = ['## UI 契约（由前端源码静态索引生成，可信度高于经验猜测）', ''];

  lines.push(`- 组件库：${contract.uiLibrary.name}@${contract.uiLibrary.version}`);
  lines.push(`- 目标路由：${route.url}${route.containerPath ? `（${route.containerPath}）` : ''}`);

  if (route.inIframe) {
    lines.push(`- **该页面内容在 iframe 内**：${route.iframeReason}。必须用 frameLocator 定位。`);
  } else {
    lines.push(
      `- **该页面内容不在 iframe 内**：${route.iframeReason}。禁止使用 frameLocator / 双路径 fallback，直接用 page 定位。`,
    );
  }

  const notes = antdV3Notes(route, contract.uiLibrary.version);
  if (notes.length) {
    lines.push('', '### 组件库定位约束');
    for (const note of notes) lines.push(`- ${note}`);
  }

  if (route.endpoints.length) {
    lines.push('', '### 该页关键接口（用于精确等待，替代 networkidle）');
    for (const ep of route.endpoints.slice(0, 8)) {
      const tags = [
        ep.fn ? `来自 ${ep.fn}()` : '',
        ep.isList && ep.calledInContainer ? '**列表主数据源**' : '',
      ]
        .filter(Boolean)
        .join('，');
      lines.push(`- ${ep.method.toUpperCase()} ${ep.glob}${tags ? ` — ${tags}` : ''}`);
    }
    lines.push(
      '等待列表数据时只用标注了「列表主数据源」的那条；其余是操作类接口，等它们会直接超时。',
      '路径相近不代表语义相同（例：/api/approvals/pending 是「单据暂挂」，不是待审批列表），必须按标注选择，不要凭 URL 猜。',
      '该接口可能在脚本开始前就已返回，waitForResponse 必须挂 .catch() 兜底，再用 expect.poll 校验 UI。',
      '优先用 page.waitForResponse(<glob>) 或 expect.poll，不要用 waitForLoadState(\'networkidle\')。',
    );
  }

  if (route.anchors.length) {
    lines.push('', '### 可用定位锚点（只能使用下表文案，不得自行编造 testid 或文案）');
    lines.push('| i18n key | 中文文案 | 角色 | 备注 |');
    lines.push('| --- | --- | --- | --- |');
    for (const a of route.anchors.slice(0, 24)) {
      lines.push(`| ${a.i18nKey} | ${a.matchText} | ${a.role} | ${anchorNote(a)} |`);
    }
    lines.push(
      '',
      '注意：表格列头与页签文案在运行时常被拼接（如页签会追加计数 " (3)"、列头带排序图标），',
      '因此默认用子串匹配（getByText(文案) 不加 exact），只有确认整格文本就是该文案时才用 exact: true。',
    );
  }

  lines.push('', `> 语言提示：${contract.i18n.note}`);
  lines.push(
    '> 契约中的文案若在运行时找不到，允许回退到语义等价的可见文案，但不得凭空构造选择器。',
  );

  return { text: lines.join('\n'), route };
}
