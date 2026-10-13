const SEVERITY_LABELS: Record<string, string> = {
  blocker: '阻断',
  warning: '警告',
  noise: '噪声',
  info: '信息',
};

const COMPARE_KIND_LABELS: Record<string, string> = {
  golden: 'Golden基线',
  structure: '结构对比',
  'last-green': 'LastGreen',
  'cross-browser': '跨浏览器',
  'run-drift': '运行漂移',
};

const STATUS_LABELS: Record<string, string> = {
  success: '成功',
  failed: '失败',
  aborted: '中断',
  skipped: '跳过',
};

const FLOW_LABELS: Record<string, string> = {
  'approval-flow': '审批',
  'request-flow': '申请单',
  approval: '审批',
  request: '申请单',
};

export const BITABLE_SEVERITY_OPTIONS = [{ name: '阻断' }, { name: '警告' }, { name: '噪声' }, { name: '信息' }];
export const BITABLE_COMPARE_KIND_OPTIONS = [
  { name: 'Golden基线' },
  { name: '结构对比' },
  { name: 'LastGreen' },
  { name: '跨浏览器' },
  { name: '运行漂移' },
];
export const BITABLE_STATUS_OPTIONS = [
  { name: '成功' },
  { name: '失败' },
  { name: '中断' },
  { name: '跳过' },
];

/**
 * UI 验收明细/汇总表单选选项。color 为飞书色板索引（0-54），
 * 按语义取基础色系（红/黄/绿/灰），具体色相可在飞书 UI 微调。
 */
export const DELIVERY_VERDICT_OPTIONS = [
  { name: '需要修复', color: 0 },
  { name: '无需处理', color: 7 },
  { name: '完全一致', color: 3 },
  { name: '待建基线', color: 2 },
];
export const DELIVERY_BROWSER_OPTIONS = [
  { name: 'Chrome', color: 4 },
  { name: 'WebKit', color: 5 },
  { name: 'Firefox', color: 6 },
];
/** 与 src/utils/env-profile.ts 的 profiles label 对齐；未知环境值写入时飞书自动加选项 */
export const DELIVERY_ENV_OPTIONS = [
  { name: 'DEV环境' },
  { name: 'UAT环境' },
  { name: 'Stage9084环境' },
  { name: '预发布环境' },
];
/** 兜底迭代（与 bitable-schema.ts DEFAULT_DELIVERY_ITERATION 保持一致） */
export const DELIVERY_ITERATION_OPTIONS = [{ name: '261016' }];
export const DELIVERY_SHIP_ADVICE_OPTIONS = [
  { name: '可以发版', color: 3 },
  { name: '需确认差异', color: 2 },
  { name: '建议修复', color: 0 },
  { name: '待补基线', color: 7 },
];

const SHIP_ADVICE_LABELS: Record<string, string> = {
  ship: '可以发版',
  confirm: '需确认差异',
  fix: '建议修复',
  baseline: '待补基线',
};

/** ShipAdvice 枚举 → 汇总表「发布建议」单选值；未知值不写该列 */
export function formatShipAdviceLabel(value?: string | null): string {
  if (!value) return '';
  return SHIP_ADVICE_LABELS[value] ?? '';
}

export function formatSeverityLabel(value?: string | null): string {
  if (!value) return '';
  return SEVERITY_LABELS[value] ?? value;
}

export function formatCompareKindLabel(value?: string | null): string {
  if (!value) return '';
  return COMPARE_KIND_LABELS[value] ?? value;
}

export function formatStatusLabel(value?: string | null): string {
  if (!value) return '';
  return STATUS_LABELS[value] ?? value;
}

export function formatScriptLabel(scriptKey?: string | null): string {
  if (!scriptKey) return '';
  const parts = scriptKey.replace(/\\/g, '/').split('/').filter(Boolean);
  const flowRaw = parts.find((item) => item.endsWith('-flow')) || parts[0] || '';
  const flow = FLOW_LABELS[flowRaw] || flowRaw.replace(/-flow$/, '');
  const spec = parts.find((item) => /golden|full-flow|travel|approve/i.test(item)) || parts[2] || '';
  const specShort = spec
    .replace(/-regression$/, '')
    .replace(/-submit$/, '')
    .replace(/^golden$/, 'golden');
  const account = parts[parts.length - 1]?.replace(/_comic_com$/, '').replace(/_/g, '') || '';
  return [flow, specShort, account].filter(Boolean).join(' · ');
}
