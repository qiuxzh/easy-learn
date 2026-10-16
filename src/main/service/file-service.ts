import { ipcMain, dialog } from 'electron';
import { BaseService } from './base-service';
import { IpcChannel } from '../../shared/ipc-channels';
import type { FileOpenRequest, FileOpenResult } from '@shared/types/file';

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

export class FileService extends BaseService {
  setupIpcHandlers(): void {
    ipcMain.handle(
      IpcChannel.File_OpenDialog,
      async (_e, req?: FileOpenRequest): Promise<FileOpenResult> => {
        try {
          const result = await dialog.showOpenDialog({
            properties: ['openFile'],
            filters: req?.filters ?? DEFAULT_FILTERS,
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
