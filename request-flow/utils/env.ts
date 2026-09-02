import { createBaseEnv, hasLoginCredentials as hasCreds } from '../../flow-kit/utils/env';

/**
 * 申请单流程环境变量。公共部分来自 flow-kit，这里只声明本流程特有字段。
 */
export const env = {
  ...createBaseEnv({ writeEnvVar: 'REQUEST_ENABLE_WRITE' }),

  requestDocNo: process.env.REQUEST_DOC_NO || '',
  requestFormName: process.env.REQUEST_FORM_NAME || '',
  /** Golden 筛选用固定关键字 */
  requestFilterKeyword: process.env.REQUEST_FILTER_KEYWORD || '',
  /** 固定事由；不设则用例用 randomReason() */
  requestReason: process.env.REQUEST_REASON || '',
  /** 自选审批人关键字；默认 97dev（登录人） */
  requestApprover: process.env.REQUEST_APPROVER || '97dev',
};

export function hasLoginCredentials(): boolean {
  return hasCreds(env);
}
