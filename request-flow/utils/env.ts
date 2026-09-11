export const env = {
  baseURL: process.env.BASE_URL || 'https://dev.huilianyi.com',
  username: process.env.LOGIN_USERNAME || '',
  password: process.env.LOGIN_PASSWORD || '',
  loginPath: process.env.LOGIN_PATH || '/login',
  storageState: process.env.STORAGE_STATE || '',

  requestDocNo: process.env.REQUEST_DOC_NO || '',
  requestFormName: process.env.REQUEST_FORM_NAME || '',
  /** 可选对照关键字；Golden / 只读筛选优先用列表现场事由，过期配置会被忽略 */
  requestFilterKeyword: process.env.REQUEST_FILTER_KEYWORD || '',
  /** 为 1 时 Golden 才允许 REQUEST_DOC_NO / 静态种子排在列表现场值之前 */
  goldenForceSeed: process.env.GOLDEN_FORCE_SEED || '',
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
