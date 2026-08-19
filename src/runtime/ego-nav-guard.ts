import type { EgoResolvedOp } from '../ai/prompts/resolve-ego-ops.js';
import { getBaseEnvConfig } from '../utils/env-config.js';
import { extractVisibleTexts, findCandidates, type SnapshotNode } from './ego-snapshot.js';

export const WORKBENCH_HOME_PATH = '/main/home';

/** 系统管理 → 审批流配置页（与待办列表易混淆） */
export function isApprovalFlowAdminPage(snapshot: string): boolean {
  const texts = extractVisibleTexts(snapshot).map((t) => t.toLowerCase().replace(/\s+/g, ''));
  const joined = texts.join('|');
  return joined.includes('审批流') && (joined.includes('批量维护') || joined.includes('流程列表'));
}

export type NavClickKind = 'workbench-top' | 'my-approval';

export function navClickKind(desc: string): NavClickKind | null {
  const d = desc.trim();
  if (!d) return null;
  if (/我的审批/.test(d)) return 'my-approval';
  if (/工作台/.test(d) && (/顶栏|顶部|导航|tab/i.test(d) || /^工作台$/.test(d) || d.includes('顶栏工作台'))) {
    return 'workbench-top';
  }
  return null;
}

export function verifyNavClickOutcome(kind: NavClickKind, snapshot: string): string | null {
  if (isApprovalFlowAdminPage(snapshot)) {
    if (kind === 'workbench-top') {
      return '导航未切换：点击工作台后仍在系统管理审批流配置页';
    }
    return '导航落点错误：仍在系统管理审批流配置页，未到工作台我的审批列表';
  }
  if (isEArchiveModulePage(snapshot)) {
    if (kind === 'workbench-top') {
      return '导航未切换：点击工作台后仍在 e档案 模块';
    }
    return '导航落点错误：仍在 e档案，未到工作台我的审批列表';
  }
  return null;
}

export function resolveNavClickOps(
  nodes: SnapshotNode[],
  desc: string,
  kind: NavClickKind,
): EgoResolvedOp[] | null {
  if (kind === 'workbench-top') {
    const nav = pickWorkbenchTopNav(nodes);
    if (nav) return [{ type: 'click', ref: nav.ref, label: desc }];
    return null;
  }
  const menuitems = nodes.filter((n) => n.role === 'menuitem' && compactText(n.name) === compactText('我的审批'));
  if (menuitems.length === 1) return [{ type: 'click', ref: menuitems[0].ref, label: desc }];
  const picked = pickMenuSearchResult(nodes, '我的审批');
  if (picked) return [{ type: 'click', ref: picked.ref, label: picked.name || '我的审批' }];
  const exact = nodes.filter(
    (n) => compactText(n.name) === compactText('我的审批') && (n.role === 'menuitem' || n.role === 'tab'),
  );
  if (exact.length === 1) return [{ type: 'click', ref: exact[0].ref, label: desc }];
  return null;
}

export function isHuilianyiEnv(env: string): boolean {
  return /huilianyi\.com/i.test(getBaseEnvConfig(env)?.baseURL || '');
}

/** 汇联易根路径会恢复上次模块，工作台入口统一走 /main/home */
export function normalizeHuilianyiEntryPath(env: string, pathOrUrl?: string): string | undefined {
  if (!pathOrUrl || !isHomePath(pathOrUrl)) return pathOrUrl;
  if (!isHuilianyiEnv(env)) return pathOrUrl;
  return WORKBENCH_HOME_PATH;
}

export function pickWorkbenchTopNav(nodes: SnapshotNode[]): SnapshotNode | null {
  const exact = nodes.filter((n) => n.name.trim() === '工作台');
  const topRoles = ['tab', 'anchor', 'link', 'button'];
  const roleHit = exact.filter((n) => topRoles.includes(n.role));
  if (roleHit.length === 1) return roleHit[0];
  for (const role of topRoles) {
    const hits = findCandidates(nodes, '工作台', { roles: [role] });
    if (hits.length === 1) return hits[0];
  }
  return exact.length === 1 ? exact[0] : null;
}

export function pickWorkbenchTopTab(nodes: SnapshotNode[]): SnapshotNode | null {
  return pickWorkbenchTopNav(nodes);
}

function compactText(s: string): string {
  return s.trim().replace(/\s+/g, '');
}

export function extractMenuSearchLabel(desc: string): string | null {
  const d = desc.trim();
  if (!d) return null;
  const m =
    d.match(/菜单(?:搜索)?(?:结果)?(?:项)?(.+)/) ||
    d.match(/侧栏菜单项(.+)/) ||
    d.match(/菜单项(.+)/);
  if (m?.[1]) return m[1].trim();
  if (/我的审批/.test(d)) return '我的审批';
  return null;
}

export function isMenuSearchFill(desc: string): boolean {
  return /菜单搜索|搜索菜单/.test(desc);
}

export function isMenuSearchResultClick(desc: string): boolean {
  return /菜单搜索|搜索结果|搜索菜单|侧栏菜单项|菜单项/.test(desc);
}

