#!/usr/bin/env tsx
/**
 * 把 probe-live-page 的实机快照转成 catalog 草稿。
 *
 * 之前新增流程要人工做这几件事：开浏览器 → F12 抠选择器 → 猜接口名 →
 * 抄表头文案 → 写进 <domain>-catalog.ts。全靠肉眼，最容易出错也最慢。
 * 现在探活一次就能生成草稿，人只 review 差异。
 *
 * 用法：
 *   # 1. 探活（未登录会提示先跑 login）
 *   npx tsx scripts/index-frontend/probe-live-page.ts --env=dev --entry=/main/expense-parent-report/expense-report \
 *     --out=expense-flow/datasource/live-snapshot.json
 *   # 2. 生成 catalog 草稿
 *   npm run flow:gen-catalog -- --flow=expense-flow
 *   # 或直接指定输入输出
 *   npm run flow:gen-catalog -- --snapshot=<path> --domain=expense --out=<path>
 *
 * 产物是「草稿」不是「成品」：正则/文案类字段会带 TODO 注释，必须人工确认。
 */
import fs from 'fs';
import path from 'path';
import { getFlow } from './flow-registry.js';

export type ProbeInput = {
  placeholder: string;
  className: string;
  visible: boolean;
};

export type ProbeDom = {
  url?: string;
  tabs?: string[];
  radios?: string[];
  headers?: string[];
  tbodyRows?: number;
  hasAntTable?: boolean;
  searchInputs?: ProbeInput[];
  firstRowText?: string;
  firstRowButtons?: string[];
  tableClasses?: string[];
  iframeSrcs?: string[];
  bodySnippet?: string;
  childFrames?: ProbeDom[];
};

export type ProbeSnapshot = {
  env?: string;
  entry?: string;
  loginRedirect?: boolean;
  list?: ProbeDom;
  detail?: ProbeDom | null;
  listApis?: Array<{ method: string; status: number; url: string; sample: unknown[] }>;
  listApiCandidates?: Array<{ method: string; url: string; rows: number }>;
  apiCalls?: string[];
  capturedAt?: string;
};

/** 从快照里挑「真正有业务内容」的那一层：主文档常是空壳，内容在 zoom iframe */
export function pickBizDom(snapshot: ProbeSnapshot): ProbeDom {
  const list = snapshot.list || {};
  const candidates: ProbeDom[] = [list, ...(list.childFrames || [])];
  let best = list;
  let bestScore = -1;
  for (const dom of candidates) {
    const score =
      (dom.headers?.length || 0) * 3 +
      (dom.tbodyRows || 0) +
      (dom.tabs?.length || 0) * 2 +
      (dom.searchInputs?.length || 0) * 2 +
      (dom.hasAntTable ? 5 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = dom;
    }
  }
  return best;
}

/** 页签文案会带运行时计数「待审批 (3)」，取名时去掉 */
export function cleanTabLabel(raw: string): string {
  return raw
    .replace(/[（(]\s*\d+\s*[)）]\s*$/, '')
    .replace(/\s+/g, '')
    .trim();
}

/** 从表头里猜单号列 */
export function guessDocNoColumn(headers: string[]): string {
  const exact = headers.find((h) => /^(单号|单据编号|申请单号|业务单号|编号)$/.test(h.trim()));
  if (exact) return exact.trim();
  const fuzzy = headers.find((h) => /单号|编号|Code|code/.test(h));
  return (fuzzy || headers[0] || '单号').trim();
}

/** 从首行文本里推单号正则（如 CLQ2026090200123 → /\b[A-Z]{2,4}\d{8,}\b/） */
export function guessDocNoRegex(firstRowText: string): { source: string; sample: string } {
  const m = firstRowText.match(/\b([A-Z]{2,6})(\d{8,})\b/);
  if (m) {
    return {
      source: `\\b[A-Z]{${m[1].length},${Math.max(m[1].length + 2, 6)}}\\d{${m[2].length - 2},}\\b`,
      sample: m[0],
    };
  }
  const plain = firstRowText.match(/\b[A-Z0-9]{10,}\b/);
  if (plain) {
    return { source: '\\b[A-Z0-9]{10,}\\b', sample: plain[0] };
  }
  return { source: '\\b[A-Za-z0-9]{8,}\\b', sample: '' };
}

