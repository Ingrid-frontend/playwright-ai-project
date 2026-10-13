import { type Locator, type Page, expect } from '@playwright/test';
import { GenericListPage, type ListCatalog } from '../../flow-kit/list/generic-list-page';
import { RequestEditPage } from './request-edit.page';
import {
  COMBO_CLEAR,
  COMBO_TRIGGER,
  DETAIL,
  DETAIL_MARKERS,
  DOC_NO_RE,
  FILTER_LABELS,
  LIST_API_RE,
  LIST_PATH,
  NEW_REQUEST_BTN,
  ROOT,
  ROW,
  SEARCH_ACTION_CLEAR,
  SEARCH_ACTION_SEARCH,
  SEARCH_PLACEHOLDER,
  TABLE,
} from '../utils/request-catalog';

/**
 * 申请单列表页对象模型。
 *
 * 通用列表能力（加载等待 / 读列 / 取单号 / 清筛选 / 行定位）全部继承自
 * flow-kit 的 GenericListPage，由 REQUEST_LIST_CATALOG 描述本页差异；
 * 这里只保留申请单特有的动作：事由筛选、新建单据、草稿复用处理。
 *
 * 页面事实（dev 实机 + 源码）：
 * - 路由 /main/request；列表 POST /api/applications/v4/search
 * - 业务 DOM 在 iframe[src*="openBySelf=zoom"] 内
 * - 表格 .application-table-v2 .ant-table / .ant-table-tbody tr.ant-table-row
 * - 搜索 placeholder「申请单号」；筛选条：高级搜索 + 外露 ComboTrigger（创建日期/状态…）
 */
export const REQUEST_LIST_CATALOG: ListCatalog = {
  name: '申请单列表',
  listPath: LIST_PATH,
  urlPattern: /request/,
  listApiRe: LIST_API_RE,
  table: TABLE,
  row: ROW,
  rowFallback: '.application-table-v2 .ant-table-tbody > tr[data-row-key]',
  searchPlaceholder: SEARCH_PLACEHOLDER,
  searchPlaceholderAlts: ['申请单号'],
  docNoColumn: FILTER_LABELS.docNo,
  docNoRe: DOC_NO_RE,
  emptyTextRe: /暂无数据|No Data/,
  loadedTextRe: /申请单/,
  loadedSelector: ROOT,
  requireRowsOnLoad: false,
  searchActionSearch: SEARCH_ACTION_SEARCH,
  searchActionClear: SEARCH_ACTION_CLEAR,
  comboTrigger: COMBO_TRIGGER,
  comboClear: COMBO_CLEAR,
  detailSelectors: DETAIL,
  detailTextRe: DETAIL_MARKERS,
  clearLabels: [
    FILTER_LABELS.createdDate,
    FILTER_LABELS.status,
    FILTER_LABELS.submitDate,
    FILTER_LABELS.applicant,
    FILTER_LABELS.company,
    FILTER_LABELS.formName,
  ],
  dashIsEmpty: true,
};

export class ExistingRequestDraftError extends Error {
  constructor(docNo: string) {
    super(`新建申请单遇到已有草稿单号 ${docNo}，已安全终止，未修改或删除草稿；请使用独立账号或人工确认后处理`);
    this.name = 'ExistingRequestDraftError';
  }
}

export class RequestListPage extends GenericListPage {
  constructor(page: Page) {
    super(page, REQUEST_LIST_CATALOG);
  }

  // ---------- 申请单特有的筛选组合 ----------

  async restoreDefaultList(): Promise<void> {
    await this.clearDocNoSearch();
    await this.resetFilters();
    await this.clickFilterSearch();
    await this.waitListSettled();
    await this.expectSearchEmpty();
  }

  async search(keyword: string, opts: { keepListFilters?: boolean } = {}): Promise<void> {
    if (opts.keepListFilters) {
      await this.clearDocNoSearch();
    } else {
      await this.clearListQuery();
    }
    const input = this.searchInput();
    await expect(input).toBeVisible({ timeout: 15_000 });
    const respP = this.waitListApi();
    await input.fill('');
    await input.fill(keyword);
    await input.press('Enter').catch(() => undefined);
    await respP;
    await this.waitListSettled();
  }

  protected filterPanel(): Locator {
    return this.scope()
      .locator('.advanced-search, .advanced-table-search-form, .advanced-search-filter-pop')
      .filter({ visible: true })
      .last();
  }

