import { dialog, ipcMain } from 'electron';
import { IpcChannel } from '@shared/ipc-channels';
import type { FileOpenRequest } from '@shared/types/file';
import { getMainWindow } from '@main/window';
import { registerHandler } from './register-handler';

/**
 * 未显式传 filters 时使用的默认筛选。
 * 与书籍导入保持一致：应用现在支持 EPUB 与 PDF 两种格式。
 */
const DEFAULT_FILTERS = [
  { name: '电子书', extensions: ['epub', 'pdf'] },
  { name: 'EPUB 文件', extensions: ['epub'] },
  { name: 'PDF 文件', extensions: ['pdf'] },
  { name: '所有文件', extensions: ['*'] },
];

/**
 * 注册应用级通道：窗口控制与文件选择。
 *
 * 这些操作没有业务规则，直接作用在窗口或系统弹框上，因此留在 IPC 层而不建成服务。
 * 文件选择取消时返回 `{ success: false }`，外层信封的 `success` 会被它覆盖。
 */
export function registerAppHandlers(): void {
  ipcMain.on(IpcChannel.Window_Minimize, () => {
    getMainWindow()?.minimize();
  });

  ipcMain.on(IpcChannel.Window_Maximize, () => {
    const window = getMainWindow();
    if (!window) return;

    if (window.isMaximized()) {
      window.unmaximize();
      return;
    }

    window.maximize();
  });

  ipcMain.handle(IpcChannel.Window_IsMaximized, () => getMainWindow()?.isMaximized() ?? false);

  ipcMain.on(IpcChannel.Window_Close, () => {
    getMainWindow()?.close();
  });

  registerHandler<FileOpenRequest | undefined>(IpcChannel.File_OpenDialog, async request => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: request?.filters ?? DEFAULT_FILTERS,
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { success: false };
    }
    const filePath = result.filePaths[0];
    const fileName = filePath.split(/[/\\]/).pop() ?? filePath;
    return { success: true, filePath, fileName };
  });
}