/** 挑顶部关键字搜索框的 placeholder */
export function guessSearchPlaceholder(inputs: ProbeInput[]): string {
  const scored = inputs
    .filter((i) => i.placeholder)
    .map((i) => ({
      ph: i.placeholder,
      score:
        (/单号|编号/.test(i.placeholder) ? 3 : 0) +
        (/事由|申请人|摘要/.test(i.placeholder) ? 2 : 0) +
        (/搜索|查询|请输入/.test(i.placeholder) ? 1 : 0) +
        (i.placeholder.includes('/') ? 2 : 0),
    }))
    .sort((a, b) => b.score - a.score);
  return scored[0]?.ph || '请输入';
}

/** 表格容器类名：优先 .ant-table，否则取快照里出现的自定义 table 类 */
export function guessTableSelector(dom: ProbeDom): string {
  if (dom.hasAntTable) return '.ant-table';
  const custom = (dom.tableClasses || [])
    .flatMap((cls) => cls.split(/\s+/))
    .filter((c) => /table|list|grid/i.test(c) && !/^ant-table-(cell|row|thead|tbody)/.test(c));
  return custom.length ? `.${custom[0]}` : '.ant-table';
}

/** 列表接口：优先命中的 listApis，其次候选，最后留 TODO */
export function guessListApi(snapshot: ProbeSnapshot): { api: string; confident: boolean } {
  const hit = snapshot.listApis?.[0]?.url;
  if (hit) return { api: hit.split('?')[0], confident: true };
  const cand = (snapshot.listApiCandidates || []).sort((a, b) => b.rows - a.rows)[0];
  if (cand) return { api: cand.url, confident: false };
  return { api: '/api/TODO/search', confident: false };
}

/** 推断 GenericListPage 加载行为（对齐申请单 advanced-table） */
export function guessListLoadOpts(dom: ProbeDom): {
  clickSearchOnLoad: boolean;
  resetFiltersOnLoad: boolean;
  recoverEmptyOnLoad: boolean;
} {
  const snippet = dom.bodySnippet || '';
  const clickSearch =
    /点击右上角【搜索】后查看/.test(snippet) ||
    ((dom.tbodyRows || 0) === 0 && Boolean(dom.hasAntTable));
  return {
    clickSearchOnLoad: clickSearch,
    resetFiltersOnLoad: true,
    recoverEmptyOnLoad: true,
  };
}

export type CatalogDraft = {
  code: string;
  warnings: string[];
};

const TODO = '// TODO(review)';

/** 登录页特征：探活时未带有效 storageState 就会拿到这些文案 */
const LOGIN_MARKERS = /二维码登录|账号登录|请使用.*APP扫码/;

/**
 * 判定快照是否其实是登录页。
 * probe 的 loginRedirect 只看 URL 与主文档，iframe 里渲染登录页时会漏判，
 * 这里再按「页签/正文文案」兜一层——否则会生成一份把「账号登录」当页签的假 catalog。
 */
export function looksLikeLoginSnapshot(snapshot: ProbeSnapshot): boolean {
  if (snapshot.loginRedirect) return true;
  const doms: ProbeDom[] = [snapshot.list || {}, ...((snapshot.list?.childFrames as ProbeDom[]) || [])];
  for (const dom of doms) {
    const texts = [...(dom.tabs || []), ...(dom.radios || []), dom.bodySnippet || ''].join(' ');
    if (LOGIN_MARKERS.test(texts)) return true;
  }
  return false;
}


