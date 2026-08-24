import { type FrameLocator, type Locator, type Page, expect } from '@playwright/test';
import { waitForAppRoot, type AppRoot } from '../utils/app-frame';
import {
  BUSINESS_TYPE_SELECT,
  COMBO_TRIGGER,
  DETAIL,
  DOC_NO_RE,
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
} from '../utils/approval-catalog';

type Scope = FrameLocator | Page;

/** 审批中心页签（dev 实机：待审批-全部 / 我的已办 / 抄送我 / 操作历史） */
export type ApprovalTab = '待审批-全部' | '待审批' | '我的已办' | '已审批' | '抄送我' | '操作历史';

/**
 * 审批列表页对象模型。
 *
 * 页面事实（dev 实机 + 源码）：
 * - 路由 /main/approve；列表 POST /api/approvals/pendingApproval
 * - 业务 DOM 在 iframe[src*="openBySelf=zoom"] 内（waitForAppRoot 处理）
 * - 表格 .ant-table / .ant-table-tbody tr.ant-table-row（虚拟滚动，只校验视口内行）
 * - 搜索 placeholder「申请人/事由/单号」
 * - 筛选条：全部业务类型 Select、筛选面板、外露 ComboTrigger（单号等）、搜索/清除外露筛选值
 * - 行内操作列有「通过」「驳回」；点行打开全屏 .approve-entrance
 */
export class ApprovalListPage {
  readonly page: Page;
  private root: AppRoot | null = null;

  constructor(page: Page) {
    this.page = page;
  }

  private scope(): Scope {
    if (!this.root) {
      throw new Error('ApprovalListPage：请先调用 goto()');
    }
    return this.root.scope;
  }

  // ---------- 导航 / 加载 ----------

