import { test } from '../../fixtures';
import { RequestListPage } from '../../pages/request-list.page';
import { RequestEditPage } from '../../pages/request-edit.page';
import { env } from '../../utils/env';
import { resolveGoldenSeed } from '../../utils/golden-seed';
import { bindFlowStepCapture, flowStep } from '../../../src/utils/flow-step';

/**
 * Golden 固定回归（只读）：
 * 单号/事由默认从列表现场读取；REQUEST_DOC_NO、REQUEST_FILTER_KEYWORD、golden-seeds 仅作覆盖。
 * 须使用 golden* 账号档案，勿与 write 档案混跑造单用例。
 */
test.describe.configure({ mode: 'serial' });

const goldenCtx = { docNo: '', keyword: '' };
const keepFilters = { keepListFilters: true } as const;
const GOLDEN_SKIP_MSG = '列表无可用单号，跳过后续 Golden 步骤';
const SEED_MISSING_MSG = 'Golden 种子缺失（SEED_MISSING）';

const KEYWORD_SKIP_MSG = '无法从列表读取可用事由关键字';

async function pickKeywordFromList(list: RequestListPage, prev?: string): Promise<boolean> {
  if (!goldenCtx.docNo) return false;
  try {
    goldenCtx.keyword = await list.readReasonForDocNo(goldenCtx.docNo);
  } catch {
    try {
      goldenCtx.keyword = await list.readFirstReasonKeyword();
    } catch {
      return false;
    }
  }
  if (prev && prev !== goldenCtx.keyword) {
    test.info().annotations.push({
      type: 'golden-filter-fallback',
      description: `事由关键字「${prev}」当前列表无匹配，改用「${goldenCtx.keyword}」`,
    });
  }
  return true;
}

async function fillKeywordFromList(list: RequestListPage) {
  if (!goldenCtx.docNo || goldenCtx.keyword) return;
  if (!(await pickKeywordFromList(list))) return;
}

async function ensureFilterKeyword(list: RequestListPage) {
  if (!goldenCtx.docNo) return;
  if (goldenCtx.keyword && (await list.reasonKeywordExists(goldenCtx.keyword))) return;
  const prev = goldenCtx.keyword;
  if (!(await pickKeywordFromList(list, prev))) {
    test.skip(true, KEYWORD_SKIP_MSG);
  }
}

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

  if (!goldenCtx.docNo) {
    test.skip(true, SEED_MISSING_MSG);
    return;
  }

  if (!(await list.hasDataRows())) {
    await list.recoverIfEmptyList();
  }

  if (!goldenCtx.keyword) {
    await fillKeywordFromList(list);
  } else if (!(await list.reasonKeywordExists(goldenCtx.keyword))) {
    await pickKeywordFromList(list, goldenCtx.keyword);
  }
}

async function ensureGoldenCtxReady(list: RequestListPage) {
  await list.ensureOnList();
  if (!goldenCtx.docNo) {
    await trySeedGoldenContext(list);
  }
  if (!goldenCtx.docNo) {
    test.skip(true, GOLDEN_SKIP_MSG);
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
    await ensureGoldenCtxReady(list);
    await ensureFilterKeyword(list);
    const keyword = goldenCtx.keyword;
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
    // 用带空列表恢复的准备（ensureGoldenList）：前序用例 skip/筛选残留可能
    // 让列表处于空状态，recoverIfEmptyList 会清筛选重搜兜底
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
