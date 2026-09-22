import { type FrameLocator, type Locator, type Page, expect } from '@playwright/test';
import { waitForAppRoot, type AppRoot } from '../utils/app-frame';

/**
 * 列表页运行时目录：把「这页跟别的页不一样的地方」收敛成一个对象。
 *
 * 之前每加一个列表页都要复制一整份 POM（request-list 655 行 / approval-list 941 行），
 * 其中 60%+ 是「等列表接口 / 等 loading / 读表头 / 取首行某列 / 清搜索框 / 行定位」这类
 * 与业务无关的逻辑。现在这些全部由 GenericListPage 依据 catalog 实现，
 * 新页面只剩真正特有的动作（页签、审批按钮、新建单据……）。
 */
export type ListCatalog = {
  /** 页面名，用于错误信息 */
  name: string;
  /** 列表路由，如 /main/request */
  listPath: string;
  /** URL 归属判定正则，如 /\/request/ */
  urlPattern: RegExp;
  /** 列表查询接口正则 */
  listApiRe: RegExp;
  /** 从接口解析单号时使用的接口正则（默认 listApiRe；审批待办需限定 pending） */
  docNoListApiRe?: RegExp;
  /** 表格容器选择器 */
  table: string;
  /** 数据行选择器 */
  row: string;
  /** 数据行兜底选择器（虚拟表格 / 自定义表格） */
  rowFallback?: string;
  /** 顶部搜索框 placeholder（精确匹配） */
  searchPlaceholder: string;
  /** 顶部搜索框 placeholder 兜底（包含匹配） */
  searchPlaceholderAlts?: string[];
  /** 单号列列名 */
  docNoColumn: string;
  /** 单号正则 */
  docNoRe: RegExp;
  /** 空状态文案 */
  emptyTextRe: RegExp;
  /** 页面已加载的文案特征 */
  loadedTextRe: RegExp;
  /** 页面已加载的容器（优先于 loadedTextRe，避免侧栏同名隐藏文案误匹配） */
  loadedSelector?: string;
  /** expectLoaded 是否要求必须有数据行（待审批页=true，申请单页允许空=false） */
  requireRowsOnLoad: boolean;
  /** 「搜索」按钮 */
  searchActionSearch: string;
  /** 「清除」按钮 */
  searchActionClear: string;
  /** 外露筛选容器 */
  comboTrigger: string;
  /** 外露筛选的清除 × */
  comboClear: string;
  /** 需要逐个清理的外露筛选项标签 */
  clearLabels?: string[];
  /** 单元格取值为 '-' 时是否视为空（申请单列表需要） */
  dashIsEmpty?: boolean;
  /** 进入后需点「搜索」才查列表（advanced-table 常见，如报销单） */
  clickSearchOnLoad?: boolean;
  /** expectLoaded 前先「重置」并清外露筛选 */
  resetFiltersOnLoad?: boolean;
  /** 列表为空时自动清筛选并重搜 */
  recoverEmptyOnLoad?: boolean;
  /** 行点击后详情容器选择器（openByCode 事件驱动等待；无则退化为等 loading 消失） */
  detailSelectors?: string;
  /** 行点击后详情内容文案特征（与 detailSelectors 二选一或组合） */
  detailTextRe?: RegExp;
};

export type Scope = FrameLocator | Page;

const EMPTY_FALLBACK_RE = /暂无数据|No Data/;

/**
 * catalog 驱动的通用列表页。
 * 子类只需：构造时传 catalog + 实现特有动作（页签、审批、新建……）。
 */
export class GenericListPage {
  readonly page: Page;
  protected readonly catalog: ListCatalog;
  private root: AppRoot | null = null;

  constructor(page: Page, catalog: ListCatalog) {
    this.page = page;
    this.catalog = catalog;
  }

  /** 业务操作作用域（iframe 或 page） */
  protected scope(): Scope {
    if (!this.root) {
      throw new Error(`${this.catalog.name}：请先调用 goto()`);
    }
    return this.root.scope;
  }

  // ---------- 导航 / 加载 ----------

