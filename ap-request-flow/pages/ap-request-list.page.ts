import { type Page } from '@playwright/test';
import { GenericListPage, type ListCatalog } from '../../flow-kit/list/generic-list-page';
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
} from '../utils/ap-request-catalog';

/**
 * 对公申请单列表。通用能力在 GenericListPage，加载行为见 LIST_LOAD_OPTS。
 */
export const AP_REQUEST_LIST_CATALOG: ListCatalog = {
  name: '对公申请单列表',
  listPath: LIST_PATH,
  urlPattern: /main\/ap-request/,
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

export class ApRequestListPage extends GenericListPage {
  constructor(page: Page) {
    super(page, AP_REQUEST_LIST_CATALOG);
  }
}
