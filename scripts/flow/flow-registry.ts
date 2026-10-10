/**
 * 流程注册表：全仓库唯一的「新增一个流程要登记什么」清单。
 *
 * 之前新增流程要手工碰 ~10 个点（flow-runner-registry / test-jobs-config / run-*-golden /
 * run-flow-cli / package.json / playwright.config / fixtures / catalog / POM ...），
 * 其中大部分是纯样板。这里把所有「流程级元信息」收敛成一份描述对象，
 * 其余脚本（flow:debug-fast / flow:run / flow:new / job 计数）全部从它派生。
 *
 * 双层注册：RAW 种子（本文件内置，优先）+ config/flows.json（可选外部登记，
 * 文件不存在时行为与只有 RAW 完全一致；id 撞车时 RAW 优先）。
 * 对接新应用/新流程 = config/flows.json 加一条，或 RAW 加一条。
 *
 * 新增流程只需：
 *   1. npm run flow:new -- --id=<flow-id> --label=<中文名> --entry=/main/xxx --domain=<业务域>
 *   2. 填 <flow-id>/utils/<domain>-catalog.ts
 *   3. 写 <flow-id>/tests/<domain>/*.spec.ts
 */
import fs from 'fs';
import path from 'path';

/** 外部流程登记文件（可选）；不存在时注册表只含 RAW 种子 */
export const FLOWS_CONFIG_REL = 'config/flows.json';

export type FlowKind = 'golden-flow' | 'intent-suite';

export type FlowDescriptor = {
  /** flow 目录名 & FlowId，如 request-flow */
  id: string;
  /** 中文名，用于报告 / 飞书通知 */
  label: string;
  /** 业务域目录名：tests/<domain>/、pages/<domain>-list.page.ts */
  domain: string;
  /** 列表页路由，如 /main/request */
  entry: string;
  /** playwright 配置相对路径 */
  configRel: string;
  /** golden 回归 spec（相对 <id>/tests/） */
  goldenSpec: string;
  /** 全流程 spec（相对 <id>/tests/） */
  fullFlowSpec: string;
  /** playwright html 报告目录 */
  reportDir: string;
  /** golden runner 脚本文件名（scripts/flow/ 下）；null 表示未接入 */
  goldenRunner: string | null;
  /** write runner 脚本文件名；null 表示未接入 */
  writeRunner: string | null;
  /** 单号固定值环境变量（golden 用） */
  docNoEnv?: string;
  /** 搜索关键字环境变量（golden 用） */
  keywordEnv?: string;
  /** 默认关键字（golden 兜底） */
  defaultKeyword?: string;
  /** 写操作开关环境变量，如 REQUEST_ENABLE_WRITE */
  writeEnvVar?: string;
  /** golden seeds 数据文件相对路径 */
  seedsRel: string;
  /** 是否支持「待审批页签」这类多页签结构（影响 catalog 生成） */
  tabbed: boolean;
  /**
   * 流程类别：golden-flow = 走流程截图对比/交付链的 Golden 回归；
   * intent-suite = 由 Intent 用例驱动、无独立 runner 的轻量登记。
   * 缺省时按是否有 goldenRunner/writeRunner 推断（内置三条均为 golden-flow）。
   */
  kind?: FlowKind;
  /** 是否纳入全站 Smoke 巡检（轻量登记默认 true） */
  smoke?: boolean;
};

