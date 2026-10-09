import { useConfigStore } from './config-store';
import { useEmbeddingStore } from './embedding-store';

/** 是否已经挂上监听。事件监听必须常驻，重复调用只生效一次。 */
let initialized = false;

/**
 * 订阅后端推送的向量化运行态，并让「当前模型身份」跟着配置走。
 *
 * 与聊天事件同理：任务在后台跑的时候前端也要收下进度，不能等打开详情弹窗才开始听，
 * 否则书库上的角标永远不会动。应用启动时调用一次。
 */
export function ensureEmbeddingStreamInitialized(): void {
  if (initialized) return;
  initialized = true;

  window.api.onEmbeddingRuntime(runtime => {
    useEmbeddingStore.getState().applyRuntime(runtime);
  });

  // 配置里的模型身份变了，「现有向量算不算数」就跟着变。身份是本地算出来的，
  // 不需要问后端——重算一次，界面自然跟着重渲染。
  useEmbeddingStore.getState().syncCurrentModel();
  useConfigStore.subscribe(() => {
    useEmbeddingStore.getState().syncCurrentModel();
  });

  // 刷新后主进程里可能已经有任务在跑，先对齐一次运行态
  void window.api.describeEmbedding().then(runtime => {
    useEmbeddingStore.getState().applyRuntime(runtime);
  });
}
