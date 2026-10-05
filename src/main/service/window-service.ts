import { ipcMain } from 'electron';
import { BaseService } from './base-service';
import { IpcChannel } from '@shared/ipc-channels';
import { getMainWindow } from '../window';

export class WindowService extends BaseService {
  setupIpcHandlers(): void {
    ipcMain.on(IpcChannel.Window_Minimize, () => {
      getMainWindow()?.minimize();
    });

    ipcMain.on(IpcChannel.Window_Maximize, () => {
      const win = getMainWindow();
      if (!win) return;

      if (win.isMaximized()) {
        win.unmaximize();
        return;
      }

      win.maximize();
    });

    ipcMain.handle(IpcChannel.Window_IsMaximized, () => {
      return getMainWindow()?.isMaximized() ?? false;
    });

    ipcMain.on(IpcChannel.Window_Close, () => {
      getMainWindow()?.close();
    });
  }
}

export const windowService = new WindowService();
