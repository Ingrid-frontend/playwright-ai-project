import { test } from '../../fixtures';
import { RequestListPage } from '../../pages/request-list.page';
import { RequestEditPage } from '../../pages/request-edit.page';
import { env } from '../../utils/env';
import { resolveGoldenSeed } from '../../utils/golden-seed';
import { bindFlowStepCapture, flowStep } from '../../../src/utils/flow-step';

/**
 * Golden 固定回归（只读 + 固定筛选项）：
 * 供像素基线对比；筛选用 REQUEST_FILTER_KEYWORD，单号用 REQUEST_DOC_NO。
 * 须使用 golden* 账号档案，勿与 write 档案混跑造单用例。
 * 多角色时基线按登录账号 slug 分目录（by-account/<slug>）。
 */
test.describe.configure({ mode: 'serial' });

const goldenCtx = { docNo: '', keyword: '' };
const keepFilters = { keepListFilters: true } as const;
const GOLDEN_SKIP_MSG =
  '列表无可用单号，跳过后续 Golden 步骤（Studio「指定单号」/ accounts.json requestDocNo / golden-seeds.json）';

async function trySeedGoldenContext(list: RequestListPage) {
  if (!goldenCtx.docNo) goldenCtx.docNo = env.requestDocNo.trim();
  if (!goldenCtx.docNo) {
    const seed = resolveGoldenSeed(
      process.env.PLAYWRIGHT_ENV || 'dev',
      process.env.FLOW_ACCOUNT_SLUG || '',
    );
    goldenCtx.docNo = seed.docNo;
    if (!goldenCtx.keyword && seed.keyword) goldenCtx.keyword = seed.keyword;
  }
  if (!goldenCtx.keyword) goldenCtx.keyword = env.requestFilterKeyword.trim();

  if (!(await list.hasDataRows())) {
    await list.recoverIfEmptyList();
  }
  if (!(await list.hasDataRows())) {
    if (!goldenCtx.docNo) {
      goldenCtx.docNo = await list.readDocNoFromListApi({ refresh: true });
    }
    if (goldenCtx.docNo) {
      if (!goldenCtx.keyword) {
        goldenCtx.keyword = goldenCtx.docNo.slice(0, Math.min(8, goldenCtx.docNo.length));
      }
      return;
    }
    return;
  }

  if (!goldenCtx.docNo) {
    try {
      goldenCtx.docNo = await list.readFirstDocNo();
    } catch {
      return;
    }
  }

  if (!goldenCtx.keyword) {
    try {
      goldenCtx.keyword = await list.readFirstReasonKeyword();
    } catch {
      goldenCtx.keyword = goldenCtx.docNo.slice(0, Math.min(8, goldenCtx.docNo.length));
    }
  } else if (!(await list.reasonKeywordExists(goldenCtx.keyword))) {
    try {
      goldenCtx.keyword = await list.readFirstReasonKeyword();
      test.info().annotations.push({
        type: 'golden-filter-fallback',
        description: `REQUEST_FILTER_KEYWORD「${env.requestFilterKeyword}」无匹配事由，改用首行「${goldenCtx.keyword}」`,
      });
    } catch {
      goldenCtx.keyword = goldenCtx.docNo.slice(0, Math.min(8, goldenCtx.docNo.length));
    }
  }
}

async function ensureGoldenList(list: RequestListPage) {
  await list.ensureOnList();
  if (!goldenCtx.docNo) {
    await trySeedGoldenContext(list);
  }
  if (!goldenCtx.docNo) {
    test.skip(true, GOLDEN_SKIP_MSG);
  }
  if (await list.hasDataRows()) return;
  if (await list.recoverIfEmptyList()) return;
  await list.search(goldenCtx.docNo, keepFilters).catch(() => undefined);
  if (await list.hasDataRows()) return;
  throw new Error('Golden 步骤前列表无数据');
}

test.describe('申请单 · Golden 回归', () => {
  test.beforeAll(() => {
    process.env.FLOW_SPEC = 'request/golden-regression.spec.ts';
  });

  test('申请单列表加载出数据行或空状态', async ({ authenticatedPage, page, flowRunDir }) => {
    void authenticatedPage;
    bindFlowStepCapture({ page, runDir: flowRunDir });
    const list = new RequestListPage(page);
    await flowStep('打开申请单列表', async () => {
      await list.goto();
      await list.expectLoaded();
      await list.recoverIfEmptyList();
      await trySeedGoldenContext(list);
      if (!goldenCtx.docNo && !(await list.hasDataRows())) {
        test.skip(true, GOLDEN_SKIP_MSG);
      }
    }, { snapshot: 'request-list', step: 1 });
  });

  test('按单号搜索并校验列表', async ({ page, flowRunDir }) => {
    bindFlowStepCapture({ page, runDir: flowRunDir });
    const list = new RequestListPage(page);
    await flowStep('准备列表', async () => {
      await ensureGoldenList(list);
    }, { capture: false });
    const docNo = goldenCtx.docNo;
    await flowStep('按单号搜索', async () => {
      await list.search(docNo, keepFilters);
      await list.expectRowContains(docNo);
      await list.restoreDefaultList();
    }, { snapshot: 'request-search', step: 2 });
  });

  test('展开筛选并按固定关键字筛选', async ({ page, flowRunDir }) => {
    bindFlowStepCapture({ page, flowRunDir });
    const list = new RequestListPage(page);
    await ensureGoldenList(list);
    const keyword = goldenCtx.keyword || goldenCtx.docNo.slice(0, 8);
    await flowStep('按事由筛选', async () => {
      await list.filterByReason(keyword, keepFilters);
      await list.expectReasonFilterResult(keyword);
      await list.restoreDefaultList();
      await list.expectListReady();
    }, { snapshot: 'request-filter', step: 3 });
  });

  test('用现场单号搜索并打开详情', async ({ page, flowRunDir }) => {
    bindFlowStepCapture({ page, flowRunDir });
    const list = new RequestListPage(page);
    await ensureGoldenList(list);
    const docNo = goldenCtx.docNo;
    await flowStep('搜索并打开详情', async () => {
      await list.search(docNo, keepFilters);
      await list.openByCode(docNo);
      const edit = new RequestEditPage(page);
      await edit.expectEditVisible();
    }, { snapshot: 'request-detail', step: 4 });
  });
});
