/**
 * 流程注册表：全仓库唯一的「新增一个流程要登记什么」清单。
 *
 * 之前新增流程要手工碰 ~10 个点（flow-runner-registry / test-jobs-config / run-*-golden /
 * run-flow-cli / package.json / playwright.config / fixtures / catalog / POM ...），
 * 其中大部分是纯样板。这里把所有「流程级元信息」收敛成一份描述对象，
 * 其余脚本（flow:debug-fast / flow:run / flow:new / job 计数）全部从它派生。
 *
 * 新增流程只需：
 *   1. npm run flow:new -- --id=<flow-id> --label=<中文名> --entry=/main/xxx --domain=<业务域>
 *   2. 填 <flow-id>/utils/<domain>-catalog.ts
 *   3. 写 <flow-id>/tests/<domain>/*.spec.ts
 */
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
  },
];

/** 流程 ID → 描述对象 */
export const FLOW_REGISTRY: Record<string, FlowDescriptor> = Object.fromEntries(
  RAW.map((f) => [f.id, f]),
);

export function listFlows(): FlowDescriptor[] {
  return [...RAW];
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