const RAW: FlowDescriptor[] = [
  {
    id: 'request-flow',
    label: '申请单流程',
    domain: 'request',
    entry: '/main/request',
    configRel: 'request-flow/playwright.config.ts',
    goldenSpec: 'request/golden-regression.spec.ts',
    fullFlowSpec: 'request/full-flow.spec.ts',
    reportDir: 'request-flow/playwright-report',
    goldenRunner: 'run-request-flow-golden.ts',
    writeRunner: 'run-request-flow-write.ts',
    docNoEnv: 'REQUEST_DOC_NO',
    keywordEnv: 'REQUEST_FILTER_KEYWORD',
    defaultKeyword: '测试',
    writeEnvVar: 'REQUEST_ENABLE_WRITE',
    seedsRel: 'request-flow/datasource/golden-seeds.json',
    tabbed: false,
    kind: 'golden-flow',
  },
  {
    id: 'approval-flow',
    label: '审批流程',
    domain: 'approval',
    entry: '/main/approve',
    configRel: 'approval-flow/playwright.config.ts',
    goldenSpec: 'approval/golden-regression.spec.ts',
    fullFlowSpec: 'approval/full-flow.spec.ts',
    reportDir: 'approval-flow/playwright-report',
    goldenRunner: 'run-approval-flow-golden.ts',
    writeRunner: 'run-approval-flow-write.ts',
    docNoEnv: 'APPROVAL_DOC_NO',
    keywordEnv: 'APPROVAL_FILTER_KEYWORD',
    defaultKeyword: '',
    writeEnvVar: 'APPROVAL_ENABLE_WRITE',
    seedsRel: 'approval-flow/datasource/golden-seeds.json',
    tabbed: true,
    kind: 'golden-flow',
  },
  {
    id: 'expense-flow',
    label: '报销流程',
    domain: 'expense',
    entry: '/main/expense-parent-report/expense-report',
    configRel: 'expense-flow/playwright.config.ts',
    goldenSpec: 'expense/golden-regression.spec.ts',
    fullFlowSpec: 'expense/full-flow.spec.ts',
    reportDir: 'expense-flow/playwright-report',
    goldenRunner: 'run-expense-flow-golden.ts',
    writeRunner: 'run-expense-flow-write.ts',
    docNoEnv: 'EXPENSE_DOC_NO',
    keywordEnv: 'EXPENSE_FILTER_KEYWORD',
    defaultKeyword: '',
    writeEnvVar: 'EXPENSE_ENABLE_WRITE',
    seedsRel: 'expense-flow/datasource/golden-seeds.json',
    tabbed: false,
    kind: 'golden-flow',
  },
];

/**
 * 外部流程登记（config/flows.json）的最小结构校验：
 * 只收 id/label/domain/entry 均为非空字符串且不含 path 逃逸的条目，其余字段透传。
 * id 与 RAW 撞车时 RAW 优先（内置种子不可被外部覆盖）。
 */
function loadExternalFlows(root: string = process.cwd()): FlowDescriptor[] {
  const abs = path.join(root, FLOWS_CONFIG_REL);
  if (!fs.existsSync(abs)) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(abs, 'utf-8'));
  } catch (err) {
    console.warn(`[flow-registry] 解析 ${FLOWS_CONFIG_REL} 失败，忽略外部流程:`, err instanceof Error ? err.message : err);
    return [];
  }
  const flows = (parsed as { flows?: unknown })?.flows;
  if (!Array.isArray(flows)) return [];
  const out: FlowDescriptor[] = [];
  for (const item of flows) {
    const f = item as Partial<FlowDescriptor>;
    if (
      typeof f.id !== 'string' || !f.id.trim() ||
      typeof f.label !== 'string' || !f.label.trim() ||
      typeof f.domain !== 'string' || !f.domain.trim() ||
      typeof f.entry !== 'string' || !f.entry.trim() ||
      f.id.includes('..') || f.id.includes('/')
    ) {
      console.warn(`[flow-registry] ${FLOWS_CONFIG_REL} 存在无效条目，已跳过:`, f?.id);
      continue;
    }
    out.push({
      ...(f as FlowDescriptor),
      goldenRunner: f.goldenRunner ?? null,
      writeRunner: f.writeRunner ?? null,
    });
  }
  return out;
}

/** kind 缺省推断：有 runner 即 golden-flow，否则视为轻量 intent-suite 登记 */
function normalizeFlow(f: FlowDescriptor): FlowDescriptor {
  if (f.kind) return f;
  return { ...f, kind: f.goldenRunner || f.writeRunner ? 'golden-flow' : 'intent-suite' };
}

/** 内置种子 + 外部登记（RAW 优先）；flows.json 不存在时与历史行为逐字段一致 */
const ALL: FlowDescriptor[] = (() => {
  const external = loadExternalFlows();
  const rawIds = new Set(RAW.map((f) => f.id));
  return [...RAW, ...external.filter((f) => !rawIds.has(f.id))];
})();

