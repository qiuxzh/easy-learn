import { ipcMain } from 'electron';
import { IpcChannel } from '@shared/ipc-channels';
import type { ReadingStatePayload } from '@shared/types/reader';
import { BaseService } from './base-service';

export class ReadingService extends BaseService {
  private currentReadingState: ReadingStatePayload | null = null;

  setupIpcHandlers(): void {
    ipcMain.handle(IpcChannel.Reading_PushState, async (_, payload: ReadingStatePayload) => {
      this.pushReadingState(payload);
    });
  }

  pushReadingState(payload: ReadingStatePayload): void {
    this.currentReadingState = payload;
  }

  getCurrentReadingState(): ReadingStatePayload | null {
    return this.currentReadingState;
  }
}

export const readingService = new ReadingService();
