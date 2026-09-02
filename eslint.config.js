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
    ],
  },
  js.configs.recommended,
  {
    files: ['pw-files/**/*.js', 'src/utils/**/*.cjs', 'scripts/verify/**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
      },
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
    },
  },
];
