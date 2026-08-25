/**
 * 申请单列表运行时目录。以 dev 实机探活为准（request-flow/datasource/live-snapshot.json）。
 */
export const LIST_PATH = '/main/request';

export const LIST_API = '/api/applications/v4/search';

export const ROOT = '.application-list';
export const TABLE = '.application-table-v2 .ant-table, .ant-table';
export const ROW = '.ant-table-tbody tr.ant-table-row';
export const SEARCH_PLACEHOLDER = '申请单号';
export const NEW_REQUEST_BTN = /新建申请单/;
export const DETAIL =
  '.slide-frame.slide-frame-open, .full-width-slideframe, .one-screen-request, .request-edit, .full-screen, .helios-full-screen';
/** 详情区特征：勿含「单号」（列表表头也会命中导致误判已打开详情） */
export const DETAIL_MARKERS = /单据状态|单据信息|申请明细|删除单据/;

export const FILTER_TRIGGER = '.advanced-table-search, .advanced-search-filter-trigger';
export const FILTER_POP = '.advanced-table-search-form, .advanced-search-filter-pop';
export const SEARCH_ACTION_SEARCH = '.search-action-bar__search, button:has-text("搜")';
export const SEARCH_ACTION_RESET = 'button:has-text("重"), button:has-text("重置")';

export const FILTER_LABELS = {
  formName: '单据名称',
  createdDate: '创建日期',
  applicant: '申请人',
  company: '单据公司',
  reason: '事由',
  submitDate: '提交日期',
  status: '状态',
  search: '搜索',
  reset: '重置',
  docNo: '单号',
} as const;

export const LIST_API_RE = /\/api\/applications\/(?:v4\/)?search(?:\?|$)/;

export const COLUMNS = [
  '创建日期',
  '申请人',
  '单据名称',
  '事由',
  '单号',
  '单据公司',
  '币种',
  '金额',
  '本币金额',
  '当前处理人',
  '状态',
  '提交日期',
  '操作',
] as const;

export const DOC_NO_RE = /(?:EA|ER|AR|BX|CD|comic)\w{6,}/i;
