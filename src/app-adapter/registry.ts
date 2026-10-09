import type { AppAdapter } from './types.js';
import { HUILIANYI_ADAPTER } from './huilianyi/index.js';

/**
 * adapter 注册表：对接新应用 = 在 ADAPTERS 里加一条。
 * 默认 huilianyi（当前唯一受支持应用）。
 */
const ADAPTERS: Record<string, AppAdapter> = {
  [HUILIANYI_ADAPTER.id]: HUILIANYI_ADAPTER,
};

export function getAdapter(_env?: string): AppAdapter {
  // env → adapter 的映射暂不需要（当前只有汇联易）；
  // 将来多应用时按 datasource/base-config.json 的 platform 字段选择。
  return HUILIANYI_ADAPTER;
}

export function listAdapterIds(): string[] {
  return Object.keys(ADAPTERS);
}

export type { AppAdapter };
