import { type Page } from '@playwright/test';
import { GenericListPage, type ListCatalog } from '../../flow-kit/list/generic-list-page';
import {
  COMBO_TRIGGER,
  DOC_NO_COLUMN,
  DOC_NO_RE,
  EMPTY_TEXT_RE,
  EXPOSED_FILTER_FIELDS,
  LIST_API_RE,
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
 * 通用列表能力（导航 / 等接口 / 等 loading / 读表头 / 取首行某列 / 取单号 /
 * 行定位 / 搜索 / 清筛选 / 接口侧兜底）全部继承自 flow-kit 的 GenericListPage，
 * 由下面的 catalog 描述本页差异。
 *
 * 这里**只**写本页真正特有的动作，例如：页签切换、行内业务按钮、
 * 特殊弹窗、与别的页不同的详情判定。不要把通用逻辑再抄一遍。
 */
export const EXPENSE_LIST_CATALOG: ListCatalog = {
  name: '报销列表',
  listPath: LIST_PATH,
  urlPattern: /main\/expense/,
  listApiRe: LIST_API_RE,
  table: TABLE,
  row: ROW,
  searchPlaceholder: SEARCH_PLACEHOLDER,
  docNoColumn: DOC_NO_COLUMN,
  docNoRe: DOC_NO_RE,
  emptyTextRe: EMPTY_TEXT_RE,
  loadedTextRe: LOADED_TEXT_RE,
  /** 列表允许为空时改成 false */
  requireRowsOnLoad: false,
  searchActionSearch: SEARCH_ACTION_SEARCH,
  searchActionClear: SEARCH_ACTION_CLEAR,
  comboTrigger: COMBO_TRIGGER,
  comboClear: '.combo-trigger__clear',
  clearLabels: [...EXPOSED_FILTER_FIELDS],
};

export class ExpenseListPage extends GenericListPage {
  constructor(page: Page) {
    super(page, EXPENSE_LIST_CATALOG);
  }

  /**
   * 回到默认列表状态：清关键字 + 清外露筛选 + 重置。
   * golden 回归的每个用例结束都该调它，避免筛选状态串到下一个用例。
   */
  async restoreDefaultList(): Promise<void> {
    await this.clearDocNoSearch().catch(() => undefined);
    await this.clearAllExposedComboFilters().catch(() => undefined);
    await this.resetFilters().catch(() => undefined);
    await this.expectListReady();
  }

  // ---------- 本流程特有动作写在下面 ----------
  // 例：
  // async switchTab(tab: string): Promise<void> { ... }
  // async submitRow(code: string): Promise<void> { ... }
}
