import { ipcMain } from 'electron';
import { IpcChannel } from '@shared/ipc-channels';
import type { ReadingStatePayload } from '@shared/types/reader';
import { BaseService } from './base-service';

export class ReadingService extends BaseService {
  /** 渲染层最近一次同步的阅读状态；null 表示当前没有在读的书 */
  private currentReadingState: ReadingStatePayload | null = null;

  setupIpcHandlers(): void {
    ipcMain.handle(IpcChannel.Reading_PushState, async (_, payload: ReadingStatePayload | null) => {
      this.pushReadingState(payload);
    });
  }

  pushReadingState(payload: ReadingStatePayload | null): void {
    this.currentReadingState = payload;
  }

  getCurrentReadingState(): ReadingStatePayload | null {
    return this.currentReadingState;
  }
}

export const readingService = new ReadingService();
