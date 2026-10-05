import type {
  AgentMessage,
  CompactionEntry,
  ModelChangeEntry,
  ProviderId,
  SessionEntry,
  SessionEntryBase,
} from '@shared/types/chat';
import { agentEntryRepo, agentSessionRepo } from '../../db/repo';
import type { AgentEntryRow } from '../../db/repo';

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
 * 线性日志下 entry 列表本身就是路径；存在 compaction 时，最新 compaction 之前、firstKeptEntryId 之前的 entry 由摘要顶替。
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

/** 把会话日志合成为一次运行所需的上下文快照。 */
export function buildSessionContext(entries: SessionEntry[]): SessionContext {
  const messages = buildContextEntries(entries).flatMap(sessionEntryToContextMessages);
  return { messages, ...getSessionContextSettings(entries) };
}

/**
 * 把库中的一行 entry 还原为内存结构。
 * payload 在 db 层以 unknown 存储，此处按 type 收窄；未知 type 返回 null 由调用方丢弃。
 */
function rowToEntry(row: AgentEntryRow): SessionEntry | null {
  const base = { id: row.id, seq: row.seq, timestamp: row.createdAt };
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

/**
 * 从库读取某会话的全部 entry，按 seq 升序。
 * 运行时会话由 SessionManager 持有；只读场景（打开历史会话）直接用它，不必建实例。
 */
export function loadSessionEntries(sessionId: string): SessionEntry[] {
  return agentEntryRepo
    .findBySessionId(sessionId)
    .map(rowToEntry)
    .filter((entry): entry is SessionEntry => entry !== null);
}

/**
 * 单个会话的日志管理：构造时从库载入，写库成功后同步内存列表。
 * 一个 sessionId 同时只应存在一个实例，由 SessionService 的运行时池保证。
 */
export class SessionManager {
  /** 所属会话 id。 */
  readonly sessionId: string;
  /** 会话表（agent_session）读写入口。 */
  readonly sessionRepo = agentSessionRepo;
  /** 会话日志表（agent_entry）读写入口。 */
  readonly entryRepo = agentEntryRepo;

  /** 内存中的 entry 列表，按 seq 升序，与库保持一致。 */
  private entries: SessionEntry[] = [];

  constructor(sessionId: string) {
    this.sessionId = sessionId;
    this.load();
  }

  /** 从库重新载入该会话的全部 entry，覆盖内存列表。 */
  load(): void {
    this.entries = loadSessionEntries(this.sessionId);
  }

  /** 只读的 entry 列表，按 seq 升序。 */
  getEntries(): readonly SessionEntry[] {
    return this.entries;
  }

  /** 按 id 查 entry。线性查找，会话内 entry 数量有限。 */
  getEntry(id: string): SessionEntry | undefined {
    return this.entries.find(entry => entry.id === id);
  }

  /**
   * 追加一条 entry：写库成功后同步内存列表，并刷新会话活跃时间。
   * 变更类 entry 不承载消息，只用于回放会话的运行期设置。
   */
  private appendEntry(type: 'message' | 'model_change' | 'compaction', payload: unknown): void {
    const row = this.entryRepo.append({
      sessionId: this.sessionId,
      seq: this.entryRepo.nextSeq(this.sessionId),
      type,
      payload,
    });
    const entry = rowToEntry(row);
    if (entry) {
      this.entries.push(entry);
    }
    this.sessionRepo.touch(this.sessionId);
  }

  /** 把一条 LLM 消息追加进会话日志。 */
  appendMessage(message: AgentMessage): void {
    this.appendEntry('message', message);
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

  /** 由当前会话日志构建上下文快照。 */
  buildContext(): SessionContext {
    return buildSessionContext(this.entries);
  }
}
