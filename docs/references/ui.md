# 样式与组件规范

- className 由 eslint-plugin-better-tailwindcss 约束：颜色只取 index.css 的语义 token，`bg-[#bada55]`、`text-white`、`bg-red-500` 都不合法
- 优先复用现有组件，如 Button、Input，而不是使用 button、input 原生组件
- 改动任何 tsx 前先读本文。本文没写到的地方，找最近似的已有页面抄，不要就地立新值
