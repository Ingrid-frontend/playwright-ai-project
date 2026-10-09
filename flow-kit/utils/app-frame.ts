/**
 * 转发 shim：实现已收编至 src/app-adapter/huilianyi/（AppAdapter 通用化锚点）。
 * 这里仅按原样转发导出名，三个 flow 与 flow-kit 旧 import 零改动。
 */
export {
  appFrame,
  waitForAppRoot,
  type AppRoot,
  type WaitForAppRootOptions,
} from '../../src/app-adapter/huilianyi/app-frame.js';
