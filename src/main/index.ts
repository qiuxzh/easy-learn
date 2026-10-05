import { app, BrowserWindow } from 'electron';
import { electronApp } from '@electron-toolkit/utils';
import { optimizer } from '@electron-toolkit/utils';
import { existsSync, mkdirSync } from 'fs';
import log from 'electron-log';
import { createWindow } from './window';
import { setupIpcHandlers } from './ipc/ipc';
import { initDatabase } from './db';
import { Constants } from './constants';
import { registerAppProtocol, registerAppProtocolPrivileges } from './app-protocol';

function ensureUserDataDir(): void {
  const userDataPath = Constants.dataDir;
  if (!existsSync(userDataPath)) {
    mkdirSync(userDataPath, { recursive: true });
  }
}

// 初始化日志系统
log.initialize({ preload: true });
log.info('Application starting...');

// 全局异常处理器 - 捕获未处理的 Promise 拒绝
process.on('uncaughtException', error => {
  log.error('Uncaught Exception:', error);
  app.exit(1);
});

process.on('unhandledRejection', reason => {
  log.error('Unhandled Rejection:', reason);
});

app.setName('easy-learn');

// 必须在 app.ready 之前声明 app:// 的 privileged 属性（fetch 依赖 standard + supportFetchAPI）
registerAppProtocolPrivileges();

// 应用入口
app.whenReady().then(async () => {
  log.info('App ready, initializing...');

  // 设置 Windows 下的应用 ID（用于系统任务栏等功能）
  electronApp.setAppUserModelId('com.easylearn.app');

  //每当创建新的浏览器窗口时，自动注册窗口快捷键监听
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  try {
    ensureUserDataDir();
    initDatabase();
    registerAppProtocol();
    setupIpcHandlers();
    log.info('IPC handlers registered');
  } catch (error) {
    log.error('Database initialization failed:', error);
  }

  // 创建主窗口
  createWindow();

  // macOS：应用激活时（点击 Dock 图标），如果没有窗口则创建
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// 所有窗口关闭时（非 macOS）退出应用
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
