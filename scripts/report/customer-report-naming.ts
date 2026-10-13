import {
  envIdSortKey as profileEnvSortKey,
  envLabelFromProfile,
  isKnownEnvProfile,
  loadEnvProfiles,
} from '../../src/utils/env-profile.js';

/**
 * 客户报告展示名清洗。
 *
 * 内部 stepName / 目录名带着实现细节（`-after`、`action-before`、日期目录、
 * `工作台_2026-08-20_19-29-59` 这类运行时间戳），客户读不懂也不该看到。
 * 这里只做展示层转换，不改判定口径。
 */

const LEGACY_ENV_LABELS: Record<string, string> = {
  staging: '预发布环境',
  test: '测试环境',
  prod: '生产环境',
  production: '生产环境',
};

function envLabelForSegment(seg: string): string | undefined {
  const key = seg.toLowerCase();
  if (isKnownEnvProfile(key)) return envLabelFromProfile(key);
  const legacy = LEGACY_ENV_LABELS[key];
  if (legacy) return legacy;
  const stageNum = /^stage(\d+)$/i.exec(key);
  if (stageNum) return `Stage${stageNum[1]}环境`;
  return undefined;
}

/** 纯日期目录段，如 260911 / 2026-09-11 */
function isDateSegment(seg: string): boolean {
  return /^\d{6}$/.test(seg) || /^\d{4}-\d{2}-\d{2}$/.test(seg) || /^\d{8}$/.test(seg);
}

/** 内部编排目录段，客户不需要看到 */
function isInternalSegment(seg: string): boolean {
  return /^(intent|run|optimized|screenshots|baseline|flows|golden-regression|by-account|golden-set)$/i.test(
    seg,
  );
}

function isEnvSegment(seg: string): boolean {
  return isKnownEnvProfile(seg) || Boolean(envLabelForSegment(seg));
}

/**
 * 内部步骤 slug -> 客户可读页面名。
 * 这些名字来自录制脚本的选择器/动作命名，客户看到 `entry-goto`、`approval-list`
 * 只会困惑，所以在展示层统一翻译。
 */
const STEP_SLUG_LABELS: Record<string, string> = {
  'entry-goto': '进入入口页',
  goto: '进入页面',
  entry: '入口页',
  login: '登录页',
  home: '首页',
  dashboard: '工作台',
  'approval-list': '审批列表',
  'approval-tabs': '审批列表页签',
  'approval-detail': '审批详情',
  'approval-after-row-click': '点击列表行后',
  'approval-first-row': '审批列表首行',
  'approval-filter': '审批筛选',
  'approval-approve': '审批通过',
  'approval-reject': '审批驳回',
  'request-list': '申请单列表',
  'request-search': '申请单搜索',
  'request-filter': '申请单筛选',
  'request-detail': '申请单详情',
  'request-submit': '申请单提交',
  'full-flow': '全流程',
  'travel-submit': '差旅申请提交',
  'travel-approve': '差旅审批通过',
  'travel-reject': '差旅审批驳回',
  'travel-submit-reject': '差旅申请驳回',
  'golden-regression': 'Golden 回归',
  'my-approval': '我的审批',
  'approval-history': '审批历史',
  'expense-list': '报销列表',
  'expense-detail': '报销详情',
  'expense-filter': '报销筛选',
  'expense-submit': '报销提交',
  'admin': '管理员页面',
};

/** 去掉尾部运行时间戳：`工作台_2026-08-20_19-29-59` -> `工作台` */
function stripRunTimestamp(seg: string): string {
  return seg
    .replace(/_\d{4}-\d{2}-\d{2}[_-]\d{2}-\d{2}-\d{2}$/, '')
    .replace(/_\d{4}-\d{2}-\d{2}$/, '')
    .replace(/[-_]\d{13}$/, '');
}

const FLOW_SLUG_LABELS: Record<string, string> = {
  'request-flow': '申请单流程',
  'approval-flow': '审批流程',
  'expense-flow': '报销流程',
};

/**
 * `by-account/<slug>` 里的 slug 就是本次登录账号（手机号或邮箱转成的路径名）。
 * 流程名不带它；验收明细用单独一列区分同一流程下的不同账号。
 */
export function extractLoginAccount(scriptKey: string): string {
  const segs = String(scriptKey || '')
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean);
  const idx = segs.findIndex((s) => s.toLowerCase() === 'by-account');
  if (idx < 0) return '';
  return segs[idx + 1] || '';
}

/**
 * 把脚本路径转成客户可读的业务流程名。
 * `flows/request-flow/dev/golden-regression/by-account/menma_comic_com` -> `DEV环境 · 申请单流程`
 * 登录账号不进流程名，由 extractLoginAccount 单独取出。
 */
