#!/usr/bin/env tsx
/**
 * flow:new — 一条命令生成新流程骨架，并自动完成所有注册。
 *
 * 新增流程原本要人工碰 ~10 个点，其中 90% 是样板：
 *   flow-registry / package.json scripts / playwright.config / fixtures / env /
 *   catalog / list POM / golden spec / datasource / runner
 * 本脚本把这些全部生成好，人只需要做两件真正有业务含量的事：
 *   1. 探活 + 生成 catalog（npm run flow:gen-catalog）
 *   2. 写业务特有的 spec 步骤
 *
 * 用法：
 *   npm run flow:new -- --id=expense-flow --label=报销流程 --entry=/main/expense-parent-report/expense-report
 *   npm run flow:new -- --id=expense-flow --label=报销流程 --entry=/main/expense-parent-report/expense-report --dry-run
 *
 * 生成后立刻能跑：
 *   npm run flow:list                                  # 确认已注册
 *   npm run flow:debug-fast -- --flow=expense-flow     # 跑骨架 spec
 */
import fs from 'fs';
import path from 'path';
import { getFlow, listFlowIds } from './flow-registry.js';

type Args = {
  id: string;
  label: string;
  entry: string;
  domain: string;
  dryRun: boolean;
  force: boolean;
  help: boolean;
};

function getArg(argv: string[], name: string, fallback = ''): string {
  const prefix = `--${name}=`;
  const hit = argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length).trim() : fallback;
}

function parseArgs(argv: string[]): Args {
  const id = getArg(argv, 'id');
  return {
    id,
    label: getArg(argv, 'label'),
    entry: getArg(argv, 'entry'),
    domain: getArg(argv, 'domain') || id.replace(/-flow$/, ''),
    dryRun: argv.includes('--dry-run'),
    force: argv.includes('--force'),
    help: argv.includes('--help') || argv.includes('-h'),
  };
}

function printHelp(): void {
  process.stdout.write(`flow:new — 生成新流程骨架并自动注册

用法
  npm run flow:new -- --id=<flow-id> --label=<中文名> --entry=<列表路由> [选项]

必填
  --id=<flow-id>     目录名 & FlowId，约定以 -flow 结尾，如 expense-flow
  --label=<中文名>    报告 / 飞书通知里显示的名字，如 报销流程
  --entry=<path>     列表页路由，如 /main/expense-parent-report/expense-report

可选
  --domain=<name>    业务域（默认由 id 去掉 -flow 得到），决定 tests/<domain>/ 与 <domain>-catalog.ts
  --dry-run          只打印将要创建/修改的文件，不落盘
  --force            允许写入已存在的目录（不覆盖已有同名文件）
  --help

生成内容
  <id>/playwright.config.ts          复用既有配置约定（含 FLOW_* 超时开关）
  <id>/utils/env.ts                  基于 flow-kit createBaseEnv
  <id>/utils/<domain>-catalog.ts     catalog 占位（随后用 flow:gen-catalog 覆盖）
  <id>/utils/golden-seed.ts          按本流程 seeds 解析单号
  <id>/pages/<domain>-list.page.ts   继承 GenericListPage，带详情容器
  <id>/pages/<domain>-edit.page.ts   只读详情是否打开
  <id>/fixtures/index.ts             复用 createFlowFixtures
  <id>/tests/<domain>/golden-regression.spec.ts
                                     打开列表 → 按单号搜索 → 打开详情
  <id>/datasource/golden-seeds.json.example
  <id>/tsconfig.json
  scripts/flow/run-<id>-golden.ts    从既有 golden runner 派生
自动注册
  scripts/flow/flow-registry.ts      追加 FlowDescriptor
  package.json                       追加 <id>:golden / <id>:debug-fast

后续两步（真正需要人做的）
  1. npx tsx scripts/index-frontend/probe-live-page.ts --env=dev --entry=<entry> --out=<id>/datasource/live-snapshot.json
  2. npm run flow:gen-catalog -- --flow=<id> --force
`);
}

const ID_RE = /^[a-z][a-z0-9-]*$/;

