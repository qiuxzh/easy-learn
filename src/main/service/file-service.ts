import { ipcMain, dialog } from 'electron';
import { BaseService } from './base-service';
import { IpcChannel } from '../../shared/ipc-channels';
import type { FileOpenRequest, FileOpenResult } from '@shared/types/file';

export class FileService extends BaseService {
  setupIpcHandlers(): void {
    ipcMain.handle(
      IpcChannel.File_OpenDialog,
      async (_e, req?: FileOpenRequest): Promise<FileOpenResult> => {
        try {
          const result = await dialog.showOpenDialog({
            properties: ['openFile'],
            filters: req?.filters ?? [
              { name: 'EPUB 文件', extensions: ['epub'] },
              { name: '所有文件', extensions: ['*'] },
            ],
          });
          if (result.canceled || result.filePaths.length === 0) {
            return { success: false };
          }
          const filePath = result.filePaths[0];
          const fileName = filePath.split(/[/\\]/).pop() ?? filePath;
          return { success: true, filePath, fileName };
        } catch (e) {
          return { success: false, error: String(e) };
        }
      }
    );
  }
}

export const fileService = new FileService();
