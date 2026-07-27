import { defineConfig, devices } from '@playwright/test';
import * as path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
import baseConfig from './datasource/base-config.json' assert { type: 'json' };
import { resolveStorageState } from './src/utils/env-config.js';

/**
 * 环境处理逻辑
 */
const defaultEnv = "stage";
export const env = process.env.PLAYWRIGHT_ENV || process.env.NODE_ENV || defaultEnv;
export const curConfig = (baseConfig as Record<string, any>)[env] || (baseConfig as Record<string, any>)[defaultEnv];
export const storageStatePath = resolveStorageState(env, process.env.PLAYWRIGHT_ACCOUNT);

function buildReporter() {
  const reporters: any[] = [['html']];
  // 默认不启用 list，避免输出噪声；需要时可显式开启
  if (process.env.ENABLE_LIST_REPORTER === '1') {
    reporters.push(['list']);
  }
  reporters.push([path.resolve(__dirname, 'custom-reporters/error-reporter.js')]);
  return reporters;
}

/**
 * Playwright：viewport 为 null 时不能同时带 device 预设里的 deviceScaleFactor，否则
 * browser.newContext 报错。保留 userAgent 等其余字段。
 */
function useDeviceWithRealViewport(device: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  const { viewport: _vp, deviceScaleFactor: _dsf, ...rest } = device;
  return { ...rest, viewport: null, ...extra };
}

export default defineConfig({
  // 1. 测试目录与并行度
  testDir: './tests',
  testIgnore: [
    '**/raw-recordings/**',
    '**/chrome-recorder/**',
    '**/deprecated/**',
  ],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  // 优化并发数：本地开发建议 1-2，CI 环境建议 2-4
  workers: process.env.CI ? 2 : 1,

  // 2. 增强型测试报告：支持 HTML 与错误收集
  reporter: buildReporter(),

  // 3. 全局通用配置
  use: {
    baseURL: curConfig.baseURL,
    
    /* 核心：存储登录状态的路径 */
    // 注意：storageState 在各个项目中单独配置，setup 项目除外
    
    /* 稳定性与调试配置 */
    trace: (process.env.PLAYWRIGHT_TRACE ||
      (process.env.CI ? 'retain-on-failure' : 'on-first-retry')) as
      | 'on'
      | 'off'
      | 'retain-on-failure'
      | 'on-first-retry'
      | 'on-all-retries',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    
    /* 本地化：确保 AI 识别中文字符串 */
    locale: 'zh-CN',
    extraHTTPHeaders: {
      'Accept-Language': 'zh-CN,zh;q=0.9'
    },
    /* 不固定视口：跟随浏览器窗口，避免固定宽高导致页面留白/裁切与真实环境不一致 */
    viewport: null,
    actionTimeout: 60000,  // 增加操作超时时间
    navigationTimeout: 60000,  // 增加导航超时时间
  },

  // 4. 项目配置 (采用 Project Dependencies 模式替代 globalSetup)
  projects: [
    /* --- 登录依赖项 --- */
    {
      name: 'setup',
      // 重要：setup 测试文件在 src/setup 下，不在全局 testDir(./tests) 里
      testDir: './src/setup',
      testMatch: /.*\.setup\.ts/, // 匹配你的登录脚本
      // setup 项目不应该加载 storageState，而是生成它
      // 登录含 iframe + 跳转，默认 30s 易超时；与 use.navigationTimeout 对齐
      timeout: 120_000,
      retries: 0,
    },

    /* --- 浏览器测试项目 --- */
    // {
    //   name: 'chromium',
    //   use: { 
    //     ...devices['Desktop Chrome'],
    //     storageState: curConfig.storageState
    //   },
    //   dependencies: ['setup'], // 运行前确保执行 setup
    // },

    // Firefox 暂时禁用，由于 storageState 兼容性问题
    // {
    //   name: 'firefox',
    //   use: { 
    //     ...devices['Desktop Firefox'],
    //     storageState: curConfig.storageState,
    //     launchOptions: {
    //       firefoxUserPrefs: {
    //         'dom.websockets.enabled': true,
    //         'network.http.phishy-userpass-length': 255,
    //       }
    //     }
    //   },
    //   dependencies: ['setup'],
    // },

    {
      name: 'webkit',
      use: useDeviceWithRealViewport(devices['Desktop Safari'] as Record<string, unknown>, {
        storageState: storageStatePath,
      }),
      dependencies: ['setup'],
    },

    /* --- 移动端测试可选 --- */
    // {
    //   name: 'Mobile Chrome',
    //   use: { 
    //     ...devices['Pixel 5'],
    //     storageState: curConfig.storageState
    //   },
    //   dependencies: ['setup'],
    // },

    /* --- 优化后的测试项目 --- */
    {
      name: 'optimized',
      testDir: './tests/optimized',
      use: {
        ...devices['Desktop Chrome'],
        storageState: storageStatePath,
        // 固定视口与 DPR，避免 viewport:null 时截图随窗口/显示器变化（如 1280×720 与 2560×1440 混用）
        viewport: { width: 1280, height: 720 },
        deviceScaleFactor: 1,
      },
      dependencies: ['setup'],
    },

    /** 与 optimized 相同视口，引擎为 WebKit（Safari） */
    {
      name: 'optimized-webkit',
      testDir: './tests/optimized',
      use: {
        ...devices['Desktop Safari'],
        storageState: storageStatePath,
        viewport: { width: 1280, height: 720 },
        deviceScaleFactor: 1,
      },
      dependencies: ['setup'],
    },

    /** 与 optimized 相同视口，引擎为 Firefox（暂时禁用，见 config/ui-regression.json browserProjects） */
    // {
    //   name: 'optimized-firefox',
    //   testDir: './tests/optimized',
    //   use: {
    //     ...devices['Desktop Firefox'],
    //     storageState: storageStatePath,
    //     viewport: { width: 1280, height: 720 },
    //     deviceScaleFactor: 1,
    //     launchOptions: {
    //       firefoxUserPrefs: {
    //         'dom.websockets.enabled': true,
    //         'network.http.phishy-userpass-length': 255,
    //       },
    //     },
    //   },
    //   dependencies: ['setup'],
    // },
  ],

  /* 5. 本地开发服务器配置（按需取消注释） */
  // webServer: {
  //   command: 'npm run start',
  //   url: curConfig.baseURL,
  //   reuseExistingServer: !process.env.CI,
  // },
});