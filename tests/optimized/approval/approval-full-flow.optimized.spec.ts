/**
 * @spec-meta
 * {"playwrightEnv":"stage","accountProfile":"default","goldenSet":"approval-full-flow"}
 */
import fs from 'fs';
import path from 'path';
import { test } from '../fixtures';
import { ApprovalListPage } from '../../../approval-flow/pages/approval-list.page';
import { step } from '../../utils/optimized-actions';
import { assertNotLoginLikePage } from '../../../src/utils/login-detection';
import { visualTest, waitForPostInteractionPaint, withScreenshotRunSegment } from '../../../src/utils/screenshot';

/**
 * 审批列表全流程（Studio 可选）。
 *
 * 复用 approval-flow/pages/approval-list.page.ts 的 ApprovalListPage POM。
 * 说明：
 * - 登录态由 optimized 项目的 storageState 自动注入，无需重新登录。
 * - 只读流程（加载 / 页签切换 / 筛选 / 搜索 / 打开详情）始终运行。
 * - 写操作（审批通过 / 驳回）会改动 stage 真实数据，默认跳过，
 *   设置环境变量 APPROVAL_ENABLE_WRITE=1 后才会真实执行；
 *   可额外用 APPROVAL_DOC_NO / REJECT_DOC_NO 锁定具体操作单据。
 */
const WRITE_ENABLED = process.env.APPROVAL_ENABLE_WRITE === '1';
const APPROVAL_DOC_NO = process.env.APPROVAL_DOC_NO || '';
const REJECT_DOC_NO = process.env.REJECT_DOC_NO || '';
const APPROVAL_COMMENT = process.env.APPROVAL_COMMENT || '自动化审批通过（Studio）';
const REJECT_COMMENT = process.env.REJECT_COMMENT || '自动化审批驳回（Studio）';

test.describe('Golden Set · 审批列表全流程', () => {
  test('审批列表加载与页签切换', async ({ page }) => {
    test.setTimeout(90_000);
    const approval = new ApprovalListPage(page);

    await step('打开审批列表', async () => {
      await approval.goto();
      await approval.expectLoaded();
      await assertNotLoginLikePage(page, 'approval-full-flow load');
    });

    const screenshotDir = withScreenshotRunSegment('screenshots/stage/golden-set/approval-full-flow');
    fs.mkdirSync(screenshotDir, { recursive: true });
    const runDir = path.join(screenshotDir, new Date().toISOString().replace(/[:.]/g, '-'));

    await waitForPostInteractionPaint(page);
    await visualTest(page, { dir: runDir, name: 'approval-list', state: 'normal', step: 1 });

    await step('切换到「我的已办」页签', async () => {
      await approval.switchTab('我的已办');
      await approval.expectListReady();
    });

    await step('切换到「抄送我」页签', async () => {
      await approval.switchTab('抄送我');
      await approval.expectListReady();
    });
  });

  test('筛选条、业务类型与单号筛选', async ({ page }) => {
    test.setTimeout(90_000);
    const approval = new ApprovalListPage(page);

    await step('打开审批列表', async () => {
      await approval.goto();
      await approval.expectLoaded();
      await approval.expectFilterBarVisible();
    });

    await step('打开并关闭筛选面板', async () => {
      await approval.openFilterPanel();
      await approval.closeFilterPanel();
    });

    await step('按业务类型筛选后还原', async () => {
      const types = await approval.listBusinessTypes();
      if (!types.length) return;
      await approval.selectBusinessType(types[0]);
      await approval.expectListReady();
      await approval.resetBusinessType();
      await approval.expectListReady();
    });

    await step('按现场单号筛选后清除', async () => {
      const docNo = await approval.pickFirstDocNo();
      await approval.filterByDocNo(docNo);
      await approval.expectRowContains(docNo);
      await approval.clearFilters();
      await approval.expectListReady();
    });
  });

  test('按单号搜索并打开单据详情', async ({ page }) => {
    test.setTimeout(90_000);
    const approval = new ApprovalListPage(page);

    await step('打开审批列表', async () => {
      await approval.goto();
      await approval.expectLoaded();
    });

    if (APPROVAL_DOC_NO) {
      await step(`搜索单号 ${APPROVAL_DOC_NO} 并打开`, async () => {
        await approval.search(APPROVAL_DOC_NO);
        await approval.openByCode(APPROVAL_DOC_NO);
      });
    } else {
      await step('打开第一条待审批单据详情', async () => {
        await approval.openFirstRow();
      });
    }

    await step('断言详情内容可见', async () => {
      await approval.expectDetailVisible();
    });
  });
});

test.describe('审批通过与驳回（写操作，会改动 stage 数据）', () => {
  test('审批通过（带意见）— 需 APPROVAL_ENABLE_WRITE=1', async ({ page }) => {
    test.skip(!WRITE_ENABLED, '未启用写操作：设置 APPROVAL_ENABLE_WRITE=1 后才会执行真实审批');
    test.setTimeout(120_000);
    const approval = new ApprovalListPage(page);

    await step('打开待审批单据', async () => {
      await approval.goto();
      await approval.expectLoaded();
      if (APPROVAL_DOC_NO) {
        await approval.search(APPROVAL_DOC_NO);
        await approval.openByCode(APPROVAL_DOC_NO);
      } else {
        await approval.openFirstRow();
      }
    });

    await step('填写审批意见并通过', async () => {
      await approval.approveRow(APPROVAL_COMMENT, APPROVAL_DOC_NO || undefined);
    });

    await step('断言审批成功并回到列表', async () => {
      await approval.expectApprovalSuccess();
      await approval.expectBackToList();
    });
  });

  test('审批驳回（带意见）— 需 APPROVAL_ENABLE_WRITE=1', async ({ page }) => {
    test.skip(!WRITE_ENABLED, '未启用写操作：设置 APPROVAL_ENABLE_WRITE=1 后才会执行真实审批');
    test.setTimeout(120_000);
    const approval = new ApprovalListPage(page);

    await step('打开另一条待审批单据', async () => {
      await approval.goto();
      await approval.expectLoaded();
      if (REJECT_DOC_NO) {
        await approval.search(REJECT_DOC_NO);
        await approval.openByCode(REJECT_DOC_NO);
      } else {
        // 上一条「通过」已消耗首条，这里取当前列表首条（不同单据）
        await approval.openFirstRow();
      }
    });

    await step('填写审批意见并驳回', async () => {
      await approval.rejectRow(REJECT_COMMENT, REJECT_DOC_NO || undefined);
    });

    await step('断言审批成功并回到列表', async () => {
      await approval.expectApprovalSuccess();
      await approval.expectBackToList();
    });
    }
  );
});
