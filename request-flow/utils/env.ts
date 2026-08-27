export const env = {
  baseURL: process.env.BASE_URL || 'https://dev.huilianyi.com',
  username: process.env.LOGIN_USERNAME || '',
  password: process.env.LOGIN_PASSWORD || '',
  loginPath: process.env.LOGIN_PATH || '/login',
  storageState: process.env.STORAGE_STATE || '',

  requestDocNo: process.env.REQUEST_DOC_NO || '',
  requestFormName: process.env.REQUEST_FORM_NAME || '',
  /** Golden 筛选用固定关键字 */
  requestFilterKeyword: process.env.REQUEST_FILTER_KEYWORD || '',
  /** 固定事由；不设则用例用 randomReason() */
  requestReason: process.env.REQUEST_REASON || '',
  /** 自选审批人关键字；默认 97dev（登录人） */
  requestApprover: process.env.REQUEST_APPROVER || '97dev',

  /** 串联审批意见（submit-then-approve） */
  approvalComment: process.env.APPROVAL_COMMENT || '自动化审批通过（Playwright）',
  rejectComment: process.env.REJECT_COMMENT || '自动化审批驳回（Playwright）',

  writeEnabled: process.env.REQUEST_ENABLE_WRITE === '1',
};

export function hasLoginCredentials(): boolean {
  return Boolean(env.username && env.password);
}