/** 流程 ID → 描述对象 */
export const FLOW_REGISTRY: Record<string, FlowDescriptor> = Object.fromEntries(
  ALL.map((f) => [f.id, normalizeFlow(f)]),
);

export function listFlows(): FlowDescriptor[] {
  return [...ALL];
}

export function listFlowIds(): string[] {
  return RAW.map((f) => f.id);
}

export function getFlow(id: string): FlowDescriptor | undefined {
  return FLOW_REGISTRY[id];
}

export function requireFlow(id: string): FlowDescriptor {
  const flow = FLOW_REGISTRY[id];
  if (!flow) {
    throw new Error(`未知流程「${id}」。已注册：${listFlowIds().join(' / ')}`);
  }
  return flow;
}

export function isKnownFlow(id: string): boolean {
  return id in FLOW_REGISTRY;
}

/** 报告用元信息，替代 run-flow-cli 里手写的 FLOW_META */
export function flowMeta(id: string): { configRel: string; label: string; reportDir: string } {
  const f = requireFlow(id);
  return { configRel: f.configRel, label: f.label, reportDir: f.reportDir };
}

/** runner key → 脚本名。runner key 形如 request-flow-golden / request-flow-write */
export function runnerKey(kind: 'golden' | 'write', id: string): string {
  return `${id}-${kind}`;
}

export function buildRunnerScripts(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of RAW) {
    if (f.goldenRunner) out[runnerKey('golden', f.id)] = f.goldenRunner;
    if (f.writeRunner) out[runnerKey('write', f.id)] = f.writeRunner;
  }
  return out;
}

export function buildRunnerLabels(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of RAW) {
    if (f.goldenRunner) out[runnerKey('golden', f.id)] = `${f.label} Golden`;
    if (f.writeRunner) out[runnerKey('write', f.id)] = `${f.label} Write`;
  }
  return out;
}

/** 断言 <id>/playwright.config.ts 存在 */
export function flowDir(id: string): string {
  return requireFlow(id).id;
}

/** page-catalog 页面的最小形状（与 datasource/page-catalog.json 对齐，避免反向依赖 smoke-checks） */
export type CatalogPageLite = {
  id: string;
  label?: string;
  route: string;
  goldenFlowId?: string;
  smoke?: { enabled?: boolean; weight?: 'core' | 'normal' | string };
};

/**
 * 从 page-catalog 派生轻量 intent-suite 流程登记：
 *   smoke.weight=core + 已有 stable 用例覆盖（isStableCovered）+ 入口未被现有流程占用 + 未登记 goldenFlowId。
 * 产物 FlowDescriptor 不带任何 runner（goldenRunner/writeRunner=null），
 * 不会进入 flow runner job 链，仅供 flow:list / 报告元信息 / 后续晋升参考。
 */
export function deriveIntentSuiteFlows(
  catalog: CatalogPageLite[],
  isStableCovered: (pageId: string) => boolean,
): FlowDescriptor[] {
  const existing = listFlows();
  const covered = (route: string) =>
    existing.some((f) => f.entry === route || route.startsWith(`${f.entry}/`));
  const out: FlowDescriptor[] = [];
  for (const page of catalog) {
    if (page.smoke?.enabled === false) continue;
    if (page.smoke?.weight !== 'core') continue;
    if (page.goldenFlowId) continue;
    if (!isStableCovered(page.id)) continue;
    if (covered(page.route)) continue;
    if (out.some((f) => f.entry === page.route)) continue;
    out.push({
      id: `${page.id}-intent-suite`,
      label: page.label || page.id,
      domain: page.id,
      entry: page.route,
      configRel: '',
      goldenSpec: '',
      fullFlowSpec: '',
      reportDir: `results/intent-runs/${page.id}`,
      goldenRunner: null,
      writeRunner: null,
      seedsRel: '',
      tabbed: false,
      kind: 'intent-suite',
      smoke: true,
    });
  }
  return out;
}
