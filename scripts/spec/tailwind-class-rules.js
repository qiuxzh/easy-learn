/** 变体前缀：吃掉 [&>svg]: / data-[state=open]: / md: 这类前缀，后面的值位置才判断得了 */
const VARIANT = '^(?:(?:[^:\\s[]*\\[[^\\]]*\\][^:\\s]*|[^:\\s]+):)*';

/** 值位置会接颜色的工具类：方向性写法（border-t-red-500）与 ring-offset 也算颜色 */
const COLOR =
  'bg|text|border(?:-[xytrblse])?|divide(?:-[xy])?|ring(?:-offset)?|inset-ring|fill|stroke|outline|decoration|shadow|from|via|to';

/** Tailwind 默认调色板族名 */
const PALETTE =
  'slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose';

/** 原始颜色取值：默认色阶（bg-red-500）与字面黑白（text-white） */
const RAW_COLOR = `(?:${PALETTE})-\\d{2,3}|white|black`;

/**
 * 颜色纪律：颜色只能取 src/renderer/src/index.css 里定义的语义 token。
 * eslint-plugin-better-tailwindcss 的 no-restricted-classes 按顺序对每个类名做 match，先命中先报。
 */
export const RESTRICTED_CLASSES = [
  {
    pattern: `${VARIANT}(?:${COLOR})-(?:${RAW_COLOR})(?:/|$)`,
    message: '颜色不用原始色阶与字面黑白，改用语义 token',
  },
  {
    pattern: `${VARIANT}(?:${COLOR})-\\[(?:#|rgba?\\(|hsla?\\()`,
    message: '颜色不写字面值，改用 index.css 里的语义 token',
  },
];