  private reasonFilterInput(): Locator {
    const panel = this.filterPanel();
    return panel
      .locator('.ant-form-item, [class*="form-item"]')
      .filter({ hasText: /事\s*由/ })
      .locator(
        'input#title, input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]), textarea',
      )
      .filter({ visible: true })
      .first()
      .or(panel.locator('input#title').filter({ visible: true }).first())
      .or(
        this.scope()
          .locator('.advanced-search input#title, .advanced-table-search-form input#title')
          .filter({ visible: true })
          .first(),
      );
  }

  /** AdvancedSearch：重置/搜索左侧的「展开所有条件」下拉箭头 */
  private expandAllFiltersBtn(): Locator {
    return this.scope()
      .locator('.advanced-search-footer-buttons .advanced-table-head-container-setting')
      .filter({ visible: true })
      .first();
  }

  async openFilterPanel(): Promise<void> {
    if (await this.reasonFilterInput().isVisible({ timeout: 1_000 }).catch(() => false)) return;

    const expandAll = this.expandAllFiltersBtn();
    await expect(expandAll, '未找到「展开所有条件」箭头').toBeVisible({ timeout: 10_000 });
    await expandAll.click();
    await this.reasonFilterInput()
      .waitFor({ state: 'visible', timeout: 10_000 })
      .catch(() => undefined);
  }

  async filterByReason(reason: string, opts: { keepListFilters?: boolean } = {}): Promise<void> {
    if (opts.keepListFilters) {
      await this.clearDocNoSearch();
    } else {
      await this.clearListQuery();
    }
    await this.openFilterPanel();
    const input = this.reasonFilterInput();
    await expect(input, '筛选区未展开可见的「事由」输入框').toBeVisible({ timeout: 10_000 });
    await input.click();
    await input.fill('');
    await input.fill(reason);
    await expect(input, '事由筛选关键字未写入').toHaveValue(reason, { timeout: 3_000 });
    const panel = this.filterPanel();
    const searchBtn = panel
      .getByRole('button', { name: /搜\s*索|查\s*询/ })
      .filter({ visible: true })
      .first();
    const respP = this.waitListApi();
    await expect(searchBtn, '筛选区未找到「搜索/查询」按钮').toBeVisible({ timeout: 5_000 });
    await searchBtn.click();
    await respP;
    await this.waitListSettled();
  }

  /** 「事由」列是否出现包含 keyword 的单元格 */
  async reasonKeywordExists(keyword: string): Promise<boolean> {
    return this.columnContains(FILTER_LABELS.reason, keyword);
  }

  /** 读指定单号所在行的「事由」前缀，用于 Golden 现场读取（不用单号前缀当事由） */
  async readReasonForDocNo(docNo: string, maxLen = 8): Promise<string> {
    let row = this.rowByCode(docNo);
    if (!(await row.isVisible({ timeout: 2_000 }).catch(() => false))) {
      await this.search(docNo, { keepListFilters: true });
      row = this.rowByCode(docNo);
    }
    await expect(row, `列表未找到单号「${docNo}」`).toBeVisible({ timeout: 20_000 });
    const idx = await this.columnIndex(FILTER_LABELS.reason);
    const reason = ((await row.locator('td').nth(idx).innerText()) || '').replace(/\s+/g, ' ').trim();
    if (!reason || reason === '-') throw new Error(`单号「${docNo}」所在行事由为空`);
    return reason.slice(0, Math.min(maxLen, reason.length));
  }

  /** 列表「事由」列为空时，打开详情读表单事由后回到列表 */
  async readReasonForDocNoFromDetail(docNo: string, maxLen = 8): Promise<string> {
    await this.search(docNo, { keepListFilters: true });
    await this.openByCode(docNo);
    const edit = new RequestEditPage(this.page);
    const reason = await edit.readReason(maxLen);
    await this.ensureOnList();
    return reason;
  }