function q(s: string): string {
  return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function arr(items: string[]): string {
  if (!items.length) return '[]';
  return `[\n${items.map((i) => `  ${q(i)},`).join('\n')}\n]`;
}

/** 生成 <domain>-catalog.ts 源码草稿 */
export function buildCatalogCode(opts: {
  snapshot: ProbeSnapshot;
  /** 业务域。本函数不用它（输出文件名由 CLI 层决定），保留在签名里是为了调用方按名传参更清晰 */
  domain: string;
  label: string;
  entry: string;
  /** 注册表里该流程是否声明有页签；用于在「声明有但没探到」时报 TODO */
  tabbed?: boolean;
}): CatalogDraft {
  const { snapshot, label, entry } = opts;
  const tabbedHint = Boolean(opts.tabbed);
  const warnings: string[] = [];
  const dom = pickBizDom(snapshot);

  const isLogin = looksLikeLoginSnapshot(snapshot);
  if (isLogin) {
    warnings.push(
      '快照其实是登录页（探活时没有有效 storageState），字段基本都是空的或错的。' +
        '先跑登录生成 storageState，再重新探活。',
    );
  }
  const headers = (dom.headers || []).map((h) => h.replace(/\s+/g, '').trim()).filter((h) => h && h !== '+');
  if (!headers.length) warnings.push('未探到任何表头，COLUMNS 为空，需人工补。');

  const tabsRaw = (dom.tabs || []).length ? dom.tabs || [] : dom.radios || [];
  // 登录页的「账号登录/二维码登录」不是业务页签，别写进 catalog
  const tabs = isLogin
    ? []
    : Array.from(new Set(tabsRaw.map(cleanTabLabel).filter(Boolean)));

  const { api, confident } = guessListApi(snapshot);
  if (!confident) warnings.push(`列表接口不确定（推断为 ${api}），必须人工确认 LIST_API。`);

  const docNoColumn = guessDocNoColumn(headers);
  const docNo = guessDocNoRegex(dom.firstRowText || '');
  if (!docNo.sample) warnings.push('未从首行文本推出单号样本，DOC_NO_RE 为宽松兜底，建议按实际单号收紧。');

  const searchPlaceholder = guessSearchPlaceholder(dom.searchInputs || []);
  if (searchPlaceholder === '请输入') {
    warnings.push('未探到有辨识度的搜索框 placeholder，SEARCH_PLACEHOLDER 需人工确认。');
  }

  const table = guessTableSelector(dom);
  const rowActions = Array.from(
    new Set((dom.firstRowButtons || []).map((b) => b.replace(/\s+/g, '')).filter((b) => b && b.length <= 6)),
  );
  if (!rowActions.length) {
    warnings.push('未探到行内操作按钮（列表可能为空或未渲染），ROW_ACTIONS 需人工补。');
  }
  // 注册表声明有页签却没探到，通常是 DOM 层挑错了或列表没加载完，值得单独提醒
  if (tabbedHint && !tabs.length) {
    warnings.push('注册表标记该流程有页签，但快照里没探到，需确认 TABS。');
  }
  const inIframe = Boolean((dom.iframeSrcs || []).length) || Boolean(snapshot.list?.childFrames?.length);
  const loadOpts = guessListLoadOpts(dom);
  const emptyTextRe = loadOpts.clickSearchOnLoad
    ? '/点击右上角【搜索】后查看|暂无数据|No Data/'
    : '/暂无数据|No Data/';

  const code = `/**
 * ${label} UI 契约（catalog）。
 *
 * 本文件由 npm run flow:gen-catalog 从实机探活快照生成，是**草稿**：
 * 带 ${TODO} 的字段必须人工确认后再删注释。
 *
 * 实机事实（探活于 ${snapshot.capturedAt || '未知时间'}，env=${snapshot.env || '?'}）：
 * - 路由 ${entry}
 * - 列表接口 POST ${api}
 * - 业务 DOM ${inIframe ? '在 iframe[src*="openBySelf=zoom"] 内' : '在顶层文档'}
 * - 探到 ${headers.length} 个表头 / ${dom.tbodyRows || 0} 行数据${tabs.length ? ` / ${tabs.length} 个页签` : ''}
 *
 * 改这里之前先跑 npm run flow:gen-catalog -- --flow=<id> --check 比对实机是否漂移。
 */

/** 列表路由 */
export const LIST_PATH = ${q(entry)};

/** 列表查询接口 */
export const LIST_API = ${q(api)};${confident ? '' : `  ${TODO} 接口靠形状推断，需确认`}
export const LIST_API_RE = /${api.replace(/\//g, '\\/')}/;

/** 表格容器 */
export const TABLE = ${q(table)};
/** 数据行 */
export const ROW = '.ant-table-tbody tr.ant-table-row';

/** 顶部关键字搜索框 placeholder */
export const SEARCH_PLACEHOLDER = ${q(searchPlaceholder)};${searchPlaceholder === '请输入' ? `  ${TODO}` : ''}

/** 表头文案（顺序即实机顺序） */
export const COLUMNS = ${arr(headers)};${headers.length ? '' : `  ${TODO} 未探到表头，按实机补全`}

/** 单号列名 */
export const DOC_NO_COLUMN = ${q(docNoColumn)};${headers.length ? '' : `  ${TODO} 无表头依据，为默认猜测`}
/** 单号正则${docNo.sample ? `（实机样本 ${docNo.sample}）` : '' } */
export const DOC_NO_RE = /${docNo.source}/;${docNo.sample ? '' : `  ${TODO} 未取到样本，为宽松兜底，建议按实际单号收紧`}

/** 页签文案（已去掉运行时计数） */
export const TABS = ${arr(tabs)};${tabs.length || !tabbedHint ? '' : `  ${TODO} 该流程标记为有页签但未探到，需确认`}
export const TAB = '.ant-tabs-tab';

/** 行内操作按钮 */
export const ROW_ACTIONS = ${arr(rowActions)};${rowActions.length ? '' : `  ${TODO} 未探到行内按钮（列表可能为空），按实机补全`}

/** 搜索区动作 */
export const SEARCH_ACTION_SEARCH = '.search-action-search';  ${TODO} 确认实机类名
export const SEARCH_ACTION_CLEAR = '.search-action-clear';  ${TODO} 确认实机类名

/** 外露筛选 */
export const COMBO_TRIGGER = '.combo-trigger';
export const EXPOSED_FILTER_FIELDS: readonly string[] = ${arr(headers.slice(0, 3))};  ${TODO} 按实机外露筛选项改

/** 详情容器 */
export const DETAIL = '.full-screen';  ${TODO} 确认详情容器（.approve-entrance / .ant-modal / .slide-frame）

/** 空状态 / 已加载文案 */
export const EMPTY_TEXT_RE = ${emptyTextRe};
export const LOADED_TEXT_RE = /${label.replace(/流程$/, '')}/;  ${TODO} 换成页面上稳定出现的文案

/** GenericListPage 加载行为（对齐申请单 advanced-table：重置 → 搜索 → 空列表恢复） */
export const LIST_LOAD_OPTS = {
  clickSearchOnLoad: ${loadOpts.clickSearchOnLoad},
  resetFiltersOnLoad: ${loadOpts.resetFiltersOnLoad},
  recoverEmptyOnLoad: ${loadOpts.recoverEmptyOnLoad},
} as const;
`;

  return { code, warnings };
}

// ---------- CLI ----------

type Args = {
  flowId: string;
  snapshot: string;
  domain: string;
  label: string;
  entry: string;
  out: string;
  force: boolean;
  check: boolean;
  help: boolean;
};

function getArg(argv: string[], name: string, fallback = ''): string {
  const prefix = `--${name}=`;
  const hit = argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length).trim() : fallback;
}