/** 侧栏菜单搜索填值后，必须再点 menu/menuitem 才进入列表 */
export function pickMenuSearchResult(nodes: SnapshotNode[], label = '我的审批'): SnapshotNode | null {
  const needle = compactText(label);
  if (!needle) return null;

  const hits = nodes.filter((n) => {
    const name = n.name?.trim();
    if (!name) return false;
    const compact = compactText(name);
    if (compact !== needle) return false;
    return !compact.includes('我的代理');
  });

  const roles = ['menuitem', 'menu', 'anchor', 'link', 'listitem', 'list_item', 'button'];
  for (const role of roles) {
    const roleHits = hits.filter((n) => n.role === role);
    if (roleHits.length === 1) return roleHits[0];
  }
  if (hits.length === 1) return hits[0];

  const fuzzy = nodes.filter((n) => {
    const compact = compactText(n.name || '');
    return compact === needle && !compact.includes('代理');
  });
  if (fuzzy.length === 1) return fuzzy[0];
  return null;
}

export function isEArchiveModulePage(snapshot: string): boolean {
  const joined = snapNorm(snapshot);
  if (!joined) return false;
  if (joined.includes('资料归集') || (joined.includes('新建资料') && joined.includes('加入中转站'))) {
    return true;
  }
  if (
    (joined.includes('e档案') || joined.includes('档案')) &&
    (joined.includes('待补充资料') || joined.includes('快捷入口') || joined.includes('管理员首页'))
  ) {
    return true;
  }
  return false;
}

export function isApplicantSearchFill(desc: string): boolean {
  return /申请人/.test(desc) && !/菜单/.test(desc);
}

export function pickApplicantSearchInput(nodes: SnapshotNode[]): SnapshotNode | null {
  const roles = ['textbox', 'searchbox', 'input', 'combobox'];
  const hits = nodes.filter(
    (n) => roles.includes(n.role) && /申请人/.test(n.name) && !/菜单|搜索菜单/.test(n.name),
  );
  if (hits.length === 1) return hits[0];
  const loose = nodes.filter(
    (n) =>
      roles.includes(n.role) &&
      compactText(n.name).includes(compactText('申请人')) &&
      !/菜单/.test(n.name),
  );
  return loose.length === 1 ? loose[0] : null;
}

export function isListFilterSearchClick(desc: string): boolean {
  return desc.trim() === '搜索';
}

export function pickListFilterSearch(nodes: SnapshotNode[]): SnapshotNode | null {
  const searches = nodes.filter((n) => n.role === 'button' && n.name.trim() === '搜索');
  if (searches.length <= 1) return searches[0] || null;
  const archive = searches.filter((n) => /资料|归档|成册|新建资料/.test(n.raw));
  const list = searches.filter((n) => !/资料|归档|成册|新建资料/.test(n.raw));
  if (list.length === 1) return list[0];
  if (list.length > 0) return list[0];
  return null;
}

export function assertWrongPageForListOps(snapshot: string): string | null {
  if (isEArchiveModulePage(snapshot)) {
    return '当前在 e档案 模块，请先点顶栏「工作台」并进入我的审批列表';
  }
  if (isApprovalFlowAdminPage(snapshot)) {
    return '当前在系统管理审批流配置页，未到我的审批列表';
  }
  return null;
}

export function isHomePath(pathOrUrl?: string): boolean {
  if (!pathOrUrl) return false;
  const raw = pathOrUrl.trim();
  if (raw === '/' || raw === '') return true;
  try {
    const base = raw.startsWith('http') ? undefined : 'https://example.com';
    const u = new URL(raw, base);
    return u.pathname === '/' || u.pathname === '';
  } catch {
    return false;
  }
}

export type HuilianyiPageContext = {
  key: string;
  label: string;
  suggest: string;
};

function snapNorm(snapshot: string): string {
  return extractVisibleTexts(snapshot)
    .map((t) => t.toLowerCase().replace(/\s+/g, ''))
    .join('|');
}

/** 断言失败时识别汇联易常见错页，避免把 e档案按钮当成「可见操作」提示 */
export function detectHuilianyiPageContext(snapshot: string): HuilianyiPageContext | null {
  const joined = snapNorm(snapshot);
  if (!joined) return null;

  if (
    joined.includes('资料归集') ||
    (joined.includes('新建资料') && joined.includes('加入中转站'))
  ) {
    return {
      key: 'e-archive-collect',
      label: 'e档案 · 资料归集',
      suggest: '请先进入工作台 · 我的审批待办列表，而非 e档案',
    };
  }
  if (isApprovalFlowAdminPage(snapshot)) {
    return {
      key: 'approval-flow-admin',
      label: '系统管理 · 审批流配置',
      suggest: '请先进入工作台 · 我的审批待办列表',
    };
  }
  if (joined.includes('e档案') && joined.includes('待补充资料') && joined.includes('快捷入口')) {
    return {
      key: 'e-archive-home',
      label: 'e档案 · 管理员首页',
      suggest: '请先点顶栏「工作台」，再进入我的审批',
    };
  }
  return null;
}
