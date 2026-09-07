import { type Locator, type Page, expect } from '@playwright/test';
import { GenericListPage, type ListCatalog } from '../../flow-kit/list/generic-list-page';
import {
  BUSINESS_TYPE_SELECT,
  COMBO_TRIGGER,
  DETAIL,
  DOC_NO_RE,
  EXPOSED_FILTER_FIELDS,
  FILTER_LABELS,
  FILTER_POP,
  FILTER_ROW,
  FILTER_TRIGGER,
  LIST_API,
  LIST_API_RE,
  LIST_PATH,
  ROW,
  SEARCH_ACTION_CLEAR,
  SEARCH_ACTION_SEARCH,
  SEARCH_PLACEHOLDER,
  TAB,
  TABLE,
  TABS,
} from '../utils/approval-catalog';

/** 审批中心页签（dev 实机：待审批-全部 / 我的已办 / 抄送我 / 操作历史） */
export type ApprovalTab = '待审批-全部' | '待审批' | '我的已办' | '已审批' | '抄送我' | '操作历史';

/**
 * 审批列表页对象模型。
 *
 * 通用列表能力（加载等待 / 读列 / 取单号 / 行定位）继承自 flow-kit 的 GenericListPage，
 * 由 APPROVAL_LIST_CATALOG 描述本页差异；这里只保留审批特有动作：
 * 页签切换、业务类型下拉、外露筛选填值、通过/驳回、详情断言。
 *
 * 页面事实（dev 实机 + 源码）：
 * - 路由 /main/approve；列表 POST /api/approvals/pendingApproval
 * - 业务 DOM 在 iframe[src*="openBySelf=zoom"] 内
 * - 表格 .ant-table / .ant-table-tbody tr.ant-table-row（虚拟滚动，只校验视口内行）
 * - 搜索 placeholder「申请人/事由/单号」
 * - 筛选条：全部业务类型 Select、筛选面板、外露 ComboTrigger（单号等）、搜索/清除外露筛选值
 * - 行内操作列有「通过」「驳回」；点行打开全屏 .approve-entrance
 */
export const APPROVAL_LIST_CATALOG: ListCatalog = {
  name: '审批列表',
  listPath: LIST_PATH,
  urlPattern: /approve/,
  listApiRe: LIST_API_RE,
  table: TABLE,
  row: ROW,
  searchPlaceholder: SEARCH_PLACEHOLDER,
  searchPlaceholderAlts: ['单号', '申请人'],
  docNoColumn: FILTER_LABELS.docNo,
  docNoRe: DOC_NO_RE,
  emptyTextRe: /暂无数据|No Data|没有更多|暂无待审批/,
  loadedTextRe: /我的审批|待审批/,
  requireRowsOnLoad: false,
  searchActionSearch: SEARCH_ACTION_SEARCH,
  searchActionClear: SEARCH_ACTION_CLEAR,
  comboTrigger: COMBO_TRIGGER,
  comboClear: '.combo-trigger__clear',
  clearLabels: [...EXPOSED_FILTER_FIELDS],
  dashIsEmpty: false,
};

export class ApprovalListPage extends GenericListPage {
  constructor(page: Page) {
    super(page, APPROVAL_LIST_CATALOG);
  }

  /** 等待「待审批」主数据接口返回（可能在 goto 前已返回，故 catch 兜底） */
  async waitPendingApi() {
    await this.waitListApi();
  }

  /** 已在审批列表时还原筛选：先面板「清除筛选值」，再清外露（与申请单 reset 不同） */
  async resetFilterState(): Promise<void> {
    await this.closeFilterPanel().catch(() => undefined);
    await this.resetBusinessType().catch(() => undefined);
    await this.clearFilterPanel().catch(() => undefined);
    if (await this.hasExposedClear()) {
      await this.clearExposedFilters().catch(() => undefined);
    }
    await this.expectListReady();
  }

