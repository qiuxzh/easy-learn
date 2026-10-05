import { BaseService } from '@main/service';

/**
 * 注册 IPC 处理器
 */
export function setupIpcHandlers(): void {
  BaseService.setupAllIpcHandlers();
}
