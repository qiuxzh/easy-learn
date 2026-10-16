import type {
  AgentMessage,
  CompactionEntry,
  ModelChangeEntry,
  ProviderId,
  SessionEntry,
  SessionEntryBase,
} from '@shared/types/chat';
import { v4 as uuidv4 } from 'uuid';
import log from 'electron-log';
import { agentEntryRepo, agentSessionRepo, attachmentRepo } from '../../db/repo';
import type { AgentEntryRow } from '../../db/repo';
import { runInTransaction } from '../../db';
import { attachmentService } from '../../service/attachment-service';

/**
 * 由会话日志推导出的上下文快照。
 */
export interface SessionContext {
  /** 进入 LLM 上下文的消息，已按 compaction 截断。 */
  messages: AgentMessage[];
  /** 会话最近使用的模型；会话内还没有助手消息时为 null。 */
  model: { provider: ProviderId; modelId: string } | null;
}

/** 取最后一条 compaction entry，没有则返回 null。 */
export function getLatestCompaction(entries: SessionEntry[]): CompactionEntry | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry.type === 'compaction') {
      return entry;
    }
  }
  return null;
}

/** 扫描全部 entry，得到会话当前生效的模型。 */
function getSessionContextSettings(entries: SessionEntry[]): Pick<SessionContext, 'model'> {
  let model: SessionContext['model'] = null;

  for (const entry of entries) {
    // TODO 未开发 model_change 的消息，因此获取到的model和thinking是不准确的
    if (entry.type === 'model_change') {
      model = { provider: entry.provider, modelId: entry.modelId };
    } else if (entry.type === 'message' && entry.message.role === 'assistant') {
      model = { provider: entry.message.provider, modelId: entry.message.model };
    }
  }

  return { model };
}

/**
 * 把单条 entry 投影为进入 LLM 上下文的消息。
 * 变更类 entry 不产出消息；compaction 产出一条承载摘要的用户消息，顶替被它截断的历史。
 */
export function sessionEntryToContextMessages(entry: SessionEntry): AgentMessage[] {
  if (entry.type === 'message') {
    return [entry.message];
  }
  if (entry.type === 'compaction') {
    return [{ role: 'user', content: entry.summary, timestamp: entry.timestamp }];
  }
  return [];
}

/**
 * 计算参与 LLM 上下文的 entry 列表。
 * 传进来的 entry 列表本身就是一条分支（根 → 末端）；存在 compaction 时，最新 compaction 之前、firstKeptEntryId 之前的 entry 由摘要顶替。
 */
export function buildContextEntries(entries: SessionEntry[]): SessionEntry[] {
  const compaction = getLatestCompaction(entries);
  if (!compaction) {
    return entries;
  }

  const compactionIdx = entries.findIndex(entry => entry.id === compaction.id);
  if (compactionIdx < 0) {
    return entries;
  }

  const contextEntries: SessionEntry[] = [compaction];
  let foundFirstKept = false;
  for (let i = 0; i < compactionIdx; i++) {
    if (entries[i].id === compaction.firstKeptEntryId) {
      foundFirstKept = true;
    }
    if (foundFirstKept) {
      contextEntries.push(entries[i]);
    }
  }
  contextEntries.push(...entries.slice(compactionIdx + 1));
  return contextEntries;
}

/** 把一条分支合成为一次运行所需的上下文快照。 */
export function buildSessionContext(entries: SessionEntry[]): SessionContext {
  const messages = buildContextEntries(entries).flatMap(sessionEntryToContextMessages);
  return { messages, ...getSessionContextSettings(entries) };
}

/**
 * 把库中的一行 entry 还原为内存结构。
 * payload 在 db 层以 unknown 存储，此处按 type 收窄；未知 type 返回 null 由调用方丢弃。
 */
function rowToEntry(row: AgentEntryRow): SessionEntry | null {
  const base = { id: row.id, timestamp: row.createdAt };
  switch (row.type) {
    case 'message':
      return { ...base, type: 'message', message: row.payload as AgentMessage };
    case 'model_change':
      return {
        ...base,
        type: 'model_change',
        ...(row.payload as Pick<ModelChangeEntry, 'provider' | 'modelId'>),
      };
    case 'compaction':
      return {
        ...base,
        type: 'compaction',
        ...(row.payload as Pick<
          CompactionEntry,
          'summary' | 'firstKeptEntryId' | 'tokensBefore' | 'usage'
        >),
      };
    default:
      return null;
  }
}

