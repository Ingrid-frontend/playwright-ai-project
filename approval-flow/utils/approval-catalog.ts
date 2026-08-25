/**
 * 审批列表运行时目录。页签/搜索/列表接口以 dev 实机探活为准
 * （approval-flow/datasource/live-snapshot.json），单号仍须每次从列表现场取。
 */
export const LIST_PATH = '/main/approve';

export const LIST_API = '/api/approvals/pendingApproval';
export const APPROVED_API = '/api/approvals/approved';
export const CC_API = '/api/approvals/copiedToMe';

export const ROOT = '.approve-list';
export const TABLE = '.ant-table';
export const ROW = '.ant-table-tbody tr.ant-table-row';
export const TAB = '.ant-tabs-tab';
export const DETAIL = '.approve-entrance';
export const SEARCH_PLACEHOLDER = '申请人/事由/单号';

export const BUSINESS_TYPE_SELECT = '.approve-business-filter-type-select';
export const FILTER_TRIGGER = '.advanced-search-filter-trigger';
export const FILTER_POP = '.advanced-search-filter-pop, .advanced-search-filter-content';
export const FILTER_ROW = '.advanced-search-filter-row';
export const COMBO_TRIGGER = '.combo-trigger';
export const SEARCH_ACTION_SEARCH = '.search-action-bar__search';
export const SEARCH_ACTION_CLEAR = '.search-action-bar__clear';

export const FILTER_LABELS = {
  businessType: '全部业务类型',
  filter: '筛选',
  docNo: '单号',
  applicant: '申请人',
  company: '单据公司',
  submitDate: '提交日期',
  reason: '事由',
  search: '搜索',
  clearExposed: '清除外露筛选值',
  clearPanel: '清除筛选值',
  addCondition: '添加条件',
} as const;

/** 筛选条下方外露 ComboTrigger（dev 实机：单号 / 申请人 / 单据公司 / 提交日期） */
export const EXPOSED_FILTER_FIELDS = [
  FILTER_LABELS.docNo,
  FILTER_LABELS.applicant,
  FILTER_LABELS.company,
  FILTER_LABELS.submitDate,
] as const;

export const LIST_API_RE = /\/api\/approvals\/(pendingApproval|approved|copiedToMe)(?:\?|$)/;

export const TABS = {
  pending: '待审批-全部',
  approved: '已审批',
  cc: '抄送我',
  history: '操作历史',
} as const;

export const COLUMNS = [
  '申请人',
  '单号',
  '提交日期',
  '单据名称',
  '单据公司',
  '事由',
  '金额',
  '单据部门',
  '本币金额',
  '操作',
] as const;

export const ROW_ACTIONS = {
  pass: /通\s*过/,
  reject: /驳\s*回/,
} as const;

export const DOC_NO_RE = /[A-Z]{2}\d{6,}/;
