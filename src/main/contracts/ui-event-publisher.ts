import type { ChatEventPayload } from '@shared/types/chat';
import type { ConfigSnapshot } from '@shared/config';
import type { EmbeddingRuntime } from '@shared/types/embedding';
import type { OcrEvent } from '@shared/types/ocr';

/**
 * 主进程需要主动推给渲染层的事件。
 *
 * 用判别联合而不是 `(channel, payload)`：通道名属于传输层，服务只描述"发生了什么"，
 * 由 infra 的实现决定发到哪个 IPC 通道。
 */
export type UiEvent =
  | { type: 'chat-event'; payload: ChatEventPayload }
  | { type: 'book-embedding-runtime'; runtime: EmbeddingRuntime }
  | { type: 'book-ocr'; event: OcrEvent }
  | { type: 'config-changed'; snapshot: ConfigSnapshot };

/** 事件出口。业务代码只 publish，不知道接收方是窗口、日志还是测试替身。 */
export interface UiEventPublisher {
  /**
   * 推送一条事件；没有接收窗口时静默丢弃。
   *
   * @param event 发生的事件
   */
  publish(event: UiEvent): void;
}
