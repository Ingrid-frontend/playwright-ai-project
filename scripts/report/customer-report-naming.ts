/**
 * 客户报告展示名清洗。
 *
 * 内部 stepName / 目录名带着实现细节（`-after`、`action-before`、日期目录、
 * `工作台_2026-08-20_19-29-59` 这类运行时间戳），客户读不懂也不该看到。
 * 这里只做展示层转换，不改判定口径。
 */

/** 环境代号 -> 客户可读环境名 */
const ENV_LABELS: Record<string, string> = {
  dev: '开发环境',
  stage: '预发布环境',
  staging: '预发布环境',
  test: '测试环境',
  prod: '生产环境',
  production: '生产环境',
};

/** 纯日期目录段，如 260911 / 2026-09-11 */
function isDateSegment(seg: string): boolean {
  return /^\d{6}$/.test(seg) || /^\d{4}-\d{2}-\d{2}$/.test(seg) || /^\d{8}$/.test(seg);
}

/** 内部编排目录段，客户不需要看到 */
function isInternalSegment(seg: string): boolean {
  return /^(intent|run|optimized|screenshots|baseline)$/i.test(seg);
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
};

/** 去掉尾部运行时间戳：`工作台_2026-08-20_19-29-59` -> `工作台` */
function stripRunTimestamp(seg: string): string {
  return seg
    .replace(/_\d{4}-\d{2}-\d{2}[_-]\d{2}-\d{2}-\d{2}$/, '')
    .replace(/_\d{4}-\d{2}-\d{2}$/, '')
    .replace(/[-_]\d{13}$/, '');
}

/**
 * 把脚本路径转成客户可读的业务流程名。
 * `screenshots/dev/260911/工作台_2026-08-20_19-29-59` -> `开发环境 · 工作台`
 */
export function friendlyScriptLabel(scriptKey: string): string {
  const segs = String(scriptKey || '')
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean);

  let env = '';
  const rest: string[] = [];
  for (const seg of segs) {
    const envHit = ENV_LABELS[seg.toLowerCase()];
    if (envHit) {
      if (!env) env = envHit;
      continue;
    }
    if (isDateSegment(seg) || isInternalSegment(seg)) continue;
    rest.push(stripRunTimestamp(seg));
  }

  const flow = [...new Set(rest)].filter(Boolean).join(' / ');
  if (env && flow) return `${env} · ${flow}`;
  return flow || env || scriptKey;
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
