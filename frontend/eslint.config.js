/**
 * @file ESLint 9 flat config：typescript-eslint、react-hooks、react-refresh 的 recommended 规则集，
 * 外加 eslint-plugin-jsdoc 强制"每个文件有 @file 文件级注释、每个函数/组件/Hook 有 JSDoc"。
 * 格式化交给根目录 Prettier，这里不含风格规则。
 */
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import jsdoc from 'eslint-plugin-jsdoc';

export default tseslint.config(
  { ignores: ['dist', 'coverage', 'node_modules'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
      jsdoc.configs['flat/recommended-typescript-error'],
    ],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    rules: {
      // 每个文件顶部必须有一段以 @file 开头的文件级注释
      'jsdoc/require-file-overview': 'error',
      // 函数声明一律要有 JSDoc；箭头函数/函数表达式只在"赋给模块级或导出变量"时要求
      // （组件、Hook、store 都是这种形式），传给调用的内联回调不要求
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
