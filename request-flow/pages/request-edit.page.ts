import { type FrameLocator, type Locator, type Page, expect } from '@playwright/test';
import { waitForAppRoot, type AppRoot } from '../utils/app-frame';
import { env } from '../utils/env';
import { DETAIL, DETAIL_MARKERS, DOC_NO_RE } from '../utils/request-catalog';

type Scope = FrameLocator | Page;

export class RequestEditPage {
  readonly page: Page;
  private root: AppRoot | null = null;

  constructor(page: Page) {
    this.page = page;
  }

  private scope(): Scope {
    if (!this.root) {
      this.root = { page: this.page, scope: this.page, inIframe: false };
    }
    return this.root.scope;
  }

  async ensureRoot() {
    if (!this.root) {
      this.root = await waitForAppRoot(this.page);
    }
  }

  /** 列表点开后多为 SlideFrame 侧滑，URL 仍停在 /main/request */
  detailShell(): Locator {
    return this.scope().locator(DETAIL).filter({ visible: true }).last();
  }

  async confirmNewRequestModal(formName?: string) {
    await this.ensureRoot();

    const emptyTip = this.scope().getByText(/暂无可创建的单据/).filter({ visible: true }).first();
    if (await emptyTip.isVisible({ timeout: 2_000 }).catch(() => false)) {
      throw new Error('新建申请单：暂无可创建的单据（/api/custom/forms/my/available 异常或无模板）');
    }

    // 多模板：Stations Dropdown（Menu 包在 .stations-dropdown-content 内，项是 .station-menu-item，不是 .ant-dropdown-menu-item）
    const panel = this.scope().locator('.stations-dropdown-content').filter({ visible: true }).last();
    if (await panel.isVisible({ timeout: 5_000 }).catch(() => false)) {
      const items = panel.locator('.station-menu-item, .ant-menu-item, .ant-dropdown-menu-item');
      const item = formName
        ? items.filter({ hasText: formName }).first()
        : items.first();
      await expect(item, formName ? `下拉未找到单据「${formName}」` : '新建申请单下拉无可用模板').toBeVisible({
        timeout: 10_000,
      });
      await item.click();
      await this.expectEditVisible();
      return;
    }

    // 多岗位：station-modal 选模板
    const modal = this.scope().locator('.station-modal, .ant-modal.station-modal, .ant-modal').filter({ visible: true }).last();
    if (await modal.isVisible({ timeout: 3_000 }).catch(() => false)) {
      const select = modal.locator('.ant-select').first();
      if (await select.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await select.click();
        const optDrop = this.scope().locator('.ant-select-dropdown:visible').last();
        await expect(optDrop).toBeVisible({ timeout: 10_000 });
        const option = formName
          ? optDrop.locator('.ant-select-dropdown-menu-item, .ant-select-item-option').filter({ hasText: formName }).first()
          : optDrop.locator('.ant-select-dropdown-menu-item, .ant-select-item-option').first();
        await expect(option).toBeVisible({ timeout: 10_000 });
        await option.click();
      }
      const ok = modal.getByRole('button', { name: /确\s*定/ }).first();
      if (await ok.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await ok.click();
      }
      await this.expectEditVisible();
      return;
    }

    if (await emptyTip.isVisible({ timeout: 1_000 }).catch(() => false)) {
      throw new Error('新建申请单：暂无可创建的单据（/api/custom/forms/my/available 异常或无模板）');
    }

    // 单模板：点「新建申请单」后直接进编辑
    await this.expectEditVisible();
  }

  async expectEditVisible() {
    await this.ensureRoot();
    // 列表表头也有「单号」，不能单靠文案；以底栏按钮 / 详情专有文案为准。
    // 详情打开后两者常同时可见，不能用 .or().toBeVisible()（会触发 strict mode）。
    const action = this.scope()
      .getByRole('button', { name: /^(提\s*交|保\s*存|删除单据)$/ })
      .filter({ visible: true })
      .first();
    const info = this.scope()
      .getByText(DETAIL_MARKERS)
      .filter({ visible: true })
      .first();
    await expect(async () => {
      const ok =
        (await action.isVisible().catch(() => false)) ||
        (await info.isVisible().catch(() => false));
      expect(ok, '未打开申请单详情').toBeTruthy();
    }).toPass({ timeout: 60_000 });
  }

