/** 会话日志里一条记录的种类的。 */
export type SessionEntryKind = 'message' | 'model_change' | 'compaction';

/** 会话实体。会话只是「指向某个 entry 的引用」，不持有消息内容。 */
export interface SessionEntity {
  /** 会话唯一标识。 */
  id: string;
  /** 列表展示用的标题。 */
  title: string;
  /** 当前分支末端 entry id；空会话为 null。 */
  tipEntryId: string | null;
  /** 临时会话不进列表，由渲染层在关闭时删除。 */
  ephemeral: boolean;
  /** 创建时间，Unix 毫秒。 */
  createdAt: number;
  /** 最近活跃时间，Unix 毫秒。 */
  updatedAt: number;
}

/** 会话日志中的一条记录。 */
export interface SessionEntryEntity {
  /** entry 唯一标识。 */
  id: string;
  /** 上一个 entry；null 表示这是一条分支的根。 */
  parentEntryId: string | null;
  /** 记录种类。 */
  type: SessionEntryKind;
  /** 该种类专属字段，结构由 agent 层解释。 */
  payload: unknown;
  /** 创建时间，Unix 毫秒。 */
  createdAt: number;
}

/** 新建会话所需的字段。 */
export interface SessionCreate {
  /** 会话 id，由调用方生成。 */
  id: string;
  /** 初始标题。 */
  title: string;
  /** 初始分支末端；新建空会话为 null。 */
  tipEntryId?: string | null;
  /** 是否临时会话。 */
  ephemeral?: boolean;
  /** 当前时刻，Unix 毫秒。 */
  now: number;
}

/** 追加 entry 并移动会话引用所需的字段。 */
export interface SessionEntryAppend {
  /** 所属会话；不存在时事务整体回滚。 */
  sessionId: string;
  /** entry id，由调用方生成。 */
  id: string;
  /** 上一个 entry。 */
  parentEntryId: string | null;
  /** 记录种类。 */
  type: SessionEntryKind;
  /** 该种类专属字段。 */
  payload: unknown;
  /** 当前时刻，Unix 毫秒。 */
  now: number;
}
