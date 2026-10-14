import { type FrameLocator, type Locator, type Page, expect } from '@playwright/test';
import { waitForAppRoot, type AppRoot } from '../../flow-kit/utils/app-frame';
import { DETAIL, DOC_NO_RE } from '../utils/ap-request-catalog';

type Scope = FrameLocator | Page;

export class ApRequestEditPage {
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

  async ensureRoot(): Promise<void> {
    if (!this.root) {
      this.root = await waitForAppRoot(this.page);
    }
  }

  detailShell(): Locator {
    return this.scope().locator(DETAIL).filter({ visible: true }).last();
  }

  async expectEditVisible(): Promise<void> {
    await this.ensureRoot();
    const action = this.scope()
      .getByRole('button', { name: /保\s*存|提\s*交|删\s*除|返\s*回/ })
      .filter({ visible: true })
      .first();
    const shell = this.detailShell();
    const detailHeading = this.scope()
      .getByText(/单据详情|单据信息/)
      .filter({ visible: true })
      .first();
    const docNoText = this.scope().getByText(DOC_NO_RE).filter({ visible: true }).first();
    await expect(async () => {
      const actionOk = await action.isVisible().catch(() => false);
      const shellOk =
        (await shell.isVisible().catch(() => false)) &&
        (await shell.getByText(DOC_NO_RE).first().isVisible().catch(() => false));
      const headingOk =
        (await detailHeading.isVisible().catch(() => false)) &&
        (await docNoText.isVisible().catch(() => false));
      expect(actionOk || shellOk || headingOk, '未打开对公申请单详情').toBeTruthy();
    }).toPass({ timeout: 60_000 });
  }
}