  /** 编辑区：侧滑壳；或无壳时用带保存/返回的 main（新建全屏常见） */
  private editRoot(): Locator {
    const shell = this.detailShell();
    const main = this.scope()
      .locator('main')
      .filter({ has: this.scope().getByRole('button', { name: /保\s*存|返\s*回|提\s*交|删除单据/ }) })
      .last();
    return shell.or(main).last();
  }

  private reasonInput(): Locator {
    // label 与 input 是兄弟，不能用 input.filter({ has: label })；accessible name 多为「请输入」而非「事由」
    const root = this.editRoot();
    return root
      .locator('.ant-form-item, [class*="form-item"]')
      .filter({ has: root.locator('.ant-form-item-label, label, [class*="label"]').filter({ hasText: /^\s*事由/ }) })
      .locator('textarea, input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"])')
      .filter({ visible: true })
      .first()
      .or(root.getByRole('textbox', { name: /请输入/ }).filter({ visible: true }).first());
  }

  async fillReason(value: string) {
    await this.expectEditVisible();
    const input = this.reasonInput();
    await expect(input, '未找到事由输入框').toBeVisible({ timeout: 20_000 });
    await input.click();
    await input.fill('');
    await input.fill(value);
  }

  /**
   * 「97费用申请单-关联单据」等表单提交前必须选自选审批人，否则 POST submit/v2 → 70401010。
   * 默认选登录人自己（REQUEST_APPROVER → LOGIN_USERNAME → 页头制单人）。
   * 详情只读态需先「编辑」；选完人后点「保存」回到带「提交」的详情底栏。
   */
  async fillApproverIfNeeded(keyword?: string) {
    await this.ensureRoot();
    await this.finishDetailSlideIfOpen();

    const keys = await this.approverKeywords(keyword);

    const readonlyLabel = this.scope()
      .getByText(/自选审批人[：:]\s*\S+/)
      .filter({ visible: true })
      .filter({ hasNotText: /请选择/ })
      .first();
    if (await readonlyLabel.isVisible({ timeout: 2_000 }).catch(() => false)) {
      const t = ((await readonlyLabel.innerText().catch(() => '')) || '').trim();
      if (keys.some((k) => t.includes(k))) return;
    }

    // 详情只读：点「编辑」打开单据信息侧滑（此时底栏只有保存/返回，没有提交）
    const editBtn = this.scope().getByRole('button', { name: /^编\s*辑$/ }).filter({ visible: true }).first();
    let block = this.scope()
      .locator('.ant-form-item, [class*="form-item"], [class*="counter-sign"], [class*="countersign"]')
      .filter({ hasText: /自选审批人/ })
      .filter({ visible: true })
      .first();

    if (!(await block.isVisible({ timeout: 2_000 }).catch(() => false))) {
      if (await editBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await editBtn.click();
        await this.page.waitForTimeout(800);
      }
      block = this.scope()
        .locator('.ant-form-item, [class*="form-item"]')
        .filter({ hasText: /自选审批人/ })
        .filter({ visible: true })
        .first();
    }

    if (!(await block.isVisible({ timeout: 3_000 }).catch(() => false))) return;

    const already = block
      .locator('.ant-select-selection-choice, .ant-select-selection-item, .ant-tag, [class*="avatar"], [class*="selected"]')
      .filter({ hasText: /.{2,}/ })
      .filter({ hasNotText: /请选择|请输入/ })
      .first();
    if (await already.isVisible().catch(() => false)) {
      const text = ((await already.innerText().catch(() => '')) || '').trim();
      if (keys.some((k) => text.includes(k))) {
        await this.saveDocInfoIfEditing();
        return;
      }
      await this.clearApproverInBlock(block);
    }

    const iconBtn = block.locator('.anticon, [class*="add"], [class*="plus"], i, span').filter({ visible: true }).last();
    const trigger = block.getByRole('combobox').or(block.locator('.ant-select')).first();
    if (await trigger.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await trigger.click();
    } else if (await iconBtn.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await iconBtn.click();
    }

    const picked = await this.pickPersonByKeywords(keys);
    await this.expectApproverSelected(block, picked);
    await this.saveDocInfoIfEditing();
  }

