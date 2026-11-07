import { app, BrowserWindow } from 'electron';
import { electronApp } from '@electron-toolkit/utils';
import { optimizer } from '@electron-toolkit/utils';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';
import log from 'electron-log';
import { createWindow } from './window';
import { setupIpcHandlers } from './ipc/setup';
import { bootstrap, type App } from './bootstrap';
import { createPaths, type Paths } from './paths';
import { registerAppProtocol, registerAppProtocolPrivileges } from './app-protocol';

/** 装配好的应用实例；初始化失败时保持 null。 */
let instance: App | null = null;
/** 是否已经进入退出流程，避免 before-quit 被二次拦截。 */
let shuttingDown = false;

/** 数据根目录：会话日志、书籍与图片都落在它下面。 */
function createAppPaths(): Paths {
  return createPaths(path.resolve(app.getPath('userData'), 'data'));
}

function ensureUserDataDir(paths: Paths): void {
  if (!existsSync(paths.dataDir)) {
    mkdirSync(paths.dataDir, { recursive: true });
  }
}

/** 进程级异常：记录后退出，未捕获异常下的进程状态不可信。 */
function registerProcessErrorHandlers(): void {
  process.on('uncaughtException', error => {
    log.error('Uncaught Exception:', error);
    app.exit(1);
  });

  process.on('unhandledRejection', reason => {
    log.error('Unhandled Rejection:', reason);
  });
}

/**
 * ready 之后按顺序装配：路径 → 数据库与服务 → 协议 → IPC。
 *
 * @returns 装配好的应用实例
 * @throws 路径创建、数据库打开或 IPC 注册失败时抛出，由调用方决定如何提示
 */
function startApplication(): App {
  const paths = createAppPaths();
  ensureUserDataDir(paths);

  const app = bootstrap({ paths });
  registerAppProtocol({
    dataDir: paths.dataDir,
    attachmentDir: paths.attachmentDir,
    attachmentService: app.services.attachmentService,
    libraryDir: paths.libraryDir,
    resolveResourceBlob: id => app.services.libraryService.resolveResourceBlob(id),
  });
  setupIpcHandlers(app);
  log.info('IPC handlers registered');

  return app;
}

/**
 * 注册应用级事件：窗口快捷键、macOS 激活、关窗退出与退出前释放。
 *
 * 这些事件必须在 ready 之前注册，初始化失败时 `instance` 为 null，
 * 退出流程直接放行，不阻塞窗口关闭。
 */
function registerLifecycle(): void {
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  // macOS：应用激活时（点击 Dock 图标），如果没有窗口则创建
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });

  // 所有窗口关闭时（非 macOS）退出应用
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  // 退出前释放装配根持有的资源（运行时池与数据库连接）。
  // 阻止第一次退出以等待异步释放完成，完成后重新 quit；释放失败也必须退出，否则窗口关不掉。
  app.on('before-quit', event => {
    if (!instance || shuttingDown) return;
    event.preventDefault();
    shuttingDown = true;
    void instance.shutdown().finally(() => app.quit());
  });
}

// 初始化日志系统
log.initialize({ preload: true });
log.info('Application starting...');

registerProcessErrorHandlers();
app.setName('easy-learn');

// 必须在 app.ready 之前声明 app:// 的 privileged 属性（fetch 依赖 standard + supportFetchAPI）
registerAppProtocolPrivileges();

// 应用入口
app.whenReady().then(async () => {
  log.info('App ready, initializing...');

  // 设置 Windows 下的应用 ID（用于系统任务栏等功能）
  electronApp.setAppUserModelId('com.easylearn.app');

  registerLifecycle();

  try {
    instance = startApplication();
  } catch (error) {
    log.error('Application initialization failed:', error);
  }

  // 创建主窗口
  createWindow();
});
