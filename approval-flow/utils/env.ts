import { createBaseEnv, hasLoginCredentials as hasCreds } from '../../flow-kit/utils/env';

/**
 * 审批流程环境变量。公共部分来自 flow-kit，这里只声明本流程特有字段。
 */
export const env = {
  ...createBaseEnv({ writeEnvVar: 'APPROVAL_ENABLE_WRITE' }),

  /** 指定一条「待审批」单号用于搜索 + 打开 / 审批；不填则用列表第一条 */
  approvalDocNo: process.env.APPROVAL_DOC_NO || '',
  /** 指定一条用于「驳回」的单号；不填则用通过操作后的下一条待审批 */
  rejectDocNo: process.env.REJECT_DOC_NO || '',
};

export function hasLoginCredentials(): boolean {
  return hasCreds(env);
}
