import eslint from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import betterTailwindcss from 'eslint-plugin-better-tailwindcss';
import { getDefaultSelectors } from 'eslint-plugin-better-tailwindcss/defaults';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import globals from 'globals';
import { RESTRICTED_CLASSES } from './scripts/spec/tailwind-class-rules.js';

/** 默认 selector 去掉 `style` 变量：它指向 CSS 变量对象，不是类名清单 */
const CLASS_SELECTORS = getDefaultSelectors().filter(selector => selector.name !== '^styles?$');

export default [
  {
    ignores: [
      'out/',
      'node_modules/',
      'dist/',
      'temp_script/',
      'src/renderer/src/components/agent-elements/',
    ],
  },
  eslint.configs.recommended,
  {
    // 配置文件与脚本按 Node 环境解析：它们不在 `**/*.{ts,tsx}` 的 globals 覆盖内
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
      react,
      'react-hooks': reactHooks,
      'jsx-a11y': jsxA11y,
    },
    rules: {
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.configs.recommended.rules,
      ...tseslint.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/ban-types': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      'jsx-a11y/no-autofocus': 'off',
      'no-console': 'off',
    },
    settings: {
      react: { version: 'detect' },
    },
  },
  {
    files: ['src/renderer/src/**/*.{ts,tsx}'],
    plugins: { 'better-tailwindcss': betterTailwindcss },
    settings: {
      'better-tailwindcss': {
        // 钉住解析基准：跑 eslint 的目录变了也不会丢 entryPoint
        cwd: import.meta.dirname,
        entryPoint: 'src/renderer/src/index.css',
        selectors: CLASS_SELECTORS,
      },
    },
    rules: {
      'better-tailwindcss/no-restricted-classes': ['error', { restrict: RESTRICTED_CLASSES }],
      'better-tailwindcss/no-conflicting-classes': 'error',
      'better-tailwindcss/no-concatenated-classes': 'error',
    },
  },
];
