import { test } from '../../fixtures/index';
import { ApRequestListPage } from '../../pages/ap-request-list.page';
import { ApRequestEditPage } from '../../pages/ap-request-edit.page';
import { env } from '../../utils/env';
import { resolveGoldenSeed } from '../../utils/golden-seed';
import { bindFlowStepCapture, flowStep } from '../../../src/utils/flow-step.js';

const GOLDEN_SKIP_MSG = '列表无可用单号，跳过 Golden 搜索';
const ctx = { docNo: '' };

function configuredDocNo(): string {
  const fromEnv = env.apRequestDocNo.trim();
  if (fromEnv) return fromEnv;
  const seed = resolveGoldenSeed(
    process.env.PLAYWRIGHT_ENV || 'dev',
    process.env.FLOW_ACCOUNT_SLUG || '',
  );
  return seed.docNo;
}

async function ensureDocNo(list: ApRequestListPage): Promise<string> {
  if (ctx.docNo) return ctx.docNo;
  ctx.docNo = configuredDocNo();
  if (!ctx.docNo) {
    if (!(await list.hasDataRows())) await list.recoverIfEmptyList();
    test.skip(!(await list.hasDataRows()), GOLDEN_SKIP_MSG);
    ctx.docNo = await list.readFirstDocNo();
  }
  return ctx.docNo;
}

/**
 * 对公申请单流程 golden 回归（只读）。
 *
 * 同一页顺序做：打开列表 → 按单号搜索 → 打开详情。
 * 不再每步整页重开，也不在搜索后重置列表。
 */
test.describe.configure({ mode: 'serial' });

test.describe('对公申请单流程 golden 回归', () => {
  test('列表加载与基础结构', async ({ page, flowRunDir }) => {
    bindFlowStepCapture({ page, flowRunDir });
    const list = new ApRequestListPage(page);

    await flowStep('打开列表', async () => {
      await list.goto();
      await list.expectLoaded();
    }, { snapshot: 'ap-request-list', step: 1 });
  });

  test('按首行单号搜索', async ({ page, flowRunDir }) => {
    bindFlowStepCapture({ page, flowRunDir });
    const list = new ApRequestListPage(page);
    await list.ensureOnList();
    const docNo = await ensureDocNo(list);

    await flowStep('搜索单号', async () => {
      await list.search(docNo);
      await list.expectRowContains(docNo);
    }, { snapshot: 'ap-request-search', step: 2 });
  });

  test('用现场单号搜索并打开详情', async ({ page, flowRunDir }) => {
    bindFlowStepCapture({ page, flowRunDir });
    const list = new ApRequestListPage(page);
    await list.ensureOnList();
    const docNo = await ensureDocNo(list);

    await flowStep('打开详情', async () => {
      await list.openByCode(docNo);
      const edit = new ApRequestEditPage(page);
      await edit.expectEditVisible();
    }, { snapshot: 'ap-request-detail', step: 3 });
  });
});