  /** 关掉未确认的「新建明细」侧滑，避免 slide-mask 挡住「编辑/提交」 */
  private async finishDetailSlideIfOpen() {
    const panel = this.scope().getByText('新建明细', { exact: true }).filter({ visible: true }).first();
    const mask = this.scope().locator('.slide-mask').filter({ visible: true }).first();
    if (!(await panel.isVisible({ timeout: 1_000 }).catch(() => false)) && !(await mask.isVisible({ timeout: 500 }).catch(() => false))) {
      return;
    }

    const amount = this.scope().getByRole('spinbutton', { name: /请输入/ }).filter({ visible: true }).first();
    if (await amount.isVisible({ timeout: 2_000 }).catch(() => false)) {
      const val = await amount.inputValue().catch(() => '');
      if (!val || val === '0' || val === '0.00') {
        await amount.click();
        await amount.fill('1');
      }
    }

    const ok = this.scope().getByRole('button', { name: /^确\s*定$/ }).filter({ visible: true }).last();
    if (await ok.isVisible({ timeout: 2_000 }).catch(() => false) && (await ok.isEnabled().catch(() => false))) {
      await ok.click();
      await this.confirmIfNeeded();
    } else {
      const titleClose = this.scope().locator('text=新建明细').locator('..').locator('img, .anticon').first();
      if (await titleClose.isVisible({ timeout: 1_000 }).catch(() => false)) {
        await titleClose.click();
      }
    }

    await expect(this.scope().locator('.slide-mask').first()).toBeHidden({ timeout: 15_000 }).catch(() => undefined);
    await expect(this.scope().getByRole('button', { name: /^提\s*交$/ }).first()).toBeVisible({ timeout: 15_000 });
  }

  private async clearApproverInBlock(block: Locator) {
    const clear = block
      .locator(
        '.anticon-close, .anticon-close-circle, .ant-select-selection__clear, .ant-select-clear, [aria-label="close"]',
      )
      .filter({ visible: true })
      .first();
    if (await clear.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await clear.click();
      await this.page.waitForTimeout(400);
    }
    const tagClose = block.locator('.ant-tag .anticon-close, .ant-select-selection-item-remove').first();
    if (await tagClose.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await tagClose.click();
      await this.page.waitForTimeout(400);
    }
  }