/* ───────────────────────── 分支（一棵 entry 树里的一条路径） ───────────────────────── */

/**
 * 沿父指针从某个 entry 回溯到根，再反转成「根 → 末端」的顺序。
 * 不认识的 type 直接丢弃，但父指针取自原始行，所以中间被丢弃也不会断链。
 */
function walkUp(tipEntryId: string): SessionEntry[] {
  const entries: SessionEntry[] = [];
  let cursor: string | null = tipEntryId;
  while (cursor !== null) {
    const row = agentEntryRepo.findById(cursor);
    // 父指针断了就到此为止，避免死循环
    if (!row) break;
    const entry = rowToEntry(row);
    if (entry) entries.push(entry);
    cursor = row.parentEntryId;
  }
  return entries.reverse();
}

/** 一个会话当前所在分支的快照。 */
export interface BranchSnapshot {
  /** 分支末端 entry id；空会话为 null。 */
  tipEntryId: string | null;
  /** 从根到末端的 entry 序列，不认识的 type 已被丢弃。 */
  entries: SessionEntry[];
}

/**
 * 读一个会话当前所在的分支：先读它的引用（tip），再沿父指针回溯。
 * 只读场景（打开历史会话）直接用它，不必建 SessionManager 实例。
 */
export function loadBranch(sessionId: string): BranchSnapshot {
  const tipEntryId = agentSessionRepo.findTip(sessionId);
  if (tipEntryId === null) {
    return { tipEntryId: null, entries: [] };
  }
  return { tipEntryId, entries: walkUp(tipEntryId) };
}

/** 从 entry 的 payload 里提取它引用的附件 id */
function extractAttachmentIds(rows: AgentEntryRow[]): string[] {
  const ids: string[] = [];
  for (const row of rows) {
    if (row.type !== 'message') continue;
    const payload = row.payload as { message?: { content?: unknown } };
    const content = payload.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (
        block &&
        typeof block === 'object' &&
        (block as { type?: unknown }).type === 'image' &&
        typeof (block as { attachmentId?: unknown }).attachmentId === 'string'
      ) {
        ids.push((block as { attachmentId: string }).attachmentId);
      }
    }
  }
  return ids;
}

/**
 * 从某个分支末端向上收集不可达的 entry 行。
 *
 * 沿父指针往上走，遇到「还有别的孩子」或「还有别的会话把它当末端」就停下：那个节点及其祖先仍被别的分支可达，必须保留；它更靠近末端的那些节点已无人引用，可以删。
 * 向上走时要排除「自己是从哪个孩子走上来的」，否则每个节点都会因为那个孩子而被误判成有别的孩子。
 *
 * @param tipEntryId - 刚被删掉引用所指向的末端
 * @returns 被回收的 entry 数量
 */
function collectUnreachableRows(tipEntryId: string): AgentEntryRow[] {
  const rows: AgentEntryRow[] = [];
  let cursor: string | null = tipEntryId;
  let cameFrom: string | null = null;

  while (cursor !== null) {
    const row = agentEntryRepo.findById(cursor);
    if (!row) break;

    const otherChildren = agentEntryRepo.listChildIds(cursor).filter(id => id !== cameFrom);
    if (otherChildren.length > 0 || agentSessionRepo.existsByTip(cursor)) break;

    rows.push(row);
    cameFrom = cursor;
    cursor = row.parentEntryId;
  }
  return rows;
}

/** 删除 entry 引用的附件行，返回被删附件的相对路径供事务提交后删文件 */
function dropAttachmentsOfEntries(rows: AgentEntryRow[]): string[] {
  const attachmentIds = extractAttachmentIds(rows);
  if (attachmentIds.length === 0) return [];

  let paths: string[] = [];
  try {
    paths = attachmentRepo.findByIds(attachmentIds).map(row => row.path);
  } catch (error) {
    log.error('[SessionManager] 查询 entry 附件失败:', error);
    return [];
  }
  try {
    attachmentRepo.deleteByIds(attachmentIds);
  } catch (error) {
    log.error('[SessionManager] 回收 entry 附件失败:', error);
    return [];
  }
  return paths;
}

/**
 * 删掉一个会话的引用，并回收只被它引用的 entry
 *
 * @returns 被回收的 entry 数量
 */
