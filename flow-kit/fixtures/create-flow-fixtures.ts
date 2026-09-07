import {
  test as base,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';
import { savePlaywrightVideo } from '../../src/runtime/flow-replay.js';
import { appendApiFailures, flowRunsDir, initWorkerRun } from '../../src/utils/flow-run-report.js';
import { HomePage } from '../pages/home.page';
import { LoginPage } from '../pages/login.page';
import { ApiGuard, createApiGuard, type ApiFailure } from '../utils/api-guard';

/**
 * 流程级 fixtures 工厂。
 *
 * request-flow 与 approval-flow 的 fixtures/index.ts 之前是 200 行 × 2 份的复制品，
 * 差异只有：FLOW_ID、默认 spec、以及各自挂哪几个 Page 对象。
 * 这里把「worker 级共享浏览器窗口 + API 失败守卫 + run 目录 + 登录态」全部做成通用实现，
 * 新流程只需 3 行声明自己的 Page 即可。
 */
export type FlowFixtureEnv = {
  baseURL: string;
  username: string;
  password: string;
  storageState: string;
};

type BaseFixtures = {
  homePage: HomePage;
  loginPage: LoginPage;
  authenticatedPage: LoginPage;
  flowRunDir: string;
  _apiGuardPerTest: void;
};

type WorkerFixtures = {
  sharedContext: BrowserContext;
  sharedPage: Page;
  apiGuard: ApiGuard;
  _flowWorkerRun: void;
};

export type CreateFlowFixturesOptions<Extra extends Record<string, unknown>> = {
  /** 流程 ID，对应 results/flow-runs/<id> 与报告里的流程名 */
  flowId: string;
  /** FLOW_SPEC 未设置时的默认 spec */
  defaultSpec: string;
  /** 该流程的 env（至少含 baseURL / username / password / storageState） */
  env: FlowFixtureEnv;
  /** 判断是否有账号密码（用于决定是否 skip 登录用例） */
  hasLoginCredentials: () => boolean;
  /** 该流程特有的 Page 对象工厂，键名即 fixture 名 */
  pages: { [K in keyof Extra]: (page: Page) => Extra[K] };
};

const VIEWPORT = { width: 1280, height: 720 };

function useWindowViewport(): boolean {
  return process.env.FLOW_RUN_MODE === 'headed';
}

function makeStorageStateResolver(env: FlowFixtureEnv, flowDirName: string) {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const flowRoot = path.resolve(__dirname, '..', '..', flowDirName);
  return function resolveStorageState(): string | undefined {
    const candidates = [
      process.env.STORAGE_STATE,
      env.storageState,
      path.resolve(process.cwd(), 'storage/loginState/dev.json'),
      path.resolve(flowRoot, '..', 'storage/loginState/dev.json'),
    ].filter((p): p is string => Boolean(p));
    return candidates.find((p) => fs.existsSync(p));
  };
}

export function createFlowFixtures<Extra extends Record<string, unknown>>(
  opts: CreateFlowFixturesOptions<Extra>,
) {
  const { flowId, defaultSpec, env, hasLoginCredentials } = opts;
  // flow-kit/fixtures/ -> ../../<flowDirName>；这里只知道 flowId，用其作为目录名
  const resolveStorageState = makeStorageStateResolver(env, flowId);
  const videoDisabled =
    process.env.FLOW_DISABLE_VIDEO === '1' ||
    (process.env.FLOW_DEBUG_FAST === '1' && process.env.FLOW_CONFIG_TRY_RUN !== '1');

  let workerRun: ReturnType<typeof initWorkerRun> | null = null;

  const workerScoped = {
    _flowWorkerRun: [
      async ({}, use: (r: void) => Promise<void>) => {
        const spec = process.env.FLOW_SPEC || defaultSpec;
        workerRun = initWorkerRun({
          flowId,
          env: process.env.PLAYWRIGHT_ENV || 'dev',
          spec,
        });
        process.env.FLOW_RUN_MODE = process.env.FLOW_RUN_MODE || 'headless';
        await use();
      },
      { scope: 'worker' as const, auto: true as const },
    ],

    sharedContext: [
      async (
        { browser }: { browser: Browser; _flowWorkerRun: void },
        use: (r: BrowserContext) => Promise<void>,
      ) => {
        const storageState = resolveStorageState();
        const context = await browser.newContext({
          baseURL: env.baseURL,
          locale: 'zh-CN',
          timezoneId: 'Asia/Shanghai',
          viewport: useWindowViewport() ? null : VIEWPORT,
          storageState,
          ...(videoDisabled
            ? {}
            : {
                recordVideo: {
                  dir: path.join(process.cwd(), 'test-results', 'videos'),
                  ...(useWindowViewport() ? {} : { size: VIEWPORT }),
                },
              }),
        });
        await use(context);
        const page = context.pages()[0];
        const video = page?.video();
        await context.close();
        const runId = workerRun?.runId || process.env.FLOW_RUN_ID?.trim();
        if (video && runId) {
          const outDir = path.join(process.cwd(), flowRunsDir(flowId), runId);
          fs.mkdirSync(outDir, { recursive: true });
          await savePlaywrightVideo(video, path.join(outDir, 'flow.webm'));
        }
      },
      { scope: 'worker' as const },
    ],

    sharedPage: [
      async (
        { sharedContext }: { sharedContext: BrowserContext },
        use: (r: Page) => Promise<void>,
      ) => {
        const page = await sharedContext.newPage();
        await use(page);
      },
      { scope: 'worker' as const },
    ],

    apiGuard: [
      async ({ sharedPage }: { sharedPage: Page }, use: (r: ApiGuard) => Promise<void>) => {
        const guard = createApiGuard(sharedPage);
        await use(guard);
        guard.detach();
      },
      { scope: 'worker' as const },
    ],
  };

  const pageFixtures: Record<string, unknown> = {
    context: async (
      { sharedContext }: { sharedContext: BrowserContext },
      use: (r: BrowserContext) => Promise<void>,
    ) => {
      await use(sharedContext);
    },
    page: async ({ sharedPage }: { sharedPage: Page }, use: (r: Page) => Promise<void>) => {
      await use(sharedPage);
    },
    flowRunDir: async ({}, use: (r: string) => Promise<void>) => {
      await use(workerRun?.runDir || '');
    },
    homePage: async ({ page }: { page: Page }, use: (r: HomePage) => Promise<void>) => {
      await use(new HomePage(page));
    },
    loginPage: async ({ page }: { page: Page }, use: (r: LoginPage) => Promise<void>) => {
      await use(new LoginPage(page));
    },
  };

  for (const [key, factory] of Object.entries(opts.pages)) {
    pageFixtures[key] = async ({ page }: { page: Page }, use: (r: unknown) => Promise<void>) => {
      await use(factory(page));
    };
  }

  const test = base.extend<BaseFixtures & Extra, WorkerFixtures>({
    ...(workerScoped as unknown as Record<string, unknown>),
    ...pageFixtures,

    _apiGuardPerTest: [
      async (
        { apiGuard }: { apiGuard: ApiGuard },
        use: (r: void) => Promise<void>,
        testInfo: { title: string; annotations: Array<{ type: string }> },
      ) => {
        const skip = testInfo.annotations.some((a) => a.type === 'skip-api-guard');
        if (!skip) {
          apiGuard.start();
        }
        let testErr: unknown;
        try {
          await use();
        } catch (e) {
          testErr = e;
        }
        if (!skip) {
          const failures = apiGuard.getFailures();
          if (failures.length && workerRun) {
            appendApiFailures(
              flowId,
              workerRun.runId,
              testInfo.title,
              failures.map((f) => ({
                kind: f.kind,
                url: f.url,
                method: f.method,
                status: f.status,
                bodySummary: f.bodySummary,
                errorText: f.errorText,
              })),
            );
          }
          if (apiGuard.getAbortError()) {
            await apiGuard.assertNoFailures(`[${testInfo.title}]`);
          } else if (testErr) {
            throw testErr;
          } else {
            await apiGuard.assertNoFailures(`[${testInfo.title}]`);
          }
        } else if (testErr) {
          throw testErr;
        }
      },
      { auto: true as const },
    ],

    authenticatedPage: async (
      { page }: { page: Page },
      use: (r: LoginPage) => Promise<void>,
    ) => {
      const storageState = resolveStorageState();
      const loginPage = new LoginPage(page);
      if (storageState) {
        if (!/\/main\b/.test(page.url())) {
          await page.goto('/main', { waitUntil: 'domcontentloaded', timeout: 60_000 });
        }
        await use(loginPage);
        return;
      }
      test.skip(!hasLoginCredentials(), '未配置 LOGIN_USERNAME / LOGIN_PASSWORD，且没有 storageState');
      if (!/\/main\b/.test(page.url())) {
        await loginPage.goto();
        await loginPage.login(env.username, env.password);
        await loginPage.expectLoggedIn();
      }
      await use(loginPage);
    },
  } as never);

  return test;
}

export type { ApiFailure, ApiGuard };
