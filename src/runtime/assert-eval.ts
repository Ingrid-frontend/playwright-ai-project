import type { SemanticAction } from '../types/ai-test-plan.js';
import { findCandidates, parseSnapshotText, snapshotContainsText } from './ego-snapshot.js';

export type AssertEvalInput = {
  kind: 'text' | 'visible' | 'url' | 'count';
  expect: string;
  target?: string;
  snapshot?: string;
  url?: string;
};

export function normalizeAssertAction(action: Extract<SemanticAction, { type: 'assert' }>): AssertEvalInput {
  return {
    kind: action.kind || 'text',
    expect: (action.expect || action.description || '').trim(),
    target: action.target,
  };
}

/** 纯函数：根据 Snapshot / URL 判定结构化断言（不经 LLM） */
export function evaluateStructuredAssert(input: AssertEvalInput): { ok: boolean; detail: string } {
  const kind = input.kind || 'text';
  const expect = input.expect.trim();
  if (!expect) return { ok: false, detail: 'assert expect 为空' };

  if (kind === 'url') {
    const url = input.url || '';
    const ok = url.toLowerCase().includes(expect.toLowerCase());
    return { ok, detail: ok ? `url 包含 ${expect}` : `当前 url=${url} 不含 ${expect}` };
  }

  const snapshot = input.snapshot || '';
  if (kind === 'count') {
    const n = Number(expect);
    if (!Number.isFinite(n) || n < 0) return { ok: false, detail: 'count expect 非法' };
    const needle = (input.target || '').trim();
    const nodes = parseSnapshotText(snapshot);
    const hits = needle ? findCandidates(nodes, needle) : nodes;
    const ok = hits.length >= n;
    return {
      ok,
      detail: ok ? `count=${hits.length} >= ${n}` : `count=${hits.length} < ${n}${needle ? ` (target=${needle})` : ''}`,
    };
  }

  // text / visible：可见原文子串或节点名
  const ok = snapshotContainsText(snapshot, expect);
  return { ok, detail: ok ? `命中文案 ${expect}` : `Snapshot 未找到文案 ${expect}` };
}