function parseArgs(argv: string[]): Args {
  return {
    flowId: getArg(argv, 'flow'),
    snapshot: getArg(argv, 'snapshot'),
    domain: getArg(argv, 'domain'),
    label: getArg(argv, 'label'),
    entry: getArg(argv, 'entry'),
    out: getArg(argv, 'out'),
    force: argv.includes('--force'),
    check: argv.includes('--check'),
    help: argv.includes('--help') || argv.includes('-h'),
  };
}

function printHelp(): void {
  process.stdout.write(`flow:gen-catalog — 从实机快照生成 catalog 草稿

用法
  npm run flow:gen-catalog -- --flow=<id> [选项]
  npm run flow:gen-catalog -- --snapshot=<path> --domain=<domain> --entry=/main/xxx --out=<path>

选项
  --flow=<id>        已注册流程 ID，自动推断 snapshot / domain / entry / out
  --snapshot=<path>  探活快照路径（默认 <flow>/datasource/live-snapshot.json）
  --domain=<name>    业务域，决定输出文件名 <domain>-catalog.ts
  --label=<中文名>    用于注释与 LOADED_TEXT_RE
  --entry=<path>     列表路由
  --out=<path>       输出路径（默认 <flow>/utils/<domain>-catalog.ts）
  --force            覆盖已存在的 catalog（默认写成 .draft.ts 不覆盖）
  --check            只比对不写文件：报告实机与现有 catalog 的差异
  --help

配套流程
  1. npx tsx scripts/index-frontend/probe-live-page.ts --env=dev --entry=/main/xxx --out=<flow>/datasource/live-snapshot.json
  2. npm run flow:gen-catalog -- --flow=<id>
  3. 打开产物，把 TODO(review) 的字段逐条确认后删注释
`);
}

