/**
 * commitlint 配置：强制 Conventional Commits（feat / fix / docs / test / chore / refactor / ci …）。
 * 由 .husky/commit-msg 在每次提交时调用。
 */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // 主题允许中文，因此关闭大小写检查
    'subject-case': [0],
  },
};
