import { IpcChannel } from '@shared/ipc-channels';
import type { ReadingStatePayload } from '@shared/types/reader';
import type { ReadingService } from '@main/service/reading-service';
import { registerHandler } from './register-handler';

/**
 * 注册阅读状态相关的 IPC 处理器。
 *
 * @param readingService 阅读状态服务，由装配根创建并注入
 */
export function registerReadingHandlers(readingService: ReadingService): void {
  registerHandler<ReadingStatePayload | null>(IpcChannel.Reading_PushState, payload => {
    readingService.pushReadingState(payload);
    return {};
  });
}
