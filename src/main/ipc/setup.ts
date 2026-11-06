import type { App } from '@main/bootstrap';
import { registerAttachmentHandlers } from './attachment-handlers';
import { registerBookHandlers } from './book-handlers';
import { registerCardHandlers } from './card-handlers';
import { registerChatHandlers } from './chat-handlers';
import { registerAppHandlers } from './app-handlers';
import { registerSettingsHandlers } from './settings-handlers';
import { registerReadingHandlers } from './reading-handlers';

/**
 * 注册 IPC 处理器。
 *
 * 每个域一个 handler 文件，依赖从装配根取；这里只做分发。
 *
 * @param app 装配好的应用实例，由启动流程传入
 */
export function setupIpcHandlers(app: App): void {
  registerAttachmentHandlers(app.services.attachmentService);
  registerBookHandlers(
    app.services.bookService,
    app.services.bookEmbeddingService,
    app.services.bookOcrService
  );
  registerCardHandlers(app.services.cardService);
  registerChatHandlers(app.services.sessionService);
  registerSettingsHandlers(app.configService, app.services.embeddingService);
  registerReadingHandlers(app.services.readingService);
  registerAppHandlers();
}
