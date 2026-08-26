import { type FrameLocator, type Locator, type Page, expect } from '@playwright/test';
import { waitForAppRoot, type AppRoot } from '../utils/app-frame';
import {
  DOC_NO_RE,
  FILTER_LABELS,
  LIST_API_RE,
  LIST_PATH,
  NEW_REQUEST_BTN,
  ROW,
  SEARCH_PLACEHOLDER,
  TABLE,
} from '../utils/request-catalog';

type Scope = FrameLocator | Page;

export class RequestListPage {
  readonly page: Page;
  private root: AppRoot | null = null;

  constructor(page: Page) {
    this.page = page;
  }

  private scope(): Scope {
    if (!this.root) {
      throw new Error('RequestListPage：请先调用 goto()');
    }
    return this.root.scope;
  }

  async goto() {
    await this.page.goto(LIST_PATH, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    this.root = await waitForAppRoot(this.page);
  }

  async ensureOnList() {
    if (!/\/request/.test(this.page.url())) {
      await this.goto();
      await this.expectLoaded();
      return;
    }
    if (!this.root) {
      this.root = await waitForAppRoot(this.page);
    }
    await this.waitListSettled();
    await this.expectListReady();
  }

  async expectLoaded() {
    await expect(this.page).toHaveURL(/request/, { timeout: 60_000 });
    await this.waitListApi();
    await expect(this.scope().getByText(/申请单/).first()).toBeVisible({ timeout: 60_000 });
    await expect(this.scope().locator(TABLE).first()).toBeVisible({ timeout: 60_000 });
    await this.waitListSettled();
    await this.expectListReady();
  }

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

  async waitListSettled() {
    const spin = this.scope().locator('.ant-spin-spinning');
    await spin.waitFor({ state: 'hidden', timeout: 60_000 }).catch(() => undefined);
  }

  async expectListReady() {
    await this.waitListSettled();
    await expect
      .poll(
        async () => {
          const rows = await this.dataRows().count().catch(() => 0);
          const empty = await this.scope()
            .getByText(/暂无数据|No Data/)
            .filter({ visible: true })
            .count()
            .catch(() => 0);
          return rows > 0 || empty > 0;
        },
        { timeout: 20_000, message: '申请单列表既无数据行也无空状态' },
      )
      .toBeTruthy();
  }

  dataRows(): Locator {
    return this.scope().locator(ROW).filter({ visible: true });
  }

  private headerCells(): Locator {
    return this.scope().locator('.ant-table-thead th');
  }

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

  async pickFirstRowCell(header: string): Promise<string> {
    const idx = await this.columnIndex(header);
    const cell = this.dataRows().first().locator('td').nth(idx);
    await expect(cell, `首行没有「${header}」列`).toBeVisible({ timeout: 20_000 });
    const text = ((await cell.innerText()) || '').replace(/\s+/g, ' ').trim();
    if (!text || text === '-') throw new Error(`首行「${header}」为空`);
    return text;
  }

  async pickFirstDocNo(): Promise<string> {
    try {
      return (await this.pickFirstRowCell(FILTER_LABELS.docNo)).replace(/\s+/g, '');
    } catch {
      /* fallback */
    }
    const row = this.dataRows().first();
    await expect(row, '列表没有可解析单号的数据行').toBeVisible({ timeout: 20_000 });
    const text = (await row.innerText()).replace(/\s+/g, ' ');
    const match = text.match(DOC_NO_RE) || text.match(/[A-Za-z0-9]{8,}/);
    if (!match) {
      throw new Error(`首行未解析到单号：${text.slice(0, 120)}`);
    }
    return match[0];
  }

  async expectRowsGreaterThan(n: number) {
    await expect
      .poll(async () => await this.dataRows().count().catch(() => 0), {
        timeout: 20_000,
        message: '申请单列表未渲染出数据行',
      })
      .toBeGreaterThan(n);
  }

  searchInput(): Locator {
    return this.scope()
      .locator(`input[placeholder="${SEARCH_PLACEHOLDER}"], input[placeholder*="申请单号"]`)
      .first();
  }

  async search(keyword: string) {
    const input = this.searchInput();
    await expect(input).toBeVisible({ timeout: 15_000 });
    const respP = this.waitListApi();
    await input.click();
    await input.fill('');
    await input.fill(keyword);
    await input.press('Enter').catch(() => undefined);
    await respP;
    await this.waitListSettled();
  }

  private reasonFilterInput(): Locator {
    return this.scope()
      .locator('.advanced-search input#title, .advanced-search .ant-form-item')
      .filter({ has: this.scope().locator('input#title, label:text-is("事由"), .ant-form-item-label:has-text("事由")') })
      .locator('input#title, input, textarea')
      .or(this.scope().locator('.advanced-search input#title'))
      .filter({ visible: true })
      .first();
  }

  /** AdvancedSearch：重置/搜索左侧的「展开所有条件」下拉箭头 */
  private expandAllFiltersBtn(): Locator {
    return this.scope()
      .locator('.advanced-search-footer-buttons .advanced-table-head-container-setting')
      .filter({ visible: true })
      .first();
  }

  async openFilterPanel() {
    if (await this.reasonFilterInput().isVisible({ timeout: 1_000 }).catch(() => false)) return;

    const expandAll = this.expandAllFiltersBtn();
    await expect(expandAll, '未找到「展开所有条件」箭头').toBeVisible({ timeout: 10_000 });
    await expandAll.click();
    await this.reasonFilterInput().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => undefined);
  }

  async filterByReason(reason: string) {
    await this.openFilterPanel();
    const input = this.reasonFilterInput();
    await expect(input, '筛选区未展开可见的「事由」输入框').toBeVisible({ timeout: 10_000 });
    await input.fill(reason);
    const respP = this.waitListApi();
    await this.scope().getByRole('button', { name: /搜\s*索/ }).filter({ visible: true }).first().click();
    await respP;
    await this.waitListSettled();
  }

  async resetFilters() {
    const btn = this.scope().getByRole('button', { name: /重\s*置/ }).first();
    if (!(await btn.isVisible({ timeout: 2_000 }).catch(() => false))) return;
    const respP = this.waitListApi();
    await btn.click();
    await respP;
    await this.waitListSettled();
  }

  rowByCode(code: string): Locator {
    return this.dataRows()
      .filter({ has: this.scope().locator('td, [class*="cell"]', { hasText: code }) })
      .first();
  }

  async expectRowContains(text: string) {
    await expect(this.rowByCode(text), `筛选后未看到「${text}」`).toBeVisible({
      timeout: 20_000,
    });
  }

  async openByCode(code: string) {
    const row = this.rowByCode(code);
    await expect(row, `未找到单据「${code}」`).toBeVisible({ timeout: 20_000 });
    await row.getByText(code).first().click();
    await this.page.waitForTimeout(1_000);
  }

  async clickNewRequest() {
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

      await this.page.waitForTimeout(2_000);
      await this.goto();
      await this.expectLoaded();
    }
  }
}
