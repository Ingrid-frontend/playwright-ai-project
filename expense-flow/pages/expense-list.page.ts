import { type Page } from '@playwright/test';
import { GenericListPage, type ListCatalog } from '../../flow-kit/list/generic-list-page';
import {
  COMBO_TRIGGER,
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
}
