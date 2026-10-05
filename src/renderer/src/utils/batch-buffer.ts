/** 累积缓冲，定时批量派发。适用于高频增量更新的节流场景 */
export class BatchBuffer {
  private buffer = new Map<string, string>();
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly flush: (entries: ReadonlyArray<[string, string]>) => void,
    private readonly interval: number
  ) {}

  /** 追加值到指定 key 的缓冲中 */
  push(key: string, value: string): void {
    this.buffer.set(key, (this.buffer.get(key) ?? '') + value);
    if (!this.timer) {
      this.timer = setTimeout(() => this.flushNow(), this.interval);
    }
  }

  /** 立即清空缓冲（用于流结束时确保最后一批数据不丢失） */
  flushImmediate(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.flushNow();
  }

  private flushNow(): void {
    this.timer = null;
    if (this.buffer.size === 0) return;
    const entries = [...this.buffer.entries()];
    this.buffer.clear();
    this.flush(entries);
  }
}
