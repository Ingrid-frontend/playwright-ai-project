/**
 * 流程级环境变量基座。
 *
 * 两套 flow 各写了一份 env.ts，只有「业务字段」不同。这里抽出公共部分，
 * 各 flow 只声明自己的差异字段：
 *
 *   export const env = {
 *     ...createBaseEnv({ writeEnvVar: 'REQUEST_ENABLE_WRITE' }),
 *     requestDocNo: process.env.REQUEST_DOC_NO || '',
 *   };
 */
export type BaseEnv = {
  baseURL: string;
  username: string;
  password: string;
  loginPath: string;
  storageState: string;
  /** 串联审批意见 */
  approvalComment: string;
  rejectComment: string;
  /** 写操作总开关 */
  writeEnabled: boolean;
};

export type BaseEnvOptions = {
  /** 写操作开关环境变量名，如 REQUEST_ENABLE_WRITE */
  writeEnvVar: string;
  /** 默认 baseURL */
  defaultBaseURL?: string;
};

export function createBaseEnv(opts: BaseEnvOptions): BaseEnv {
  return {
    baseURL: process.env.BASE_URL || opts.defaultBaseURL || 'https://dev.huilianyi.com',
    username: process.env.LOGIN_USERNAME || '',
    password: process.env.LOGIN_PASSWORD || '',
    loginPath: process.env.LOGIN_PATH || '/login',
    storageState: process.env.STORAGE_STATE || '',
    approvalComment: process.env.APPROVAL_COMMENT || '自动化审批通过（Playwright）',
    rejectComment: process.env.REJECT_COMMENT || '自动化审批驳回（Playwright）',
    writeEnabled: Boolean(opts.writeEnvVar) && process.env[opts.writeEnvVar] === '1',
  };
}

export function hasLoginCredentials(env: Pick<BaseEnv, 'username' | 'password'>): boolean {
  return Boolean(env.username && env.password);
}

/**
 * 与业务无关的共享环境（登录页等 flow-kit 内部使用）。
 * 业务 flow 请用 createBaseEnv() 自己组装，不要直接依赖这个常量的写开关。
 */
export const baseEnv: BaseEnv = createBaseEnv({ writeEnvVar: '' });
