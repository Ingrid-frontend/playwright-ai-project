const SEVERITY_LABELS: Record<string, string> = {
  blocker: '阻断',
  warning: '警告',
  noise: '噪声',
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

export const BITABLE_SEVERITY_OPTIONS = [{ name: '阻断' }, { name: '警告' }, { name: '噪声' }];
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
