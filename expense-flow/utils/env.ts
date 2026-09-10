import { createBaseEnv, hasLoginCredentials as hasCreds } from '../../flow-kit/utils/env';

/**
 * 报销流程环境变量。公共部分来自 flow-kit，这里只声明本流程特有字段。
 */
export const env = {
  ...createBaseEnv({ writeEnvVar: 'EXPENSE_ENABLE_WRITE' }),

  /** 指定一条单号用于搜索 / 打开；不填则用列表第一条 */
  expenseDocNo: process.env.EXPENSE_DOC_NO || '',
  /** 固定事由；不设则用例用 randomReason() */
  expenseReason: process.env.EXPENSE_REASON || '',
  /** 自选审批人关键字；默认登录人 */
  expenseApprover: process.env.EXPENSE_APPROVER || '',
  /** 新建单据的表单名（多模板时精确匹配） */
  expenseFormName: process.env.EXPENSE_FORM_NAME || '',
};

export function hasLoginCredentials(): boolean {
  return hasCreds(env);
}
