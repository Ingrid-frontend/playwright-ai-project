/**
 * 对公申请单流程 UI 契约（catalog）。
 *
 * 本文件由 npm run flow:gen-catalog 从实机探活快照生成，是**草稿**：
 * 带 // TODO(review) 的字段必须人工确认后再删注释。
 *
 * 实机事实（探活于 2026-10-14T08:11:11.291Z，env=dev）：
 * - 路由 /main/ap-request
 * - 列表接口 POST /api/applications/public/search
 * - 业务 DOM 在 iframe[src*="openBySelf=zoom"] 内
 * - 探到 17 个表头 / 0 行数据；侧栏主导航不是列表页签
 *
 * 改这里之前先跑 npm run flow:gen-catalog -- --flow=<id> --check 比对实机是否漂移。
 */

/** 列表路由 */
export const LIST_PATH = '/main/ap-request';

/** 列表查询接口 */
export const LIST_API = '/api/applications/public/search';
export const LIST_API_RE = /\/api\/applications\/public\/search/;

/** 表格容器 */
export const TABLE = '.ant-table';
/** 数据行 */
export const ROW = '.ant-table-tbody tr.ant-table-row';

/** 顶部关键字搜索框 placeholder */
export const SEARCH_PLACEHOLDER = '对公申请单号';

/** 表头文案（顺序即实机顺序） */
export const COLUMNS = [
  '序号',
  '创建日期',
  '申请人',
  '供应商名称',
  '明细供应商名称',
  '供应商银行账户',
  '单据名称',
  '事由',
  '单号',
  '币种',
  '金额',
  '本币金额',
  '当前处理人',
  '状态',
  '提交日期',
  '操作',
  '操作',
];

/** 单号列名 */
export const DOC_NO_COLUMN = '单号';
/** 单号正则 */
export const DOC_NO_RE = /\b[A-Za-z0-9]{8,}\b/;  // TODO(review) 列表无单号样本，拿到真实单号后再收紧

/** 页签（本列表无流程页签；侧栏主导航勿写入） */
export const TABS: readonly string[] = [];
export const TAB = '.ant-tabs-tab';

/** 行内操作（列表为空，golden 只读暂不需要） */
export const ROW_ACTIONS: readonly string[] = [];

/** 搜索区动作 */
export const SEARCH_ACTION_SEARCH = '.search-action-bar__search, button:has-text("搜")';
export const SEARCH_ACTION_CLEAR = '.search-action-bar__clear';

/** 外露筛选（探活正文：创建日期、状态） */
export const COMBO_TRIGGER = '.combo-trigger';
export const EXPOSED_FILTER_FIELDS: readonly string[] = ['创建日期', '状态'];

/** 详情容器（本次列表为空，未打开详情） */
export const DETAIL = '.slide-frame.slide-frame-open, .full-width-slideframe, .full-screen, .helios-full-screen';

/** 空状态 / 已加载文案 */
export const EMPTY_TEXT_RE = /暂无数据|No Data/;
export const LOADED_TEXT_RE = /对公申请单/;

/** GenericListPage 加载行为（对齐申请单 advanced-table：重置 → 搜索 → 空列表恢复） */
export const LIST_LOAD_OPTS = {
  clickSearchOnLoad: true,
  resetFiltersOnLoad: true,
  recoverEmptyOnLoad: true,
} as const;