  async expectReasonFilterResult(keyword: string): Promise<void> {
    let detail = '';
    await expect
      .poll(async () => {
        let idx: number;
        try {
          idx = await this.columnIndex(FILTER_LABELS.reason);
        } catch {
          detail = '未找到事由列';
          return false;
        }
        // 排除固定列克隆行：其隐藏 td 常为空，会让 every() 误判「存在不匹配行」
        const reasons = await this.dataRows().evaluateAll((trs, colIdx) => {
          const out: string[] = [];
          for (const tr of trs) {
            if (tr.closest('.ant-table-fixed-right, .ant-table-fixed-left')) continue;
            if (tr.querySelector('.ant-table-placeholder')) continue;
            const tds = tr.querySelectorAll(':scope > td');
            if (tds.length <= colIdx) continue;
            out.push((tds[colIdx].textContent || '').replace(/\s+/g, ' ').trim());
          }
          return out;
        }, idx);
        detail = reasons.length ? reasons.slice(0, 8).join(' | ') : '无事由单元格';
        return reasons.length > 0 && reasons.every((reason) => reason.includes(keyword));
      }, {
        timeout: 20_000,
        message: `事由筛选「${keyword}」后存在不匹配行，拒绝从默认列表取号`,
      })
      .toBe(true)
      .catch(() => {
        throw new Error(
          `事由筛选「${keyword}」后存在不匹配行，拒绝从默认列表取号；实际事由：${detail || '(空)'}`,
        );
      });
  }

  // openByCode 不再 override：基类已按 catalog 的 detailSelectors/detailTextRe
  // 做事件驱动等待（等 DETAIL 容器 + DETAIL_MARKERS 文案），行为与本类旧实现等价。

  /** 默认先清筛选；已按事由筛选并校验的调用须显式保留筛选。 */
  override async pickFirstDocNo(opts: { keepListFilters?: boolean } = {}): Promise<string> {
    if (!opts.keepListFilters) {
      await this.clearListQuery();
      if (!(await this.hasDataRows())) {
        await this.clickFilterSearch();
      }
    }
    await expect
      .poll(async () => await this.dataRows().count().catch(() => 0), {
        timeout: 20_000,
        message: '列表没有可解析单号的数据行',
      })
      .toBeGreaterThan(0);

    try {
      return await this.readFirstDocNo();
    } catch {
      /* pickFirstDocNo 兜底 */
    }
    const row = this.dataRows().first();
    await expect(row, '列表没有可解析单号的数据行').toBeVisible({ timeout: 5_000 });
    const text = (await row.innerText()).replace(/\s+/g, ' ');
    const match = text.match(DOC_NO_RE) || text.match(/[A-Za-z0-9]{8,}/);
    if (!match) {
      throw new Error(`首行未解析到单号：${text.slice(0, 120)}`);
    }
    return match[0];
  }

  // ---------- 新建申请单 ----------

  /** 关掉仍打开的详情/全屏，避免「新建」落到旧单；spec 的失败恢复也会直接调它 */
  async closeDetailIfOpen(): Promise<void> {
    const back = this.scope().getByRole('button', { name: /^返\s*回$/ }).filter({ visible: true }).first();
    if (await back.isVisible({ timeout: 1_500 }).catch(() => false)) {
      await back.click();
      await this.waitListSettled();
      return;
    }
    const close = this.scope()
      .locator(
        '.slide-frame.slide-frame-open .anticon-close, .full-width-slideframe .ant-modal-close, [aria-label="Close"]',
      )
      .filter({ visible: true })
      .first();
    if (await close.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await close.click();
      await this.waitListSettled();
    }
  }

  /** 新建空白申请单；已有单号的草稿归属不可证明，必须安全终止。 */
  async startNewRequest(formName?: string): Promise<RequestEditPage> {
    await this.closeDetailIfOpen();
    const edit = new RequestEditPage(this.page);
    await this.clickNewRequest();
    await edit.confirmNewRequestModal(formName);
    await edit.expectEditVisible();
    const docNo = await edit.tryReadDocNo();
    if (docNo) throw new ExistingRequestDraftError(docNo);
    return edit;
  }

  async clickNewRequest(): Promise<void> {
    await this.closeDetailIfOpen();
    const btn = this.scope().getByRole('button', { name: NEW_REQUEST_BTN }).first();
    await expect(btn, '未找到「新建申请单」按钮').toBeVisible({ timeout: 15_000 });

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await btn.click();

      const empty = this.scope().getByText(/暂无可创建的单据/).filter({ visible: true }).first();
      const tipVisible = await empty.isVisible({ timeout: 2_500 }).catch(() => false);
      if (!tipVisible) {
        // 下拉/弹窗/直进编辑均算成功；available 可能在进列表时已请求，不必再等
        return;
      }

      if (attempt === 2) {
        throw new Error('新建申请单：暂无可创建的单据（模板列表为空或 available 接口异常）');
      }

      // available 接口刚报空，重新进列表触发刷新（替代旧版 2s 盲等）
      await this.goto();
      await this.expectLoaded();
    }
  }
}
