/**
 * 报销流程 UI 契约（catalog）——**占位骨架**。
 *
 * 正确的填法不是手写，而是实机探活后自动生成：
 *   1. npx tsx scripts/index-frontend/probe-live-page.ts --env=dev --entry=/main/expense \
 *        --out=expense-flow/datasource/live-snapshot.json
 *   2. npm run flow:gen-catalog -- --flow=expense-flow --force
 *   3. 逐条确认产物里的 TODO(review) 后删注释
 *
 * 之后每次怀疑实机漂移：
 *   npm run flow:gen-catalog -- --flow=expense-flow --check
 */

/** 列表路由 */
export const LIST_PATH = '/main/expense';

/** 列表查询接口（探活后替换） */
export const LIST_API = '/api/TODO/search';
export const LIST_API_RE = /\/api\/TODO\/search/;

/** 表格容器 / 数据行 */
export const TABLE = '.ant-table';
export const ROW = '.ant-table-tbody tr.ant-table-row';

/** 顶部关键字搜索框 placeholder（探活后替换） */
export const SEARCH_PLACEHOLDER = '请输入';

/** 表头文案（探活后替换） */
export const COLUMNS: readonly string[] = [];

/** 单号列名 / 单号正则（探活后收紧） */
export const DOC_NO_COLUMN = '单号';
export const DOC_NO_RE = /\b[A-Za-z0-9]{8,}\b/;

/** 页签 */
export const TABS: readonly string[] = [];
export const TAB = '.ant-tabs-tab';

/** 搜索区动作 */
export const SEARCH_ACTION_SEARCH = '.search-action-search';
export const SEARCH_ACTION_CLEAR = '.search-action-clear';

/** 外露筛选 */
export const COMBO_TRIGGER = '.combo-trigger';
export const EXPOSED_FILTER_FIELDS: readonly string[] = [];

/** 详情容器 */
export const DETAIL = '.full-screen';

/** 空状态 / 已加载文案 */
export const EMPTY_TEXT_RE = /暂无数据|No Data/;
export const LOADED_TEXT_RE = /报销/;
