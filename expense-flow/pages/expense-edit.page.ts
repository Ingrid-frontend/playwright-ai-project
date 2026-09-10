import { type Locator, type Page, expect } from '@playwright/test';
import { DETAIL, LIST_PATH, DOC_NO_RE } from '../utils/expense-catalog';
import { randomReason } from '../utils/random';

/**
 * 报销单编辑/详情页对象模型。
 *
 * 结构对齐 request-flow 的 RequestEditPage，但报销单详情的判定信号更简单：
 * SlideFrame 侧滑 / 全屏容器 + 底栏「保\s*存 / 提\s*交」按钮。
 * 写操作（save/submit）只在 EXPENSE_ENABLE_WRITE=1 的 full-flow 里被调用。
 */
export class ExpenseEditPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  /** 详情容器：侧滑或全屏，取可见的最后一个 */
  detailShell(): Locator {
    return this.page.locator(DETAIL).filter({ visible: true }).last();
  }

  async expectEditVisible(): Promise<void> {
    // 双信号：底栏动作按钮 or 容器内出现单号格式文本（列表页头也有「单号」列，故需限定在容器内）
    const action = this.page
      .getByRole('button', { name: /保\s*存|提\s*交|删\s*除|返\s*回/ })
      .filter({ visible: true })
      .first();
    const shell = this.detailShell();
    await expect(async () => {
      const actionOk = await action.isVisible().catch(() => false);
      const shellOk =
        (await shell.isVisible().catch(() => false)) &&
        (await shell.getByText(DOC_NO_RE).first().isVisible().catch(() => false));
      expect(actionOk || shellOk, '未打开报销单详情').toBeTruthy();
    }).toPass({ timeout: 60_000 });
  }

  private async waitFormReady(): Promise<void> {
    await this.page
      .locator('.ant-spin-spinning')
      .first()
      .waitFor({ state: 'hidden', timeout: 30_000 })
      .catch(() => undefined);
  }

  /** 事由输入框：报销单编辑页的事由块（textarea / input） */
  private async findReasonInput(): Promise<Locator> {
    await this.waitFormReady();
    let found: Locator | null = null;
    await expect(async () => {
      const blocks = this.page
        .locator('.ant-form-item, [class*="form-item"]')
        .filter({ hasText: /事\s*由/ })
        .filter({ visible: true });
      const n = await blocks.count();
      for (let i = 0; i < n; i++) {
        const block = blocks.nth(i);
        const textarea = block.locator('textarea').filter({ visible: true }).first();
        if (await textarea.isVisible({ timeout: 300 }).catch(() => false)) {
          found = textarea;
          return;
        }
        const input = block
          .locator('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"])')
          .filter({ visible: true })
          .first();
        if (await input.isVisible({ timeout: 300 }).catch(() => false)) {
          found = input;
          return;
        }
      }
      // 兜底：label / placeholder 定位
      const outs = [
        this.page.getByLabel(/事\s*由/).filter({ visible: true }).first(),
        this.page.getByPlaceholder(/事由|请输入/).filter({ visible: true }).first(),
      ];
      for (const loc of outs) {
        if (await loc.isVisible({ timeout: 300 }).catch(() => false)) {
          found = loc;
          return;
        }
      }
      expect(found, '未找到报销单事由输入框').toBeTruthy();
    }).toPass({ timeout: 30_000 });
    return found!;
  }

  async fillReason(value: string): Promise<void> {
    await this.expectEditVisible();
    const input = await this.findReasonInput();
    await input.scrollIntoViewIfNeeded().catch(() => undefined);
    await input.click();
    await input.press('ControlOrMeta+a');
    await input.press('Backspace');
    try {
      await input.fill(value);
    } catch {
      await input.pressSequentially(value, { delay: 20 });
    }
    await input.blur();
    await expect(input, '事由未写入报销单表单').toHaveValue(value, { timeout: 5_000 });
  }

  /** 底栏动作按钮（保存/提交），详情态先点「编辑」再保存的场景不覆盖——报销单新建即编辑态 */
  private actionBtn(name: RegExp): Locator {
    return this.page
      .getByRole('button', { name })
      .filter({ visible: true })
      .first();
  }

  /** 保存报销单。返回是否成功（保存后底栏出现「提交」或出现成功 toast） */
  async save(): Promise<void> {
    await this.actionBtn(/保\s*存/).click();
    // 保存成功信号：提交按钮可见（保存并继续编辑）或 toast
    await expect(async () => {
      const submitOk = await this.actionBtn(/提\s*交/).isVisible().catch(() => false);
      const toastOk = await this.page
        .locator('.ant-message-success, .ant-notification-notice-success')
        .first()
        .isVisible()
        .catch(() => false);
      expect(submitOk || toastOk, '报销单保存未成功').toBeTruthy();
    }).toPass({ timeout: 60_000 });
  }

  /** 提交报销单（写操作） */
  async submit(): Promise<void> {
    const btn = this.actionBtn(/提\s*交/);
    await expect(btn, '未找到「提交」按钮（可能未保存）').toBeVisible({ timeout: 10_000 });
    await btn.click();
    // 确认弹窗（如有）
    const confirm = this.page
      .locator('.ant-modal-confirm')
      .filter({ visible: true })
      .last();
    if (await confirm.isVisible({ timeout: 1_500 }).catch(() => false)) {
      await confirm.getByRole('button', { name: /确\s*定|同\s*意/ }).first().click();
    }
    await expect(async () => {
      // 提交成功：回到列表 or 成功 toast
      const backToList = this.page.url().includes(LIST_PATH.replace('/main', '/main'));
      const toastOk = await this.page
        .locator('.ant-message-success, .ant-notification-notice-success')
        .first()
        .isVisible()
        .catch(() => false);
      const closed = !(await this.detailShell().isVisible().catch(() => false));
      expect(backToList && (toastOk || closed), '报销单提交未成功').toBeTruthy();
    }).toPass({ timeout: 60_000 });
  }

  /** 默认事由（环境变量或随机） */
  static defaultReason(): string {
    return randomReason();
  }
}
