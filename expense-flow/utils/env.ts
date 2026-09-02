import { createBaseEnv, hasLoginCredentials as hasCreds } from '../../flow-kit/utils/env';

/**
 * 报销流程环境变量。公共部分来自 flow-kit，这里只声明本流程特有字段。
 */
export const env = {
  ...createBaseEnv({ writeEnvVar: 'EXPENSE_ENABLE_WRITE' }),

  /** 指定一条单号用于搜索 / 打开；不填则用列表第一条 */
  expenseDocNo: process.env.EXPENSE_DOC_NO || '',
};

export function hasLoginCredentials(): boolean {
  return hasCreds(env);
}