export function friendlyScriptLabel(scriptKey: string): string {
  const segs = String(scriptKey || '')
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean);

  let flowName = '';
  for (const seg of segs) {
    if (FLOW_SLUG_LABELS[seg]) {
      flowName = FLOW_SLUG_LABELS[seg];
      break;
    }
  }

  let envId = '';
  const rest: string[] = [];
  let prev = '';
  for (const seg of segs) {
    // 账号目录段不拼进流程名，单独进「登录账号」列
    if (prev.toLowerCase() === 'by-account') {
      prev = seg;
      continue;
    }
    if (isEnvSegment(seg)) {
      if (!envId) envId = seg.toLowerCase();
      prev = seg;
      continue;
    }
    if (isDateSegment(seg) || isInternalSegment(seg)) {
      prev = seg;
      continue;
    }
    if (FLOW_SLUG_LABELS[seg]) {
      prev = seg;
      continue;
    }
    rest.push(stripRunTimestamp(seg));
    prev = seg;
  }

  const identity = [...new Set(rest)].filter(Boolean).pop() || '';
  const envLabel = envId ? envLabelForSegment(envId) || envId : '';
  const parts = [envLabel, flowName, identity].filter(Boolean);
  if (parts.length) return parts.join(' · ');
  return scriptKey;
}

/** 技术附录环境分组顺序（来自 config/env-profiles.json） */
export const RUN_HISTORY_ENV_ORDER = loadEnvProfiles().runHistoryOrder;

/** 从 scriptKey 提取环境段，如 flows/request-flow/dev/... -> dev */
export function extractEnvId(scriptKey: string): string {
  for (const seg of String(scriptKey || '').split('/')) {
    if (isEnvSegment(seg)) return seg.toLowerCase();
  }
  return '';
}

export function envIdSortKey(envId: string): number {
  return profileEnvSortKey(envId);
}

export function envLabelFromId(envId: string): string {
  if (!envId) return '';
  return envLabelForSegment(envId) || envLabelFromProfile(envId) || envId;
}

/** 从 scriptKeys 收集去重环境段，按 RUN_HISTORY_ENV_ORDER 排序 */
export function collectEnvIds(scriptKeys: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const key of scriptKeys) {
    const id = extractEnvId(key);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  out.sort((a, b) => envIdSortKey(a) - envIdSortKey(b));
  return out;
}

/** 从脚本路径提取全部环境名，用于报告头展示 */
export function extractEnvLabel(scriptKeys: string[]): string {
  return collectEnvIds(scriptKeys)
    .map((id) => envLabelFromId(id))
    .filter(Boolean)
    .join('、');
}

/**
 * 技术标识符 → 业务名称映射。
 * AI 审计描述里的 CSS 选择器/元素 ID 客户看不懂，需要翻译成业务语言。
 */
const TECH_IDENTIFIER_LABELS: Record<string, string> = {
  'request-filter-panel': '筛选面板',
  'request-list-root': '列表容器',
  'request-list-table': '列表表格',
  'request-detail-root': '详情容器',
  'approval-list-root': '审批列表',
  'approval-filter-panel': '审批筛选面板',
};

/** 把审计描述里的技术标识符替换成业务名称 */
export function translateAuditDescription(description: string): string {
  let result = description;
  for (const [tech, business] of Object.entries(TECH_IDENTIFIER_LABELS)) {
    result = result.replace(new RegExp(tech, 'g'), business);
  }
  return result;
}

/**
 * 差异区在页面上的方位描述，如「页面上部右侧」。
 * 判定理由与页面文案共用，保证客户看到的措辞一致。
 */
export function regionZoneLabel(
  r: { x: number; y: number; w: number; h: number },
  width?: number,
  height?: number,
): string {
  if (!width || !height || width <= 0 || height <= 0) return '页面局部';
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const v = cy < height / 3 ? '上部' : cy > (height * 2) / 3 ? '下部' : '中部';
  const h = cx < width / 3 ? '左侧' : cx > (width * 2) / 3 ? '右侧' : '中央';
  if (v === '中部' && h === '中央') return '页面中部';
  return `页面${v}${h === '中央' ? '' : h}`;
}

/**
 * 把 stepName 转成客户可读的页面/动作名。
 * `DEV管理员-after` -> `DEV管理员`，`返-回-after` -> `返回`，
 * `action-before` -> `操作前页面`，`导航到页面` 原样保留。
 */
export function friendlyStepLabel(stepName: string): string {
  let s = String(stepName || '').trim();
  if (!s) return '页面';

  // 只取 __ 之前的语义段
  const sep = s.indexOf('__');
  if (sep > 0) s = s.slice(0, sep);

  const isBefore = /-before$/i.test(s);
  const isSkipped = /-skipped$/i.test(s);
  s = s.replace(/-(after|before|skipped)$/i, '');

  // `返-回` 这类被分词连字符切碎的中文名，去掉中文之间的连字符
  s = s.replace(/(?<=[\u4e00-\u9fa5])-(?=[\u4e00-\u9fa5])/g, '');

  if (/^action$/i.test(s)) s = '操作';
  // 纯英文 slug 走词典；`step-3` 这类无语义编号回落成「第 N 步页面」
  const slug = STEP_SLUG_LABELS[s.toLowerCase()];
  if (slug) s = slug;
  else {
    const stepNo = /^step[-_]?(\d+)$/i.exec(s);
    if (stepNo) s = `第 ${Number(stepNo[1])} 步页面`;
  }
  if (!s) s = '页面';

  if (isBefore) return `${s}（操作前）`;
  if (isSkipped) return `${s}（未执行）`;
  return s;
}
