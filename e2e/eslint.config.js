/**
 * @file E2E 包的 ESLint 9 flat config：typescript-eslint recommended + eslint-plugin-jsdoc，
 * 与 frontend/eslint.config.js 使用同一套 require-file-overview / require-jsdoc 规则，只是没有 React 插件、
 * 全局变量换成 Node。格式化交给根目录 Prettier。
 */
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import jsdoc from 'eslint-plugin-jsdoc';

export default tseslint.config(
  { ignores: ['node_modules', 'playwright-report', 'test-results', '.tmp'] },
  {
    files: ['**/*.ts'],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommended,
      jsdoc.configs['flat/recommended-typescript-error'],
    ],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.node,
    },
    rules: {
      // 每个文件顶部必须有一段以 @file 开头的文件级注释
      'jsdoc/require-file-overview': 'error',
      // 函数声明一律要有 JSDoc；箭头函数只在"赋给模块级或导出变量"时要求，test() 的内联回调不要求
      'jsdoc/require-jsdoc': [
        'error',
        {
          require: {
            FunctionDeclaration: true,
            ArrowFunctionExpression: false,
            FunctionExpression: false,
          },
          contexts: [
            'Program > VariableDeclaration > VariableDeclarator > ArrowFunctionExpression',
            'Program > VariableDeclaration > VariableDeclarator > FunctionExpression',
            'ExportNamedDeclaration > VariableDeclaration > VariableDeclarator > ArrowFunctionExpression',
            'ExportNamedDeclaration > VariableDeclaration > VariableDeclarator > FunctionExpression',
          ],
          exemptEmptyFunctions: false,
          enableFixer: false,
        },
      ],
      // TS 类型已自明，不强制写 @param / @returns
      'jsdoc/require-param': 'off',
      'jsdoc/require-returns': 'off',
    },
  },
);
