/** 向量端点测试请求。 */
export interface TestEmbeddingEndpointRequest {
  /** 完整的 embeddings 请求地址 */
  endpoint: string;
  /** 请求时传给接口的 model 名 */
  modelId: string;
  /** 接口密钥，本地服务可以留空 */
  apiKey?: string;
}

/** 向量端点测试结果。 */
export interface TestEmbeddingEndpointResult {
  success: boolean;
  /** 接口返回的向量维度，成功时存在 */
  dimension?: number;
  /** 失败原因，成功时不存在 */
  error?: string;
}

/**
 * 启动一次向量化的模式。
 *
 * 「开始」与「继续」是同一个操作：待处理的判据是「还没有向量行」，
 * 它同时覆盖了从没做过和上次失败停下的分片，所以两者不需要区分。
 */
export type EmbedStartMode =
  /** 处理所有还没做成的单元 */
  | 'resume'
  /** 先清空这本书的向量，再从头做一遍 */
  | 'rebuild';

/** 启动向量化的请求。 */
export interface EmbedStartRequest {
  bookId: string;
  mode: EmbedStartMode;
}

/** 命令类接口的统一返回。进度通过事件推送，不靠它回传。 */
export interface EmbedCommandResult {
  success: boolean;
  /** 失败原因，成功时不存在 */
  error?: string;
}

/**
 * 任务的阶段。
 *
 * 没有「排队」——开始即执行，不存在「还没轮到我」这个中间态。
 */
export type EmbedTaskPhase =
  /** 正在请求接口 */
  | 'running'
  /** 停在批次边界，等 resume */
  | 'paused';

/** 一本正在处理（或已暂停）的书的进度。 */
export interface EmbedTaskInfo {
  bookId: string;
  phase: EmbedTaskPhase;
  /** 这本书的分片总数，进度的分母 */
  total: number;
  /** 已经有向量的分片数 */
  done: number;
  /** 单元 / 秒，取最近几批的滑动窗口。样本不足时为 0 */
  rate: number;
  /** 预计剩余毫秒；无法估计时为 null，界面应显示「计算中」而不是乱跳的数字 */
  etaMs: number | null;
}

/**
 * 界面上的向量化状态，由 `embedding-state.ts` 的推导得出。每个值对应一句文案。
 *
 * 没有「未分片」：分片是导入时就做好的，没切出分片的书不是一个需要用户处理的状态。
 * 也没有「失败」和「索引失效」：它们的动作和「未向量化」完全一样，只是原因不同，
 * 由附注承担。
 */
export type EmbeddingState =
  /** 向量化中 */
  | 'running'
  /** 已暂停 */
  | 'paused'
  /** 未向量化。含从没做过、做了一半、换了模型、上次失败 */
  | 'none'
  /** 已向量化 */
  | 'done';

/**
 * 向量化的运行态。
 *
 * 没有队列：点一本书就立刻跑一本，并发数就是用户点了几下，不由调度器决定。
 * 每本书各自独立，一本书失败或暂停不影响其它书。
 *
 * 它是内存态，重启后为空；待处理集合从数据库推导，下次点「继续」自然接着跑。
 * 所以它和 `BookEmbedding` 严格分开：那边是落库的事实，这边是此刻谁在动。
 *
 * 命令（启动、暂停、继续、取消）也属于这一层：它们改的是运行态，不是书籍数据。
 */
export interface EmbeddingRuntime {
  /** 正在处理或已暂停的任务，按开始顺序排列；空闲时为空数组 */
  tasks: EmbedTaskInfo[];
}
