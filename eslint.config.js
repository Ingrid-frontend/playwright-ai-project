import js from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import globals from 'globals';

/** @type {import('eslint').Linter.Config[]} */
export default [
  {
    ignores: [
      'node_modules/**',
      // 前端仓库本地克隆（index:frontend 产物，1G+ / 3 万文件）。
      // 漏掉它会让 npm run lint 报出 12 万个问题，把真实问题彻底埋掉。
      '.cache/**',
      'dist/**',
      'build/**',
      'playwright-report/**',
      'public-reports/**',
      'ci-artifacts/**',
      'test-results/**',
      'results/**',
      'screenshots/**',
      'tests/deprecated/**',
      'tests/raw-recordings/**',
      'tests/optimized/**',
      'tests/chrome-recorder/**',
      // Studio 录制的临时脚本产物，随录随删，不参与 lint
      'pw-files/.pw-studio/**',
    ],
  },
  js.configs.recommended,
  {
    // 浏览器端脚本：注入到报告 HTML 里执行，不是 Node 脚本
    files: ['scripts/report/compare-screenshots-report.js'],
    languageOptions: {
      sourceType: 'script',
      globals: {
        ...globals.browser,
        // 历史可选钩子：由外部脚本按需注入，调用处均有 typeof 守卫
        initDiffCards: 'readonly',
        initVisualReview: 'readonly',
        closeCompareModal: 'readonly',
      },
    },
    rules: {
      // 顶层函数由报告 HTML 的 onclick 内联属性调用（如 onclick="openModal(...)"），
      // 静态分析看不到这些引用，全部按“对外导出”处理。
      'no-unused-vars': ['error', { vars: 'local', args: 'after-used', argsIgnorePattern: '^_' }],
    },
  },
  {
    // Node 侧 CommonJS
    files: [
      'pw-files/**/*.js',
      'src/utils/**/*.cjs',
      'scripts/verify/**/*.cjs',
      '**/*.cjs',
    ],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  {
    // Node 侧 ESM
    files: ['**/*.mjs', 'custom-reporters/**/*.js', 'eslint.config.js'],
    languageOptions: {
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
      globals: {
        ...globals.node,
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
    },
    rules: {
      ...tseslint.configs.recommended.rules,

      // 防止“无意的 any”扩散（先警告，避免一次性大改）
      '@typescript-eslint/no-explicit-any': 'warn',

      // TS 已覆盖此类检查，避免重复噪声
      'no-undef': 'off',

      // 中文报告文案里的全角空格（如「 · 」分隔符）是刻意排版，
      // 只拦截代码区域的不可见字符，字符串/模板/注释内放行。
      'no-irregular-whitespace': [
        'error',
        { skipStrings: true, skipTemplates: true, skipComments: true, skipRegExps: true },
      ],

      // 下划线前缀 = 刻意忽略（解构剔除属性、占位参数），不算未使用
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
    },
  },
];