  /** 列表因筛选为空时，走审批专用重置（不用通用 clearListQuery） */
  override async recoverIfEmptyList(): Promise<boolean> {
    if (await this.hasDataRows()) return true;
    await this.switchToPending().catch(() => undefined);
    await this.resetFilterState().catch(() => undefined);
    return this.hasDataRows();
  }

  async switchToPending(): Promise<void> {
    await this.switchTab(TABS.pending);
    await this.expectListReady();
  }

  // ---------- 页签切换 ----------

  /** 切换到指定页签（待审批 / 已审批 / 抄送我 / 操作历史），支持子串匹配 */
  async switchTab(tab: ApprovalTab | string): Promise<void> {
    const tabEl = this.scope().locator(TAB).filter({ hasText: tab }).first();
    await expect(tabEl, `未找到页签「${tab}」`).toBeVisible({ timeout: 20_000 });

    const apiHint = /已办|已审批/.test(String(tab))
      ? '/api/approvals/approved'
      : /抄送/.test(String(tab))
        ? '/api/approvals/copiedToMe'
        : LIST_API;

    for (let i = 0; i < 4; i += 1) {
      const respP = this.page.waitForResponse(
        (r) => r.url().includes(apiHint) && r.request().method() === 'POST',
        { timeout: 20_000 },
      );
      await tabEl.click();
      const resp = await respP.catch(() => null);
      if (resp && resp.status() === 200) break;
      await this.page.waitForTimeout(3_000);
    }
    await this.waitListSettled();
  }

  // ---------- 搜索 ----------

  /** 触发列表刷新后等待：部分筛选/清除不会打列表接口，避免空等 waitListApi 满超时 */
  private async withListMutation(action: () => Promise<void>, apiTimeout = 8_000): Promise<void> {
    const respP = this.waitListApi(apiTimeout);
    await action();
    await Promise.race([respP, this.waitListSettled()]);
    await this.waitListSettled();
  }

  override async search(keyword: string): Promise<void> {
    const input = this.searchInput();
    await expect(input, '未找到审批列表搜索框').toBeVisible({ timeout: 15_000 });
    await input.click();
    await input.fill('');
    await input.fill(keyword);

    const icon = this.scope()
      .getByRole('img', { name: /search/i })
      .or(this.scope().locator('.anticon-search'))
      .filter({ visible: true })
      .first();
    const textSearch = this.scope().getByText('搜索', { exact: true }).filter({ visible: true }).first();
    await this.withListMutation(async () => {
      if (await icon.isVisible({ timeout: 1_500 }).catch(() => false)) {
        await icon.click();
      } else if (await textSearch.isVisible({ timeout: 1_000 }).catch(() => false)) {
        await textSearch.click();
      } else {
        await input.press('Enter');
      }
    });
  }

