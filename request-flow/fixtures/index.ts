import { test as base, type BrowserContext, type Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';
import { savePlaywrightVideo } from '../../src/runtime/flow-replay.js';
import { appendApiFailures, flowRunsDir, initWorkerRun } from '../../src/utils/flow-run-report.js';
import { HomePage } from '../pages/home.page';
import { LoginPage } from '../pages/login.page';
import { RequestListPage } from '../pages/request-list.page';
import { RequestEditPage } from '../pages/request-edit.page';
import { ApiGuard, createApiGuard } from '../utils/api-guard';
import { env, hasLoginCredentials } from '../utils/env';

const FLOW_ID = 'request-flow' as const;
let workerRun: ReturnType<typeof initWorkerRun> | null = null;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function resolveStorageState(): string | undefined {
  const candidates = [
    process.env.STORAGE_STATE,
    env.storageState,
    path.resolve(process.cwd(), 'storage/loginState/dev.json'),
    path.resolve(__dirname, '../../storage/loginState/dev.json'),
  ].filter((p): p is string => Boolean(p));
  return candidates.find((p) => fs.existsSync(p));
}

type AppFixtures = {
  homePage: HomePage;
  loginPage: LoginPage;
  requestListPage: RequestListPage;
  requestEditPage: RequestEditPage;
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

const VIEWPORT = { width: 1440, height: 900 };

export const test = base.extend<AppFixtures, WorkerFixtures>({
  _flowWorkerRun: [
    async ({}, use, workerInfo) => {
      const spec = process.env.FLOW_SPEC || 'request/full-flow.spec.ts';
      workerRun = initWorkerRun({
        flowId: FLOW_ID,
        env: process.env.PLAYWRIGHT_ENV || 'dev',
        spec,
      });
      process.env.FLOW_RUN_MODE = process.env.FLOW_RUN_MODE || 'headless';
      await use();
      void workerInfo;
    },
    { scope: 'worker', auto: true },
  ],

  sharedContext: [
    async ({ browser }, use) => {
      const storageState = resolveStorageState();
      const context = await browser.newContext({
        baseURL: env.baseURL,
        locale: 'zh-CN',
        timezoneId: 'Asia/Shanghai',
        viewport: VIEWPORT,
        storageState,
        recordVideo: {
          dir: path.join(process.cwd(), 'test-results', 'videos'),
          size: VIEWPORT,
        },
      });
      await use(context);
      const page = context.pages()[0];
      const video = page?.video();
      await context.close();
      const runId = workerRun?.runId || process.env.FLOW_RUN_ID?.trim();
      if (video && runId) {
        const outDir = path.join(process.cwd(), flowRunsDir(FLOW_ID), runId);
        fs.mkdirSync(outDir, { recursive: true });
        await savePlaywrightVideo(video, path.join(outDir, 'flow.webm'));
      }
    },
    { scope: 'worker' },
  ],

  sharedPage: [
    async ({ sharedContext }, use) => {
      const page = await sharedContext.newPage();
      await use(page);
    },
    { scope: 'worker' },
  ],

  apiGuard: [
    async ({ sharedPage }, use) => {
      const guard = createApiGuard(sharedPage);
      await use(guard);
      guard.detach();
    },
    { scope: 'worker' },
  ],

  context: async ({ sharedContext }, use) => {
    await use(sharedContext);
  },

  page: async ({ sharedPage }, use) => {
    await use(sharedPage);
  },

  flowRunDir: async ({}, use) => {
    await use(workerRun?.runDir || '');
  },

  _apiGuardPerTest: [
    async ({ apiGuard }, use, testInfo) => {
      const skip = testInfo.annotations.some((a) => a.type === 'skip-api-guard');
      if (!skip) {
        apiGuard.start();
      }
      await use();
      if (!skip) {
        const failures = apiGuard.getFailures();
        if (failures.length && workerRun) {
          appendApiFailures(
            FLOW_ID,
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
        await apiGuard.assertNoFailures(`[${testInfo.title}]`);
      }
    },
    { auto: true },
  ],

  homePage: async ({ page }, use) => {
    await use(new HomePage(page));
  },
  loginPage: async ({ page }, use) => {
    await use(new LoginPage(page));
  },
  requestListPage: async ({ page }, use) => {
    await use(new RequestListPage(page));
  },
  requestEditPage: async ({ page }, use) => {
    await use(new RequestEditPage(page));
  },
  authenticatedPage: async ({ page }, use) => {
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
});

export { expect } from '@playwright/test';
export type { ApiFailure, ApiGuard } from '../utils/api-guard';
