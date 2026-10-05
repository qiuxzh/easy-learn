import { shell, BrowserWindow } from 'electron';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { is } from '@electron-toolkit/utils';
import installExtension, { REACT_DEVELOPER_TOOLS } from 'electron-devtools-installer';
import { IpcChannel } from '../shared/ipc-channels';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 主窗口单例
let mainWindow: BrowserWindow | null = null;

/**
 * 创建主窗口
 */
export function createWindow(): BrowserWindow {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    show: false,
    frame: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true, // 启用上下文隔离，保证安全
      nodeIntegration: false, // 禁用 Node.js 集成
    },
  });

  // 窗口准备完毕后显示，避免创建时闪烁
  mainWindow.on('ready-to-show', () => {
    mainWindow?.show();
  });

  // 最大化状态变化时推送给渲染进程
  mainWindow.on('maximize', () => {
    mainWindow?.webContents.send(IpcChannel.Window_MaximizedStateChanged, true);
  });
  mainWindow.on('unmaximize', () => {
    mainWindow?.webContents.send(IpcChannel.Window_MaximizedStateChanged, false);
  });

  // 开发环境：安装 React DevTools（需要 VPN 或手动安装）
  // if (is.dev) {
  //   installExtension(REACT_DEVELOPER_TOOLS).catch(err => {
  //     console.warn('Failed to install DevTools extension:', err);
  //   });
  // }

  // 阻止在新窗口打开外部链接，改为使用系统默认浏览器打开
  mainWindow.webContents.setWindowOpenHandler(details => {
    shell.openExternal(details.url);
    return { action: 'deny' };
  });

  // 开发环境：加载 Vite 开发服务器的 URL
  // 生产环境：加载打包后的 HTML 文件
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  return mainWindow;
}

/**
 * 获取主窗口实例
 */
export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}