  /** 新建提交后审批列表偶发索引延迟：多次搜索直到行出现 */
  async searchUntilRow(code: string, attempts = 4): Promise<void> {
    let lastErr: unknown;
    for (let i = 0; i < attempts; i += 1) {
      try {
        if (i > 0) {
          await this.page.waitForTimeout(2_000 * i);
          await this.goto();
          await this.expectLoaded();
        }
        await this.search(code);
        await this.expectRowContains(code);
        return;
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }

  // ---------- 筛选 ----------

  filterTrigger(): Locator {
    return this.scope().locator(FILTER_TRIGGER).first();
  }

  filterPanel(): Locator {
    return this.scope().locator(FILTER_POP).first();
  }

  async expectFilterBarVisible(): Promise<void> {
    await expect(
      this.scope().getByText(FILTER_LABELS.businessType).first(),
      '未找到「全部业务类型」',
    ).toBeVisible({ timeout: 20_000 });
    await expect(this.filterTrigger(), '未找到「筛选」按钮').toBeVisible({
      timeout: 15_000,
    });
  }

  async expectExposedFiltersVisible(): Promise<void> {
    for (const label of EXPOSED_FILTER_FIELDS) {
      await expect(this.exposedField(label), `未找到外露「${label}」`).toBeVisible({
        timeout: 15_000,
      });
    }
    await expect(this.scope().locator(SEARCH_ACTION_SEARCH).first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(this.scope().locator(SEARCH_ACTION_CLEAR).first()).toBeVisible({
      timeout: 10_000,
    });
  }

  async isFilterPanelOpen(): Promise<boolean> {
    return this.filterPanel().isVisible({ timeout: 1_000 }).catch(() => false);
  }

  async openFilterPanel(): Promise<void> {
    if (await this.isFilterPanelOpen()) return;
    await expect(this.filterTrigger()).toBeVisible({ timeout: 15_000 });
    await this.filterTrigger().click();
    await this.expectFilterPanelVisible();
  }

  async expectFilterPanelVisible(): Promise<void> {
    await expect(this.filterPanel(), '筛选面板未打开').toBeVisible({
      timeout: 15_000,
    });
    await expect(
      this.scope().locator(FILTER_ROW).first(),
      '筛选面板没有条件行',
    ).toBeVisible({ timeout: 15_000 });
  }

  async closeFilterPanel(): Promise<void> {
    if (!(await this.isFilterPanelOpen())) return;
    const closeIcon = this.scope()
      .locator('.advanced-search-filter-title')
      .locator('svg, [class*="icon"]')
      .last();
    if (await closeIcon.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await closeIcon.click();
    } else {
      await this.filterTrigger().click();
    }
    await expect(this.filterPanel()).toBeHidden({ timeout: 10_000 }).catch(() => undefined);
  }

  /** 业务类型下拉选项（不含「全部业务类型」） */
  async listBusinessTypes(): Promise<string[]> {
    const select = this.scope().locator(BUSINESS_TYPE_SELECT).first();
    await expect(select, '未找到业务类型下拉').toBeVisible({ timeout: 15_000 });
    await select.click();
    const items = this.scope().locator(
      '.ant-select-dropdown:visible .ant-select-dropdown-menu-item, .ant-select-dropdown:visible .ant-select-item-option',
    );
    await expect(items.first(), '业务类型下拉没有选项').toBeVisible({ timeout: 10_000 });
    const texts = (await items.allInnerTexts())
      .map((t) => t.replace(/\s+/g, ' ').trim())
      .filter((t) => t && !/全部业务类型/.test(t));
    await this.page.keyboard.press('Escape').catch(() => undefined);
    return texts;
  }

  /** 切换业务类型；不传则选第一条非「全部」；选完等列表刷新 */
  async selectBusinessType(name?: string): Promise<void> {
    const select = this.scope().locator(BUSINESS_TYPE_SELECT).first();
    await expect(select, '未找到业务类型下拉').toBeVisible({ timeout: 15_000 });
    await select.click();
    const dropdown = this.scope().locator('.ant-select-dropdown:visible').last();
    await expect(dropdown).toBeVisible({ timeout: 10_000 });
    const items = dropdown.locator('.ant-select-dropdown-menu-item, .ant-select-item-option');
    const option = name
      ? items.filter({ hasText: name }).first()
      : items.filter({ hasNotText: /全部业务类型/ }).first();
    await expect(option, `业务类型下拉没有「${name || '非全部'}」`).toBeVisible({
      timeout: 10_000,
    });
    await this.withListMutation(() => option.click());
  }

  async resetBusinessType(): Promise<void> {
    const select = this.scope().locator(BUSINESS_TYPE_SELECT).first();
    const current = ((await select.innerText()) || '').replace(/\s+/g, ' ');
    if (/全部业务类型/.test(current)) return;
    await this.selectBusinessType(FILTER_LABELS.businessType);
  }

  exposedField(label: string): Locator {
    return this.scope()
      .locator(COMBO_TRIGGER)
      .filter({ has: this.scope().locator('.combo-trigger__label', { hasText: label }) })
      .first();
  }

  async fillExposedField(label: string, value: string): Promise<void> {
    if (label === FILTER_LABELS.company) {
      await this.selectExposedCompany(value);
      return;
    }
    if (label === FILTER_LABELS.submitDate) {
      await this.fillExposedDate(value);
      return;
    }

    const trigger = this.exposedField(label);
    await expect(trigger, `未找到外露「${label}」筛选`).toBeVisible({ timeout: 15_000 });
    await trigger.locator('.combo-trigger__toggle').click();

    const candidates = [
      trigger.locator('input:not([readonly])'),
      trigger.locator('..').locator('input:not([readonly])'),
      this.scope().locator('.ant-select-dropdown:visible input:not([readonly])'),
      this.scope().locator('.ant-dropdown:visible input:not([readonly])'),
    ];
    for (const loc of candidates) {
      const input = loc.first();
      if (!(await input.isVisible({ timeout: 1_000 }).catch(() => false))) continue;
      await input.fill('');
      await input.fill(value);
      const opt = this.scope()
        .locator('.ant-select-dropdown:visible li, .ant-dropdown-menu:visible li')
        .filter({ hasText: value })
        .first();
      if (await opt.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await opt.click();
      } else {
        await this.page.keyboard.press('Enter').catch(() => undefined);
      }
      await this.page.keyboard.press('Escape').catch(() => undefined);
      return;
    }

    throw new Error(`无法在「${label}」筛选控件填入「${value}」`);
  }

  /** 单据公司：弹窗「选择公司」 */
  async selectExposedCompany(search?: string): Promise<void> {
    const trigger = this.exposedField(FILTER_LABELS.company);
    await expect(trigger).toBeVisible({ timeout: 15_000 });
    await trigger.locator('.combo-trigger__toggle').click();
    const modal = this.scope().locator('.ant-modal').filter({ hasText: '选择公司' }).last();
    await expect(modal, '未打开「选择公司」弹窗').toBeVisible({ timeout: 15_000 });

    if (search) {
      const codeInput = modal.getByRole('textbox', { name: '公司编码' });
      if (await codeInput.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await codeInput.fill(search);
      } else {
        await modal.locator('input[placeholder="请输入"]').last().fill(search);
      }
      await modal.getByRole('button', { name: /搜\s*索/ }).click();
      await this.waitListSettled();
    } else {
      await modal.getByRole('button', { name: /搜\s*索/ }).click();
      await this.waitListSettled();
    }

    const row = modal.locator('table').nth(1).locator('tr').first();
    if (!(await row.isVisible({ timeout: 3_000 }).catch(() => false))) {
      const fallback = modal.getByRole('row').filter({ hasText: /DEV|公司编码|002/ }).first();
      await expect(fallback, '选择公司弹窗没有数据行').toBeVisible({ timeout: 15_000 });
      const cb2 = fallback.locator('input[type=checkbox], .ant-checkbox-input').first();
      if (await cb2.isVisible({ timeout: 2_000 }).catch(() => false)) await cb2.click();
      else await fallback.click();
      await modal.getByRole('button', { name: /确\s*定/ }).click();
      await expect(modal).toBeHidden({ timeout: 15_000 }).catch(() => undefined);
      return;
    }
    await expect(row, '选择公司弹窗没有数据行').toBeVisible({ timeout: 15_000 });
    const cb = row.locator('input[type=checkbox], .ant-checkbox-input').first();
    if (await cb.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await cb.click();
    } else {
      await row.click();
    }
    await modal.getByRole('button', { name: /确\s*定/ }).click();
    await expect(modal).toBeHidden({ timeout: 15_000 }).catch(() => undefined);
  }

  /** 提交日期：只读日历，点选日期格 */
  async fillExposedDate(value: string): Promise<void> {
    const m = value.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (!m) throw new Error(`日期格式无效：${value}`);
    const title = `${m[1]}-${m[2]}-${m[3]}`;

    const trigger = this.exposedField(FILTER_LABELS.submitDate);
    await expect(trigger).toBeVisible({ timeout: 15_000 });
    await trigger.locator('.combo-trigger__toggle').click();
    const roInput = trigger.locator('input.ant-calendar-picker-input, input[readonly]').first();
    if (await roInput.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await roInput.click();
    }

    const calendar = this.scope()
      .locator(
        '.ant-calendar-picker-container:visible, .ant-calendar:visible, .ant-picker-dropdown:visible',
      )
      .last();
    await expect(calendar).toBeVisible({ timeout: 10_000 });

    const byTitle = calendar.locator(`td[title="${title}"], td[title*="${title}"]`).first();
    if (await byTitle.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await byTitle.click();
    } else {
      const day = String(Number(m[3]));
      await calendar
        .locator('.ant-calendar-date, .ant-picker-cell-inner')
        .filter({ hasText: day })
        .first()
        .click();
    }

    const endCell = calendar.locator(`td[title="${title}"], td[title*="${title}"]`).first();
    if (await endCell.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await endCell.click().catch(() => undefined);
    }
    await this.page.keyboard.press('Escape').catch(() => undefined);
  }

  async fillExposedDocNo(docNo: string): Promise<void> {
    const trigger = this.exposedField(FILTER_LABELS.docNo);
    await expect(trigger, `未找到外露「${FILTER_LABELS.docNo}」筛选`).toBeVisible({
      timeout: 15_000,
    });
    const input = trigger.locator('input:not([readonly])').first();
    if (await input.isVisible({ timeout: 1_500 }).catch(() => false)) {
      await input.fill('');
      await input.fill(docNo);
      return;
    }
    await this.fillExposedField(FILTER_LABELS.docNo, docNo);
  }

  async filterByExposedField(label: string, value: string): Promise<void> {
    await this.fillExposedField(label, value);
    await this.clickExposedSearch();
  }

  async clickExposedSearch(): Promise<void> {
    const btn = this.scope().locator(SEARCH_ACTION_SEARCH).first();
    await expect(btn, '未找到「搜索」').toBeVisible({ timeout: 10_000 });
    await this.withListMutation(() => btn.click());
  }

  async clearExposedFilters(): Promise<void> {
    const btn = this.scope().locator(SEARCH_ACTION_CLEAR).first();
    await expect(btn, '未找到「清除外露筛选值」').toBeVisible({ timeout: 10_000 });
    await this.withListMutation(() => btn.click());
  }

  /** 在筛选面板里给指定字段填值（字段已存在则直接填，否则添加条件） */
  async fillFilterPanelField(label: string, value: string): Promise<void> {
    await this.openFilterPanel();
    const rows = this.scope().locator(FILTER_ROW);
    const hit = rows.filter({ hasText: label }).first();
    if (await hit.isVisible({ timeout: 2_000 }).catch(() => false)) {
      const input = hit.locator('input').first();
      await expect(input).toBeVisible({ timeout: 10_000 });
      await input.fill('');
      await input.fill(value);
      return;
    }
    const add = this.scope().getByText(FILTER_LABELS.addCondition).first();
    await expect(add, '筛选面板没有「添加条件」').toBeVisible({ timeout: 10_000 });
    await add.click();
    const lastRow = rows.last();
    await lastRow.locator('.ant-select').first().click();
    const opt = this.scope()
      .locator(
        '.ant-select-dropdown:visible .ant-select-dropdown-menu-item, .ant-select-dropdown:visible .ant-select-item-option',
      )
      .filter({ hasText: label })
      .first();
    await expect(opt, `筛选字段没有「${label}」`).toBeVisible({ timeout: 10_000 });
    await opt.click();
    const input = lastRow.locator('input').first();
    await expect(input).toBeVisible({ timeout: 10_000 });
    await input.fill(value);
  }

  async submitFilterPanel(): Promise<void> {
    const btn = this.filterPanel()
      .locator('.search-btn')
      .or(this.filterPanel().getByRole('button', { name: FILTER_LABELS.search }))
      .first();
    await expect(btn, '筛选面板没有「搜索」').toBeVisible({ timeout: 10_000 });
    await this.withListMutation(() => btn.click());
  }

  async filterByPanelField(label: string, value: string): Promise<void> {
    await this.fillFilterPanelField(label, value);
    await this.submitFilterPanel();
  }

  async clearFilterPanel(): Promise<void> {
    await this.openFilterPanel();
    const clearBtn = this.filterPanel()
      .getByRole('button', { name: FILTER_LABELS.clearPanel })
      .or(
        this.scope()
          .locator('.advanced-search-filter-footer')
          .getByRole('button', { name: FILTER_LABELS.clearPanel }),
      )
      .first();
    if (!(await clearBtn.isVisible({ timeout: 3_000 }).catch(() => false))) {
      await this.closeFilterPanel();
      return;
    }
    await this.withListMutation(() => clearBtn.click({ force: true }));
    if (await this.isFilterPanelOpen()) {
      await this.submitFilterPanel();
    }
  }

  /** 取首行单号并走顶部关键词搜索 */
  async searchByFirstDocNo(): Promise<string> {
    const docNo = await this.pickFirstDocNo();
    await this.search(docNo);
    await this.expectRowContains(docNo);
    return docNo;
  }

  async hasExposedDocNo(): Promise<boolean> {
    return this.exposedField(FILTER_LABELS.docNo).isVisible({ timeout: 3_000 }).catch(() => false);
  }

  async hasExposedClear(): Promise<boolean> {
    return this.scope().locator(SEARCH_ACTION_CLEAR).isVisible({ timeout: 3_000 }).catch(() => false);
  }

  /** 优先走外露单号；没有外露则打开筛选面板填单号 */
  async filterByDocNo(docNo: string): Promise<void> {
    if (await this.hasExposedDocNo()) {
      await this.filterByExposedField(FILTER_LABELS.docNo, docNo);
      return;
    }
    await this.fillFilterPanelField(FILTER_LABELS.docNo, docNo);
    await this.submitFilterPanel();
  }

  /** 清除面板 + 外露筛选（审批两条路径都要走，先面板后外露） */
  async clearFilters(): Promise<void> {
    await this.clearFilterPanel().catch(() => undefined);
    if (await this.hasExposedClear()) {
      await this.clearExposedFilters().catch(() => undefined);
    }
    await this.expectListReady();
  }

  // ---------- 打开单据详情 ----------

  /** 打开列表第一条数据行的详情 */
  async openFirstRow(): Promise<void> {
    const row = this.dataRows().first();
    await expect(row).toBeVisible({ timeout: 20_000 });
    const code = await this.pickFirstDocNo();
    await row.getByText(code).first().click();
    await this.waitDetailVisible();
  }

  override async openByCode(code: string): Promise<void> {
    const row = this.rowByCode(code);
    await expect(row, `未找到单据「${code}」，请确认其存在于当前列表`).toBeVisible({
      timeout: 20_000,
    });
    await this.closeFilterPanel().catch(() => undefined);
    await this.waitListSettled();
    await row.scrollIntoViewIfNeeded();
    const cell = row.locator('td', { hasText: code }).first();
    const target = (await cell.count()) > 0 ? cell : row.getByText(code).first();
    try {
      await target.click({ timeout: 8_000 });
    } catch {
      await target.click({ force: true, timeout: 8_000 });
    }
    await this.waitDetailVisible();
  }

  // ---------- 详情断言 ----------

  /** 全屏详情（dev 实机为 .approve-entrance，不是 .ant-modal） */
  detailEntrance(): Locator {
    return this.scope().locator(DETAIL).first();
  }

  /** 详情弹窗（批量通过等场景仍可能出现） */
  detailModal(): Locator {
    return this.scope().locator('.ant-modal').filter({ visible: true }).first();
  }

  /** 详情相关文案定位（详情/审批意见/基本信息/操作历史/单号） */
  detailContentText(): Locator {
    return this.scope().getByText(/详情|审批意见|基本信息|操作历史|单号/);
  }

  async waitDetailVisible(): Promise<void> {
    const entrance = this.scope().locator(`${DETAIL}, .full-screen, .full-screen-mask`).first();
    await expect(entrance, '未打开审批详情（.approve-entrance / full-screen）').toBeVisible({
      timeout: 20_000,
    });
  }

  async expectDetailVisible(): Promise<void> {
    await this.waitDetailVisible();
  }

  // ---------- 审批动作 ----------

  /**
   * 操作列「通过/驳回」：dev 实机在右侧固定表（.ant-table-fixed-right），
   * 与数据行分表，不能只用 dataRow.locator('td').last()。
   */
  private actionButton(name: RegExp): Locator {
    const fixed = this.scope()
      .locator('.ant-table-fixed-right')
      .getByRole('button', { name })
      .filter({ visible: true });
    const any = this.scope().getByRole('button', { name }).filter({ visible: true });
    return fixed.or(any).first();
  }

  /** 在指定行（或首行）的操作列点击「通过」；若弹出意见框则自动填写 */
  async approveRow(comment?: string, code?: string): Promise<void> {
    if (code) {
      await expect(this.rowByCode(code), `未找到单据「${code}」`).toBeVisible({ timeout: 20_000 });
    } else {
      await expect(this.dataRows().first()).toBeVisible({ timeout: 20_000 });
    }
    const btn = this.actionButton(/^\s*通\s*过\s*$/);
    await expect(btn, '未在操作列找到「通过」按钮').toBeVisible({ timeout: 10_000 });
    await btn.click();
    await this.fillCommentDialogIfNeeded(comment, false);
    await this.confirmIfNeeded();
  }

  /** 在指定行（或首行）的操作列点击「驳回」；若弹出意见框则自动填写 */
  async rejectRow(comment?: string, code?: string): Promise<void> {
    if (code) {
      await expect(this.rowByCode(code), `未找到单据「${code}」`).toBeVisible({ timeout: 20_000 });
    } else {
      await expect(this.dataRows().first()).toBeVisible({ timeout: 20_000 });
    }
    const btn = this.actionButton(/^\s*驳\s*回\s*$/);
    await expect(btn, '未在操作列找到「驳回」按钮').toBeVisible({ timeout: 10_000 });
    await btn.click();
    await expect(
      this.scope().getByRole('dialog').filter({ hasText: /驳回意见|审批驳回/ }),
      '未出现审批驳回弹窗',
    ).toBeVisible({ timeout: 15_000 });
    await this.fillCommentDialogIfNeeded(comment, true);
    await this.confirmIfNeeded();
  }

  /** 点击通过/驳回后，填写意见并点弹窗内「确定」 */
  private async fillCommentDialogIfNeeded(comment?: string, required = false): Promise<void> {
    if (!comment) return;
    const dialog = this.scope()
      .getByRole('dialog')
      .filter({ hasText: /驳回意见|审批意见|审批驳回|审批通过/ })
      .filter({ visible: true })
      .last();
    if (!required) {
      if (!(await dialog.isVisible({ timeout: 3_000 }).catch(() => false))) return;
    } else {
      await expect(dialog, '未出现审批意见弹窗').toBeVisible({ timeout: 15_000 });
    }

    // 驳回优先点快捷回复（contenteditable 手输偶发未写入受控值）
    let filled = false;
    const quick = dialog.getByText(/test审批意见\d+/).first();
    if (await quick.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await quick.click();
      filled = true;
    }
    if (!filled) {
      filled = await this.fillDialogComment(dialog, comment);
    }

    const counter = dialog.getByText(/\d+\s*\/\s*500/);
    if (await counter.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await expect(counter, '驳回意见未填写').not.toHaveText(/^0\s*\/\s*500/, { timeout: 8_000 });
    } else if (!filled) {
      throw new Error('审批意见弹窗：未找到可填写的输入框');
    }

    const ok = dialog.getByRole('button', { name: /^确\s*定$/ }).filter({ visible: true }).last();
    await expect(ok, '审批意见弹窗未找到「确定」').toBeVisible({ timeout: 8_000 });
    await this.withListMutation(async () => {
      await ok.click();
      await expect(dialog).toBeHidden({ timeout: 20_000 });
    }, 15_000);
  }

  private async fillDialogComment(dialog: Locator, comment: string): Promise<boolean> {
    const item = dialog.locator('.ant-form-item').filter({ hasText: /驳回意见|审批意见/ }).first();
    const targets = [
      item.locator('textarea').first(),
      item.locator('[contenteditable="true"]').first(),
      item.getByRole('textbox').first(),
      dialog.locator('textarea').first(),
      dialog.locator('[contenteditable="true"]').first(),
    ];

    for (const target of targets) {
      if (!(await target.isVisible({ timeout: 500 }).catch(() => false))) continue;
      await target.click();
      const ok = await target
        .fill(comment)
        .then(() => true)
        .catch(async () => {
          await this.page.keyboard.press('Meta+a').catch(() => this.page.keyboard.press('Control+a'));
          await this.page.keyboard.type(comment, { delay: 15 });
          return true;
        });
      if (ok) return true;
    }

    const ph = item.getByText('请输入').first();
    if (await ph.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await ph.click();
      await this.page.keyboard.type(comment, { delay: 15 });
      return true;
    }

    const box = item.locator('div').filter({ hasText: '请输入' }).first();
    if (await box.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await box.click();
      await this.page.keyboard.type(comment, { delay: 15 });
      return true;
    }

    return false;
  }

  /** 填写「审批意见」（详情弹窗场景） */
  async fillApprovalComment(comment: string): Promise<void> {
    const ta = this.scope()
      .locator(`${DETAIL} textarea, .approve-bar textarea, .ant-modal textarea, .ant-drawer textarea`)
      .first();
    await expect(ta).toBeVisible({ timeout: 15_000 });
    await ta.fill(comment);
  }

  /** 审批通过（带意见），并兜底处理二次确认弹窗 */
  async approve(comment: string): Promise<void> {
    await this.fillApprovalComment(comment);
    const btn = this.scope().getByRole('button', { name: /通\s*过|同\s*意|批\s*准/ }).last();
    await expect(btn).toBeVisible({ timeout: 15_000 });
    await btn.click();
    await this.confirmIfNeeded();
  }

  /** 审批驳回（带意见），并兜底处理二次确认弹窗 */
  async reject(comment: string): Promise<void> {
    await this.fillApprovalComment(comment);
    const btn = this.scope().getByRole('button', { name: /驳\s*回|拒\s*绝/ }).last();
    await expect(btn).toBeVisible({ timeout: 15_000 });
    await btn.click();
    await this.confirmIfNeeded();
  }

  private async confirmIfNeeded(): Promise<void> {
    const confirm = this.scope().getByRole('button', { name: /确\s*定|确\s*认/ }).last();
    if (await confirm.isVisible({ timeout: 3000 }).catch(() => false)) {
      await confirm.click();
    }
  }

  // ---------- 结果校验 ----------

  /** 断言出现审批成功类提示；toast 闪过时用「待审批行消失」兜底 */
  async expectApprovalSuccess(goneText?: string): Promise<void> {
    const msg = /审批成功|驳回成功|提交成功|操作成功|已通过|已驳回|审批完成|处理成功/;
    const toast = this.scope()
      .locator('.ant-message, .ant-notification')
      .getByText(msg)
      .or(this.scope().getByText(msg))
      .or(this.page.locator('.ant-message, .ant-notification').getByText(msg))
      .filter({ visible: true })
      .first();

    const toastOk = await toast.isVisible({ timeout: 12_000 }).catch(() => false);
    if (toastOk) return;

    if (goneText) {
      await expect(
        this.rowByCode(goneText),
        `未看到成功提示，且列表仍有「${goneText}」`,
      ).toBeHidden({ timeout: 15_000 });
      return;
    }

    await expect(toast).toBeVisible({ timeout: 5_000 });
  }

  /** 断言回到列表（详情关闭、表格可见） */
  async expectBackToList(): Promise<void> {
    await expect(this.scope().locator(TABLE).first()).toBeVisible({
      timeout: 20_000,
    });
  }
}
