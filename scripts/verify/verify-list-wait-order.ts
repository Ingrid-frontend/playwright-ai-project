import assert from 'node:assert/strict';
import type { Locator, Page } from '@playwright/test';
import { GenericListPage, type ListCatalog } from '../../flow-kit/list/generic-list-page.js';
import { ApprovalListPage, APPROVAL_LIST_CATALOG } from '../../approval-flow/pages/approval-list.page.js';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function fixture() {
  const events: string[] = [];
  const clicked = deferred();
  const response = deferred();
  const locator = {
    locator: () => locator,
    or: () => locator,
    filter: () => locator,
    first: () => locator,
    count: async () => 0,
    innerText: async () => '申请单',
    isVisible: async () => true,
    click: async () => { events.push('click'); clicked.resolve(); },
  };
  const page = {
    locator: () => locator,
    getByRole: () => locator,
    goto: async () => { events.push('navigate'); },
    on: () => undefined,
    off: () => undefined,
  } as unknown as Page;
  class List extends GenericListPage {
    constructor(clickSearchOnLoad = false) {
      super(page, { ...APPROVAL_LIST_CATALOG, clickSearchOnLoad } satisfies ListCatalog);
    }
    override scope() { return page; }
    protected override async dismissChrome() {}
    override async waitListApi() {
      events.push('listen');
      await response.promise;
      events.push('response');
      return null;
    }
    override async waitListSettled() { events.push('settled'); }
    clearCombo() { return this.clickComboClear(locator as unknown as Locator); }
  }
  return { events, page, clicked, response, List };
}

for (const clickSearch of [false, true]) {
  const f = fixture();
  const list = new f.List(clickSearch);
  const navigation = list.goto();
  assert.deepEqual(f.events, clickSearch ? ['navigate'] : ['listen', 'navigate']);
  f.response.resolve();
  await navigation;
}

for (const action of ['search', 'clear'] as const) {
  const f = fixture();
  const list = new f.List();
  const mutation = action === 'search' ? list.clickFilterSearch() : list.clearCombo();
  await f.clicked.promise;
  assert.deepEqual(f.events, ['listen', 'click']);
  f.response.resolve();
  await mutation;
  assert.deepEqual(f.events, ['listen', 'click', 'response', 'settled']);
}

{
  const f = fixture();
  const pending = deferred();
  const list = new ApprovalListPage(f.page);
  list.waitPendingApi = async () => {
    f.events.push('listen-pending');
    await pending.promise;
  };
  list.waitListApi = async () => {
    f.events.push('listen');
    await f.response.promise;
    return null;
  };
  const navigation = list.goto();
  assert.deepEqual(f.events, ['listen-pending', 'listen', 'navigate']);
  f.response.resolve();
  pending.resolve();
  await navigation;
  list.dispose();
}

{
  const f = fixture();
  const list = new ApprovalListPage(f.page);
  list.waitListApi = async () => {
    f.events.push('listen');
    await f.response.promise;
    f.events.push('response');
    return null;
  };
  list.waitListSettled = async () => { f.events.push('settled'); };
  const mutation = (list as unknown as {
    withListMutation(action: () => Promise<void>): Promise<void>;
  }).withListMutation(async () => { f.events.push('click'); });
  await Promise.resolve();
  assert.deepEqual(f.events, ['listen', 'click']);
  f.response.resolve();
  await mutation;
  assert.deepEqual(f.events, ['listen', 'click', 'response', 'settled']);
  list.dispose();
}

console.log('list wait ordering verification passed');
