import { toast } from 'sonner';
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { OcrRuntime } from '@shared/types/ocr';
import { useBooksStore } from './books-store';

interface OcrState {
  /** 主进程正在跑的识别任务；没有任务时为空 */
  runtime: OcrRuntime | null;
  /** 用后端推送的快照覆盖本地运行态 */
  applyRuntime: (runtime: OcrRuntime | null) => void;
}

/**
 * 文字提取的运行态。
 *
 * 只镜像主进程内存里的那一个任务，不落库：刷新后由 `describeOcr` 对齐一次。
 */
export const useOcrStore = create<OcrState>()(
  immer(set => ({
    runtime: null,
    applyRuntime: runtime =>
      set(state => {
        state.runtime = runtime;
      }),
  }))
);

/** 是否已经挂上监听。事件监听必须常驻，重复调用只生效一次。 */
let initialized = false;

/**
 * 订阅文字提取的运行态与结束事件。
 *
 * 任务可能在书库页就发起，监听要一直挂着，不能等打开弹窗才开始听。
 * 结束事件负责刷新书籍列表——识别会改阶段行、分片与向量，本地快照已经过期。
 */
export function ensureOcrStreamInitialized(): void {
  if (initialized) return;
  initialized = true;

  window.api.onOcrEvent(event => {
    if (event.kind === 'runtime') {
      useOcrStore.getState().applyRuntime(event.runtime);
      return;
    }

    useOcrStore.getState().applyRuntime(null);

    if (event.cancelled) {
      toast.info('已停止提取，已完成的页会保留');
    } else if (event.success) {
      toast.success('文字提取完成，已自动分片');
    } else {
      toast.error(`文字提取失败：${event.error ?? '未知错误'}`);
    }

    void useBooksStore.getState().loadBooks();
  });

  // 刷新后主进程里可能已经有任务在跑，先对齐一次运行态
  void window.api.describeOcr().then(runtime => {
    useOcrStore.getState().applyRuntime(runtime);
  });
}
