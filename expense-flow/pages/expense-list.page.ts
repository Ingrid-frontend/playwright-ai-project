import { type Page } from '@playwright/test';
import { GenericListPage, type ListCatalog } from '../../flow-kit/list/generic-list-page';
import { ExpenseEditPage } from './expense-edit.page';
import {
  COMBO_TRIGGER,
  DETAIL,
  DOC_NO_COLUMN,
  DOC_NO_RE,
  EMPTY_TEXT_RE,
  EXPOSED_FILTER_FIELDS,
  LIST_API_RE,
  LIST_LOAD_OPTS,
  LIST_PATH,
  LOADED_TEXT_RE,
  ROW,
  SEARCH_ACTION_CLEAR,
  SEARCH_ACTION_SEARCH,
  SEARCH_PLACEHOLDER,
  TABLE,
} from '../utils/expense-catalog';

/**
 * 报销流程列表页对象模型。
 *
 * 通用列表能力（导航 / 等接口 / 等 loading / 清筛选 / 空列表恢复）由 flow-kit GenericListPage 提供；
 * 加载行为见 catalog 的 LIST_LOAD_OPTS。
 */
export const EXPENSE_LIST_CATALOG: ListCatalog = {
  name: '报销列表',
  listPath: LIST_PATH,
  urlPattern: /expense-parent-report\/expense-report/,
  listApiRe: LIST_API_RE,
  table: TABLE,
  row: ROW,
  searchPlaceholder: SEARCH_PLACEHOLDER,
  docNoColumn: DOC_NO_COLUMN,
  docNoRe: DOC_NO_RE,
  emptyTextRe: EMPTY_TEXT_RE,
  loadedTextRe: LOADED_TEXT_RE,
  requireRowsOnLoad: false,
  searchActionSearch: SEARCH_ACTION_SEARCH,
  searchActionClear: SEARCH_ACTION_CLEAR,
  comboTrigger: COMBO_TRIGGER,
  comboClear: '.combo-trigger__clear',
  clearLabels: [...EXPOSED_FILTER_FIELDS],
  detailSelectors: DETAIL,
  ...LIST_LOAD_OPTS,
};

export class ExpenseListPage extends GenericListPage {
  constructor(page: Page) {
    super(page, EXPENSE_LIST_CATALOG);
  }

  async restoreDefaultList(): Promise<void> {
    await this.clearDocNoSearch().catch(() => undefined);
    await this.resetFilters().catch(() => undefined);
    await this.clickFilterSearch();
    await this.expectListReady();
  }

  // ---------- 本流程特有动作写在下面 ----------
  // 注意：业务内容在 zoom iframe 内，以下定位一律走 scope()，不能直接打顶层 page。

  /** 列表点「新建」进入报销单编辑（打开模板下拉/弹窗由 ExpenseEditPage 处理） */
  async clickNewExpense(): Promise<void> {
    await this.closeDetailIfOpen();
    const btn = this.scope()
      .getByRole('button', { name: /新\s*建|新建报销/ })
      .filter({ visible: true })
      .first();
    await btn.waitFor({ state: 'visible', timeout: 15_000 });
    await btn.click();
  }

  /** 关闭打开的详情侧滑/全屏（新建前清场） */
  async closeDetailIfOpen(): Promise<void> {
    const url = this.page.url();
    if (!url.includes(LIST_PATH)) return;
    const close = this.scope()
      .locator(
        '.slide-frame.slide-frame-open .anticon-close, .full-width-slideframe .ant-modal-close, .full-screen .anticon-close, [aria-label="Close"]',
      )
      .filter({ visible: true })
      .first();
    if (await close.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await close.click();
      await this.waitListSettled();
    }
  }

  /** 新建报销单：点新建 → 确认模板（如有）→ 进入编辑态 */
  async startNewExpense(formName?: string): Promise<ExpenseEditPage> {
    await this.closeDetailIfOpen();
    const edit = new ExpenseEditPage(this.page);
    await this.clickNewExpense();
    // 单模板直接进编辑；多模板下拉 / 弹窗
    const panel = this.scope()
      .locator('.ant-dropdown, .ant-select-dropdown, .ant-modal, .stations-dropdown-content')
      .filter({ visible: true })
      .last();
    if (await panel.isVisible({ timeout: 3_000 }).catch(() => false)) {
      const items = panel
        .locator('.ant-dropdown-menu-item, .ant-select-dropdown-menu-item, .ant-select-item-option, .ant-menu-item')
        .filter({ visible: true });
      const item = formName
        ? items.filter({ hasText: formName }).first()
        : items.first();
      await item.waitFor({ state: 'visible', timeout: 10_000 });
      await item.click({ force: true });
    }
    await edit.expectEditVisible();
    return edit;
  }
}