  /** 选人：优先「历史选择」标签；否则填关键字并点「搜索」后再点表格行（勿点宽父节点） */
  private async pickPersonByKeyword(keyword: string) {
    const dropdown = this.scope().locator('.ant-select-dropdown:visible').last();
    if (await dropdown.isVisible({ timeout: 2_000 }).catch(() => false)) {
      const opt = dropdown
        .locator('.ant-select-item-option, .ant-select-dropdown-menu-item')
        .filter({ hasText: keyword })
        .first();
      await expect(opt, `下拉未找到「${keyword}」`).toBeVisible({ timeout: 10_000 });
      await opt.click();
      return;
    }

    const modal = this.scope()
      .locator('.ant-modal, [role="dialog"]')
      .filter({ visible: true })
      .filter({ hasText: /自选审批人|选择|人员|审批|同事|用户/ })
      .last();
    await expect(modal, `选人弹窗未出现（关键字=${keyword}）`).toBeVisible({ timeout: 5_000 });

    // 「历史选择」里常有「97dev / 本人」，比表格搜索更稳
    const histChip = modal
      .getByText('历史选择', { exact: true })
      .locator('..')
      .getByText(keyword, { exact: true })
      .filter({ visible: true })
      .first();
    if (await histChip.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await histChip.click();
      const okHist = modal.getByRole('button', { name: /^确\s*定$/ }).first();
      await expect(okHist).toBeVisible({ timeout: 5_000 });
      await okHist.click();
      return;
    }

    const search = modal.getByPlaceholder(/工号|姓名|手机|邮箱|搜索|请输入/).or(modal.getByRole('textbox')).first();
    await expect(search, '选人弹窗无搜索框').toBeVisible({ timeout: 5_000 });
    await search.fill('');
    await search.fill(keyword);
    const searchBtn = modal.getByRole('button', { name: /搜\s*索/ }).filter({ visible: true }).first();
    if (await searchBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await searchBtn.click();
    } else {
      await search.press('Enter');
    }
    await this.page.waitForTimeout(1_000);

    const row = modal
      .locator('.ant-table-tbody tr.ant-table-row, .ant-table-tbody tr, .ant-list-item')
      .filter({ hasText: keyword })
      .filter({ visible: true })
      .first();
    await expect(row, `选人弹窗表格未找到「${keyword}」`).toBeVisible({ timeout: 15_000 });
    await row.click();
    const ok = modal.getByRole('button', { name: /^确\s*定$/ }).first();
    if (await ok.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await ok.click();
    }
  }

  private async expectApproverSelected(block: Locator, keyword: string) {
    const selected = block
      .locator('.ant-select-selection-choice, .ant-select-selection-item, .ant-tag')
      .filter({ hasText: keyword })
      .filter({ visible: true })
      .first();
    await expect(selected, `自选审批人未选中「${keyword}」（仍是默认人如泊凰测试）`).toBeVisible({
      timeout: 10_000,
    });
  }

  /** 选人候选：显式 > 制单人/申请人 > REQUEST_APPROVER > LOGIN_USERNAME（按序尝试，避免账号搜不到中文名） */
  private async approverKeywords(explicit?: string): Promise<string[]> {
    const keys: string[] = [];
    const add = (raw?: string | null) => {
      const t = (raw || '').trim();
      if (!t || t === '-') return;
      const v = t.includes('@') ? t.split('@')[0]! : t;
      if (!keys.includes(v)) keys.push(v);
    };
    add(explicit);
    for (const re of [/制单人[：:]\s*(\S+)/, /申请人[：:]\s*(\S+)/]) {
      const el = this.scope().getByText(re).filter({ visible: true }).first();
      if (await el.isVisible({ timeout: 1_000 }).catch(() => false)) {
        const text = ((await el.innerText().catch(() => '')) || '').trim();
        const m = text.match(re);
        if (m?.[1]) add(m[1]);
      }
    }
    add(env.requestApprover);
    add(env.username);
    if (!keys.length) {
      throw new Error('无法解析登录人作为自选审批人，请设置 REQUEST_APPROVER 或 LOGIN_USERNAME');
    }
    return keys;
  }

  private async selfApproverKeyword(explicit?: string): Promise<string> {
    return (await this.approverKeywords(explicit))[0]!;
  }

