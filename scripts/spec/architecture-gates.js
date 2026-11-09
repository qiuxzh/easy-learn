/**
 * 架构门禁的唯一来源。
 *
 * 当前只约束 service 目录；books、chat、agent 暂不设门禁，后续迁移进 service 后再纳入。
 * `from` 是源文件 glob，`to` 是项目内路径或 npm 包名；不使用 import alias。
 * architecture.check.ts 用 TypeScript 模块解析把模块说明符还原成真实路径再与门禁的项目路径目标比较，包名目标按字面量匹配，并检查门禁目标、tsconfig paths 与 from glob 是否失效。
 * ESLint 用同一份门禁数据生成 no-restricted-imports 规则做字面量匹配，在 lint 时提供不需要模块解析的早期反馈，不解析真实目标，也不检查漂移。
 */

const forbid = (to, reason, allowTypeOnly = false) => ({ to, reason, allowTypeOnly });

/** @type {import('./architecture.check.js').ArchitectureGate[]} */
export const ARCHITECTURE_GATES = [
  {
    name: 'service 不依赖 Electron、数据库与装配根',
    from: ['src/main/service/**'],
    forbid: [
      forbid('electron', 'service 不能依赖 Electron'),
      forbid('electron-log', 'service 只能使用 @main/logging 门面'),
      forbid('src/main/infra/db', 'service 不能直接依赖数据库连接'),
      forbid('src/main/infra/repo', 'service 只能以类型方式引用仓储集合', true),
      forbid('src/main/ipc', 'service 不能反向依赖 IPC'),
      forbid('src/main/bootstrap.ts', 'service 不能依赖装配根'),
    ],
  },
  {
    name: 'infra 不依赖业务层',
    from: ['src/main/infra/**'],
    forbid: [
      forbid('src/main/service', 'infra 不能依赖 service'),
      forbid('src/main/books', 'infra 不能依赖 books'),
      forbid('src/main/chat', 'infra 不能依赖 chat'),
      forbid('src/main/agent', 'infra 不能依赖 agent'),
      forbid('src/main/ipc', 'infra 不能依赖 IPC'),
      forbid('src/main/bootstrap.ts', 'infra 不能依赖装配根'),
    ],
  },
  {
    name: 'preload 不进入主进程',
    from: ['src/preload/**'],
    forbid: [forbid('src/main', 'preload 不能依赖主进程实现')],
  },
  {
    name: 'renderer 不进入主进程',
    from: ['src/renderer/src/**/*.ts', 'src/renderer/src/**/*.tsx'],
    forbid: [
      forbid('electron', 'renderer 不能直接依赖 Electron'),
      forbid('src/main', 'renderer 不能依赖主进程实现'),
    ],
  },
];
