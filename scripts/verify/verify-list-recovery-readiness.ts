import assert from 'node:assert/strict';
import { GenericListPage } from '../../flow-kit/list/generic-list-page.js';

// 不启动浏览器：模拟数据行尚未渲染，验证恢复前等待与失败传播。
const recover = GenericListPage.prototype.recoverIfEmptyList;
const events: string[] = [];
let rowsReady = false;
const loadingList = {
  expectListReady: async () => { events.push('ready'); rowsReady = true; },
  hasDataRows: async () => { events.push('rows'); return rowsReady; },
  widenSubmitDate: async () => { throw new Error('有数据时不得修改筛选'); },
};
assert.equal(await recover.call(loadingList as unknown as GenericListPage), true);
assert.deepEqual(events, ['ready', 'rows']);

let checkedRows = false;
await assert.rejects(recover.call({
  expectListReady: async () => { throw new Error('列表未就绪'); },
  hasDataRows: async () => { checkedRows = true; return false; },
} as unknown as GenericListPage), /列表未就绪/);
assert.equal(checkedRows, false, '未就绪不得尝试清理筛选');

const emptyEvents: string[] = [];
assert.equal(await recover.call({
  expectListReady: async () => { emptyEvents.push('empty-ready'); },
  hasDataRows: async () => false,
  widenSubmitDate: async () => { emptyEvents.push('recover'); return true; },
} as unknown as GenericListPage), true);
assert.deepEqual(emptyEvents, ['empty-ready', 'recover'], '合法空状态仍允许恢复');
console.log('✓ 列表就绪后才恢复、未就绪错误传播、有数据不改筛选、合法空状态仍可恢复');