  async goto() {
    await this.page.goto(LIST_PATH, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    this.root = await waitForAppRoot(this.page);
  }

  /** 进入审批列表并断言「待审批」列表已加载出数据 */
  async expectLoaded() {
    await expect(this.page).toHaveURL(/approve/, { timeout: 60_000 });
    await this.waitPendingApi();
    await expect(
      this.scope().getByText(/我的审批|待审批/).first()
    ).toBeVisible({ timeout: 60_000 });
    await expect(this.scope().locator(TABLE).first()).toBeVisible({
      timeout: 60_000,
    });
    await this.waitListSettled();
    await this.expectRowsGreaterThan(0);
  }

  /** 等待「待审批」主数据接口返回（可能在 goto 前已返回，故 catch 兜底） */
  async waitPendingApi() {
    await this.waitListApi();
  }

  /** 等待列表查询接口（待审批 / 已办 / 抄送）POST 200；超时返回 null */
  async waitListApi(timeout = 20_000) {
    return this.page
      .waitForResponse(
        (r) =>
          LIST_API_RE.test(r.url()) &&
          r.request().method() === 'POST' &&
          r.status() === 200,
        { timeout },
      )
      .catch(() => null);
  }

  /** 等 loading 遮罩消失 */
  async waitListSettled() {
    const spin = this.scope().locator('.ant-spin-spinning');
    await spin.waitFor({ state: 'hidden', timeout: 60_000 }).catch(() => undefined);
  }

  /** 列表已就绪：要么渲染出数据行，要么出现空状态（适用于非待审批页签） */
  async expectListReady() {
    await this.waitListSettled();
    await expect
      .poll(
        async () => {
          const rows = await this.dataRows().count().catch(() => 0);
          const empty = await this.scope()
            .getByText(/暂无数据|No Data|没有更多|暂无待审批/)
            .filter({ visible: true })
            .count()
            .catch(() => 0);
          return rows > 0 || empty > 0;
        },
        { timeout: 20_000, message: '审批列表既无数据行也无空状态' }
      )
      .toBeTruthy();
  }

  dataRows(): Locator {
    return this.scope().locator(ROW).filter({ visible: true });
  }

  /** 从当前列表首行解析单号；解析不到则失败，不回退猜选择器 */
  async pickFirstDocNo(): Promise<string> {
    const row = this.dataRows().first();
    await expect(row, '列表没有可解析单号的数据行').toBeVisible({ timeout: 20_000 });
    const text = (await row.innerText()).replace(/\s+/g, ' ');
    const match = text.match(DOC_NO_RE);
    if (!match) {
      throw new Error(`首行未解析到单号：${text.slice(0, 120)}`);
    }
    return match[0];
  }

  async expectRowsGreaterThan(n: number) {
    await expect
      .poll(async () => await this.dataRows().count().catch(() => 0), {
        timeout: 20_000,
        message: '审批列表未渲染出数据行',
      })
      .toBeGreaterThan(n);
  }

  // ---------- 页签切换 ----------

  /** 切换到指定页签（待审批 / 已审批 / 我发起的 / 抄送我），支持子串匹配 */
  async switchTab(tab: ApprovalTab | string) {
    const tabEl = this.scope()
      .locator(TAB)
      .filter({ hasText: tab })
      .first();
    await expect(tabEl, `未找到页签「${tab}」`).toBeVisible({ timeout: 20_000 });

    const apiHint =
      /已办|已审批/.test(String(tab))
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

  async search(keyword: string) {
    const byPlaceholder = this.scope()
      .locator(`input[placeholder="${SEARCH_PLACEHOLDER}"], input[placeholder*="单号"], input[placeholder*="申请人"]`)
      .first();

    if (await byPlaceholder.isVisible({ timeout: 3000 }).catch(() => false)) {
      await byPlaceholder.click();
      await byPlaceholder.fill('');
      await byPlaceholder.fill(keyword);
    } else {
      const fallback = this.scope()
        .locator('.ant-table-wrapper, .approval-filter, form')
        .first()
        .locator('input')
        .first();
      await expect(fallback).toBeVisible({ timeout: 15_000 });
      await fallback.click();
      await fallback.fill('');
      await fallback.fill(keyword);
    }
    await this.page.waitForTimeout(500);
    const searchBtn = this.scope().getByRole('button', { name: '搜索' });
    if (await searchBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      const respP = this.waitListApi();
      await searchBtn.click();
      await respP;
    } else {
      await byPlaceholder.press('Enter').catch(() => undefined);
    }
    await this.waitListSettled();
  }

  // ---------- 筛选 ----------

  filterTrigger(): Locator {
    return this.scope().locator(FILTER_TRIGGER).first();
  }

  filterPanel(): Locator {
    return this.scope().locator(FILTER_POP).first();
  }

  async expectFilterBarVisible() {
    await expect(
      this.scope().getByText(FILTER_LABELS.businessType).first(),
      '未找到「全部业务类型」',
    ).toBeVisible({ timeout: 20_000 });
    await expect(this.filterTrigger(), '未找到「筛选」按钮').toBeVisible({
      timeout: 15_000,
    });
  }

  async isFilterPanelOpen() {
    return this.filterPanel().isVisible({ timeout: 1_000 }).catch(() => false);
  }

  async openFilterPanel() {
    if (await this.isFilterPanelOpen()) return;
    await expect(this.filterTrigger()).toBeVisible({ timeout: 15_000 });
    await this.filterTrigger().click();
    await this.expectFilterPanelVisible();
  }

  async expectFilterPanelVisible() {
    await expect(this.filterPanel(), '筛选面板未打开').toBeVisible({
      timeout: 15_000,
    });
    await expect(
      this.scope().locator(FILTER_ROW).first(),
      '筛选面板没有条件行',
    ).toBeVisible({ timeout: 15_000 });
  }

  async closeFilterPanel() {
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
  async selectBusinessType(name?: string) {
    const select = this.scope().locator(BUSINESS_TYPE_SELECT).first();
    await expect(select, '未找到业务类型下拉').toBeVisible({ timeout: 15_000 });
    const respP = this.waitListApi();
    await select.click();
    const dropdown = this.scope()
      .locator('.ant-select-dropdown:visible')
      .last();
    await expect(dropdown).toBeVisible({ timeout: 10_000 });
    const items = dropdown.locator(
      '.ant-select-dropdown-menu-item, .ant-select-item-option',
    );
    const option = name
      ? items.filter({ hasText: name }).first()
      : items.filter({ hasNotText: /全部业务类型/ }).first();
    await expect(option, `业务类型下拉没有「${name || '非全部'}」`).toBeVisible({
      timeout: 10_000,
    });
    await option.click();
    await respP;
    await this.waitListSettled();
  }

  async resetBusinessType() {
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

  async fillExposedDocNo(docNo: string) {
    const trigger = this.exposedField(FILTER_LABELS.docNo);
    await expect(trigger, '未找到外露「单号」筛选').toBeVisible({ timeout: 15_000 });
    await trigger.locator('.combo-trigger__toggle').click();
    const input = trigger.locator('input').first();
    await expect(input, '单号下拉未出现输入框').toBeVisible({ timeout: 10_000 });
    await input.fill('');
    await input.fill(docNo);
    await this.page.keyboard.press('Escape').catch(() => undefined);
  }

  async clickExposedSearch() {
    const btn = this.scope().locator(SEARCH_ACTION_SEARCH).first();
    await expect(btn, '未找到「搜索」').toBeVisible({ timeout: 10_000 });
    const respP = this.waitListApi();
    await btn.click();
    await respP;
    await this.waitListSettled();
  }

  async clearExposedFilters() {
    const btn = this.scope().locator(SEARCH_ACTION_CLEAR).first();
    await expect(btn, '未找到「清除外露筛选值」').toBeVisible({ timeout: 10_000 });
    const respP = this.waitListApi();
    await btn.click();
    await respP;
    await this.waitListSettled();
  }

  /** 在筛选面板里给指定字段填值（字段已存在则直接填，否则添加条件） */
  async fillFilterPanelField(label: string, value: string) {
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
      .locator('.ant-select-dropdown:visible .ant-select-dropdown-menu-item, .ant-select-dropdown:visible .ant-select-item-option')
      .filter({ hasText: label })
      .first();
    await expect(opt, `筛选字段没有「${label}」`).toBeVisible({ timeout: 10_000 });
    await opt.click();
    const input = lastRow.locator('input').first();
    await expect(input).toBeVisible({ timeout: 10_000 });
    await input.fill(value);
  }

  async submitFilterPanel() {
    const btn = this.filterPanel()
      .locator('.search-btn')
      .or(this.filterPanel().getByRole('button', { name: FILTER_LABELS.search }))
      .first();
    await expect(btn, '筛选面板没有「搜索」').toBeVisible({ timeout: 10_000 });
    const respP = this.waitListApi();
    await btn.click();
    await respP;
    await this.waitListSettled();
  }

  async expectRowContains(text: string) {
    await expect(this.rowByCode(text), `筛选后未看到「${text}」`).toBeVisible({
      timeout: 20_000,
    });
  }

  async hasExposedDocNo() {
    return this.exposedField(FILTER_LABELS.docNo).isVisible({ timeout: 3_000 }).catch(() => false);
  }

  async hasExposedClear() {
    return this.scope().locator(SEARCH_ACTION_CLEAR).isVisible({ timeout: 3_000 }).catch(() => false);
  }

  /** 优先走外露单号；没有外露则打开筛选面板填单号 */
  async filterByDocNo(docNo: string) {
    if (await this.hasExposedDocNo()) {
      await this.fillExposedDocNo(docNo);
      await this.clickExposedSearch();
      return;
    }
    await this.fillFilterPanelField(FILTER_LABELS.docNo, docNo);
    await this.submitFilterPanel();
  }

  /** 清除外露筛选；没有外露清除时走面板「清除筛选值」 */
  async clearFilters() {
    if (await this.hasExposedClear()) {
      await this.clearExposedFilters();
      return;
    }
    await this.openFilterPanel();
    const clearBtn = this.scope()
      .locator('.advanced-search-filter-footer')
      .getByRole('button', { name: FILTER_LABELS.clearPanel });
    if (await clearBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await clearBtn.click();
      if (await this.isFilterPanelOpen()) {
        await this.submitFilterPanel();
      } else {
        await this.waitListSettled();
      }
      return;
    }
    await this.closeFilterPanel();
  }

  // ---------- 打开单据详情 ----------

  /** 打开列表第一条数据行的详情 */
  async openFirstRow() {
    const row = this.dataRows().first();
    await expect(row).toBeVisible({ timeout: 20_000 });
    const code = await this.pickFirstDocNo();
    await row.getByText(code).first().click();
    await this.waitDetailVisible();
  }

  async openByCode(code: string) {
    const row = this.rowByCode(code);
    await expect(row, `未找到单据「${code}」，请确认其存在于当前列表`).toBeVisible({
      timeout: 20_000,
    });
    await row.getByText(code).first().click();
    await this.waitDetailVisible();
  }

  rowByCode(code: string): Locator {
    return this.dataRows()
      .filter({ has: this.scope().locator('td, [class*="cell"]', { hasText: code }) })
      .first();
  }

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

  async waitDetailVisible() {
    const entrance = this.scope().locator(`${DETAIL}, .full-screen, .full-screen-mask`).first();
    await expect(entrance, '未打开审批详情（.approve-entrance / full-screen）').toBeVisible({
      timeout: 20_000,
    });
  }

  async expectDetailVisible() {
    await this.waitDetailVisible();
  }

  // ---------- 审批动作 ----------

  /** 某数据行内的「操作」列定位器 */
  private rowActions(row: Locator): Locator {
    return row.locator('td').last().locator('a, button, [class*="action"], [class*="operate"], span');
  }

  /** 在指定行（或首行）的操作列点击「通过」；若弹出意见框则自动填写 */
  async approveRow(comment?: string, code?: string) {
    const row = code ? this.rowByCode(code) : this.dataRows().first();
    await expect(row).toBeVisible({ timeout: 20_000 });
    const btn = this.rowActions(row).filter({ hasText: /通\s*过/ }).first();
    await expect(btn, '未在操作列找到「通过」按钮').toBeVisible({ timeout: 10_000 });
    await btn.click();
    await this.fillCommentDialogIfNeeded(comment);
    await this.confirmIfNeeded();
  }

  /** 在指定行（或首行）的操作列点击「驳回」；若弹出意见框则自动填写 */
  async rejectRow(comment?: string, code?: string) {
    const row = code ? this.rowByCode(code) : this.dataRows().first();
    await expect(row).toBeVisible({ timeout: 20_000 });
    const btn = this.rowActions(row).filter({ hasText: /驳\s*回/ }).first();
    await expect(btn, '未在操作列找到「驳回」按钮').toBeVisible({ timeout: 10_000 });
    await btn.click();
    await this.fillCommentDialogIfNeeded(comment);
    await this.confirmIfNeeded();
  }

  /** 点击通过/驳回后，如果出现「审批意见」输入框则填写（可能以弹窗/抽屉形式出现） */
  private async fillCommentDialogIfNeeded(comment?: string) {
    if (!comment) return;
    // 尝试在弹窗/抽屉/内联表单中找到「审批意见」的 textarea
    const dialog = this.scope()
      .locator('.ant-modal, .ant-drawer, .ant-popover, .approval-dialog')
      .filter({ visible: true })
      .first();
    const visible = await dialog.count().catch(() => 0);
    if (visible === 0) return;

    const ta = dialog.locator('textarea').first();
    if (await ta.isVisible({ timeout: 3000 }).catch(() => false)) {
      await ta.fill(comment);
    }
  }

  /** 填写「审批意见」（详情弹窗场景） */
  async fillApprovalComment(comment: string) {
    const ta = this.scope()
      .locator(`${DETAIL} textarea, .approve-bar textarea, .ant-modal textarea, .ant-drawer textarea`)
      .first();
    await expect(ta).toBeVisible({ timeout: 15_000 });
    await ta.fill(comment);
  }

  /** 审批通过（带意见），并兜底处理二次确认弹窗 */
  async approve(comment: string) {
    await this.fillApprovalComment(comment);
    const btn = this.scope()
      .getByRole('button', { name: /通\s*过|同\s*意|批\s*准/ })
      .last();
    await expect(btn).toBeVisible({ timeout: 15_000 });
    await btn.click();
    await this.confirmIfNeeded();
  }

  /** 审批驳回（带意见），并兜底处理二次确认弹窗 */
  async reject(comment: string) {
    await this.fillApprovalComment(comment);
    const btn = this.scope()
      .getByRole('button', { name: /驳\s*回|拒\s*绝/ })
      .last();
    await expect(btn).toBeVisible({ timeout: 15_000 });
    await btn.click();
    await this.confirmIfNeeded();
  }

  private async confirmIfNeeded() {
    const confirm = this.scope()
      .getByRole('button', { name: /确\s*定|确\s*认/ })
      .last();
    if (await confirm.isVisible({ timeout: 3000 }).catch(() => false)) {
      await confirm.click();
    }
  }

  // ---------- 结果校验 ----------

  /** 断言出现审批成功类提示 */
  async expectApprovalSuccess() {
    await expect(
      this.scope()
        .getByText(/审批成功|提交成功|操作成功|已通过|审批完成|处理成功/)
        .first()
    ).toBeVisible({ timeout: 20_000 });
  }

  /** 断言回到列表（详情关闭、表格可见） */
  async expectBackToList() {
    await expect(this.scope().locator(TABLE).first()).toBeVisible({
      timeout: 20_000,
    });
  }
}
