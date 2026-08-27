import { type FrameLocator, type Locator, type Page, expect } from '@playwright/test';
import { waitForAppRoot, type AppRoot } from '../utils/app-frame';
import { env } from '../utils/env';
import { DETAIL, DETAIL_MARKERS, DOC_NO_RE } from '../utils/request-catalog';
import { pickRandom, randomReason } from '../utils/random';

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
      const items = panel
        .locator('.station-menu-item, .ant-menu-item, .ant-dropdown-menu-item')
        .filter({ visible: true });
      const item = formName
        ? items.filter({ hasText: formName }).first()
        : await this.pickRandomMenuItem(items);
      await expect(
        item,
        formName ? `下拉未找到单据「${formName}」` : '新建申请单下拉无可用模板',
      ).toBeVisible({ timeout: 10_000 });
      await item.scrollIntoViewIfNeeded();
      await item.click({ force: true });
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
        const options = optDrop
          .locator('.ant-select-dropdown-menu-item, .ant-select-item-option')
          .filter({ visible: true });
        const option = formName
          ? options.filter({ hasText: formName }).first()
          : await this.pickRandomMenuItem(options);
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

  /** 从可见菜单项里随机选一个（未指定 REQUEST_FORM_NAME 时换表单试） */
  private async pickRandomMenuItem(items: Locator) {
    const n = await items.count();
    expect(n, '新建申请单下拉无可用模板').toBeGreaterThan(0);
    const idxs = Array.from({ length: n }, (_, i) => i);
    return items.nth(pickRandom(idxs));
  }

  async expectEditVisible() {
    await this.ensureRoot();
    // 列表表头也有「单号」，不能单靠文案。新建全屏底栏常见「保存并添加明细」，不能写死 ^保存$。
    // 详情打开后多信号常同时可见，不能用 .or().toBeVisible()（strict mode）。
    const action = this.scope()
      .getByRole('button', { name: /保存并添加明细|保\s*存|提\s*交|删除单据/ })
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

  private reasonInputStrict(): Locator {
    const root = this.editRoot();
    return root
      .locator('.ant-form-item, [class*="form-item"]')
      .filter({
        has: root.locator('.ant-form-item-label, label, [class*="label"]').filter({ hasText: /事由/ }),
      })
      .locator('textarea, input#title, input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"])')
      .filter({ visible: true })
      .first();
  }

  private async smartFillField(input: Locator, value: string) {
    await input.scrollIntoViewIfNeeded();
    await input.click();
    await input.press('ControlOrMeta+a');
    await input.press('Backspace');
    try {
      await input.fill(value);
    } catch {
      await input.pressSequentially(value, { delay: 20 });
    }
    const cur = ((await input.inputValue().catch(() => '')) || '').trim();
    if (cur !== value) {
      await input.evaluate((el, text) => {
        const node = el as HTMLInputElement | HTMLTextAreaElement;
        const proto =
          node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        setter?.call(node, text);
        node.dispatchEvent(new Event('input', { bubbles: true }));
        node.dispatchEvent(new Event('change', { bubbles: true }));
      }, value);
    }
    await input.blur();
  }

  async fillReason(value: string) {
    await this.expectEditVisible();
    const input = this.reasonInputStrict();
    await expect(input, '未找到事由输入框').toBeVisible({ timeout: 20_000 });
    await this.smartFillField(input, value);
    await expect(input, '事由未写入表单').toHaveValue(value, { timeout: 5_000 });
  }

  private async ensureReasonFilled() {
    const input = this.reasonInputStrict();
    if (!(await input.isVisible({ timeout: 3_000 }).catch(() => false))) return;
    const val = ((await input.inputValue().catch(() => '')) || '').trim();
    if (!val) await this.fillReason(env.requestReason || randomReason());
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

  /** 关掉未确认的侧滑（新建明细 / 新建行程），避免 slide-mask 挡住「编辑/提交」 */
  private async finishDetailSlideIfOpen() {
    const detailPanel = this.scope().getByText('新建明细', { exact: true }).filter({ visible: true }).first();
    const tripPanel = this.scope().getByText('新建行程', { exact: true }).filter({ visible: true }).first();
    const mask = this.scope().locator('.slide-mask').filter({ visible: true }).first();
    if (
      !(await detailPanel.isVisible({ timeout: 1_000 }).catch(() => false)) &&
      !(await tripPanel.isVisible({ timeout: 500 }).catch(() => false)) &&
      !(await mask.isVisible({ timeout: 500 }).catch(() => false))
    ) {
      return;
    }

    if (await tripPanel.isVisible({ timeout: 500 }).catch(() => false)) {
      const cancel = this.scope().getByRole('button', { name: /^取\s*消$/ }).filter({ visible: true }).last();
      if (await cancel.isVisible({ timeout: 1_000 }).catch(() => false)) {
        await cancel.click();
      } else {
        await this.page.keyboard.press('Escape').catch(() => undefined);
      }
      await expect(mask).toBeHidden({ timeout: 15_000 }).catch(() => undefined);
    }

    if (
      !(await detailPanel.isVisible({ timeout: 500 }).catch(() => false)) &&
      !(await this.scope().locator('.slide-mask').filter({ visible: true }).first().isVisible({ timeout: 500 }).catch(() => false))
    ) {
      await expect(this.scope().getByRole('button', { name: /^提\s*交$/ }).first())
        .toBeVisible({ timeout: 15_000 })
        .catch(() => undefined);
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

  /** 选人：优先「历史选择」（含「本人」）；表格搜登录名常无结果，勿作为首选 */
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

    const confirmHist = async () => {
      const okHist = modal.getByRole('button', { name: /^确\s*定$/ }).first();
      await expect(okHist).toBeVisible({ timeout: 5_000 });
      await okHist.click();
    };

    // 「历史选择」里「97dev + 本人」：登录名表格常搜不到，优先点该芯片
    const selfChip = modal
      .locator('div')
      .filter({ has: modal.getByText('本人', { exact: true }) })
      .filter({ hasText: keyword })
      .filter({ visible: true })
      .first();
    if (await selfChip.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await selfChip.click();
      await confirmHist();
      return;
    }

    // 「历史选择」其它芯片（芯片父节点文案可能是「泊凰测试」整段）
    const histBlock = modal
      .locator('div')
      .filter({ has: modal.getByText('历史选择', { exact: true }) })
      .first();
    const histChip = histBlock.getByText(keyword, { exact: true }).filter({ visible: true }).first();
    if (await histChip.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await histChip.click();
      await confirmHist();
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

    // 新建全屏/详情底栏已有「提交」时不是编辑侧滑；误点「保存」会因差旅缺日期等校验失败
    if (await submitOnSameBar.isVisible({ timeout: 1_000 }).catch(() => false)) return;

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

  async save(approverKeyword?: string, reason?: string) {
    await this.expectEditVisible();
    if (reason) await this.fillReason(reason);
    else await this.ensureReasonFilled();
    await this.fillApproverIfNeeded(approverKeyword);
    const travel = await this.isTravelForm();
    if (travel) await this.ensureTravelItinerary();
    await this.ensureReasonFilled();
    const root = this.editRoot();
    // 优先纯「保存/暂存」；仅有「保存并添加明细」时再点它（会弹出费用类型弹窗）
    const saveOnly = root.getByRole('button', { name: /^保\s*存$|^暂\s*存$/ }).filter({ visible: true }).first();
    const saveAny = root.getByRole('button', { name: /^保\s*存|^暂\s*存/ }).filter({ visible: true }).first();
    const btn = (await saveOnly.isVisible({ timeout: 2_000 }).catch(() => false)) ? saveOnly : saveAny;
    await expect(btn).toBeVisible({ timeout: 15_000 });
    await btn.click();
    await this.confirmIfNeeded();
    await this.waitSaveDone();
    if (travel) {
      // 「保存并添加明细」可能弹出费用类型；差旅靠行程，关掉即可
      await this.dismissExpenseTypeIfOpen();
    } else {
      await this.ensureLineItem();
    }
  }

  /** 关掉「添加费用类型」弹窗（差旅「保存并添加明细」会弹出） */
  private async dismissExpenseTypeIfOpen() {
    const wrap = this.scope().locator('.expense-type-modal').filter({ visible: true }).last();
    if (!(await wrap.isVisible({ timeout: 2_000 }).catch(() => false))) {
      // 兼容无 class 的费用类型 dialog
      const dialog = this.scope()
        .getByRole('dialog')
        .filter({ visible: true })
        .filter({ hasText: /添加费用类型|费用类型/ })
        .last();
      if (!(await dialog.isVisible({ timeout: 500 }).catch(() => false))) return;
      const cancel = dialog.getByRole('button', { name: /取\s*消/ }).filter({ visible: true }).first();
      if (await cancel.isVisible({ timeout: 1_000 }).catch(() => false)) await cancel.click({ force: true });
      else await this.page.keyboard.press('Escape').catch(() => undefined);
      await expect(dialog).toBeHidden({ timeout: 8_000 }).catch(() => undefined);
      return;
    }

    const cancel = wrap.getByRole('button', { name: /取\s*消/ }).filter({ visible: true }).first();
    const close = wrap.locator('.ant-modal-close, [aria-label="Close"]').filter({ visible: true }).first();
    if (await cancel.isVisible({ timeout: 1_500 }).catch(() => false)) {
      await cancel.click({ force: true });
    } else if (await close.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await close.click({ force: true });
    } else {
      await this.page.keyboard.press('Escape').catch(() => undefined);
    }
    await expect(wrap).toBeHidden({ timeout: 10_000 }).catch(() => undefined);
  }

  /** 差旅/差补/自由式：日期 + 目的地 + 行程明细（否则 subsidies 接口 success:false） */
  private async isTravelForm() {
    const root = this.editRoot();
    const checks = [
      root.getByText(/差旅行程|行程明细|行程信息/).filter({ visible: true }).first(),
      root.getByPlaceholder(/出发日期|返回日期|开始日期|结束日期/).filter({ visible: true }).first(),
      root.getByRole('textbox', { name: /出发日期|返回日期|开始日期/ }).filter({ visible: true }).first(),
      this.scope().locator('main').getByText(/差旅|差补|自由式/).filter({ visible: true }).first(),
    ];
    for (const loc of checks) {
      if (await loc.isVisible({ timeout: 800 }).catch(() => false)) return true;
    }
    return false;
  }

  private async ensureTravelItinerary() {
    await this.fillTripIfNeeded();
    const root = this.editRoot();
    await this.pickTripCities(root);
    await this.ensureItineraryRow(root);
  }

  private async pickCityInBlock(block: Locator, city: string | RegExp): Promise<boolean> {
    const control = block.locator('.ant-form-item-control, [class*="control"], [class*="content"]').first();
    const area = (await control.isVisible({ timeout: 300 }).catch(() => false)) ? control : block;
    const trigger = area
      .getByRole('combobox')
      .or(area.locator('.ant-select, [class*="city"]'))
      .or(area.getByText(/^请选择$|^出发地$|^目的地$/).filter({ visible: true }))
      .first();
    if (!(await trigger.isVisible({ timeout: 2_000 }).catch(() => false))) return false;
    await trigger.click();
    const opt = this.scope()
      .locator(
        '.ant-select-dropdown:visible .ant-select-item-option, .ant-select-dropdown:visible .ant-select-dropdown-menu-item, .ant-modal:visible, [class*="city-panel"]:visible',
      )
      .filter({ hasText: city })
      .filter({ visible: true })
      .first();
    if (!(await opt.isVisible({ timeout: 5_000 }).catch(() => false))) return false;
    await opt.click();
    return true;
  }

  private async fillTripCityByLabel(root: Locator, label: RegExp, city: string) {
    const block = root
      .locator('.ant-form-item, [class*="form-item"]')
      .filter({
        has: root.locator('.ant-form-item-label, label, [class*="label"]').filter({ hasText: label }),
      })
      .filter({ visible: true })
      .first();
    if (!(await block.isVisible({ timeout: 500 }).catch(() => false))) return;

    const err = block.getByText(/请选择/).filter({ visible: true }).first();
    const val = block.getByText(/北京|上海|广州|深圳|杭州|成都|武汉|南京/).filter({ visible: true }).first();
    if (await val.isVisible({ timeout: 300 }).catch(() => false) && !(await err.isVisible({ timeout: 200 }).catch(() => false))) {
      return;
    }
    await this.pickCityInBlock(block, city);
  }

  private async pickTripCities(root: Locator) {
    for (const { label, city } of [
      { label: /^出发地$|出发城市/, city: '北京' },
      { label: /^目的地$|到达城市/, city: '上海' },
      { label: /^城市$/, city: '北京' },
    ] as const) {
      await this.fillTripCityByLabel(root, label, city);
    }

    const destErr = root.getByText(/请选择目的地|请选择城市|请选择出发/).filter({ visible: true }).first();
    if (await destErr.isVisible({ timeout: 500 }).catch(() => false)) {
      const block = root
        .locator('.ant-form-item, [class*="form-item"]')
        .filter({ has: destErr })
        .filter({ visible: true })
        .first();
      if (await block.isVisible({ timeout: 500 }).catch(() => false)) {
        await this.pickCityInBlock(block, /北京|上海|广州/);
      } else {
        const icon = root.locator('.anticon, i, [class*="add"]').filter({ visible: true }).last();
        if (await icon.isVisible({ timeout: 1_000 }).catch(() => false)) {
          await icon.click();
          const city = this.scope()
            .locator('.ant-select-dropdown:visible, .ant-modal:visible, [class*="city-panel"]:visible')
            .getByText(/^北京$|^上海$|^广州$/)
            .filter({ visible: true })
            .first();
          if (await city.isVisible({ timeout: 5_000 }).catch(() => false)) await city.click();
        }
      }
    }
  }

  /** 自由式差旅：无行程明细时补一段（触发差补计算） */
  private async ensureItineraryRow(root: Locator) {
    const hasRow = root
      .locator('.ant-table-tbody tr.ant-table-row, [class*="itinerary"], [class*="trip-"]')
      .filter({ hasText: /北京|上海|广州|深圳|\d{4}-\d{2}-\d{2}/ })
      .filter({ visible: true })
      .first();
    if (await hasRow.isVisible({ timeout: 2_000 }).catch(() => false)) return;

    const add = root
      .getByRole('button', { name: /添加行程|新建行程|添加差旅行程|添加一段|添\s*加行程/ })
      .filter({ visible: true })
      .first();
    if (!(await add.isVisible({ timeout: 3_000 }).catch(() => false))) return;

    await add.click();
    const panel = this.scope()
      .locator('.ant-drawer, .ant-modal, [class*="slide"]')
      .filter({ visible: true })
      .filter({ hasText: /行程|出发|到达|目的地|城市/ })
      .last();
    if (!(await panel.isVisible({ timeout: 8_000 }).catch(() => false))) return;

    for (const [re, city] of [
      [/出发城市|出发地|从/, '北京'],
      [/到达城市|目的地|到/, '上海'],
    ] as const) {
      const block = panel.locator('.ant-form-item, [class*="form-item"]').filter({ hasText: re }).first();
      if (await block.isVisible({ timeout: 1_000 }).catch(() => false)) {
        if (await this.pickCityInBlock(block, city)) continue;
      }
      const loose = panel.locator('div').filter({ hasText: re }).filter({ visible: true }).first();
      if (await loose.isVisible({ timeout: 500 }).catch(() => false)) {
        await this.pickCityInBlock(loose, city);
      }
    }

    const saveBtn = panel.getByRole('button', { name: /^保\s*存$|^确\s*定$/ }).filter({ visible: true }).last();
    if (await saveBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await expect(saveBtn).toBeEnabled({ timeout: 8_000 });
      await saveBtn.click();
    }
    await expect(panel).toBeHidden({ timeout: 15_000 }).catch(() => undefined);
    await expect(this.scope().locator('.slide-mask').filter({ visible: true }).first())
      .toBeHidden({ timeout: 15_000 })
      .catch(() => undefined);
  }

  /** 差旅类表单：补出发/返回日期（避开与已有单据重叠；RangePicker 多为 readonly） */
  private async fillTripIfNeeded() {
    const root = this.editRoot();
    const start = root
      .getByPlaceholder(/出发日期|开始日期|开始|出发/)
      .or(root.getByRole('textbox', { name: /出发日期|开始日期|出发/ }))
      .filter({ visible: true })
      .first();
    const end = root
      .getByPlaceholder(/返回日期|结束日期|结束|返回/)
      .or(root.getByRole('textbox', { name: /返回日期|结束日期|返回/ }))
      .filter({ visible: true })
      .first();
    if (!(await start.isVisible({ timeout: 2_000 }).catch(() => false))) return;

    // 往后翻若干月再选，降低与历史差补单「单据日期重叠」概率
    const monthsAhead = 2 + (Date.now() % 3);

    await start.click();
    const cal = this.scope()
      .locator('.ant-calendar-picker-container:visible, .ant-picker-dropdown:visible')
      .last();
    await expect(cal, '未打开行程日期日历').toBeVisible({ timeout: 8_000 });

    const nextMonth = cal
      .locator(
        '.ant-calendar-next-month-btn, .ant-picker-header-next-btn, .ant-calendar-next-year-btn, button.ant-picker-header-super-next-btn',
      )
      .filter({ visible: true })
      .first();
    for (let i = 0; i < monthsAhead; i += 1) {
      if (await nextMonth.isVisible({ timeout: 800 }).catch(() => false)) {
        await nextMonth.click();
        await this.page.waitForTimeout(200);
      }
    }

    const dayCells = cal
      .locator(
        'td.ant-calendar-cell:not(.ant-calendar-disabled-cell):not(.ant-calendar-last-month-cell):not(.ant-calendar-next-month-btn-day) .ant-calendar-date, .ant-picker-cell-in-view:not(.ant-picker-cell-disabled) .ant-picker-cell-inner',
      )
      .filter({ visible: true });
    await expect(dayCells.first(), '日历无可选日期').toBeVisible({ timeout: 5_000 });

    // 选当月中间两天，保证 start < end
    const n = await dayCells.count();
    const i0 = Math.min(10, Math.max(0, n - 3));
    const i1 = Math.min(i0 + 2, n - 1);
    await dayCells.nth(i0).click({ force: true });
    await dayCells.nth(i1).click({ force: true });
    await this.page.keyboard.press('Escape').catch(() => undefined);

    const s = ((await start.inputValue().catch(() => '')) || '').trim();
    const e = (await end.isVisible().catch(() => false))
      ? ((await end.inputValue().catch(() => '')) || '').trim()
      : s;
    if (!s || !e || s >= e) {
      // readonly 填不进时再点一轮相邻两天
      await start.click();
      const cal2 = this.scope()
        .locator('.ant-calendar-picker-container:visible, .ant-picker-dropdown:visible')
        .last();
      if (await cal2.isVisible({ timeout: 3_000 }).catch(() => false)) {
        const cells = cal2
          .locator(
            'td.ant-calendar-cell:not(.ant-calendar-disabled-cell) .ant-calendar-date, .ant-picker-cell-in-view:not(.ant-picker-cell-disabled) .ant-picker-cell-inner',
          )
          .filter({ visible: true });
        if ((await cells.count()) >= 2) {
          await cells.nth(5).click({ force: true }).catch(() => cells.first().click({ force: true }));
          await cells.nth(7).click({ force: true }).catch(() => cells.nth(1).click({ force: true }));
        }
        await this.page.keyboard.press('Escape').catch(() => undefined);
      }
    }

    const destErr = root.getByText(/请选择目的地/).filter({ visible: true }).first();
    if (await destErr.isVisible({ timeout: 1_000 }).catch(() => false)) {
      const city = root.getByText(/北京|上海|广州|深圳|杭州/).filter({ visible: true }).first();
      if (await city.isVisible({ timeout: 1_000 }).catch(() => false)) {
        await city.click().catch(() => undefined);
      }
    }
  }

  /** 保存成功：toast / 顶栏「单据已保存」/「保存并添加明细」弹出费用类型 均算成功 */
  private async waitSaveDone(timeout = 30_000) {
    const deadline = Date.now() + timeout;
    const ok = this.scope()
      .getByText(/已保存|保存成功|操作成功|单据已保存/)
      .filter({ visible: true })
      .first();
    const expenseDlg = this.expenseTypeDialog();
    const bad = this.scope()
      .getByText(/请选择开始结束日期|请选择目的地|请填写|不能为空|校验失败|保存失败/)
      .filter({ visible: true })
      .first();
    while (Date.now() < deadline) {
      if (await ok.isVisible().catch(() => false)) return;
      if (await expenseDlg.isVisible({ timeout: 200 }).catch(() => false)) return;
      await this.clickContinueSaveIfNeeded();
      if (await bad.isVisible().catch(() => false)) {
        const msg = ((await bad.innerText().catch(() => '')) || '').trim();
        throw new Error(`保存未成功（表单校验）：${msg || '存在必填未填'}`);
      }
      await this.page.waitForTimeout(400);
    }
    await expect(ok, '保存未出现成功提示（差旅等模板可能缺行程日期）').toBeVisible({ timeout: 1_000 });
  }

  /** 「单据日期重叠」等：点「继续保存」 */
  private async clickContinueSaveIfNeeded() {
    const btn = this.scope()
      .getByRole('button', { name: /继\s*续\s*保\s*存|继\s*续\s*提\s*交|仍\s*要\s*保\s*存/ })
      .or(this.scope().getByText(/继续保存/, { exact: true }))
      .filter({ visible: true })
      .first();
    if (await btn.isVisible({ timeout: 300 }).catch(() => false)) {
      await btn.click();
    }
  }

  /** 费用类单据：弹窗选类型或点「新建明细」，补一条可提交的明细 */
  async ensureLineItem() {
    await this.ensureRoot();
    const root = this.editRoot();
    const empty = root.getByText(/暂无明细/);
    const dialog = this.expenseTypeDialog();

    // 保存后弹窗可能晚于 toast；短等空态或费用类型弹窗
    let needDetail =
      (await empty.isVisible({ timeout: 2_000 }).catch(() => false)) ||
      (await dialog.isVisible({ timeout: 1_000 }).catch(() => false));
    if (!needDetail) {
      needDetail = await dialog
        .waitFor({ state: 'visible', timeout: 5_000 })
        .then(() => true)
        .catch(async () => empty.isVisible({ timeout: 1_000 }).catch(() => false));
    }
    if (!needDetail) return;

    // 保存/保存并添加明细 会自动弹窗；先等弹窗，勿抢点 loading 中或被遮罩挡住的「新建明细」
    if (!(await dialog.isVisible({ timeout: 500 }).catch(() => false))) {
      const opened = await dialog
        .waitFor({ state: 'visible', timeout: 12_000 })
        .then(() => true)
        .catch(() => false);
      if (!opened) {
        const newBtn = root.getByRole('button', { name: /新建明细/ }).filter({ visible: true }).first();
        await expect(newBtn).toBeEnabled({ timeout: 15_000 });
        await newBtn.click();
      }
    }
    await expect(dialog, '未打开费用类型弹窗').toBeVisible({ timeout: 15_000 });

    const typeName = await this.pickExpenseType(dialog);
    const ok = dialog.getByRole('button', { name: /^确\s*定$/ }).filter({ visible: true }).first();
    await expect(ok).toBeEnabled({ timeout: 10_000 });
    await ok.click();
    await this.fillDetailAmountAndSave(typeName);
  }

  private expenseTypeDialog(): Locator {
    return this.scope()
      .locator('.expense-type-modal')
      .or(this.scope().getByRole('dialog', { name: /添加费用类型|费用类型/ }))
      .or(this.scope().locator('.ant-modal, [role="dialog"]').filter({ hasText: /添加费用类型|选择费用类型/ }))
      .filter({ visible: true })
      .last();
  }

  private async pickExpenseType(dialog: Locator): Promise<string> {
    const pool = ['办公', '其它杂项', '招待', '通讯', '餐补', '话费'];
    const selectedHint = dialog.getByText(/已选\s*[1-9]/).filter({ visible: true }).first();

    const tryPick = async (name: string) => {
      const label = dialog.getByText(name, { exact: true }).filter({ visible: true }).first();
      if (!(await label.isVisible({ timeout: 1_000 }).catch(() => false))) return false;
      // 卡片是「icon + 文案」外层；点 label 后校验「已选 N」，失败则点父节点
      await label.click();
      if (await selectedHint.isVisible({ timeout: 1_500 }).catch(() => false)) return true;
      await label.evaluate((el) => {
        const parent = el.parentElement;
        if (parent) (parent as HTMLElement).click();
      });
      return selectedHint.isVisible({ timeout: 2_000 }).catch(() => false);
    };

    for (const name of pool) {
      if (await tryPick(name)) return name;
    }

    const otherTab = dialog
      .locator('.ant-menu-item, [class*="category"], [class*="group"]')
      .filter({ hasText: /^其它$/ })
      .filter({ visible: true })
      .first()
      .or(dialog.getByText('其它', { exact: true }).filter({ visible: true }).first());
    if (await otherTab.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await otherTab.click();
      await this.page.waitForTimeout(400);
      for (const name of pool) {
        if (await tryPick(name)) return name;
      }
    }

    throw new Error('费用类型列表为空或点击未选中（已选仍为 0）');
  }

  private async fillDetailAmountAndSave(typeName: string) {
    // 明细侧滑金额：Ant InputNumber；以 spinbutton 为准（勿用 [class*="slide"]，会误命中主编辑 slide-frame）
    const amount = this.scope()
      .getByRole('spinbutton', { name: /请输入/ })
      .filter({ visible: true })
      .first()
      .or(
        this.scope()
          .locator('.ant-form-item, [class*="form-item"]')
          .filter({ hasText: /金额\s*\*/ })
          .locator('input:not([type="hidden"])')
          .filter({ visible: true })
          .first(),
      );
    await expect(amount, '明细金额输入框未出现').toBeVisible({ timeout: 15_000 });

    const saveDetail = this.scope()
      .getByRole('button', { name: /^确\s*定$/ })
      .filter({ visible: true })
      .last();
    await expect(saveDetail).toBeVisible({ timeout: 10_000 });

    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (!(await amount.isVisible({ timeout: 800 }).catch(() => false))) break;

      const val = String(Math.floor(Math.random() * 99) + 1);
      await amount.click();
      await amount.press('ControlOrMeta+a');
      await amount.press('Backspace');
      await amount.pressSequentially(val, { delay: 25 });
      await amount.blur();
      await expect(amount).not.toHaveValue(/^(0(\.0+)?|)$/, { timeout: 3_000 });

      await expect(saveDetail).toBeEnabled({ timeout: 5_000 });
      await saveDetail.click();
      await this.confirmIfNeeded();

      const closed = await amount
        .waitFor({ state: 'hidden', timeout: 10_000 })
        .then(() => true)
        .catch(() => false);
      if (closed) break;
      if (attempt === 2) {
        const hint = await this.scope()
          .getByText(/请填写|不能为空|必填|请输入金额/)
          .filter({ visible: true })
          .first()
          .innerText()
          .catch(() => '');
        throw new Error(`明细侧滑点「确定」后未关闭${hint ? `：${hint}` : ''}`);
      }
    }

    await expect(this.scope().getByText(/暂无明细/).filter({ visible: true }).first()).toBeHidden({
      timeout: 30_000,
    });
    await expect(
      this.scope().locator('main').getByText(typeName, { exact: true }).first(),
      `明细未保存成功（期望类型「${typeName}」）`,
    ).toBeVisible({ timeout: 30_000 });
  }

  async submit(approverKeyword?: string) {
    await this.expectEditVisible();
    await this.dismissBlockers();
    await this.dismissExpenseTypeIfOpen();
    const travel = await this.isTravelForm();
    if (travel) await this.ensureTravelItinerary();
    else await this.ensureLineItem();
    await this.fillApproverIfNeeded(approverKeyword);
    await this.dismissExpenseTypeIfOpen();
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
    // 提交后常直接回列表；快速失败好走列表按事由回退，避免 expectEditVisible 空等 60s
    const stillEdit = this.scope()
      .getByRole('button', { name: /提\s*交|删除单据|撤\s*回/ })
      .filter({ visible: true })
      .first();
    if (!(await stillEdit.isVisible({ timeout: 5_000 }).catch(() => false))) {
      throw new Error('详情已关闭，改从列表取单号');
    }
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
    // 勿用裸「审批中」：列表行也有该文案，会误判已提交而离开详情
    const toastOk = this.scope()
      .locator('.ant-message, .ant-notification, [class*="message"], [class*="toast"]')
      .getByText(/提交成功|单据已提交|操作成功/)
      .filter({ visible: true })
      .first();
    const detailOk = this.editRoot()
      .getByText(/提交成功|单据已提交|审批中|已提交/)
      .filter({ visible: true })
      .first();
    const backToList = this.scope()
      .getByRole('button', { name: /新建申请单/ })
      .filter({ visible: true })
      .first();

    while (Date.now() < deadline) {
      // 先认回列表（部分模板提交后直接关详情），避免再去点中间态按钮
      if (await backToList.isVisible().catch(() => false)) {
        const submitGone = !(await this.scope()
          .getByRole('button', { name: /^提\s*交$/ })
          .filter({ visible: true })
          .first()
          .isVisible()
          .catch(() => false));
        if (submitGone) return;
      }
      if ((await toastOk.isVisible().catch(() => false)) || (await detailOk.isVisible().catch(() => false))) {
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

    await expect(toastOk.or(detailOk).first(), '提交未完成（可能缺明细/需选审批人/校验未点继续）').toBeVisible({
      timeout: 1_000,
    });
  }

  private async handleSubmitFollowUps() {
    await this.clickContinueSaveIfNeeded();
    // 预算/合规/日期重叠：仅匹配明确文案，勿用裸「继续」（易误点不可点控件）
    const cont = this.scope()
      .locator('.ant-modal, [role="dialog"]')
      .filter({ visible: true })
      .filter({ hasNot: this.scope().locator('.request-loading-modal, .modal-submit-checking') })
      .getByRole('button', { name: /继续提交|继\s*续\s*提\s*交|强行提交|继续保存|继\s*续\s*保\s*存/ })
      .filter({ visible: true })
      .last();
    if (await cont.isVisible({ timeout: 800 }).catch(() => false) && (await cont.isEnabled().catch(() => false))) {
      await cont.click({ timeout: 8_000 }).catch(() => undefined);
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
    await this.dismissExpenseTypeIfOpen();
  }

  private async confirmIfNeeded() {
    for (let i = 0; i < 3; i += 1) {
      await this.clickContinueSaveIfNeeded();
      const confirm = this.scope()
        .locator('.ant-modal, .ant-popover, [role="dialog"]')
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
