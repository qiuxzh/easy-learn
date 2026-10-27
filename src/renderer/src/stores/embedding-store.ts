import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { EmbeddingRuntime } from '@shared/types/embedding';
import type { EmbeddingIdentity } from '@shared/utils/embedding-identity';
import { useBooksStore } from './books-store';
import { useConfigStore } from './config-store';

/** 空运行态，用作初始值。 */
const EMPTY_RUNTIME: EmbeddingRuntime = { tasks: [] };

interface EmbeddingStoreState {
  /**
   * 向量化任务的内存态。
   *
   * 书籍的向量化信息不在这里——它跟着书走（`BookDoc.stages`），
   * 由 `book-service` 的书籍列表一起带回来。
   */
  runtime: EmbeddingRuntime;

  /**
   * 当前配置对应的模型身份；没选中、或字段不全时为 null。
   *
   * 它由配置算出来，不是后端给的：「现有向量算不算数」是相对的判断，
   * 比这一步必须在前端做，否则换模型就得回写每本书的状态。
   */
  current: EmbeddingIdentity | null;

  /** 收到运行态推送 */
  applyRuntime: (runtime: EmbeddingRuntime) => void;
  /** 重新从配置算当前模型身份 */
  syncCurrentModel: () => void;
}

/** 从配置里取出当前选中的模型身份。字段不全时返回 null。 */
function readCurrentIdentity(): EmbeddingIdentity | null {
  const embedding = useConfigStore.getState().config.embedding;
  const selected = embedding?.selected?.trim();
  if (!selected) return null;

  const entry = embedding?.models?.[selected];
  if (!entry) return null;

  const endpoint = entry.endpoint.trim();
  const modelId = entry.modelId.trim();
  if (!endpoint || !modelId) return null;

  return { endpoint, modelId };
}

/** 把身份折成一个可比较的字符串，用来判断它有没有变。 */
function identityKey(identity: EmbeddingIdentity | null): string {
  return identity ? `${identity.endpoint}\u0000${identity.modelId}` : '';
}

export const useEmbeddingStore = create<EmbeddingStoreState>()(
  immer((set, get) => ({
    runtime: EMPTY_RUNTIME,
    current: null,

    applyRuntime: runtime => {
      const before = new Set(get().runtime.tasks.map(task => task.bookId));
      const after = new Set(runtime.tasks.map(task => task.bookId));
      // 只有任务集合变化（开始或结束）时才需要重取书库：那一刻入库进度才作数。
      // 每批进度都重取会把书库打满——getAllBooks 会给每本书做一次文件 stat。
      const taskSetChanged =
        before.size !== after.size || [...before].some(bookId => !after.has(bookId));

      set(state => {
        state.runtime = runtime;
      });

      if (taskSetChanged) {
        void useBooksStore.getState().loadBooks();
      }
    },

    syncCurrentModel: () => {
      const next = readCurrentIdentity();
      if (identityKey(next) === identityKey(get().current)) return;
      set(state => {
        state.current = next;
      });
    },
  }))
);
