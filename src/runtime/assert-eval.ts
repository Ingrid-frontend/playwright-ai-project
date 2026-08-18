import type { SemanticAction } from '../types/ai-test-plan.js';
import {
  findCandidates,
  listVisibleControlNames,
  parseSnapshotText,
  snapshotContainsText,
} from './ego-snapshot.js';

export type AssertEvalInput = {
  kind: 'text' | 'visible' | 'url' | 'count';
  expect: string;
  target?: string;
  snapshot?: string;
  url?: string;
  frameTexts?: string[];
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

  // text / visible：可见原文子串或节点名；iframe innerText 作兜底
  if (snapshotContainsText(snapshot, expect)) {
    return { ok: true, detail: `命中文案 ${expect}` };
  }
  const needle = expect.toLowerCase().replace(/\s+/g, '');
  const frameHit = (input.frameTexts || []).some((text) =>
    String(text || '')
      .toLowerCase()
      .replace(/\s+/g, '')
      .includes(needle),
  );
  return {
    ok: frameHit,
    detail: frameHit ? `命中文案 ${expect}` : formatMissingAssertDetail(expect, snapshot),
  };
}

/** 口述操作名被写成 assert，且下一步就是去点它 → 跳过臆造断言 */
export function shouldSkipUnobservedAssert(
  expect: string,
  next?: { type?: string; description?: string },
): boolean {
  const needle = expect.trim();
  if (!needle || !next) return false;
  if (next.type !== 'click' && next.type !== 'fill' && next.type !== 'select') return false;
  const desc = (next.description || '').trim();
  return Boolean(desc && desc.includes(needle));
}

export function formatMissingAssertDetail(expect: string, snapshot: string): string {
  const names = listVisibleControlNames(snapshot);
  const hint = names.length ? `。页面可见操作：${names.join('、')}` : '';
  return `Snapshot 未找到文案 ${expect}${hint}`;
}
