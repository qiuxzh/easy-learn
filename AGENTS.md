## 项目概述

PDF/EPUB 阅读学习应用，Electron 桌面工具

## 技术栈

- 框架: electron-vite + React 19 + TypeScript
- 样式: Tailwind CSS + shadcn/ui + Radix UI
- 状态: zustand v5
- 数据库: Drizzle ORM + better-sqlite3
- 电子书解析: foliate-js
- 代码规范: ESLint 9 + Prettier
- 测试: vitest
- 自定义协议: app://

## 开发命令

```bash
pnpm dev      # 开发
pnpm build    # 编译
pnpm lint     # 检查（每次写完代码后必须执行，确保语法正确）
pnpm lint:fix # 修复
pnpm format   # 格式化
```

## 项目结构

```
src/
├── main/               # Electron 主进程
│   ├── agent/          # 自研 Agent 内核
│   │   ├── core/       #   Agent 循环、抽象类型、流式事件
│   │   ├── model/      #   模型运行时（模型配置解析、api 协议适配）
│   │   └── common-agent/  # 通用 Agent 实现（工具、提示词、压缩策略）
│   ├── chat/           # 会话服务与阅读 Agent（reading-agent、session-service）
│   ├── books/          # 电子书：解析、分块、检索（bm25）
│   │   └── etl/        #   PDF 解析、OCR、数据处理流程
│   ├── db/             # Drizzle 数据库
│   │   ├── schema/     #   表结构定义
│   │   └── repo/       #   数据访问层
│   ├── config/         # 应用配置读写
│   ├── service/        # 主进程服务（文件、图片、卡片、阅读、窗口）
│   ├── ipc/            # IPC 通道注册
│   └── app-protocol.ts # app:// 协议注册
├── preload/            # 预加载，暴露 API 给渲染进程
├── renderer/           # React 渲染进程
│   ├── index.html
│   └── src/
│       ├── components/ # 组件：ui/ 为 shadcn 组件，chat/ layout/ reader/ 为业务组件
│       ├── pages/      # 页面（Home、BookShelf、Chat、Flashcard、Settings）
│       ├── stores/     # zustand 状态管理
│       ├── hooks/      # 自定义 hooks
│       ├── utils/      # 渲染层工具
│       └── lib/        # 通用工具（cn 等）
└── shared/             # 主进程与渲染进程共享的代码
    ├── types/          # 共享类型定义
    ├── config/         # 配置 schema 与默认值
    ├── utils/          # 共享工具（含 book-parser）
    └── ipc-channels.ts # IPC 通道常量
```

- temp_script，里面可以放置临时的脚本，用于临时测试

## 文档

如有任何对文档的写入，务必参考：docs/references/documents.md

# 工作思维准则

## 编码前先思考

- 明确列出所有前提假设。存在不确定点时，先提问再动手开发。
- 若需求存在多种解读方向，全部列明，不得自行悄悄选定一种方案。
- 若有更简洁的实现思路，主动说明；必要时合理提出异议。
- 遇到模糊不清的内容立刻停止，点明存疑之处并发起询问。
- 如果你觉得任务颗粒度不够，请向我追问，直到你有足够把握理解我的需求，防止开发过程中擅作主张

## 规范

- **自行验证**,改完代码需要自行编译查看是否有语法错误。执行 pnpm lint
- 只需要完成用户的需求，**禁止做用户没有要求的事情**（除了文档和注释更新）。
- 你写的代码需要有中文注释。约束：注释之和代码本身有关系。不能通过注释和用户对话，比如写“根据用户要求修改了查询数据库的逻辑”
- 尽量不使用 as unknown as 强制转换类型
- 如果eslint报错，但是报错的文件和你的改动无关，相信你的判断
- 不经过用户允许，禁止在项目代码里新增/删除文件夹，防止扰乱架构。如果确实需要，停下来和用户说明。用户没有明确改代码需要，不应该修改代码。
- 防止代码冗余：如果为了实现某个功能多次修改代码/多次尝试，一定会产生冗余代码，最终需要删除冗余代码。
- 代码需要写注释，至少每个函数需要写上注释，类型上也需要有注释
- 文件名规范：只有 React 组件用 PascalCase，shadcn组件遵循下载后的组件名，其他一律 kebab-case
- 代码可读性：不允许把大量内容写到一行，例如有多个字段的对象。适当的换行、缩进，提高代码可读性
- agent-browser在用户要求后才用，因为校验耗时较旧
- 如无特殊要求，过于简单的ts类型不应该独立出来定义类型。如`type Direction = 'left' | 'right'`

### 前端

- pnpm 下载包时不需要指定store位置，直接使用 `pnpm add` 就可以
- zustand的store里面使用immer，防止出现代码多层嵌套
- **组件复用**：有现成组件，就不要自己造轮子。如果没有需要的组件，优先考虑下载，而不是自己实现
- 在renderer里面严禁使用../导入，尽可能用@/...导入组件
