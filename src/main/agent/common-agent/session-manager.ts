import type {
  AgentMessage,
  CompactionEntry,
  ModelChangeEntry,
  ProviderId,
  SessionEntry,
  SessionEntryBase,
} from '@shared/types/chat';
import { v4 as uuidv4 } from 'uuid';
import type {
  SessionEntryAppend,
  SessionEntryKind,
  SessionEntryEntity,
} from '@main/contracts/session';
import type { SessionEntryRepo } from '@main/contracts/session-repo';
import type { SessionRepo } from '@main/contracts/session-repo';

/** 会话日志所需的两个仓储，只在装配时由 `createSessionLog` 接收。 */
export interface SessionRepos {
  /** 会话行。 */
  sessionRepo: SessionRepo;
  /** entry 行。 */
  entryRepo: SessionEntryRepo;
}

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
function rowToEntry(row: SessionEntryEntity): SessionEntry | null {
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

/** 从 entry 的 payload 里提取它引用的附件 id */
function extractAttachmentIds(rows: SessionEntryEntity[]): string[] {
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

/** 一个会话当前所在分支的快照。 */
export interface BranchSnapshot {
  /** 分支末端 entry id；空会话为 null。 */
  tipEntryId: string | null;
  /** 从根到末端的 entry 序列，不认识的 type 已被丢弃。 */
  entries: SessionEntry[];
}

/** 会话日志入口：仓储在创建时绑定，调用方只传 sessionId。 */
export interface SessionLog {
  /** 为某个会话建立运行时日志视图。 */
  open(sessionId: string): SessionManager;
  /** 只读地读取某个会话当前所在的分支。 */
  load(sessionId: string): BranchSnapshot;
  /** 追加一条 entry 并把分支引用移过去。 */
  append(input: SessionEntryAppend): SessionEntryEntity;
  /**
   * 删掉一个会话的引用，并回收只被它引用的 entry。
   *
   * @returns 被回收的 entry 数量，以及这些 entry 引用过、已无人可达的附件 id
   */
  drop(sessionId: string): { count: number; attachmentIds: string[] };
}

/**
 * 创建会话日志入口。
 *
 * 仓储只在这里绑定一次；对外的函数只接收 sessionId，不再到处传仓储。
 *
 * @param repos 会话与 entry 两张表的仓储
 */
export function createSessionLog(repos: SessionRepos): SessionLog {
  /**
   * 沿父指针从某个 entry 回溯到根，再反转成「根 → 末端」的顺序。
   * 不认识的 type 直接丢弃，但父指针取自原始行，所以中间被丢弃也不会断链。
   */
  const walkUp = (tipEntryId: string): SessionEntry[] => {
    const entries: SessionEntry[] = [];
    let cursor: string | null = tipEntryId;
    while (cursor !== null) {
      const row = repos.entryRepo.findById(cursor);
      // 父指针断了就到此为止，避免死循环
      if (!row) break;
      const entry = rowToEntry(row);
      if (entry) entries.push(entry);
      cursor = row.parentEntryId;
    }
    return entries.reverse();
  };

  const load = (sessionId: string): BranchSnapshot => {
    const tipEntryId = repos.sessionRepo.findTip(sessionId);
    if (tipEntryId === null) {
      return { tipEntryId: null, entries: [] };
    }
    return { tipEntryId, entries: walkUp(tipEntryId) };
  };

  /**
   * 从某个分支末端向上收集不可达的 entry 行。
   *
   * 沿父指针往上走，遇到「还有别的孩子」或「还有别的会话把它当末端」就停下：那个节点及其祖先仍被别的分支可达，必须保留；它更靠近末端的那些节点已无人引用，可以删。
   * 向上走时要排除「自己是从哪个孩子走上来的」，否则每个节点都会因为那个孩子而被误判成有别的孩子。
   */
  const collectUnreachableRows = (tipEntryId: string): SessionEntryEntity[] => {
    const rows: SessionEntryEntity[] = [];
    let cursor: string | null = tipEntryId;
    let cameFrom: string | null = null;

    while (cursor !== null) {
      const row = repos.entryRepo.findById(cursor);
      if (!row) break;

      const otherChildren = repos.entryRepo.listChildIds(cursor).filter(id => id !== cameFrom);
      if (otherChildren.length > 0 || repos.sessionRepo.existsByTip(cursor)) break;

      rows.push(row);
      cameFrom = cursor;
      cursor = row.parentEntryId;
    }
    return rows;
  };

  const log: SessionLog = {
    open: sessionId => new SessionManager(sessionId, log),

    load,

    append: input => repos.entryRepo.appendAndMoveTip(input),

    drop: sessionId => {
      const tipEntryId = repos.sessionRepo.findTip(sessionId);
      const unreachableRows = tipEntryId === null ? [] : collectUnreachableRows(tipEntryId);

      // 会话与 entry 的删除在同一个事务里；附件属于另一个聚合，由调用方拿到 id 后清理
      repos.sessionRepo.deleteWithEntries({
        id: sessionId,
        entryIds: unreachableRows.map(row => row.id),
      });

      return {
        count: unreachableRows.length,
        attachmentIds: extractAttachmentIds(unreachableRows),
      };
    },
  };

  return log;
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

  /** 已绑定仓储的会话日志，由 `SessionLog.open` 注入。 */
  private readonly log: SessionLog;

  /** 当前分支的 entry 序列（根 → 末端），不认识的 type 已被丢弃。 */
  private entries: SessionEntry[] = [];
  /** 当前分支末端的 entry id；空会话为 null。 */
  private tip: string | null = null;

  constructor(sessionId: string, log: SessionLog) {
    this.sessionId = sessionId;
    this.log = log;
    this.load();
  }

  /** 从库重新载入当前分支，覆盖内存状态。 */
  load(): void {
    const branch = this.log.load(this.sessionId);
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
  private appendEntry(type: SessionEntryKind, payload: unknown): string {
    const id = uuidv4();
    const parentEntryId = this.tip;

    const row = this.log.append({
      sessionId: this.sessionId,
      id,
      parentEntryId,
      type,
      payload,
      now: Date.now(),
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