  private async pickPersonByKeywords(keywords: string[]): Promise<string> {
    let lastErr: unknown;
    for (const k of keywords) {
      try {
        await this.pickPersonByKeyword(k);
        return k;
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr instanceof Error
      ? lastErr
      : new Error(`选人失败，已尝试：${keywords.join(' / ')}`);
  }

  /** 单据信息编辑侧滑：保存后回到详情（露出「提交」） */
  private async saveDocInfoIfEditing() {
    // 编辑侧滑底栏通常同时有「保存」且当前页看不到详情上的「提交」作为同一栏
    const saveBtn = this.scope()
      .getByRole('button', { name: /^保\s*存$/ })
      .filter({ visible: true })
      .last();
    const submitOnSameBar = this.scope()
      .getByRole('button', { name: /^提\s*交$/ })
      .filter({ visible: true })
      .first();

    // 若「保存」可见且处于编辑侧滑（详情提交被挡或需先落库审批人）
    if (!(await saveBtn.isVisible({ timeout: 2_000 }).catch(() => false))) return;

    // 详情页也有时只有提交没有「纯保存」；仅当编辑层打开时点保存
    const editing = this.scope().getByText(/自选审批人/).filter({ visible: true }).first();
    if (!(await editing.isVisible().catch(() => false))) return;

    await saveBtn.click();
    await this.confirmIfNeeded();
    await expect(
      this.scope().getByText(/已保存|保存成功|操作成功|单据已保存/).first(),
    ).toBeVisible({ timeout: 30_000 }).catch(() => undefined);

    // 等编辑侧滑收起，详情「提交」重新可点
    await expect(submitOnSameBar).toBeVisible({ timeout: 30_000 });
  }

  async save(approverKeyword?: string) {
    await this.expectEditVisible();
    await this.fillApproverIfNeeded(approverKeyword);
    const root = this.editRoot();
    // 优先纯「保存/暂存」；仅有「保存并添加明细」时再点它（会弹出费用类型弹窗）
    const saveOnly = root.getByRole('button', { name: /^保\s*存$|^暂\s*存$/ }).filter({ visible: true }).first();
    const saveAny = root.getByRole('button', { name: /^保\s*存|^暂\s*存/ }).filter({ visible: true }).first();
    const btn = (await saveOnly.isVisible({ timeout: 2_000 }).catch(() => false)) ? saveOnly : saveAny;
    await expect(btn).toBeVisible({ timeout: 15_000 });
    await btn.click();
    await this.confirmIfNeeded();
    await expect(
      this.scope().getByText(/已保存|保存成功|操作成功|单据已保存/).first(),
    ).toBeVisible({ timeout: 30_000 });
    // 费用申请单无明细时提交会长时间停在「正在提交」；有弹窗则补一条，不要直接取消
    await this.ensureLineItem();
  }

  /** 费用类单据：弹窗选类型或点「新建明细」，补一条可提交的明细 */
  async ensureLineItem() {
    await this.ensureRoot();
    const root = this.editRoot();
    const empty = root.getByText(/暂无明细/);
    // 「保存并添加明细」会直接打开 .expense-type-modal，勿再点被遮挡的「新建明细」
    const dialog = this.expenseTypeDialog();

    const needDetail =
      (await dialog.isVisible({ timeout: 5_000 }).catch(() => false)) ||
      (await empty.isVisible({ timeout: 2_000 }).catch(() => false));
    if (!needDetail) return;

    if (!(await dialog.isVisible({ timeout: 1_000 }).catch(() => false))) {
      const newBtn = root.getByRole('button', { name: /新建明细/ }).first();
      if (!(await newBtn.isVisible({ timeout: 5_000 }).catch(() => false))) return;
      // 保存并添加明细可能延迟弹出；再等一下，避免点到被遮罩挡住的按钮
      if (!(await dialog.isVisible({ timeout: 3_000 }).catch(() => false))) {
        await newBtn.click();
      }
      await expect(dialog, '未打开费用类型弹窗').toBeVisible({ timeout: 15_000 });
    }

    const typeName = await this.pickExpenseType(dialog);
    const ok = dialog.getByRole('button', { name: /^确\s*定$/ }).filter({ visible: true }).first();
    await expect(ok).toBeEnabled({ timeout: 10_000 });
    await ok.click();
    await this.fillDetailAmountAndSave(typeName);
  }

  private expenseTypeDialog(): Locator {
    return this.scope()
      .locator('.expense-type-modal')
      .or(this.scope().getByRole('dialog', { name: /添加费用类型/ }))
      .filter({ visible: true })
      .last();
  }

  private async pickExpenseType(dialog: Locator): Promise<string> {
    const pool = ['办公', '其它杂项', '招待', '通讯', '餐补', '话费'];
    const visible: string[] = [];
    for (const name of pool) {
      const item = dialog.getByText(name, { exact: true }).first();
      if (await item.isVisible({ timeout: 800 }).catch(() => false)) visible.push(name);
    }
    if (!visible.length) {
      const otherTab = dialog.getByText('其它', { exact: true }).first();
      if (await otherTab.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await otherTab.click();
        await this.page.waitForTimeout(400);
      }
      for (const name of pool) {
        const item = dialog.getByText(name, { exact: true }).first();
        if (await item.isVisible({ timeout: 800 }).catch(() => false)) visible.push(name);
      }
    }
    expect(visible.length, '费用类型列表为空').toBeGreaterThan(0);
    const name = visible[Math.floor(Math.random() * visible.length)]!;
    await dialog.getByText(name, { exact: true }).first().click();
    return name;
  }

  private async fillDetailAmountAndSave(typeName: string) {
    // 明细侧滑：金额多为 Ant InputNumber；fill() 常写不进受控值，需逐字输入再 Tab 提交
    const panel = this.scope()
      .locator('.ant-drawer, [class*="slide"], [class*="drawer"]')
      .filter({ hasText: /新建明细|金额/ })
      .filter({ visible: true })
      .last();
    const root = (await panel.isVisible({ timeout: 2_000 }).catch(() => false)) ? panel : this.scope();

    const amount = root
      .getByRole('spinbutton', { name: /请输入/ })
      .filter({ visible: true })
      .first()
      .or(
        root
          .locator('.ant-form-item, [class*="form-item"]')
          .filter({ hasText: /金额/ })
          .locator('input:not([type="hidden"])')
          .filter({ visible: true })
          .first(),
      );
    await expect(amount, '明细金额输入框未出现').toBeVisible({ timeout: 15_000 });
    const val = String(Math.floor(Math.random() * 99) + 1);
    await amount.click();
    await amount.fill('');
    await amount.pressSequentially(val, { delay: 20 });
    await amount.press('Tab');

    const saveDetail = root.getByRole('button', { name: /^确\s*定$/ }).filter({ visible: true }).last();
    await expect(saveDetail).toBeVisible({ timeout: 10_000 });
    await expect(saveDetail).toBeEnabled({ timeout: 5_000 });
    await saveDetail.click();
    await this.confirmIfNeeded();

    // 等明细侧滑收起（主列表也有「新建明细」按钮，不能等该文案消失）
    await expect(saveDetail).toBeHidden({ timeout: 30_000 });
    await expect(this.scope().getByText(/暂无明细/).filter({ visible: true }).first()).toBeHidden({ timeout: 30_000 });
    await expect(
      this.scope().locator('main').getByText(typeName, { exact: true }).first(),
      `明细未保存成功（期望类型「${typeName}」）`,
    ).toBeVisible({ timeout: 30_000 });
  }

  async submit(approverKeyword?: string) {
    await this.expectEditVisible();
    await this.dismissBlockers();
    await this.ensureLineItem();
    await this.fillApproverIfNeeded(approverKeyword);
    // 不要用 editRoot()：编辑侧滑 last() 会盖住详情，侧滑内没有「提交」
    const btn = this.scope()
      .getByRole('button', { name: /^提\s*交$/ })
      .filter({ visible: true })
      .first();
    await expect(btn, '未找到提交按钮（若在编辑侧滑请先保存退出）').toBeVisible({ timeout: 30_000 });
    await btn.click();
    await this.waitSubmitDone();
  }

  /** 从当前详情/编辑区解析单号（提交成功后调用） */
  async readDocNo(): Promise<string> {
    await this.expectEditVisible();
    const root = this.editRoot();
    const labeled = root
      .locator('.ant-form-item, [class*="form-item"], [class*="info"], [class*="detail"]')
      .filter({ hasText: /单\s*号/ })
      .first();
    const chunk =
      ((await labeled.innerText().catch(() => '')) || '').trim() ||
      ((await root.innerText().catch(() => '')) || '');
    const text = chunk.replace(/\s+/g, ' ');
    const match = text.match(DOC_NO_RE) || text.match(/[A-Za-z0-9]{10,}/);
    if (!match) {
      throw new Error(`详情未解析到单号：${text.slice(0, 120)}`);
    }
    return match[0];
  }

  /**
   * 提交后可能：校验弹窗「继续提交」、指派「审批流程」确定、或长时间「正在提交」。
   * 在超时内轮询处理中间态，再认成功文案/状态。
   */
  private async waitSubmitDone(timeout = 120_000) {
    const deadline = Date.now() + timeout;
    const success = this.scope()
      .getByText(/提交成功|单据已提交|操作成功|审批中/)
      .filter({ visible: true })
      .first();

    while (Date.now() < deadline) {
      if (await success.isVisible().catch(() => false)) {
        return;
      }
      const bizErr = this.scope()
        .getByText(/请选择审批人|以保证单据正常送审|70401010/)
        .filter({ visible: true })
        .first();
      if (await bizErr.isVisible().catch(() => false)) {
        throw new Error('提交失败：请选择审批人（表单含自选审批人时需先选人，可设 REQUEST_APPROVER）');
      }
      await this.handleSubmitFollowUps();
      await this.page.waitForTimeout(500);
    }

    await expect(success, '提交未完成（可能缺明细/需选审批人/校验未点继续）').toBeVisible({ timeout: 1_000 });
  }

  private async handleSubmitFollowUps() {
    // 预算/合规校验：继续提交
    const cont = this.scope()
      .locator('.ant-modal')
      .filter({ visible: true })
      .filter({ hasNot: this.scope().locator('.request-loading-modal, .modal-submit-checking') })
      .getByRole('button', { name: /继续提交|继\s*续提\s*交|强行提交|继续/ })
      .filter({ visible: true })
      .last();
    if (await cont.isVisible().catch(() => false) && (await cont.isEnabled().catch(() => false))) {
      await cont.click();
      return;
    }

    // 指派审批人：标题「审批流程」——禁止 .first()（默认常是「泊凰测试」）
    const designate = this.scope()
      .locator('.ant-modal')
      .filter({ visible: true })
      .filter({ hasText: /审批流程|选择审批人|部分节点需要选择审批人/ })
      .last();
    if (await designate.isVisible().catch(() => false)) {
      const keys = await this.approverKeywords();
      const select = designate.locator('.ant-select').first();
      if (await select.isVisible().catch(() => false)) {
        const current = select.locator('.ant-select-selection-item, .ant-select-selection-choice').first();
        const curText = ((await current.innerText().catch(() => '')) || '').trim();
        if (!keys.some((k) => curText.includes(k))) {
          await select.click();
          let picked = false;
          for (const k of keys) {
            const search = this.scope().locator('.ant-select-dropdown:visible input').first();
            if (await search.isVisible({ timeout: 2_000 }).catch(() => false)) {
              await search.fill(k);
              await this.page.waitForTimeout(800);
            }
            const opt = this.scope()
              .locator(
                '.ant-select-dropdown:visible .ant-select-dropdown-menu-item, .ant-select-dropdown:visible .ant-select-item-option',
              )
              .filter({ hasText: k })
              .first();
            if (await opt.isVisible({ timeout: 3_000 }).catch(() => false)) {
              await opt.click();
              picked = true;
              break;
            }
          }
          if (!picked) {
            throw new Error(`审批流程弹窗未找到审批人，已尝试：${keys.join(' / ')}`);
          }
        }
      }
      const ok = designate.getByRole('button', { name: /^确\s*定$/ }).first();
      if (await ok.isVisible().catch(() => false) && (await ok.isEnabled().catch(() => false))) {
        await ok.click();
      }
      return;
    }

    // 普通确认
    const confirm = this.scope()
      .locator('.ant-modal, .ant-popover')
      .filter({ visible: true })
      .filter({ hasNotText: /正在提交|正在处理|过程中请勿离开/ })
      .getByRole('button', { name: /^确\s*定$|^确\s*认$/ })
      .filter({ visible: true })
      .last();
    if (await confirm.isVisible().catch(() => false) && (await confirm.isEnabled().catch(() => false))) {
      await confirm.click();
    }
  }

  /** 关掉非提交流程的遮挡弹窗（如未处理完的费用类型弹窗） */
  private async dismissBlockers() {
    const dialog = this.scope()
      .getByRole('dialog')
      .filter({ visible: true })
      .filter({ hasText: /添加费用类型/ })
      .last();
    if (!(await dialog.isVisible({ timeout: 1_000 }).catch(() => false))) return;
    const close = dialog
      .getByRole('button', { name: /取\s*消|Close|关\s*闭/ })
      .filter({ visible: true })
      .first();
    if (await close.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await close.click();
    }
    await expect(dialog).toBeHidden({ timeout: 5_000 }).catch(() => undefined);
  }

  private async confirmIfNeeded() {
    for (let i = 0; i < 3; i += 1) {
      const confirm = this.scope()
        .locator('.ant-modal, .ant-popover')
        .filter({ visible: true })
        .filter({ hasNotText: /正在提交|正在处理|过程中请勿离开/ })
        .getByRole('button', { name: /确\s*定|确\s*认|继\s*续|提\s*交/ })
        .last();
      if (!(await confirm.isVisible({ timeout: 2_000 }).catch(() => false))) break;
      if (!(await confirm.isEnabled().catch(() => false))) break;
      await confirm.click();
      await this.page.waitForTimeout(500);
    }
  }

  /** 审批中则撤回；编辑中无「撤回」则跳过 */
  async withdrawIfNeeded() {
    await this.ensureRoot();
    await this.finishDetailSlideIfOpen();
    const btn = this.scope()
      .getByRole('button', { name: /撤\s*回/ })
      .filter({ visible: true })
      .first();
    if (!(await btn.isVisible({ timeout: 5_000 }).catch(() => false))) return;

    await btn.click();
    await this.confirmIfNeeded();
    await expect(
      this.scope()
        .getByText(/撤回成功|已撤回|操作成功|编辑中/)
        .filter({ visible: true })
        .first(),
    ).toBeVisible({ timeout: 60_000 });
  }

  /**
   * 强制把自选审批人改成指定人（默认 97dev）。
   * 只读详情先点「编辑」；清掉已选后再搜选并保存。
   */
  async updateApprover(keyword = '97dev') {
    await this.ensureRoot();
    await this.finishDetailSlideIfOpen();
    const name = (keyword || (await this.selfApproverKeyword())).trim();

    const readonlyOk = this.scope()
      .getByText(new RegExp(`自选审批人[：:]\\s*${escapeRegExp(name)}`))
      .filter({ visible: true })
      .first();
    if (await readonlyOk.isVisible({ timeout: 2_000 }).catch(() => false)) {
      return;
    }

    const editBtn = this.scope().getByRole('button', { name: /^编\s*辑$/ }).filter({ visible: true }).first();
    if (await editBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await editBtn.click();
      await this.page.waitForTimeout(800);
    }

    const block = this.scope()
      .locator('.ant-form-item, [class*="form-item"]')
      .filter({ hasText: /自选审批人/ })
      .filter({ visible: true })
      .first();
    await expect(block, '未找到自选审批人字段（请确认已进入编辑）').toBeVisible({ timeout: 15_000 });

    await this.clearApproverInBlock(block);

    const trigger = block.getByRole('combobox').or(block.locator('.ant-select')).first();
    await expect(trigger).toBeVisible({ timeout: 10_000 });
    await trigger.click();

    await this.pickPersonByKeyword(name);
    await this.expectApproverSelected(block, name);
    await this.saveDocInfoIfEditing();
    await expect(
      this.scope().getByText(new RegExp(`自选审批人[：:]\\s*${escapeRegExp(name)}`)).first(),
      `自选审批人未更新为「${name}」`,
    ).toBeVisible({ timeout: 30_000 });
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