  async goto(): Promise<void> {
    const response = this.catalog.clickSearchOnLoad ? null : this.waitListApi();
    await this.page.goto(this.catalog.listPath, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    this.root = await waitForAppRoot(this.page);
    await response;
  }

  /** 关掉顶部用户菜单、快捷键提示等遮挡层，避免 click 被 intercept */
  protected async dismissChrome(): Promise<void> {
    await this.page.keyboard.press('Escape').catch(() => undefined);
    const openMenu = this.scope()
      .locator('.ant-dropdown-menu:visible, .ant-select-dropdown:visible')
      .first();
    await openMenu.waitFor({ state: 'hidden', timeout: 1_000 }).catch(() => undefined);
    await this.page.keyboard.press('Escape').catch(() => undefined);
    if (await openMenu.isVisible({ timeout: 300 }).catch(() => false)) {
      await this.page.keyboard.press('Escape').catch(() => undefined);
      await openMenu.waitFor({ state: 'hidden', timeout: 1_000 }).catch(() => undefined);
    }
  }

  /** 已在目标列表时复用当前页，避免重复整页导航 */
  async ensureOnList(): Promise<void> {
    if (!this.catalog.urlPattern.test(this.page.url())) {
      await this.goto();
      await this.expectLoaded();
      return;
    }
    await this.ensureRootLoaded();
    await this.waitListSettled();
    await this.expectListReady();
  }

  /** 子类可用的 root 懒加载入口（子类不应直接访问 private root） */
  protected async ensureRootLoaded(): Promise<void> {
    if (!this.root) {
      this.root = await waitForAppRoot(this.page);
    }
  }

  async expectLoaded(): Promise<void> {
    const c = this.catalog;
    const clickSearch = c.clickSearchOnLoad === true;
    const resetOnLoad = c.resetFiltersOnLoad === true;
    const recoverEmpty = c.recoverEmptyOnLoad === true;

    await expect(this.page).toHaveURL(c.urlPattern, { timeout: 60_000 });
    if (c.loadedSelector) {
      await expect(this.scope().locator(c.loadedSelector).first()).toBeVisible({ timeout: 60_000 });
    } else {
      await expect(this.scope().getByText(c.loadedTextRe).filter({ visible: true }).first()).toBeVisible({
        timeout: 60_000,
      });
    }
    await expect(this.scope().locator(c.table).first()).toBeVisible({ timeout: 60_000 });
    if (resetOnLoad) {
      await this.resetFilters().catch(() => undefined);
      await this.clearAllExposedComboFilters().catch(() => undefined);
    }
    if (clickSearch) {
      await this.clickFilterSearch();
    } else {
      await this.waitListSettled();
    }
    if (c.requireRowsOnLoad) {
      await this.expectRowsGreaterThan(0);
    } else {
      await this.expectListReady();
    }
    if (recoverEmpty) {
      await this.recoverIfEmptyList();
    }
  }

  /** 清掉顶栏单号与外露筛选，避免 Golden 串行用例读到空列表 */
  async clearListQuery(): Promise<void> {
    await this.dismissChrome();
    await this.clearDocNoSearch().catch(() => undefined);
    await this.clearExposedFilters().catch(() => undefined);
    await this.clearAllExposedComboFilters().catch(() => undefined);
    await this.resetFilters().catch(() => undefined);
    await this.clickFilterSearch();
    await this.waitListSettled();
  }

  /** 列表因残留筛选为空时，尝试去掉条件并重新搜索 */
  async recoverIfEmptyList(): Promise<boolean> {
    if (await this.hasDataRows()) return true;
    await this.dismissChrome();
    await this.clearDocNoSearch().catch(() => undefined);
    await this.clearExposedFilters().catch(() => undefined);
    await this.clearAllExposedComboFilters().catch(() => undefined);
    await this.clickFilterSearch();
    if (await this.hasDataRows()) return true;
    await this.resetFilters().catch(() => undefined);
    await this.clearAllExposedComboFilters().catch(() => undefined);
    await this.clickFilterSearch();
    return this.hasDataRows();
  }

  /** 回到默认列表状态：清关键字 + 清外露筛选 + 重置 */
  async restoreDefaultList(): Promise<void> {
    await this.clearListQuery();
    await this.expectListReady();
  }

  /** 无数据入口或纯前端筛选可能不发查询，响应等待超时返回 null。 */
  async waitListApi(timeout = 20_000) {
    return this.page
      .waitForResponse(
        (r) =>
          this.catalog.listApiRe.test(r.url()) &&
          r.request().method() === 'POST' &&
          r.status() === 200,
        { timeout },
      )
      .catch(() => null);
  }

  /** 等 loading 遮罩消失 */
  async waitListSettled(): Promise<void> {
    const spin = this.scope().locator('.ant-spin-spinning');
    await spin.waitFor({ state: 'hidden', timeout: 60_000 }).catch(() => undefined);
  }

  /** 列表已就绪：有数据行，或出现空状态 */
  async expectListReady(): Promise<void> {
    const c = this.catalog;
    await this.waitListSettled();
    await expect
      .poll(
        async () => {
          const rows = await this.dataRows().count().catch(() => 0);
          const empty = await this.scope()
            .getByText(c.emptyTextRe)
            .filter({ visible: true })
            .count()
            .catch(() => 0);
          return rows > 0 || empty > 0;
        },
        { timeout: 20_000, message: `${c.name}既无数据行也无空状态` },
      )
      .toBeTruthy();
  }

  // ---------- 行 / 列 ----------

  dataRows(): Locator {
    const c = this.catalog;
    const selector = c.rowFallback ? `${c.row}, ${c.rowFallback}` : c.row;
    return this.scope()
      .locator(selector)
      .filter({ hasNot: this.scope().locator('.ant-table-placeholder') })
      .filter({ visible: true });
  }

  async rowCount(): Promise<number> {
    return this.dataRows().count().catch(() => 0);
  }

  async hasDataRows(): Promise<boolean> {
    return (await this.rowCount()) > 0;
  }

  protected headerCells(): Locator {
    return this.scope().locator('.ant-table-thead th');
  }

  /** 按表头文案找列下标（双向子串匹配） */
  async columnIndex(header: string): Promise<number> {
    const headers = this.headerCells();
    const count = await headers.count();
    for (let i = 0; i < count; i += 1) {
      const text = ((await headers.nth(i).innerText()) || '').replace(/\s+/g, ' ').trim();
      if (!text || text === '+') continue;
      if (text.includes(header) || header.includes(text)) return i;
    }
    throw new Error(`未找到列「${header}」`);
  }

  /** 取首行指定列文本 */
  async pickFirstRowCell(header: string): Promise<string> {
    const idx = await this.columnIndex(header);
    const cell = this.dataRows().first().locator('td').nth(idx);
    await expect(cell, `首行没有「${header}」列`).toBeVisible({ timeout: 20_000 });
    const text = ((await cell.innerText()) || '').replace(/\s+/g, ' ').trim();
    if (!text) throw new Error(`首行「${header}」为空`);
    if (this.catalog.dashIsEmpty && text === '-') throw new Error(`首行「${header}」为空`);
    return text;
  }

  /** 取第 n 行指定列文本（n 从 0 开始） */
  async cellText(rowIndex: number, header: string): Promise<string> {
    const idx = await this.columnIndex(header);
    const cell = this.dataRows().nth(rowIndex).locator('td').nth(idx);
    await expect(cell, `第 ${rowIndex + 1} 行没有「${header}」列`).toBeVisible({ timeout: 20_000 });
    return ((await cell.innerText()) || '').replace(/\s+/g, ' ').trim();
  }

  /** 按单元格文本定位行 */
  rowByCode(code: string): Locator {
    return this.dataRows()
      .filter({ has: this.scope().locator('td, [class*="cell"]', { hasText: code }) })
      .first();
  }

  async expectRowContains(text: string): Promise<void> {
    await expect(this.rowByCode(text), `筛选后未看到「${text}」`).toBeVisible({
      timeout: 20_000,
    });
  }

  async expectRowsGreaterThan(n: number): Promise<void> {
    await expect
      .poll(async () => await this.dataRows().count().catch(() => 0), {
        timeout: 20_000,
        message: `${this.catalog.name}未渲染出数据行`,
      })
      .toBeGreaterThan(n);
  }

  /** 打开指定单据（点单号文本）；详情页判定不同的页面请覆写 */
  async openByCode(code: string): Promise<void> {
    const row = this.rowByCode(code);
    await expect(row, `未找到单据「${code}」`).toBeVisible({ timeout: 20_000 });
    await row.getByText(code).first().click();
    await this.waitForDetailOpen();
  }

  /**
   * 行点击后等详情就绪（事件驱动，替代旧版 1s 盲等）：
   * - catalog 提供 detailSelectors → 等详情容器可见
   * - catalog 提供 detailTextRe → 等详情内容特征出现
   * - 都没有 → 退化为等列表 loading 消失（旧行为的合理子集）
   */
  protected async waitForDetailOpen(): Promise<void> {
    const c = this.catalog;
    if (c.detailSelectors || c.detailTextRe) {
      if (c.detailSelectors) {
        const container = this.scope().locator(c.detailSelectors).first();
        await expect(container, '点击行后未打开详情容器').toBeVisible({ timeout: 20_000 });
      }
      if (c.detailTextRe) {
        const content = this.scope()
          .getByText(c.detailTextRe)
          .filter({ visible: true })
          .first();
        await expect(content, '详情内容特征未出现（可能仍在加载）').toBeVisible({
          timeout: 20_000,
        });
      }
      return;
    }
    await this.waitListSettled();
  }

  // ---------- 单号 / 关键字 ----------

  /** 首行单号：优先读单号列，否则按正则从行文本兜底 */
  async readFirstDocNo(): Promise<string> {
    await expect
      .poll(async () => await this.dataRows().count().catch(() => 0), {
        timeout: 20_000,
        message: `${this.catalog.name}没有可解析单号的数据行`,
      })
      .toBeGreaterThan(0);

    try {
      const fromCol = (await this.pickFirstRowCell(this.catalog.docNoColumn)).replace(/\s+/g, '');
      if (fromCol && fromCol !== '-') return fromCol;
    } catch {
      /* fallback */
    }

    const rows = this.dataRows();
    const n = await rows.count();
    for (let i = 0; i < Math.min(n, 12); i += 1) {
      const text = ((await rows.nth(i).innerText()) || '').replace(/\s+/g, ' ');
      const match = text.match(this.catalog.docNoRe) || text.match(/[A-Za-z0-9]{8,}/);
      if (match?.[0]) return match[0];
    }
    throw new Error('列表行中未解析到单号');
  }

  /** 取首行单号（默认等价于 readFirstDocNo；需要清筛选的列表请覆写） */
  async pickFirstDocNo(): Promise<string> {
    return this.readFirstDocNo();
  }

  /** 首行「事由」关键字，截断到 maxLen */
  async readFirstReasonKeyword(maxLen = 8): Promise<string> {
    const reason = await this.pickFirstRowCell('事由');
    if (!reason || reason === '-') throw new Error('首行事由为空');
    return reason.slice(0, Math.min(maxLen, reason.length));
  }

  /** 指定列是否出现包含 keyword 的单元格（最多扫 20 行） */
  async columnContains(header: string, keyword: string): Promise<boolean> {
    if (!keyword) return false;
    try {
      const idx = await this.columnIndex(header);
      const rows = this.dataRows();
      const n = await rows.count();
      for (let i = 0; i < Math.min(n, 20); i += 1) {
        const text = ((await rows.nth(i).locator('td').nth(idx).innerText()) || '')
          .replace(/\s+/g, ' ')
          .trim();
        if (text.includes(keyword)) return true;
      }
    } catch {
      return false;
    }
    return false;
  }

  /** 断言首行指定列包含 keyword（列缺失时降级为「任意行该列包含」） */
  async expectFirstRowCellContains(header: string, keyword: string): Promise<void> {
    await this.expectRowsGreaterThan(0);
    const first = await this.pickFirstRowCell(header).catch(() => '');
    if (first.includes(keyword)) return;
    const anyRow = await this.columnContains(header, keyword);
    if (anyRow) return;
    throw new Error(`列「${header}」未出现包含「${keyword}」的值（首行实际为「${first}」）`);
  }

  // ---------- 搜索 ----------

  searchInput(): Locator {
    const c = this.catalog;
    const alts = (c.searchPlaceholderAlts || []).map((p) => `input[placeholder*="${p}"]`);
    const parts = [`input[placeholder="${c.searchPlaceholder}"]`, ...alts];
    return this.scope().locator(parts.join(', ')).first();
  }

  /**
   * 顶部关键字搜索：填值 → 触发（搜索图标 / 「搜索」文案 / Enter）→ 等列表刷新。
   * 触发方式差异较大的页面覆写本方法即可。
   */
  async search(keyword: string): Promise<void> {
    const input = this.searchInput();
    await expect(input, `未找到${this.catalog.name}搜索框`).toBeVisible({ timeout: 15_000 });
    await input.click();
    await input.fill('');
    await input.fill(keyword);

    const icon = this.scope()
      .getByRole('img', { name: /search/i })
      .or(this.scope().locator('.anticon-search'))
      .filter({ visible: true })
      .first();
    const respP = this.waitListApi();
    if (await icon.isVisible({ timeout: 1_500 }).catch(() => false)) {
      await icon.click();
    } else {
      await input.press('Enter');
    }
    await respP;
    await this.waitListSettled();
  }

  async expectSearchEmpty(timeout = 5_000): Promise<void> {
    const input = this.searchInput();
    await expect(input).toBeVisible({ timeout });
    await expect
      .poll(async () => ((await input.inputValue().catch(() => '')) || '').trim(), {
        timeout,
        message: '搜索框未清空',
      })
      .toBe('');
  }

  /** 清空顶部关键字搜索框 */
  async clearDocNoSearch(): Promise<void> {
    const input = this.searchInput();
    if (!(await input.isVisible({ timeout: 2_000 }).catch(() => false))) return;
    const val = ((await input.inputValue().catch(() => '')) || '').trim();
    if (!val) return;

    const clearBtn = input
      .locator(
        'xpath=ancestor::*[contains(@class,"ant-input-affix-wrapper") or contains(@class,"ant-input-group")][1]',
      )
      .locator('.ant-input-clear-icon, .anticon-close-circle')
      .first();
    const respP = this.waitListApi();
    if (await clearBtn.isVisible({ timeout: 500 }).catch(() => false)) {
      await clearBtn.click({ force: true });
    } else {
      await input.fill('');
      await input.press('Enter').catch(() => undefined);
    }
    await respP;
    await this.waitListSettled();
    await this.expectSearchEmpty();
  }

  /** 点「搜索」 */
  async clickFilterSearch(): Promise<void> {
    await this.dismissChrome();
    const btn = this.scope()
      .locator(this.catalog.searchActionSearch)
      .or(this.scope().getByRole('button', { name: /搜\s*索|查\s*询/ }))
      .filter({ visible: true })
      .first();
    if (!(await btn.isVisible({ timeout: 1_000 }).catch(() => false))) return;
    const respP = this.waitListApi();
    await btn.click({ force: true });
    await respP;
    await this.waitListSettled();
  }

  /** 点「重置」 */
  async resetFilters(): Promise<void> {
    const btn = this.scope().getByRole('button', { name: /重\s*置/ }).first();
    if (!(await btn.isVisible({ timeout: 2_000 }).catch(() => false))) return;
    const respP = this.waitListApi();
    await btn.click({ force: true });
    await respP;
    await this.waitListSettled();
  }

  // ---------- 外露筛选清理 ----------

  protected exposedComboByLabel(label: string | RegExp): Locator {
    return this.scope()
      .locator(this.catalog.comboTrigger)
      .filter({ has: this.scope().locator('.combo-trigger__label', { hasText: label }) })
      .filter({ visible: true })
      .first();
  }

  protected async clickComboClear(trigger: Locator): Promise<boolean> {
    const c = this.catalog;
    const clears = [
      trigger.locator(c.comboClear),
      trigger.locator('.anticon-close'),
      trigger.locator('.anticon-close-circle'),
      trigger.locator('[class*="clear"]'),
    ];
    for (const clear of clears) {
      const btn = clear.filter({ visible: true }).first();
      if (!(await btn.isVisible({ timeout: 300 }).catch(() => false))) continue;
      const response = this.waitListApi(3_000);
      await btn.click({ force: true });
      await response;
      await this.waitListSettled();
      return true;
    }
    return false;
  }

  protected async clearExposedComboByLabel(label: string | RegExp): Promise<boolean> {
    const trigger = this.exposedComboByLabel(label);
    if (await trigger.isVisible({ timeout: 500 }).catch(() => false)) {
      if (await this.clickComboClear(trigger)) return true;
    }
    const tag = this.scope()
      .locator('.combo-trigger, [class*="filter-tag"], [class*="search-tag"]')
      .filter({ hasText: label })
      .filter({ visible: true })
      .first();
    if (await tag.isVisible({ timeout: 300 }).catch(() => false)) {
      return this.clickComboClear(tag);
    }
    return false;
  }

  /** 逐个清掉外露 combo 上的 ×，再扫一遍残留 */
  protected async clearAllExposedComboFilters(): Promise<void> {
    const c = this.catalog;
    for (const label of c.clearLabels || []) {
      for (let i = 0; i < 3; i += 1) {
        if (!(await this.clearExposedComboByLabel(label))) break;
        // 等列表 loading 消失（替代旧版 350ms 盲等）
        await this.waitListSettled();
      }
    }

    const roots = [
      this.advancedSearchRoot(),
      this.scope().locator('.advanced-table-search-head, .search-action-bar').first(),
    ];
    for (const root of roots) {
      for (let i = 0; i < 8; i += 1) {
        const clear = root
          .locator(
            `${c.comboClear}, .combo-trigger .anticon-close, .combo-trigger .anticon-close-circle`,
          )
          .filter({ visible: true })
          .first();
        if (!(await clear.isVisible({ timeout: 300 }).catch(() => false))) break;
        const respP = this.waitListApi(3_000);
        await clear.click({ force: true });
        await respP.catch(() => null);
        // 接口响应 + loading 消失已是完整事件信号，末尾盲等删去
        await this.waitListSettled();
      }
    }
  }

  protected advancedSearchRoot(): Locator {
    return this.scope()
      .locator('.advanced-search, .advanced-table-search')
      .filter({ visible: true })
      .first();
  }

  /** 点「清除外露筛选值」 */
  protected async clearExposedFilters(): Promise<void> {
    const btn = this.scope().locator(this.catalog.searchActionClear).first();
    if (!(await btn.isVisible({ timeout: 1_000 }).catch(() => false))) return;
    const respP = this.waitListApi();
    await btn.click({ force: true });
    await respP;
    await this.waitListSettled();
  }

  // ---------- 接口侧兜底 ----------

  protected listRowsFromBody(body: unknown): Record<string, unknown>[] {
    if (!body || typeof body !== 'object') return [];
    const obj = body as Record<string, unknown>;
    const nested =
      obj.data && typeof obj.data === 'object' ? (obj.data as Record<string, unknown>) : null;
    const rows =
      (Array.isArray(obj.rows) && obj.rows) ||
      (Array.isArray(obj.data) && obj.data) ||
      (nested && Array.isArray(nested.rows) && nested.rows) ||
      (nested && Array.isArray(nested.content) && nested.content) ||
      (Array.isArray(obj.content) && obj.content) ||
      [];
    return rows.filter(
      (row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object',
    );
  }

  protected docNoFromRow(row: Record<string, unknown>): string {
    const candidates = [
      row.businessCode,
      row.documentNumber,
      row.formCode,
      row.applicationCode,
      row.code,
    ];
    for (const val of candidates) {
      const text = String(val || '').replace(/\s+/g, '').trim();
      if (text && text !== '-' && (this.catalog.docNoRe.test(text) || text.length >= 8)) return text;
    }
    const blob = JSON.stringify(row);
    const match = blob.match(this.catalog.docNoRe) || blob.match(/[A-Za-z0-9]{10,}/);
    return match?.[0] || '';
  }

  protected extractDocNoFromBody(body: unknown): string {
    for (const row of this.listRowsFromBody(body)) {
      const docNo = this.docNoFromRow(row);
      if (docNo) return docNo;
    }
    return '';
  }

  /** 列表 UI 无行时，从最近一次列表接口响应里解析单号 */
  async readDocNoFromListApi(opts: { refresh?: boolean } = {}): Promise<string> {
    const apiRe = this.catalog.docNoListApiRe || this.catalog.listApiRe;
    let resp = null;
    if (opts.refresh) {
      const respP = this.page.waitForResponse(
        (r) => apiRe.test(r.url()) && r.request().method() === 'POST' && r.status() === 200,
        { timeout: 20_000 },
      );
      await this.clickFilterSearch();
      resp = await respP.catch(() => null);
    }
    if (!resp) {
      resp = await this.page
        .waitForResponse(
          (r) => apiRe.test(r.url()) && r.request().method() === 'POST' && r.status() === 200,
          { timeout: opts.refresh ? 5_000 : 3_000 },
        )
        .catch(() => null);
    }
    if (!resp) return '';
    const body = await resp.json().catch(() => null);
    return this.extractDocNoFromBody(body);
  }

  /** 空状态兜底文案 */
  protected get emptyTextRe(): RegExp {
    return this.catalog.emptyTextRe || EMPTY_FALLBACK_RE;
  }
}
