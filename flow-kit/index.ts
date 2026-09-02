/**
 * flow-kit：所有流程共享的脚手架。
 *
 * 设计目标：新增一个流程只写「这页跟别的页不一样的地方」。
 * 详见 docs/flow-kit-and-flow-new.md。
 */
export * from './utils/app-frame';
export * from './utils/api-guard';
export * from './utils/env';
export * from './utils/golden-seed';
export * from './utils/random';
export * from './utils/request-fields';
export * from './utils/clear-expired-storage';
export * from './utils/feishu-api-failure';
export * from './pages/home.page';
export * from './pages/login.page';
export * from './list/generic-list-page';
