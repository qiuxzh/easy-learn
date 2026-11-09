import eslint from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import betterTailwindcss from 'eslint-plugin-better-tailwindcss';
import { getDefaultSelectors } from 'eslint-plugin-better-tailwindcss/defaults';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import globals from 'globals';
import path from 'node:path';
import ts from 'typescript';
import { RESTRICTED_CLASSES } from './scripts/spec/tailwind-class-rules.js';
import { ARCHITECTURE_GATES } from './scripts/spec/architecture-gates.js';

const tsconfig = ts.readConfigFile(
  path.join(import.meta.dirname, 'tsconfig.json'),
  ts.sys.readFile
);
if (tsconfig.error) throw new Error('无法读取 tsconfig.json');
const { options: tsOptions } = ts.parseJsonConfigFileContent(
  tsconfig.config,
  ts.sys,
  import.meta.dirname
);
const PATH_MAPPINGS = Object.entries(tsOptions.paths ?? {}).map(([alias, targets]) => ({
  aliasBase: alias.replace(/\/?\*$/, ''),
  targetBase: targets[0].replace(/\/?\*$/, '').replace(/\/$/, ''),
}));

/** 把门禁的项目路径翻译成 import 字面量；只从 tsconfig paths 推导，不维护第二份 alias。 */
function aliasGroupsFor(target) {
  if (!target.startsWith('src/')) return [target, `${target}/**`];
  const groups = new Set();
  for (const { aliasBase, targetBase } of PATH_MAPPINGS) {
    if (target !== targetBase && !target.startsWith(`${targetBase}/`)) continue;
    const suffix = target
      .slice(targetBase.length)
      .replace(/^\//, '')
      .replace(/\.tsx?$/, '');
    const base = suffix ? `${aliasBase}/${suffix}` : aliasBase;
    groups.add(base);
    groups.add(`${base}/**`);
  }
  return groups.size > 0 ? [...groups] : [target];
}

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
  ...ARCHITECTURE_GATES.map(gate => ({
    files: gate.from,
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: gate.forbid.map(target => ({
            group: aliasGroupsFor(target.to),
            message: target.reason,
            allowTypeImports: target.allowTypeOnly === true,
          })),
        },
      ],
    },
  })),
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
