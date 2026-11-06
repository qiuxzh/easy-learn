import type {
  SessionCreate,
  SessionEntryAppend,
  SessionEntryEntity,
  SessionEntity,
} from './session';

/**
 * 会话的持久化接口。
 *
 * 会话是聚合根：删除会话时，entry 的可达性回收也归这里管，跨表写入在实现内部包事务。
 */
export interface SessionRepo {
  /** 新建会话。 */
  create(input: SessionCreate): SessionEntity;
  /** 按 id 查询会话。 */
  findById(id: string): SessionEntity | undefined;
  /** 会话列表用：排除临时会话，按最近活跃倒序。 */
  listPersistent(): SessionEntity[];
  /** 修改标题。 */
  updateTitle(input: { id: string; title: string }): void;
  /** 取会话当前分支末端；空会话返回 null。 */
  findTip(id: string): string | null;
  /** 是否还有会话把该 entry 当作分支末端。 */
  existsByTip(tipEntryId: string): boolean;
  /**
   * 删除会话并回收给定的 entry，同一事务。
   *
   * @param input.id 要删除的会话
   * @param input.entryIds 已判定为不可达、可以一并删除的 entry
   */
  deleteWithEntries(input: { id: string; entryIds: string[] }): void;
}
/** 会话日志中 entry 的持久化接口。 */
export interface SessionEntryRepo {
  /** 按 id 查询 entry。 */
  findById(id: string): SessionEntryEntity | undefined;
  /** 某个 entry 的全部直接子节点 id，用于分叉点判断与可达性回收。 */
  listChildIds(parentEntryId: string): string[];
  /**
   * 追加 entry 并把会话引用移到它上面，同一事务。
   *
   * @returns 落库后的 entry
   * @throws 会话不存在，事务整体回滚，避免留下没有分支引用的孤儿 entry
   */
  appendAndMoveTip(input: SessionEntryAppend): SessionEntryEntity;
  /** 删除若干 entry，用于可达性回收。 */
  deleteByIds(ids: string[]): void;
}