/** --check：把实机探到的表头/接口/placeholder 与现有 catalog 对一遍 */
function runCheck(snapshot: ProbeSnapshot, catalogPath: string): number {
  if (!fs.existsSync(catalogPath)) {
    process.stderr.write(`[check] 现有 catalog 不存在：${catalogPath}\n`);
    return 1;
  }
  const src = fs.readFileSync(catalogPath, 'utf8');
  const dom = pickBizDom(snapshot);
  const drift: string[] = [];

  const { api } = guessListApi(snapshot);
  if (api && !src.includes(api)) {
    drift.push(`列表接口：实机 ${api}，catalog 里没有这个字符串`);
  }

  const ph = guessSearchPlaceholder(dom.searchInputs || []);
  if (ph && ph !== '请输入' && !src.includes(ph)) {
    drift.push(`搜索框 placeholder：实机「${ph}」，catalog 里未出现`);
  }

  const headers = (dom.headers || []).map((h) => h.replace(/\s+/g, '').trim()).filter(Boolean);
  const missing = headers.filter((h) => h !== '+' && !src.includes(h));
  if (missing.length) {
    drift.push(`表头：实机有 ${missing.length} 个列名未出现在 catalog：${missing.join(' / ')}`);
  }

  const tabs = Array.from(new Set((dom.tabs || []).map(cleanTabLabel).filter(Boolean)));
  const missingTabs = tabs.filter((t) => !src.includes(t));
  if (missingTabs.length) {
    drift.push(`页签：实机有 ${missingTabs.join(' / ')} 未出现在 catalog`);
  }

  if (!drift.length) {
    process.stdout.write(`[check] ✅ catalog 与实机一致：${catalogPath}\n`);
    return 0;
  }
  process.stdout.write(`[check] ⚠️ 发现 ${drift.length} 处可能漂移（${catalogPath}）：\n`);
  for (const d of drift) process.stdout.write(`  · ${d}\n`);
  process.stdout.write(`\n  确认是真漂移就改 catalog；只是新增列可忽略。\n`);
  return 2;
}

function main(): void {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);

  if (args.help) {
    printHelp();
    return;
  }

  let { snapshot: snapPath, domain, label, entry, out } = args;
  let tabbed = false;

  if (args.flowId) {
    const flow = getFlow(args.flowId);
    if (flow) {
      snapPath ||= `${flow.id}/datasource/live-snapshot.json`;
      domain ||= flow.domain;
      label ||= flow.label;
      entry ||= flow.entry;
      out ||= `${flow.id}/utils/${flow.domain}-catalog.ts`;
      tabbed = Boolean(flow.tabbed);
    } else {
      // 尚未注册的新流程：按约定推断
      snapPath ||= `${args.flowId}/datasource/live-snapshot.json`;
      domain ||= args.flowId.replace(/-flow$/, '');
      out ||= `${args.flowId}/utils/${domain}-catalog.ts`;
    }
  }

  if (!snapPath) {
    process.stderr.write('缺少 --snapshot 或 --flow。--help 看用法。\n');
    process.exit(1);
  }

  const snapAbs = path.resolve(snapPath);
  if (!fs.existsSync(snapAbs)) {
    process.stderr.write(
      `找不到快照：${snapAbs}\n先跑：npx tsx scripts/index-frontend/probe-live-page.ts --env=dev --entry=${entry || '/main/xxx'} --out=${snapPath}\n`,
    );
    process.exit(1);
  }

  const snapshot = JSON.parse(fs.readFileSync(snapAbs, 'utf8')) as ProbeSnapshot;
  if (looksLikeLoginSnapshot(snapshot)) {
    process.stderr.write(
      '[gen-catalog] 探活落到登录页（storageState 无效或未传入）。请先在 Studio 左侧登录，再重新一键配置。\n',
    );
    process.exit(1);
  }
  entry ||= snapshot.entry || '/main/unknown';
  domain ||= 'biz';
  label ||= domain;
  out ||= `${domain}-catalog.ts`;

  if (args.check) {
    process.exit(runCheck(snapshot, path.resolve(out)));
  }

  const { code, warnings } = buildCatalogCode({ snapshot, domain, label, entry, tabbed });

  const outAbs = path.resolve(out);
  let target = outAbs;
  if (fs.existsSync(outAbs) && !args.force) {
    target = outAbs.replace(/\.ts$/, '.draft.ts');
    process.stdout.write(`[gen-catalog] ${out} 已存在，草稿写到 ${path.relative(process.cwd(), target)}（--force 可覆盖）\n`);
  }

  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, code, 'utf8');

  process.stdout.write(`[gen-catalog] 已生成 ${path.relative(process.cwd(), target)}\n`);
  if (warnings.length) {
    process.stdout.write(`\n需人工确认 ${warnings.length} 项：\n`);
    for (const w of warnings) process.stdout.write(`  · ${w}\n`);
  }
  process.stdout.write(`\n下一步：搜文件里的 TODO(review)，逐条确认后删掉注释。\n`);
}

const invokedDirectly =
  process.argv[1] && /gen-catalog-from-probe\.(ts|js|mjs)$/.test(process.argv[1]);
if (invokedDirectly) {
  main();
}