function validate(args: Args): string[] {
  const errs: string[] = [];
  if (!args.id) errs.push('缺少 --id');
  else if (!ID_RE.test(args.id)) errs.push(`--id 只能用小写字母/数字/连字符：${args.id}`);
  if (!args.label) errs.push('缺少 --label');
  if (!args.entry) errs.push('缺少 --entry');
  else if (!args.entry.startsWith('/')) errs.push(`--entry 应以 / 开头：${args.entry}`);
  if (args.id && getFlow(args.id)) {
    errs.push(`流程「${args.id}」已注册（现有：${listFlowIds().join(' / ')}）`);
  }
  return errs;
}

/** 域名首字母大写，用于类名：expense → Expense */
function pascal(domain: string): string {
  return domain
    .split(/[-_]/)
    .filter(Boolean)
    .map((s) => s[0].toUpperCase() + s.slice(1))
    .join('');
}

/** 由 domain 推环境变量前缀：expense → EXPENSE */
function envPrefix(domain: string): string {
  return domain.replace(/-/g, '_').toUpperCase();
}

type Ctx = {
  id: string;
  label: string;
  entry: string;
  domain: string;
  Domain: string;
  PREFIX: string;
  /** 正则字面量内部片段，如 /main/expense-parent-report/expense-report → main\/expense-parent-report\/expense-report */
  urlReLiteral: string;
  /** golden-seeds.json 里的单号字段名，如 expense → expenseDocNo */
  docNoField: string;
};

/**
 * 把路由转成「可直接嵌进正则字面量」的片段。
 * /main/expense-parent-report/expense-report → main\/expense-parent-report\/expense-report（去掉开头 /，其余 / 转义一次）
 */
