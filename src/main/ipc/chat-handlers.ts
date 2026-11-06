import { IpcChannel } from '@shared/ipc-channels';
import type {
  DeleteSessionRequest,
  ForkSessionRequest,
  OpenSessionRequest,
  RenameSessionRequest,
  StreamAbortRequest,
  StreamSendRequest,
} from '@shared/types/chat';
import type { SessionService } from '@main/chat/session-service';
import { registerDirectHandler } from './register-handler';

/**
 * 注册会话相关的 IPC 处理器。
 *
 * 这些通道的既有契约是"直接返回结果或 rejection"，因此用 `registerDirectHandler`，不套成功信封。
 *
 * @param sessionService 会话服务，由装配根创建并注入
 */
export function registerChatHandlers(sessionService: SessionService): void {
  registerDirectHandler(IpcChannel.Chat_ListSessionSummary, () =>
    sessionService.listSessionSummary()
  );

  registerDirectHandler<OpenSessionRequest>(IpcChannel.Chat_OpenSession, request =>
    sessionService.openSession(request)
  );

  registerDirectHandler<RenameSessionRequest>(IpcChannel.Chat_RenameSession, request => {
    sessionService.renameSession(request);
  });

  registerDirectHandler<DeleteSessionRequest>(IpcChannel.Chat_DeleteSession, request =>
    sessionService.deleteSession(request)
  );

  registerDirectHandler<ForkSessionRequest>(IpcChannel.Chat_ForkSession, request =>
    sessionService.forkSession(request)
  );

  registerDirectHandler<StreamSendRequest>(IpcChannel.Chat_StreamSend, request =>
    sessionService.streamSend(request)
  );

  registerDirectHandler<StreamAbortRequest>(IpcChannel.Chat_StreamAbort, async request => ({
    success: await sessionService.streamAbort(request),
  }));
}
