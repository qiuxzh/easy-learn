import { IpcChannel } from '@shared/ipc-channels';
import type { UiEventPublisher, UiEvent } from '@main/contracts/ui-event-publisher';
import { getMainWindow } from '@main/window';

/** 事件类型到 IPC 通道的映射，只出现在这一层。 */
function toChannel(event: UiEvent): string {
  switch (event.type) {
    case 'chat-event':
      return IpcChannel.Chat_Event;
    case 'book-embedding-runtime':
      return IpcChannel.Book_EmbeddingRuntime;
    case 'book-ocr':
      return IpcChannel.Book_OcrEvent;
    case 'config-changed':
      return IpcChannel.Config_Changed;
  }
}

/** 事件负载，类型由上面的通道映射决定。 */
function toPayload(event: UiEvent): unknown {
  switch (event.type) {
    case 'chat-event':
      return event.payload;
    case 'book-embedding-runtime':
      return event.runtime;
    case 'book-ocr':
      return event.event;
    case 'config-changed':
      return event.snapshot;
  }
}

/**
 * 创建发往渲染层的事件出口。
 *
 * 窗口不存在时静默丢弃：事件通常伴随后台任务，退出过程中本就没有接收方。
 */
export function createUiEventPublisher(): UiEventPublisher {
  return {
    publish: event => {
      getMainWindow()?.webContents.send(toChannel(event), toPayload(event));
    },
  };
}