export function urlRegexBody(entry: string): string {
  return entry.replace(/^\//, '').replace(/\//g, '\\/');
}

function buildCtx(args: Args): Ctx {
  return {
    id: args.id,
    label: args.label,
    entry: args.entry,
    domain: args.domain,
    Domain: pascal(args.domain),
    PREFIX: envPrefix(args.domain),
    // 正则片段预先算好，避免在模板字符串里反复推转义层数（曾因此生成过 /main\\/expense/ 这种坏码）
    urlReLiteral: urlRegexBody(args.entry),
    // 与既有两个流程对齐：approval → approvalDocNo、request → requestDocNo
    docNoField: `${camel(args.domain)}DocNo`,
  };
}

/** my-domain → myDomain（seeds 字段名要用 camelCase） */
function camel(s: string): string {
  return s.replace(/[-_]+(.)/g, (_, ch: string) => ch.toUpperCase()).replace(/^(.)/, (m) => m.toLowerCase());
}

// ---------- 文件模板 ----------

function tplPlaywrightConfig(): string {
  return `import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: path.resolve(__dirname, '.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });

const baseURL = process.env.BASE_URL || 'https://dev.huilianyi.com';

function resolveRetries(): number {
  const explicit = Number(process.env.PLAYWRIGHT_RETRIES);
  if (Number.isFinite(explicit) && explicit >= 0) return explicit;
  return process.env.CI ? 2 : 0;
}

function resolvePositiveMs(envName: string, fallback: number): number {
  const value = Number(process.env[envName]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: resolveRetries(),
  workers: 1, // 必须为 1：fixtures 里 worker 级共用同一个浏览器窗口
  timeout: resolvePositiveMs('PW_TEST_TIMEOUT', 180_000),
  expect: {
    timeout: resolvePositiveMs('PW_EXPECT_TIMEOUT', 15_000),
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.02,
      animations: 'disabled',
      caret: 'hide',
    },
  },
  snapshotPathTemplate: '{testDir}/ui-baselines/{testFileName}/{arg}-{platform}{ext}',
  reporter: [['html', { open: 'never' }], ['list']],
  use: {
    baseURL,
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    screenshot: 'on',
    video: 'retain-on-failure',
    trace: process.env.FLOW_TRACE === 'on'
      ? 'on'
      : process.env.FLOW_TRACE === 'retain-on-failure'
        ? 'retain-on-failure'
        : 'on-first-retry',
    actionTimeout: resolvePositiveMs('PW_ACTION_TIMEOUT', 20_000),
    navigationTimeout: resolvePositiveMs('PW_NAVIGATION_TIMEOUT', 60_000),
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
`;
}

function tplTsconfig(): string {
  return `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "node",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "types": ["node"]
  },
  "include": [
    "playwright.config.ts",
    "tests/**/*.ts",
    "pages/**/*.ts",
    "fixtures/**/*.ts",
    "utils/**/*.ts",
    "../flow-kit/**/*.ts"
  ]
}
`;
}

function tplEnv(c: Ctx): string {
  return `import { createBaseEnv, hasLoginCredentials as hasCreds } from '../../flow-kit/utils/env';

/**
 * ${c.label}环境变量。公共部分来自 flow-kit，这里只声明本流程特有字段。
 */
export const env = {
  ...createBaseEnv({ writeEnvVar: '${c.PREFIX}_ENABLE_WRITE' }),

  /** 指定一条单号用于搜索 / 打开；不填则用列表第一条 */
  ${camel(c.domain)}DocNo: process.env.${c.PREFIX}_DOC_NO || '',
};

export function hasLoginCredentials(): boolean {
  return hasCreds(env);
}
`;
}

function tplGoldenSeed(c: Ctx): string {
  return `import { createGoldenSeedResolver } from '../../flow-kit/utils/golden-seed';

/**
 * ${c.label} Golden 种子：${c.id}/datasource/golden-seeds.json
 * { "<env>": { "<roleSlug>": { ${c.docNoField} } } }
 */
export const resolveGoldenSeed = createGoldenSeedResolver({
  seedsRel: '${c.id}/datasource/golden-seeds.json',
  docNoKeys: ['${c.docNoField}', 'docNo'],
  keywordKeys: ['${camel(c.domain)}FilterKeyword', 'keyword'],
});

export type { GoldenSeed } from '../../flow-kit/utils/golden-seed';
`;
}

function tplCatalog(c: Ctx): string {
  return `/**
 * ${c.label} UI 契约（catalog）——**占位骨架**。
 *
 * 正确的填法不是手写，而是实机探活后自动生成：
 *   1. npx tsx scripts/index-frontend/probe-live-page.ts --env=dev --entry=${c.entry} \\
 *        --out=${c.id}/datasource/live-snapshot.json
 *   2. npm run flow:gen-catalog -- --flow=${c.id} --force
 *   3. 逐条确认产物里的 TODO(review) 后删注释
 *
 * 之后每次怀疑实机漂移：
 *   npm run flow:gen-catalog -- --flow=${c.id} --check
 */

/** 列表路由 */
export const LIST_PATH = '${c.entry}';

/** 列表查询接口（探活后替换） */
export const LIST_API = '/api/TODO/search';
export const LIST_API_RE = /\\/api\\/TODO\\/search/;

/** 表格容器 / 数据行 */
export const TABLE = '.ant-table';
export const ROW = '.ant-table-tbody tr.ant-table-row';

/** 顶部关键字搜索框 placeholder（探活后替换） */
export const SEARCH_PLACEHOLDER = '请输入';

/** 表头文案（探活后替换） */
export const COLUMNS: readonly string[] = [];

/** 单号列名 / 单号正则（探活后收紧） */
export const DOC_NO_COLUMN = '单号';
export const DOC_NO_RE = /\\b[A-Za-z0-9]{8,}\\b/;

/** 页签 */
export const TABS: readonly string[] = [];
export const TAB = '.ant-tabs-tab';

/** 搜索区动作 */
export const SEARCH_ACTION_SEARCH = '.search-action-bar__search, button:has-text("搜")';
export const SEARCH_ACTION_CLEAR = '.search-action-bar__clear';

/** 外露筛选 */
export const COMBO_TRIGGER = '.combo-trigger';
export const EXPOSED_FILTER_FIELDS: readonly string[] = [];

/** 详情容器（与报销单同一组侧滑 / 全屏） */
export const DETAIL = '.slide-frame.slide-frame-open, .full-width-slideframe, .full-screen, .helios-full-screen';

/** 空状态 / 已加载文案 */
export const EMPTY_TEXT_RE = /暂无数据|No Data/;
export const LOADED_TEXT_RE = /${c.label.replace(/流程$/, '')}/;

/** GenericListPage 加载行为（对齐申请单 advanced-table：重置 → 搜索 → 空列表恢复） */
export const LIST_LOAD_OPTS = {
  clickSearchOnLoad: true,
  resetFiltersOnLoad: true,
  recoverEmptyOnLoad: true,
} as const;
`;
}

function tplListPage(c: Ctx): string {
  return `import { type Page } from '@playwright/test';
import { GenericListPage, type ListCatalog } from '../../flow-kit/list/generic-list-page';
import {
  COMBO_TRIGGER,
  DETAIL,
  DOC_NO_COLUMN,
  DOC_NO_RE,
  EMPTY_TEXT_RE,
  EXPOSED_FILTER_FIELDS,
  LIST_API_RE,
  LIST_LOAD_OPTS,
  LIST_PATH,
  LOADED_TEXT_RE,
  ROW,
  SEARCH_ACTION_CLEAR,
  SEARCH_ACTION_SEARCH,
  SEARCH_PLACEHOLDER,
  TABLE,
} from '../utils/${c.domain}-catalog';

/** ${c.label}列表。通用能力在 GenericListPage，加载行为见 LIST_LOAD_OPTS。 */
export const ${c.PREFIX}_LIST_CATALOG: ListCatalog = {
  name: '${c.label.replace(/流程$/, '')}列表',
  listPath: LIST_PATH,
  urlPattern: /${c.urlReLiteral}/,
  listApiRe: LIST_API_RE,
  table: TABLE,
  row: ROW,
  searchPlaceholder: SEARCH_PLACEHOLDER,
  docNoColumn: DOC_NO_COLUMN,
  docNoRe: DOC_NO_RE,
  emptyTextRe: EMPTY_TEXT_RE,
  loadedTextRe: LOADED_TEXT_RE,
  requireRowsOnLoad: false,
  searchActionSearch: SEARCH_ACTION_SEARCH,
  searchActionClear: SEARCH_ACTION_CLEAR,
  comboTrigger: COMBO_TRIGGER,
  comboClear: '.combo-trigger__clear',
  clearLabels: [...EXPOSED_FILTER_FIELDS],
  detailSelectors: DETAIL,
  ...LIST_LOAD_OPTS,
};

export class ${c.Domain}ListPage extends GenericListPage {
  constructor(page: Page) {
    super(page, ${c.PREFIX}_LIST_CATALOG);
  }
}
`;
}

function tplEditPage(c: Ctx): string {
  return `import { type FrameLocator, type Locator, type Page, expect } from '@playwright/test';
import { waitForAppRoot, type AppRoot } from '../../flow-kit/utils/app-frame';
import { DETAIL, DOC_NO_RE } from '../utils/${c.domain}-catalog';

type Scope = FrameLocator | Page;

export class ${c.Domain}EditPage {
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
      .getByRole('button', { name: /保\\s*存|提\\s*交|删\\s*除|返\\s*回/ })
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
      expect(actionOk || shellOk || headingOk, '未打开${c.label.replace(/流程$/, '')}详情').toBeTruthy();
    }).toPass({ timeout: 60_000 });
  }
}
`;
}

function tplFixtures(c: Ctx): string {
  return `import { createFlowFixtures } from '../../flow-kit/fixtures/create-flow-fixtures';
import { ${c.Domain}ListPage } from '../pages/${c.domain}-list.page';
import { env, hasLoginCredentials } from '../utils/env';

/**
 * ${c.label} fixtures。
 * 共享实现在 flow-kit/fixtures/create-flow-fixtures，这里只声明本流程的 Page。
 */
export const test = createFlowFixtures({
  flowId: '${c.id}',
  defaultSpec: '${c.domain}/golden-regression.spec.ts',
  env,
  hasLoginCredentials,
  pages: {
    ${camel(c.domain)}ListPage: (page) => new ${c.Domain}ListPage(page),
  },
});

export { expect } from '@playwright/test';
export type { ApiFailure, ApiGuard } from '../../flow-kit/utils/api-guard';
`;
}

function tplGoldenSpec(c: Ctx): string {
  const docField = `${camel(c.domain)}DocNo`;
  return `import { test } from '../../fixtures/index';
import { ${c.Domain}ListPage } from '../../pages/${c.domain}-list.page';
import { ${c.Domain}EditPage } from '../../pages/${c.domain}-edit.page';
import { env } from '../../utils/env';
import { resolveGoldenSeed } from '../../utils/golden-seed';
import { bindFlowStepCapture, flowStep } from '../../../src/utils/flow-step.js';

const GOLDEN_SKIP_MSG = '列表无可用单号，跳过 Golden 搜索';
const ctx = { docNo: '' };

function configuredDocNo(): string {
  const fromEnv = env.${docField}.trim();
  if (fromEnv) return fromEnv;
  const seed = resolveGoldenSeed(
    process.env.PLAYWRIGHT_ENV || 'dev',
    process.env.FLOW_ACCOUNT_SLUG || '',
  );
  return seed.docNo;
}

async function ensureDocNo(list: ${c.Domain}ListPage): Promise<string> {
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
 * ${c.label} golden 回归（只读）。
 *
 * 同一页顺序做：打开列表 → 按单号搜索 → 打开详情。
 * 不再每步整页重开，也不在搜索后重置列表。
 */
test.describe.configure({ mode: 'serial' });

test.describe('${c.label} golden 回归', () => {
  test('列表加载与基础结构', async ({ page, flowRunDir }) => {
    bindFlowStepCapture({ page, flowRunDir });
    const list = new ${c.Domain}ListPage(page);

    await flowStep('打开列表', async () => {
      await list.goto();
      await list.expectLoaded();
    }, { snapshot: '${c.domain}-list', step: 1 });
  });

  test('按首行单号搜索', async ({ page, flowRunDir }) => {
    bindFlowStepCapture({ page, flowRunDir });
    const list = new ${c.Domain}ListPage(page);
    await list.ensureOnList();
    const docNo = await ensureDocNo(list);

    await flowStep('搜索单号', async () => {
      await list.search(docNo);
      await list.expectRowContains(docNo);
    }, { snapshot: '${c.domain}-search', step: 2 });
  });

  test('用现场单号搜索并打开详情', async ({ page, flowRunDir }) => {
    bindFlowStepCapture({ page, flowRunDir });
    const list = new ${c.Domain}ListPage(page);
    await list.ensureOnList();
    const docNo = await ensureDocNo(list);

    await flowStep('打开详情', async () => {
      await list.openByCode(docNo);
      const edit = new ${c.Domain}EditPage(page);
      await edit.expectEditVisible();
    }, { snapshot: '${c.domain}-detail', step: 3 });
  });
});
`;
}

/**
 * golden-seeds 示例。
 * 结构必须与 approval-flow / request-flow 的真实 seeds 一致：
 *   { "<envId>": { "<roleSlug>": { "<domain>DocNo": "..." } } }
 * roleSlug 用 "*" 表示该环境下所有角色共用。
 * 早期版本这里写成了 { profiles: [...] }，与 resolveFlowGoldenSeed 读的结构对不上，
 * 结果 golden 永远拿不到单号——改了别再改回去。
 */
function tplSeedsExample(c: Ctx): string {
  return `{
  "_comment": "${c.label} golden 档案。复制为 golden-seeds.json 后填真实值；该文件不入库。",
  "_shape": "<envId>.<roleSlug>.${c.docNoField}，roleSlug 用 * 表示该环境所有角色共用",
  "dev": {
    "*": {
      "${c.docNoField}": ""
    }
  },
  "uat": {
    "*": {
      "${c.docNoField}": ""
    }
  }
}
`;
}

/**
 * golden runner：从既有 run-approval-flow-golden.ts 派生。
 *
 * donor 里的 approval 特定内容分四类，必须全部换掉，否则生成物会去读
 * approval 的 seeds、往 approval 的报告目录写、打 approval 的日志前缀：
 *   1. 流程常量（FLOW_ID / FLOW_LABEL / CONFIG_REL / SPEC）
 *   2. 环境变量前缀（APPROVAL_DOC_NO 等）
 *   3. seed 模块与字段名（resolveApprovalGoldenSeed / approvalDocNo）
 *   4. 字符串里的流程名（日志前缀 `[approval-flow:golden]`、报告目录）
 * 第 4 类最容易漏——它不在常量里，散落在十几处模板字符串中。
 *
 * 派生完会做一次自检（assertNoDonorLeak），有残留直接抛错，
 * 免得生成一份「看着能跑、实际读错流程数据」的 runner。
 */
function tplGoldenRunner(c: Ctx, repoRoot: string): string {
  const donor = path.join(repoRoot, 'scripts', 'flow', 'run-approval-flow-golden.ts');
  let src = fs.readFileSync(donor, 'utf8');
  src = deriveGoldenRunner(src, c);

  const banner = `#!/usr/bin/env tsx
/**
 * ${c.label} golden runner（由 npm run flow:new 生成）。
 * 结构与 run-approval-flow-golden.ts 一致——多环境 / 多档案 / 结果汇总 / 基线晋升。
 * 如需改公共行为，改 scripts/flow/flow-shared.ts 或两处一起改，别只改这一份。
 */
`;
  src = src.replace(/^#!\/usr\/bin\/env tsx\n/, banner);
  assertNoDonorLeak(src, c);
  return src;
}

/**
 * 纯替换逻辑，抽出来是为了能不落盘直接单测。
 * 顺序有讲究：先换 seed 模块整行（含 require 路径），再换字段名，
 * 否则 `approvalDocNo` 的替换会先把 require 行里的 `approval-golden-seed` 打乱。
 */
export function deriveGoldenRunner(donorSrc: string, c: Ctx): string {
  return (
    donorSrc
      // ① seed 模块：改用按 flow 参数化的通用实现，不再一流程一份 seed js
      .replace(
        /const \{ resolveApprovalGoldenSeed \} = require\("\.\.\/\.\.\/pw-files\/lib\/approval-golden-seed\.js"\);/,
        `const { resolveFlowGoldenSeed } = require("../../pw-files/lib/flow-golden-seed.js");`,
      )
      .replace(
        /const goldenSeed = resolveApprovalGoldenSeed\(repoRoot, envId, roleSlug\);/,
        `const goldenSeed = resolveFlowGoldenSeed(repoRoot, FLOW_ID, envId, roleSlug, ["${c.docNoField}"]);`,
      )
      // ② seed / profile 字段名：approvalDocNo → <domain>DocNo
      .replace(/\bapprovalDocNo\b/g, c.docNoField)
      // ③ 流程常量
      .replace(/const FLOW_ID = "approval-flow";/, `const FLOW_ID = "${c.id}";`)
      .replace(/const FLOW_LABEL = "审批流程";/, `const FLOW_LABEL = "${c.label}";`)
      .replace(
        /const CONFIG_REL = "approval-flow\/playwright\.config\.ts";/,
        `const CONFIG_REL = "${c.id}/playwright.config.ts";`,
      )
      .replace(
        /const SPEC = "approval\/golden-regression\.spec\.ts";/,
        `const SPEC = "${c.domain}/golden-regression.spec.ts";`,
      )
      // ④ 环境变量前缀
      .replace(/APPROVAL_FILTER_KEYWORD/g, `${c.PREFIX}_FILTER_KEYWORD`)
      .replace(/APPROVAL_DOC_NO/g, `${c.PREFIX}_DOC_NO`)
      .replace(/APPROVAL_ENABLE_WRITE/g, `${c.PREFIX}_ENABLE_WRITE`)
      // ⑤ 字符串里的流程名：日志前缀 + 报告目录（这类最容易漏，统一按 flow 目录名替换）
      .replace(/\[approval-flow:golden\]/g, `[${c.id}:golden]`)
      .replace(/approval-flow\/playwright-report/g, `${c.id}/playwright-report`)
      .replace(/approval-flow\/datasource\//g, `${c.id}/datasource/`)
      .replace(/\breadApprovalSnapshotDocNo\b/g, `read${c.Domain}SnapshotDocNo`)
  );
}

/** 生成后自检：donor 的流程标识不应残留（除了注释里那句「结构与 …一致」的引用） */
export function assertNoDonorLeak(src: string, c: Ctx): void {
  const leaks: string[] = [];
  src.split('\n').forEach((line, i) => {
    if (!/approval|Approval|APPROVAL/.test(line)) return;
    // banner 里明确写了「结构与 run-approval-flow-golden.ts 一致」，这是有意的说明，不算泄漏
    if (line.includes('run-approval-flow-golden.ts')) return;
    leaks.push(`${i + 1}: ${line.trim()}`);
  });
  if (leaks.length) {
    throw new Error(
      `生成 ${c.id} 的 golden runner 时残留 ${leaks.length} 处 approval 内容，` +
        `说明 deriveGoldenRunner 的替换规则没跟上 donor 的改动：\n  ` +
        leaks.join('\n  '),
    );
  }
}

// ---------- 自动注册 ----------

/** 往 flow-registry.ts 的 RAW 数组尾部插入一条 FlowDescriptor */
export function injectFlowRegistry(src: string, c: Ctx): string {
  const entry = `  {
    id: '${c.id}',
    label: '${c.label}',
    domain: '${c.domain}',
    entry: '${c.entry}',
    configRel: '${c.id}/playwright.config.ts',
    goldenSpec: '${c.domain}/golden-regression.spec.ts',
    fullFlowSpec: '${c.domain}/full-flow.spec.ts',
    reportDir: '${c.id}/playwright-report',
    goldenRunner: 'run-${c.id}-golden.ts',
    writeRunner: null,
    docNoEnv: '${c.PREFIX}_DOC_NO',
    keywordEnv: '${c.PREFIX}_FILTER_KEYWORD',
    defaultKeyword: '',
    writeEnvVar: '${c.PREFIX}_ENABLE_WRITE',
    seedsRel: '${c.id}/datasource/golden-seeds.json',
    tabbed: false,
    kind: 'golden-flow',
  },
`;
  const marker = '\n];\n\n/**\n * 外部流程登记';
  const idx = src.indexOf(marker);
  if (idx === -1) {
    throw new Error('flow-registry.ts 结构变了，找不到 RAW 数组结尾，请手工追加 FlowDescriptor。');
  }
  return `${src.slice(0, idx + 1)}${entry}${src.slice(idx + 1)}`;
}

/** 往 package.json scripts 里加 <id>:golden / <id>:debug-fast */
export function injectPackageScripts(pkg: Record<string, unknown>, c: Ctx): Record<string, unknown> {
  const scripts = { ...((pkg.scripts as Record<string, string>) || {}) };
  scripts[`${c.id}:golden`] = `tsx scripts/flow/run-${c.id}-golden.ts`;
  scripts[`${c.id}:debug-fast`] = `tsx scripts/flow/flow-debug-fast.ts --flow=${c.id}`;
  return { ...pkg, scripts };
}

// ---------- 主流程 ----------

type PlannedFile = { rel: string; content: string };

function planFiles(c: Ctx, repoRoot: string): PlannedFile[] {
  return [
    { rel: `${c.id}/playwright.config.ts`, content: tplPlaywrightConfig() },
    { rel: `${c.id}/tsconfig.json`, content: tplTsconfig() },
    { rel: `${c.id}/utils/env.ts`, content: tplEnv(c) },
    { rel: `${c.id}/utils/golden-seed.ts`, content: tplGoldenSeed(c) },
    { rel: `${c.id}/utils/${c.domain}-catalog.ts`, content: tplCatalog(c) },
    { rel: `${c.id}/pages/${c.domain}-list.page.ts`, content: tplListPage(c) },
    { rel: `${c.id}/pages/${c.domain}-edit.page.ts`, content: tplEditPage(c) },
    { rel: `${c.id}/fixtures/index.ts`, content: tplFixtures(c) },
    {
      rel: `${c.id}/tests/${c.domain}/golden-regression.spec.ts`,
      content: tplGoldenSpec(c),
    },
    {
      rel: `${c.id}/datasource/golden-seeds.json.example`,
      content: tplSeedsExample(c),
    },
    { rel: `scripts/flow/run-${c.id}-golden.ts`, content: tplGoldenRunner(c, repoRoot) },
  ];
}

function main(): void {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);

  if (args.help || !argv.length) {
    printHelp();
    return;
  }

  const errs = validate(args);
  if (errs.length) {
    for (const e of errs) process.stderr.write(`✗ ${e}\n`);
    process.stderr.write('\n--help 看用法。\n');
    process.exit(1);
  }

  const repoRoot = process.cwd();
  const c = buildCtx(args);
  const flowDirAbs = path.join(repoRoot, c.id);

  if (fs.existsSync(flowDirAbs) && !args.force) {
    process.stderr.write(`✗ 目录已存在：${c.id}（--force 可在其中补齐缺失文件）\n`);
    process.exit(1);
  }

  const files = planFiles(c, repoRoot);
  const registryPath = path.join(repoRoot, 'scripts', 'flow', 'flow-registry.ts');
  const pkgPath = path.join(repoRoot, 'package.json');

  const willCreate: PlannedFile[] = [];
  const willSkip: string[] = [];
  for (const f of files) {
    if (fs.existsSync(path.join(repoRoot, f.rel))) willSkip.push(f.rel);
    else willCreate.push(f);
  }

  if (args.dryRun) {
    process.stdout.write(`[flow:new] dry-run · ${c.id}（${c.label}）· entry=${c.entry} · domain=${c.domain}\n\n`);
    process.stdout.write('将创建：\n');
    for (const f of willCreate) process.stdout.write(`  + ${f.rel}\n`);
    if (willSkip.length) {
      process.stdout.write('\n已存在，将跳过：\n');
      for (const r of willSkip) process.stdout.write(`  = ${r}\n`);
    }
    process.stdout.write('\n将修改：\n');
    process.stdout.write('  ~ scripts/flow/flow-registry.ts（追加 FlowDescriptor）\n');
    process.stdout.write(`  ~ package.json（追加 ${c.id}:golden / ${c.id}:debug-fast）\n`);
    return;
  }

  for (const f of willCreate) {
    const abs = path.join(repoRoot, f.rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, f.content, 'utf8');
    process.stdout.write(`  + ${f.rel}\n`);
  }
  for (const r of willSkip) process.stdout.write(`  = ${r}（已存在，跳过）\n`);

  // 注册到 flow-registry
  const registrySrc = fs.readFileSync(registryPath, 'utf8');
  fs.writeFileSync(registryPath, injectFlowRegistry(registrySrc, c), 'utf8');
  process.stdout.write('  ~ scripts/flow/flow-registry.ts\n');

  // 注册 npm scripts
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as Record<string, unknown>;
  fs.writeFileSync(pkgPath, `${JSON.stringify(injectPackageScripts(pkg, c), null, 2)}\n`, 'utf8');
  process.stdout.write('  ~ package.json\n');

  process.stdout.write(`
[flow:new] ✅ ${c.label}（${c.id}）已生成并注册。

接下来只剩两件真正需要人做的事：

  1. 实机探活 + 生成 catalog
     npx tsx scripts/index-frontend/probe-live-page.ts --env=dev --entry=${c.entry} \\
       --out=${c.id}/datasource/live-snapshot.json
     npm run flow:gen-catalog -- --flow=${c.id} --force
     # 然后逐条确认产物里的 TODO(review)

  2. 跑通骨架，再按业务补用例
     npm run flow:debug-fast -- --flow=${c.id} --grep=列表加载

顺手确认：
  npm run flow:list                      # 应能看到 ${c.id}
  npx tsc --noEmit -p ${c.id}/tsconfig.json
`);
}

const invokedDirectly = process.argv[1] && /new-flow\.(ts|js|mjs)$/.test(process.argv[1]);
if (invokedDirectly) {
  main();
}