export function dropSessionBranch(sessionId: string): number {
  const tipEntryId = agentSessionRepo.findTip(sessionId);
  // 删会话与回收在同一个事务里。别的分支共享的那段历史会被可达性判断保留下来，所以删除永远不连坐
  const result = runInTransaction(() => {
    agentSessionRepo.delete(sessionId);
    if (tipEntryId === null) {
      return { count: 0, attachmentPaths: [] as string[] };
    }

    const unreachableRows = collectUnreachableRows(tipEntryId);
    agentEntryRepo.deleteByIds(unreachableRows.map(row => row.id));
    const attachmentPaths = dropAttachmentsOfEntries(unreachableRows);
    return { count: unreachableRows.length, attachmentPaths };
  });

  // 事务提交后再删附件文件
  void attachmentService.deleteFiles(result.attachmentPaths);
  return result.count;
}

/* ───────────────────────────────── 运行时视图 ───────────────────────────────── */

/**
 * 单个会话的运行时日志视图：**当前所在的那条分支**，以及往它追加。
 * 会话本身只是「指向某个 entry 的引用」，所以这里同时维护那个引用（tip）并在每次追加后移动它。
 * 一个 sessionId 同时只应存在一个实例，由 SessionService 的运行时池保证。
 */
export class SessionManager {
  /** 所属会话 id。 */
  readonly sessionId: string;

  /** 当前分支的 entry 序列（根 → 末端），不认识的 type 已被丢弃。 */
  private entries: SessionEntry[] = [];
  /** 当前分支末端的 entry id；空会话为 null。 */
  private tip: string | null = null;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
    this.load();
  }

  /** 从库重新载入当前分支，覆盖内存状态。 */
  load(): void {
    const branch = loadBranch(this.sessionId);
    this.entries = branch.entries;
    this.tip = branch.tipEntryId;
  }

  /** 当前分支末端 entry id；空会话为 null。 */
  get tipEntryId(): string | null {
    return this.tip;
  }

  /** 只读的当前分支 entry 序列。 */
  getEntries(): readonly SessionEntry[] {
    return this.entries;
  }

  /** 按 id 查 entry。只在当前分支上找，别的分支的 entry 不在这里。 */
  getEntry(id: string): SessionEntry | undefined {
    return this.entries.find(entry => entry.id === id);
  }

  /**
   * 往当前分支追加一条 entry，并把会话的引用移到它上面。
   * 父 = 当前末端；插 entry 与移动引用在同一个事务里，失败时内存不变。
   * 变更类 entry 不承载消息，只用于回放会话的运行期设置。
   *
   * @returns 新 entry 的 id，供调用方随事件带给渲染层
   */
  private appendEntry(type: 'message' | 'model_change' | 'compaction', payload: unknown): string {
    const id = uuidv4();
    const parentEntryId = this.tip;

    const row = runInTransaction(() => {
      const inserted = agentEntryRepo.append({ id, parentEntryId, type, payload });
      const updated = agentSessionRepo.setTip(this.sessionId, id);
      // 会话行不存在就整体回滚，避免留下一条没有任何分支引用的孤儿 entry
      // （旧结构里这件事由 entry.session_id 的外键兜住，新结构没有外键了）
      if (updated.changes !== 1) {
        throw new Error(`会话不存在: ${this.sessionId}`);
      }
      return inserted;
    });

    const entry = rowToEntry(row);
    if (entry) {
      this.entries.push(entry);
    }
    this.tip = id;
    return id;
  }

  /**
   * 把一条 LLM 消息追加进当前分支。
   * @returns 该消息在会话树里的 entry id
   */
  appendMessage(message: AgentMessage): string {
    return this.appendEntry('message', message);
  }

  /** 记录一次模型变更。 */
  appendModelChange(provider: ProviderId, modelId: string): void {
    this.appendEntry('model_change', { provider, modelId });
  }

  /**
   * 追加一条压缩标记：summary 顶替 firstKeptEntryId 之前的历史消息。
   * 被顶替的 entry 仍留在日志里，只是不再进入上下文。
   */
  appendCompaction(compaction: Omit<CompactionEntry, keyof SessionEntryBase>): void {
    this.appendEntry('compaction', compaction);
  }

  /** 由当前分支构建上下文快照。 */
  buildContext(): SessionContext {
    return buildSessionContext(this.entries);
  }
}
