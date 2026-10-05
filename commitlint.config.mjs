/**
 * commitlint 配置：校验提交信息是否符合 Conventional Commits 规范
 * 示例：feat(reader): 支持 EPUB 目录跳转
 */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // 允许的提交类型
    'type-enum': [
      2,
      'always',
      [
        'feat',
        'fix',
        'docs',
        'style',
        'refactor',
        'perf',
        'test',
        'build',
        'ci',
        'chore',
        'revert',
      ],
    ],
    // 中文描述不做大小写校验
    'subject-case': [0],
  },
};
