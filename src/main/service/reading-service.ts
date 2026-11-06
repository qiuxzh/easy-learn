import type { ReadingStatePayload } from '@shared/types/reader';

/**
 * 阅读状态服务：保存渲染层同步过来的"当前在读什么"。
 *
 */
export class ReadingService {
  /** 最近一次同步的阅读状态；null 表示当前没有在读的书 */
  private currentReadingState: ReadingStatePayload | null = null;

  /**
   * 覆盖当前阅读状态。
   *
   * @param payload 渲染层同步的状态；null 表示退出阅读
   */
  pushReadingState(payload: ReadingStatePayload | null): void {
    this.currentReadingState = payload;
  }

  /**
   * 取最近一次同步的阅读状态。
   *
   * @returns 尚未同步过时返回 null
   */
  getCurrentReadingState(): ReadingStatePayload | null {
    return this.currentReadingState;
  }
}
