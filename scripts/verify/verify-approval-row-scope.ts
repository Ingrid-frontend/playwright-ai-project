import assert from 'node:assert/strict';
import type { Locator, Page } from '@playwright/test';
import { ApprovalListPage } from '../../approval-flow/pages/approval-list.page.js';

// evaluateAll 在 mock 浏览器边界解包 handle；不同 handle 可指向同一个 DOM 节点。
type Handle = { node: object; dispose(): Promise<void> };
type Internals = {
  dataRowIndexOf(target: Locator): Promise<number>;
  actionButtonInRow(target: Locator, name: RegExp): Promise<Locator>;
  fixedActionRows(): Locator;
  actionButton(name: RegExp): Locator;
  fillCommentDialogIfNeeded(): Promise<void>;
  confirmIfNeeded(): Promise<void>;
};

function fixture() {
  const clicks: string[] = [];
  const disposed: Handle[] = [];
  const handles: Handle[] = [];
  const nodes = [{}, {}];
  let fixedCount = 1;
  let evaluateError = false;
  function locator(tag: string, node?: object, count = 1): Locator {
    const value = {
      constructor: { name: 'Locator' },
      _expect: async () => ({ matches: count > 0, received: count > 0 ? 'visible' : 'hidden' }),
      filter: () => locator(`${tag}/filter`, node, count),
      first: () => locator(`${tag}/first`, node, count),
      nth: (i: number) => locator(`${tag}/nth(${i})`, node, count),
      getByRole: () => locator(`${tag}/button`, node, count),
      count: async () => count,
      click: async () => { clicks.push(tag); },
      elementHandle: async () => {
        if (!node) return null;
        const handle: Handle = { node, dispose: async () => { disposed.push(handle); } };
        handles.push(handle);
        return handle;
      },
      elementHandles: async () => { throw new Error('不得比较 Node.js handle 引用'); },
      evaluateAll: async (fn: (rows: object[], target: object) => number, handle: Handle) => {
        if (evaluateError) throw new Error('DOM evaluation failed');
        return fn(nodes, handle.node);
      },
    };
    return value as unknown as Locator;
  }
  const page = { on: () => undefined, off: () => undefined, getByRole: () => locator('dialog') } as unknown as Page;
  class TestApproval extends ApprovalListPage {
    override scope(): Page { return page; }
    override dataRows(): Locator { return locator('dataRows'); }
    override rowByCode(code: string): Locator {
      return locator(code, code === 'ABC001' ? nodes[0] : code === 'ABC002' ? nodes[1] : {});
    }
  }
  const list = new TestApproval(page);
  // 只在 mock 边界访问 private 成员，避免 private 交叉类型折叠为 never。
  const internals = list as unknown as Internals;
  internals.fixedActionRows = () => locator('fixedRows', undefined, fixedCount);
  internals.actionButton = () => { throw new Error('指定行不得退回全局 first'); };
  internals.fillCommentDialogIfNeeded = async () => undefined;
  internals.confirmIfNeeded = async () => undefined;
  return {
    list, internals, handles, disposed, clicks, locator,
    setFixedCount: (count: number) => { fixedCount = count; },
    failEvaluation: () => { evaluateError = true; },
  };
}

async function main(): Promise<void> {
  const f = fixture();
  try {
    assert.equal(await f.internals.dataRowIndexOf(f.list.rowByCode('ABC001')), 0);
    assert.equal(await f.internals.dataRowIndexOf(f.list.rowByCode('ABC002')), 1);
    assert.equal(await f.internals.dataRowIndexOf(f.list.rowByCode('ABC002')), 1);
    assert.notEqual(f.handles[1], f.handles[2], '每次获取均为不同 handle');
    assert.equal(f.handles[1].node, f.handles[2].node, '不同 handle 指向同 DOM');
    assert.equal(f.disposed.length, 3, '成功路径释放所有获取的 handle');

    await f.list.approveRow('offline', 'ABC002');
    await f.list.rejectRow('offline', 'ABC002');
    assert.deepEqual(f.clicks, [
      'fixedRows/nth(1)/button/filter/first',
      'fixedRows/nth(1)/button/filter/first',
    ], '通过和驳回均定位非首行固定列');

    f.setFixedCount(0);
    await (await f.internals.actionButtonInRow(f.list.rowByCode('ABC002'), /^通过$/)).click();
    assert.equal(f.clicks.at(-1), 'ABC002/button/filter/first', '无固定列时仅退回目标行');
    f.setFixedCount(1);
    await (await f.internals.actionButtonInRow(f.list.rowByCode('missing'), /^通过$/)).click();
    assert.equal(f.clicks.at(-1), 'missing/button/filter/first', '目标 DOM 不在集合时不碰首行');
    assert.equal(await f.internals.dataRowIndexOf(f.locator('null-handle')), -1);

    f.failEvaluation();
    await assert.rejects(f.internals.dataRowIndexOf(f.list.rowByCode('ABC002')), /DOM evaluation failed/);
    assert.equal(f.disposed.length, f.handles.length, '异常路径也释放 handle');
  } finally {
    f.list.dispose();
  }
  console.log('approval row scope verification passed');
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
