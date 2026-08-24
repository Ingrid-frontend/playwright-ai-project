export const env = {
  baseURL: process.env.BASE_URL || 'https://dev.huilianyi.com',
  username: process.env.LOGIN_USERNAME || '',
  password: process.env.LOGIN_PASSWORD || '',
  loginPath: process.env.LOGIN_PATH || '/login',
  storageState: process.env.STORAGE_STATE || '',

  /** 指定一条「待审批」单号用于搜索 + 打开 / 审批；不填则用列表第一条 */
  approvalDocNo: process.env.APPROVAL_DOC_NO || '',
  /** 指定一条用于「驳回」的单号；不填则用通过操作后的下一条待审批 */
  rejectDocNo: process.env.REJECT_DOC_NO || '',

  /** 审批意见文案 */
  approvalComment: process.env.APPROVAL_COMMENT || '自动化审批通过（Playwright）',
  rejectComment: process.env.REJECT_COMMENT || '自动化审批驳回（Playwright）',

  /** 写操作开关；不设为 1 时通过/驳回用例 skip */
  writeEnabled: process.env.APPROVAL_ENABLE_WRITE === '1',
};

export function hasLoginCredentials(): boolean {
  return Boolean(env.username && env.password);
}
