/**
 * 报销流程 UI 契约（catalog）。
 *
 * 以 dev 实机探活为准（expense-flow/datasource/live-snapshot.json）。
 * 列表默认不自动查数，需先点筛选区「搜索」。
 *
 * 改这里之前先跑 npm run flow:gen-catalog -- --flow=expense-flow --check 比对实机是否漂移。
 */

/** 列表路由 */
export const LIST_PATH = '/main/expense-parent-report/expense-report';

/** 列表查询接口（点「搜索」后 POST） */
export const LIST_API = '/api/expense/queryPage';
export const LIST_API_RE = /\/api\/expense\/queryPage(?:\?|$)/;

/** 表格容器 */
export const TABLE = '.ant-table';
/** 数据行 */
export const ROW = '.ant-table-tbody tr.ant-table-row';

/** 顶部关键字搜索框 placeholder */
export const SEARCH_PLACEHOLDER = '报销单号';

/** 表头文案（顺序即实机顺序） */
export const COLUMNS = [
  '序号',
  '提交日期',
  '申请人',
  '单据名称',
  '事由',
  '单号',
  '币种',
  '金额',
  '本币币种',
  '本币金额',
  '收单状态',
  '摘要信息',
  '当前处理人',
  '状态',
  '操作',
  '操作',
] as const;

/** 单号列名 */
export const DOC_NO_COLUMN = '单号';
/** 单号正则（与申请单同源编码规则） */
export const DOC_NO_RE = /(?:EA|ER|AR|BX|CD|comic)\w{6,}/i;

/** 页签（报销列表无流程页签；侧栏主导航勿写入） */
export const TABS: readonly string[] = [];
export const TAB = '.ant-tabs-tab';

/** 行内操作（golden 只读暂不需要） */
export const ROW_ACTIONS: readonly string[] = [];

/** 搜索区动作 */
export const SEARCH_ACTION_SEARCH = '.search-action-bar__search, button:has-text("搜")';
export const SEARCH_ACTION_CLEAR = '.search-action-bar__clear';

/** 外露筛选 */
export const COMBO_TRIGGER = '.combo-trigger';
export const EXPOSED_FILTER_FIELDS: readonly string[] = ['单据名称', '提交日期'];

/** 详情容器 */
export const DETAIL = '.slide-frame.slide-frame-open, .full-width-slideframe, .full-screen, .helios-full-screen';

/** 空状态 / 已加载文案 */
export const EMPTY_TEXT_RE = /点击右上角【搜索】后查看|暂无数据|No Data/;
export const LOADED_TEXT_RE = /报销单/;

/** GenericListPage 加载行为（对齐申请单 advanced-table：重置 → 搜索 → 空列表恢复） */
export const LIST_LOAD_OPTS = {
  clickSearchOnLoad: true,
  resetFiltersOnLoad: true,
  recoverEmptyOnLoad: true,
} as const;
